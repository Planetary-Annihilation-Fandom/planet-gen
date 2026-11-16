import neighbors from "./templates/neighbor_fronts.json";
import shared from "./templates/shared_regions.json";
import { validateTemplate, applyTemplate, cleanBasePlanet } from "./template-engine.js";
import { createTemplateGraph } from "./template-graph.js";
import { iconSVG } from "./icons.js";

const $ = (id) => document.getElementById(id);
const STORAGE = "planet-gen.templates.v1";
export function createTemplateMode(scene, toast) {
  let templates = [neighbors, shared], base = null, applied = null, selected = null, active = false, timer;
  const source = { name: "Основа шаблона", planet: { seed: 42, radius: 500, heightRange: 18, waterHeight: 0, waterDepth: 0, biomeScale: 65, temperature: 80, metalDensity: 0, metalClusters: 0, metalSpotLimit: 0, biome: "desert", symmetryType: "none", symmetricalMetal: false, mass: 10000 }, planetCSG: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    if (!Array.isArray(saved) || saved.length > 50) throw new Error("Некорректный список шаблонов");
    for (const t of saved) { validateTemplate(t); if (!templates.some((v) => v.id === t.id)) templates.push(t); }
  } catch (e) { toast(`Сохранённые шаблоны не загружены: ${e.message}`, true); }
  const graph = createTemplateGraph($("nodeCanvas"), select);
  for (const kind of ["spawn", "metal", "blocker", "ramp"]) {
    const label = document.querySelector(`[data-applied-layer="${kind}"]`).closest("label");
    label.insertBefore(iconSVG(kind), label.childNodes[1]);
  }
  const template = () => templates.find((t) => t.id === $("templateSelect").value) ?? templates[0];
  function fillList(id = templates[0].id) {
    $("templateSelect").replaceChildren(...templates.map((t) => new Option(t.name, t.id)));
    $("templateSelect").value = id;
  }
  function syncTemplate(reset = true) {
    const t = template();
    $("templateDescription").textContent = t.description ?? "";
    $("templateId").textContent = t.id;
    $("players").min = t.players.min; $("players").max = t.players.max;
    $("players").value = reset ? t.players.default : Math.max(t.players.min, Math.min(t.players.max, Number($("players").value)));
    selected = null; regenerate();
  }
  function layers() {
    const options = {};
    for (const el of document.querySelectorAll("[data-applied-layer]")) options[el.dataset.appliedLayer] = el.checked;
    scene.toggleApplied(options);
  }
  function select(id) {
    selected = id;
    graph.select(id); if (active) scene.selectNode(id);
    const rule = applied?.template.nodes.find((n) => n.id === id);
    $("nodeTitle").textContent = rule?.name ?? "Выберите ноду или область на планете";
    $("nodeDetails").textContent = rule ? JSON.stringify({ rule, instances: applied.zones.filter((z) => z.nodeId === id).map((z) => ({ id: z.id, owner: z.owner === null ? null : z.owner + 1, metal: z.points.length })) }, null, 2) : "";
  }
  function regenerate() {
    clearTimeout(timer);
    try {
      const t0 = performance.now();
      const next = applyTemplate(template(), { players: Number($("players").value), seed: Number($("templateSeed").value), metalScale: Number($("metalScale").value) });
      applied = next;
      if (base && active) { applied.result = scene.setApplied(applied, select); layers(); }
      graph.show(applied); select(selected);
      $("appliedStats").textContent = `${applied.parameters.players} игроков   ${applied.zones.length} областей   ${applied.debug.metal} металла   ${(performance.now()-t0).toFixed(0)} мс`;
      $("templateNotice").textContent = base ? applied.debug.balance : "Сгенерируйте основу, чтобы увидеть шаблон на планете.";
      $("exportResult").disabled = !base;
    } catch (e) { $("templateNotice").textContent = e.message; }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(regenerate, 120); };
  function download(name, object) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function addTemplate(t) {
    validateTemplate(t);
    if (templates.some((v) => v.id === t.id)) throw new Error(`Шаблон ${t.id} уже существует; используйте другой id`);
    if (templates.length >= 52) throw new Error("Сохранено слишком много шаблонов");
    const next = [...templates, t];
    localStorage.setItem(STORAGE, JSON.stringify(next.slice(2)));
    templates = next; fillList(t.id); syncTemplate();
  }
  fillList(); syncTemplate();
  $("templateSelect").onchange = () => syncTemplate();
  for (const id of ["players", "templateSeed", "metalScale"]) $(id).addEventListener("input", schedule);
  $("rerollTemplate").onclick = () => { $("templateSeed").value = crypto.getRandomValues(new Uint32Array(1))[0]; regenerate(); };
  $("fitGraph").onclick = graph.fit;
  $("clearSelection").onclick = () => select(null);
  for (const el of document.querySelectorAll("[data-applied-layer]")) el.onchange = layers;
  $("exportTemplate").onclick = () => download(`${template().id}.json`, template());
  $("exportResult").onclick = () => download(`${template().id}-result.json`, { base, applied });
  $("importTemplate").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      if (f.size > 256000) throw new Error("JSON шаблона должен быть меньше 256 КБ");
      addTemplate(JSON.parse((await f.text()).replace(/^\uFEFF/, "")));
    } catch (err) { toast(err.message, true); }
    e.target.value = "";
  };
  $("newTemplate").onclick = () => { $("newTemplateError").textContent = ""; $("newTemplateDialog").showModal(); $("newTemplateId").focus(); };
  $("cancelTemplate").onclick = () => $("newTemplateDialog").close();
  $("newTemplateForm").onsubmit = (e) => {
    e.preventDefault();
    try {
      const t = structuredClone(template()); t.id = $("newTemplateId").value.trim(); t.name = $("newTemplateName").value.trim();
      addTemplate(t); $("newTemplateDialog").close(); toast("Заготовка создана на основе выбранного шаблона. Её JSON можно сохранить.");
    } catch (err) { $("newTemplateError").textContent = err.message; }
  };
  return { source,
    enter() { active = true; regenerate(); },
    leave() { active = false; clearTimeout(timer); scene.setApplied(null); },
    async accept(result, parameters) {
      base = cleanBasePlanet(result, parameters); source.planet = { ...parameters };
      await scene.show(base.result, { template: true }); regenerate();
      return base.result;
    },
    async restore() { if (base) { await scene.show(base.result, { template: true }); regenerate(); return base.result; } return null; },
  };
}
