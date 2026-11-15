import { invoke } from "@tauri-apps/api/core";
import { createScene } from "./scene.js";

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
  ["biome", "Биом", "text"],
  ["symmetryType", "Симметрия", ["none", "terrain", "terrain and CSG"]],
  ["symmetricalMetal", "Симметричный металл", "checkbox"],
];

const $ = (id) => document.getElementById(id);
const scene = createScene($("view"));
let systems = [];
let current = null;

function buildParams() {
  const box = $("params");
  for (const [key, title, type] of FIELDS) {
    const label = document.createElement("label");
    label.textContent = title;
    let input;
    if (Array.isArray(type)) {
      input = document.createElement("select");
      for (const v of type) input.add(new Option(v, v));
    } else {
      input = document.createElement("input");
      input.type = type;
      if (type === "number") input.step = "any";
    }
    input.id = `p_${key}`;
    label.append(input);
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
  const g = { ...(current?.planet ?? {}) };
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
  (s?.planets ?? []).forEach((p, j) => sel.add(new Option(`${p.name ?? j} (${p.planet?.biome ?? "?"})`, j)));
  selectPlanet(0);
}

function selectPlanet(j) {
  current = systems[$("system").value]?.planets?.[j] ?? null;
  if (current) fillParams(current.planet ?? {});
}

async function run() {
  if (!current) return;
  const btn = $("run");
  btn.disabled = true;
  $("stats").className = "";
  $("stats").textContent = "генерация…";
  try {
    const t0 = performance.now();
    const planet = await invoke("generate", { planet: { planet: readParams() }, maxSlope: Number($("slope").value) });
    const ms = performance.now() - t0;
    scene.show(planet);
    applyToggles();
    showStats(planet, ms);
  } catch (e) {
    $("stats").className = "error";
    $("stats").textContent = String(e);
  } finally {
    btn.disabled = false;
  }
}

function showStats(p, ms) {
  const m = p.metal;
  const lines = [
    `биом ${p.biome}, радиус ${p.radius}`,
    `плит на грань ${p.plates}, треугольников ${p.triangles.length}`,
    `рельеф ${p.min_radius.toFixed(1)}…${p.max_radius.toFixed(1)}`,
    `вода ${p.water_radius?.toFixed(2) ?? "нет"}`,
    `лава ${p.lava_radius?.toFixed(2) ?? "нет"}`,
    `кандидатов ${m.candidates.length}, точек металла ${m.spots.length}`,
    `время ${ms.toFixed(0)} мс`,
  ];
  if (m.limit_is_random) lines.push("задан лимит точек: игра обрезает их в случайном порядке");
  $("stats").textContent = lines.join("\n");
}

function applyToggles() {
  scene.toggle({
    water: $("showWater").checked,
    metal: $("showMetal").checked,
    candidates: $("showCand").checked,
    wire: $("showWire").checked,
  });
}

buildParams();
$("system").onchange = (e) => selectSystem(Number(e.target.value));
$("planet").onchange = (e) => selectPlanet(Number(e.target.value));
$("run").onclick = run;
for (const id of ["showWater", "showMetal", "showCand", "showWire"]) $(id).onchange = applyToggles;
$("file").onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const doc = JSON.parse((await f.text()).replace(/^﻿/, ""));
  const sys = doc.planets ? doc : { name: f.name, planets: [doc.planet ? doc : { name: f.name, planet: doc }] };
  setSystems([sys, ...systems.filter((s) => !s.__file)].map((s, i) => (i === 0 ? { ...s, __file: true } : s)));
  run();
};

if (!window.__TAURI_INTERNALS__) {
  $("stats").className = "error";
  $("stats").textContent = "Страница открыта без Tauri: запустите npm run tauri dev.";
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
      run();
    })
    .catch((e) => {
      $("stats").className = "error";
      $("stats").textContent = `системы игры не прочитаны: ${e}`;
    });
}
