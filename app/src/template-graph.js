import { KINDS } from "./template-engine.js";
import { iconSVG } from "./icons.js";
const NS = "http://www.w3.org/2000/svg";
const titles = { spawn: "Спавн", metal: "Металл", blocker: "Блокер", ramp: "Рампа" };
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createTemplateGraph(host, onSelect) {
  const root = svg("svg", { role: "img", "aria-label": "Ноды шаблона. Колесо меняет масштаб, перетаскивание перемещает граф" });
  host.replaceChildren(root);
  let data, selected = null, view = { x: 0, y: 0, w: 460, h: 640 }, drag = null;
  const update = () => root.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect(), factor = e.deltaY > 0 ? 1.1 : 1/1.1;
    const w = Math.max(220, Math.min(1600, view.w * factor)), ratio = w / view.w;
    view.x += view.w * (e.clientX-r.left)/r.width * (1-ratio);
    view.y += view.h * (e.clientY-r.top)/r.height * (1-ratio);
    view.w = w; view.h *= ratio; update();
  }, { passive: false });
  root.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-node]")) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = root.getBoundingClientRect();
    view.x = drag.vx - (e.clientX-drag.x)*view.w/r.width;
    view.y = drag.vy - (e.clientY-drag.y)*view.h/r.height; update();
  });
  root.addEventListener("pointerup", () => { drag = null; });
  root.addEventListener("pointercancel", () => { drag = null; });
  function fit() {
    view = { x: 0, y: 0, w: 460, h: Math.max(470, (data?.template.nodes.length ?? 5)*90+40) }; update();
  }
  function select(id) {
    selected = id;
    for (const g of root.querySelectorAll("[data-node]")) g.classList.toggle("selected", g.dataset.node === id);
    for (const p of root.querySelectorAll("[data-from]")) p.classList.toggle("selected", p.dataset.from === id || p.dataset.to === id);
  }
  function show(next) {
    const changed = data?.template.id !== next.template.id;
    data = next; root.replaceChildren();
    const nodes = data.template.nodes;
    const ys = new Map(nodes.map((n, i) => [n.id, 28 + i*90]));
    data.template.links.forEach((l, i) => {
      const a = ys.get(l.from)+32, b = ys.get(l.to)+32, gutter = 18 + (i%4)*12;
      const p = svg("path", { d: `M 92 ${a} C ${gutter} ${a}, ${gutter} ${b}, 92 ${b}`, class: "graph-edge", "data-from": l.from, "data-to": l.to });
      p.append(svg("title", {}, `Из ${l.from} в ${l.to}. Правило ${l.match}`)); root.append(p);
    });
    for (const n of nodes) {
      const instances = data.zones.filter((z) => z.nodeId === n.id);
      const g = svg("g", { transform: `translate(92 ${ys.get(n.id)})`, "data-node": n.id, tabindex: 0, role: "button", "aria-label": `${n.name}: ${instances.length} экземпляров` });
      g.append(svg("rect", { width: 326, height: 68, rx: 6, class: "graph-node" }));
      g.append(svg("rect", { width: 5, height: 68, fill: KINDS[n.kind], rx: 2 }));
      const icon = iconSVG(n.kind); icon.setAttribute("x", "17"); icon.setAttribute("y", "16"); icon.setAttribute("width", "28"); icon.setAttribute("height", "28"); g.append(icon);
      g.append(svg("text", { x: 57, y: 25, class: "graph-name" }, n.name));
      g.append(svg("text", { x: 57, y: 48, class: "graph-meta" }, `${titles[n.kind]}  ${n.anchor}  ${instances.length} экз.`));
      g.append(svg("circle", { cx: 0, cy: 32, r: 5, fill: KINDS[n.kind] }));
      const pick = () => onSelect(selected === n.id ? null : n.id);
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      root.append(g);
    }
    if (changed) fit();
    select(selected);
  }
  return { show, select, fit };
}
