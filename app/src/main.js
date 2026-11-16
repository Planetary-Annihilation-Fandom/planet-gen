import { invoke } from "@tauri-apps/api/core";
import { createScene, loadTexture } from "./scene.js";

// Поля генератора системы, которые можно править перед генерацией.
const FIELDS = [
  ["seed", "Зерно", "number"],
  ["radius", "Радиус", "number"],
  ["heightRange", "Перепад высот", "number"],
  ["waterHeight", "Уровень воды", "number"],
  ["waterDepth", "Глубина воды", "number"],
  ["biomeScale", "Масштаб биома", "number"],
  ["temperature", "Температура", "number"],
  ["metalDensity", "Плотность металла", "number"],
  ["metalClusters", "Кластеры металла", "number"],
  ["metalSpotLimit", "Лимит точек", "number"],
  ["biome", "Архетип", "text"],
  ["symmetryType", "Симметрия", ["none", "terrain", "terrain and CSG"]],
  ["symmetricalMetal", "Симметричный металл", "checkbox"],
];

// Архетипы, которые предлагает редактор систем игры.
const ARCHETYPES = ["earth", "tropical", "desert", "moon", "lava", "metal", "asteroid"];

const $ = (id) => document.getElementById(id);
const scene = createScene($("view"));
let systems = [];
let mode = "existing";
let current = null; // объект планеты системы: { name, planet, planetCSG, ... }
let randomPlanet = null;

function buildParams() {
  const box = $("params");
  for (const [key, title, type] of FIELDS) {
    const label = document.createElement("label");
    label.className = "field";
    let input;
    if (Array.isArray(type)) {
      input = document.createElement("select");
      for (const v of type) input.add(new Option(v, v));
      label.classList.add("wide");
    } else {
      input = document.createElement("input");
      input.type = type;
      if (type === "number") input.step = "any";
      if (type === "checkbox") label.classList.add("check", "wide");
      if (type === "text") label.classList.add("wide");
    }
    input.id = `p_${key}`;
    if (type === "checkbox") label.append(input, title);
    else label.append(title, input);
    box.append(label);
  }
}

function fillParams(g) {
  for (const [key, , type] of FIELDS) {
    const el = $(`p_${key}`);
    const v = g[key];
    if (type === "checkbox") el.checked = !!v;
    else el.value = v ?? (key === "metalSpotLimit" ? -1 : key === "symmetryType" ? "none" : "");
  }
}

function readParams() {
  const src = mode === "random" ? randomPlanet : current;
  const g = { ...(src?.planet ?? {}) };
  for (const [key, , type] of FIELDS) {
    const el = $(`p_${key}`);
    if (type === "checkbox") g[key] = el.checked;
    else if (type === "number") {
      if (el.value !== "") g[key] = Number(el.value);
    } else g[key] = el.value;
  }
  return g;
}

function setSystems(list, select = 0) {
  systems = list;
  const sel = $("system");
  sel.innerHTML = "";
  list.forEach((s, i) => sel.add(new Option(s.name ?? `система ${i}`, i)));
  sel.value = select;
  selectSystem(select);
}

function selectSystem(i) {
  const s = systems[i];
  const sel = $("planet");
  sel.innerHTML = "";
  (s?.planets ?? []).forEach((p, j) => sel.add(new Option(`${p.name ?? j} · ${p.planet?.biome ?? "?"}`, j)));
  selectPlanet(0);
}

function selectPlanet(j) {
  current = systems[$("system").value]?.planets?.[j] ?? null;
  if (current) fillParams(current.planet ?? {});
}

// Случайная планета в пределах ползунков редактора систем игры.
function rollRandom() {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const int = (a, b) => Math.round(rnd(a, b));
  const biome = $("rndBiome").value;
  let lo = Number($("rndRadiusMin").value) || 300;
  let hi = Number($("rndRadiusMax").value) || 900;
  if (lo > hi) [lo, hi] = [hi, lo];
  const wet = biome === "earth" || biome === "tropical";
  const planet = {
    seed: int(0, 32767),
    radius: Math.round(rnd(lo, hi) / 10) * 10,
    heightRange: int(10, 60),
    waterHeight: wet ? int(25, 60) : int(0, 40),
    waterDepth: int(25, 75),
    biomeScale: int(50, 100),
    temperature: biome === "tropical" || biome === "desert" ? int(70, 100) : int(20, 100),
    metalDensity: int(20, 100),
    metalClusters: int(20, 100),
    metalSpotLimit: -1,
    biome,
    symmetryType: "none",
    symmetricalMetal: false,
    mass: 10000,
  };
  randomPlanet = { name: `${biome} #${planet.seed}`, planet, planetCSG: [] };
  fillParams(planet);
}

function setMode(m) {
  mode = m;
  $("modeExisting").classList.toggle("on", m === "existing");
  $("modeRandom").classList.toggle("on", m === "random");
  $("existing").hidden = m !== "existing";
  $("random").hidden = m !== "random";
  if (m === "random") {
    if (!randomPlanet) rollRandom();
    else fillParams(randomPlanet.planet);
  } else if (current) fillParams(current.planet ?? {});
}

function toast(text, err = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = err ? "err" : "";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), err ? 8000 : 3000);
}

async function run() {
  const src = mode === "random" ? randomPlanet : current;
  if (!src) return;
  const btn = $("run");
  btn.disabled = true;
  $("status").hidden = false;
  $("status").textContent = "Генерация…";
  try {
    const t0 = performance.now();
    const planet = await invoke("generate", {
      planet: { planet: readParams(), planetCSG: src.planetCSG ?? [] },
      maxSlope: Number($("slope").value),
    });
    const ms = performance.now() - t0;
    $("status").textContent = "Загрузка текстур…";
    await scene.show(planet);
    applyToggles();
    const sysName = mode === "random" ? "случайная планета" : systems[$("system").value]?.name ?? "";
    showResult(planet, src.name ?? "планета", sysName, ms);
  } catch (e) {
    toast(String(e), true);
  } finally {
    btn.disabled = false;
    $("status").hidden = true;
  }
}

function showResult(p, name, sysName, ms) {
  const m = p.metal;
  $("title").querySelector(".main").textContent = name;
  $("title").querySelector(".sub").textContent = `${sysName} · ${p.biome}, радиус ${p.radius}`;
  $("cardTitle").textContent = name;
  const rows = [
    ["Архетип", p.biome],
    ["Плит на грань", p.plates],
    ["Треугольников", p.triangles.length],
    ["Рельеф", `${p.min_radius.toFixed(1)} … ${p.max_radius.toFixed(1)}`],
    ["Вода", p.water_radius?.toFixed(2) ?? "нет"],
    ["Лава", p.lava_radius?.toFixed(2) ?? "нет"],
    ["Кандидатов металла", m.candidates.length],
    ["Точек металла", m.spots.length],
    ["Время генерации", `${ms.toFixed(0)} мс`],
  ];
  $("stats").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

  const counts = p.biomes.map(() => 0);
  for (const b of p.biome_index) counts[b]++;
  const total = Math.max(p.biome_index.length, 1);
  const box = $("biomes");
  box.innerHTML = "";
  p.biomes.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "biome" + (counts[i] ? "" : " off");
    const [r, g, bl] = b.color.map((c) => Math.round(c * 255));
    row.style.setProperty("--c", `rgb(${r},${g},${bl})`);
    const sw = document.createElement("canvas");
    sw.width = sw.height = 28;
    row.append(sw);
    const pct = (100 * counts[i]) / total;
    row.insertAdjacentHTML(
      "beforeend",
      `<span>${b.name}</span><b>${pct.toFixed(1)}%</b><div class="bar"><div style="width:${pct}%"></div></div>`,
    );
    box.append(row);
    if (b.base_texture) {
      loadTexture(b.base_texture)
        .then((img) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
          sw.getContext("2d").drawImage(c, 0, 0, img.width, img.height, 0, 0, 28, 28);
        })
        .catch(() => {});
    }
  });

  const add = p.csg.brushes.filter((b) => b.op === "Add").length;
  const sub = p.csg.brushes.length - add;
  $("csg").innerHTML = p.csg.brushes.length
    ? `Сложение ${add}, вычитание ${sub}. Булевы операции применены к поверхности и кистям.` +
      (p.csg.skipped.length ? `<br>Пропущено ${p.csg.skipped.length}: ${p.csg.skipped.map((s) => s[0]).join(", ")}` : "")
    : "В планете нет кистей.";
  $("note").textContent = m.limit_is_random
    ? "Задан лимит точек металла: игра обрезает их в случайном порядке, поэтому набор точек может отличаться."
    : "";
}

const TOGGLES = { tTex: "textures", tWater: "water", tCsg: "csg", tSub: "subtract", tMetal: "metal", tCand: "candidates", tWire: "wire" };

function applyToggles() {
  const o = {};
  for (const [id, key] of Object.entries(TOGGLES)) o[key] = $(id).classList.contains("on");
  scene.toggle(o);
}

buildParams();
for (const a of ARCHETYPES) $("rndBiome").add(new Option(a, a));
$("modeExisting").onclick = () => setMode("existing");
$("modeRandom").onclick = () => setMode("random");
$("reroll").onclick = () => {
  rollRandom();
  run();
};
$("rndBiome").onchange = () => {
  rollRandom();
  run();
};
$("system").onchange = (e) => selectSystem(Number(e.target.value));
$("planet").onchange = (e) => {
  selectPlanet(Number(e.target.value));
  run();
};
$("run").onclick = run;
for (const id of Object.keys(TOGGLES)) {
  $(id).onclick = () => {
    $(id).classList.toggle("on");
    applyToggles();
  };
}
$("file").onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const doc = JSON.parse((await f.text()).replace(/^﻿/, ""));
  const sys = doc.planets ? doc : { name: f.name, planets: [doc.planet ? doc : { name: f.name, planet: doc }] };
  setSystems([{ ...sys, __file: true }, ...systems.filter((s) => !s.__file)]);
  setMode("existing");
  run();
};

if (!window.__TAURI_INTERNALS__) {
  toast("Страница открыта без Tauri: запустите npx tauri dev.", true);
} else {
  Promise.all([invoke("default_systems").catch(() => []), invoke("startup_args")])
    .then(async ([list, args]) => {
      if (args.path) {
        const doc = await invoke("read_system", { path: args.path });
        const sys = doc.planets ? doc : { name: args.path, planets: [doc] };
        setSystems([{ ...sys, __file: true }, ...list]);
        $("planet").value = args.planet;
        selectPlanet(args.planet);
      } else setSystems(list);
      if (args.random) {
        $("rndBiome").value = args.random;
        setMode("random");
      }
      run();
    })
    .catch((e) => toast(`Системы игры не прочитаны: ${e}`, true));
}
