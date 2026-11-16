import { KINDS } from "./template-engine.js";
import { iconSVG } from "./icons.js";
import { layoutGraph } from "./graph-model.js";
const NS = "http://www.w3.org/2000/svg", WIDTH = 300, HEIGHT = 68;
const titles = { spawn: "Спавн", metal: "Металл", blocker: "Блокер", ramp: "Рампа" };
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
const inputPoint = (p) => ({ x: p.x+28, y: p.y });
const outputPoint = (p) => ({ x: p.x+28, y: p.y+HEIGHT });
function path(a, b) {
  const bend = Math.min(14, Math.abs(b.x-a.x)/2), y = b.y-14;
  return `M ${a.x} ${a.y} L ${a.x} ${y-bend} Q ${a.x} ${y} ${a.x+bend} ${y} L ${b.x-bend} ${y} Q ${b.x} ${y} ${b.x} ${y+bend} L ${b.x} ${b.y}`;
}

export function createTemplateGraph(host, onSelect, actions = {}) {
  const root = svg("svg", { role: "group", "aria-label": "Граф шаблона. Соединяйте выходы и входы нод. Правая кнопка удаляет связь" });
  host.replaceChildren(root);
  let data, layout, selected = null, view = { x: 0, y: 0, w: 460, h: 640 }, drag = null, wire = null, preview = null, autoFit = true, previousSize;
  const update = () => root.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const point = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(root.getScreenCTM().inverse());
  function cancel() { drag = null; wire = null; preview?.remove(); preview = null; root.classList.remove("connecting"); }
  root.addEventListener("wheel", (e) => {
    e.preventDefault(); cancel(); autoFit = false;
    const p = point(e), factor = e.deltaY > 0 ? 1.1 : 1/1.1;
    const w = Math.max(220, Math.min(2400, view.w*factor)), ratio = w/view.w;
    view.x = p.x-(p.x-view.x)*ratio; view.y = p.y-(p.y-view.y)*ratio;
    view.w = w; view.h *= ratio; update();
  }, { passive: false });
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const port = e.target.closest("[data-port]");
    if (port) {
      e.preventDefault(); wire = { node: port.dataset.id, port: port.dataset.port, start: point(e) };
      preview = svg("path", { class: "graph-preview" }); root.append(preview); root.classList.add("connecting");
    } else {
      if (e.target.closest("[data-node], [data-edge]")) return;
      autoFit = false; drag = { point: point(e), x: view.x, y: view.y };
    }
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", (e) => {
    if (wire) {
      const p = point(e), a = wire.port === "output" ? wire.start : p, b = wire.port === "output" ? p : wire.start;
      preview.setAttribute("d", `M ${a.x} ${a.y} C ${a.x} ${a.y+40}, ${b.x} ${b.y-40}, ${b.x} ${b.y}`);
    } else if (drag) {
      const p = point(e); view.x += drag.point.x-p.x; view.y += drag.point.y-p.y; update();
    }
  });
  root.addEventListener("pointerup", (e) => {
    const port = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-port]");
    const started = wire;
    cancel();
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    if (started && port && root.contains(port) && port.dataset.port !== started.port) {
      const from = started.port === "output" ? started.node : port.dataset.id;
      const to = started.port === "input" ? started.node : port.dataset.id;
      try { actions.connect?.(from, to); } catch (err) { actions.error?.(err.message); }
    }
  });
  root.addEventListener("pointercancel", cancel);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); });
  function fit() {
    if (!layout) return;
    autoFit = true;
    const r = host.getBoundingClientRect(), aspect = r.width && r.height ? r.width/r.height : 460/640;
    const w = Math.max(layout.width, layout.height*aspect), h = w/aspect;
    view = { x: (layout.width-w)/2, y: (layout.height-h)/2, w, h }; update();
  }
  new ResizeObserver(() => {
    const r = host.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (autoFit) fit();
    else if (previousSize) {
      const w = view.w*r.width/previousSize.width, h = view.h*r.height/previousSize.height;
      view.x += (view.w-w)/2; view.y += (view.h-h)/2; view.w = w; view.h = h; update();
    }
    previousSize = r;
  }).observe(host);
  function select(id) {
    selected = id;
    for (const g of root.querySelectorAll("[data-node]")) g.classList.toggle("selected", g.dataset.node === id);
    for (const p of root.querySelectorAll(".graph-edge")) p.classList.toggle("selected", p.dataset.from === id || p.dataset.to === id);
  }
  function show(next) {
    cancel();
    const changed = data?.template.id !== next.template.id || JSON.stringify(data?.template.links) !== JSON.stringify(next.template.links);
    data = next; layout = layoutGraph(data.template); root.replaceChildren();
    for (const l of data.template.links) {
      const d = path(outputPoint(layout.positions.get(l.from)), inputPoint(layout.positions.get(l.to)));
      const group = svg("g", { "data-edge": `${l.from}:${l.to}`, tabindex: 0, role: "button", "aria-label": `Связь из ${l.from} в ${l.to}. Правая кнопка или Delete удаляет связь` });
      group.append(svg("path", { d, class: "graph-edge", "data-from": l.from, "data-to": l.to }));
      group.append(svg("path", { d, class: "graph-edge-hit" }));
      group.append(svg("title", {}, `Из ${l.from} в ${l.to}. Правило ${l.match}. ПКМ: удалить связь`));
      const remove = (e) => { e.preventDefault(); e.stopPropagation(); actions.remove?.(l.from, l.to); };
      group.addEventListener("contextmenu", remove);
      group.addEventListener("keydown", (e) => { if (e.key === "Delete" || e.key === "Backspace") remove(e); });
      root.append(group);
    }
    for (const n of layout.order) {
      const instances = data.zones.filter((z) => z.nodeId === n.id), p = layout.positions.get(n.id);
      const g = svg("g", { transform: `translate(${p.x} ${p.y})`, "data-node": n.id, tabindex: 0, role: "button", class: layout.active.has(n.id) ? "" : "inactive", "aria-label": `${n.name}: ${instances.length} экземпляров` });
      g.append(svg("rect", { width: WIDTH, height: HEIGHT, rx: 6, class: "graph-node" }));
      g.append(svg("rect", { width: 5, height: HEIGHT, fill: KINDS[n.kind], rx: 2 }));
      const icon = iconSVG(n.kind); icon.setAttribute("x", "17"); icon.setAttribute("y", "16"); icon.setAttribute("width", "28"); icon.setAttribute("height", "28"); g.append(icon);
      g.append(svg("text", { x: 57, y: 25, class: "graph-name" }, n.name));
      g.append(svg("text", { x: 57, y: 48, class: "graph-meta" }, layout.active.has(n.id) ? `${titles[n.kind]}  ${instances.length} экз.` : "Не подключена к спавну"));
      for (const port of n.kind === "spawn" ? ["output"] : ["input", "output"]) {
        const c = svg("circle", { cx: 28, cy: port === "input" ? 0 : HEIGHT, r: 8, class: `graph-port ${port}`, "data-port": port, "data-id": n.id, fill: KINDS[n.kind] });
        c.append(svg("title", {}, port === "input" ? "Вход. Подключите выход родительской ноды" : "Выход. Перетащите к входу зависимой ноды"));
        c.addEventListener("click", (e) => e.stopPropagation()); g.append(c);
      }
      const pick = () => onSelect(selected === n.id ? null : n.id);
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.target === g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(); } });
      root.append(g);
    }
    if (changed || autoFit) fit();
    select(selected);
  }
  return { show, select, fit };
}
