import { KINDS } from "./template-engine.js";
import { iconSVG } from "./icons.js";
import { layoutGraph } from "./graph-model.js";
import { NODE_TYPES } from "./node-types.js";
const NS = "http://www.w3.org/2000/svg", WIDTH = 300, HEIGHT = 68;
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
const inputPoint = (p) => ({ x: p.x+28, y: p.y });
const outputPoint = (p) => ({ x: p.x+28, y: p.y+HEIGHT });
function path(a, b) {
  if (b.y < a.y+28 || b.x < a.x) return `M ${a.x} ${a.y} C ${a.x} ${a.y+60}, ${b.x} ${b.y-60}, ${b.x} ${b.y}`;
  const bend = Math.min(14, Math.abs(b.x-a.x)/2), y = b.y-14;
  return `M ${a.x} ${a.y} L ${a.x} ${y-bend} Q ${a.x} ${y} ${a.x+bend} ${y} L ${b.x-bend} ${y} Q ${b.x} ${y} ${b.x} ${y+bend} L ${b.x} ${b.y}`;
}

export function createTemplateGraph(host, onSelect, actions = {}) {
  const root = svg("svg", { role: "group", "aria-label": "Граф шаблона. Соединяйте выходы и входы нод. Правая кнопка удаляет связь" });
  host.replaceChildren(root);
  const menu = document.createElement("div"); menu.className = "node-menu"; menu.hidden = true; host.append(menu);
  let data, layout, selected = null, view = { x: 0, y: 0, w: 460, h: 640 }, drag = null, wire = null, preview = null, autoFit = true, previousSize, suppressClick = false;
  const update = () => root.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const point = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(root.getScreenCTM().inverse());
  function cancel() { drag = null; wire = null; preview?.remove(); preview = null; root.classList.remove("connecting"); }
  root.addEventListener("wheel", (e) => {
    e.preventDefault(); cancel(); autoFit = false;
    const p = point(e), factor = e.deltaY > 0 ? 1.1 : 1/1.1;
    const w = Math.max(220, Math.min(14000, view.w*factor)), ratio = w/view.w;
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
      if (e.target.closest("[data-edge]")) return;
      const node = e.target.closest("[data-node]");
      if (!node) autoFit = false;
      drag = node ? { point: point(e), id: node.dataset.node, original: { ...layout.positions.get(node.dataset.node) }, moved: false } : { point: point(e) };
    }
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", (e) => {
    if (wire) {
      const p = point(e), a = wire.port === "output" ? wire.start : p, b = wire.port === "output" ? p : wire.start;
      preview.setAttribute("d", `M ${a.x} ${a.y} C ${a.x} ${a.y+40}, ${b.x} ${b.y-40}, ${b.x} ${b.y}`);
    } else if (drag?.id) {
      const p = point(e), next = { x: Math.round(drag.original.x+p.x-drag.point.x), y: Math.round(drag.original.y+p.y-drag.point.y) };
      drag.moved ||= Math.hypot(next.x-drag.original.x, next.y-drag.original.y)>3;
      if (drag.moved) {
        autoFit = false;
        layout.positions.set(drag.id, next);
        root.querySelector(`[data-node="${drag.id}"]`).setAttribute("transform", `translate(${next.x} ${next.y})`);
        for (const edge of root.querySelectorAll("[data-edge]")) {
          const [from, to] = edge.dataset.edge.split(":");
          const d = path(outputPoint(layout.positions.get(from)), inputPoint(layout.positions.get(to)));
          for (const p of edge.querySelectorAll("path")) p.setAttribute("d", d);
        }
      }
    } else if (drag) {
      const p = point(e); view.x += drag.point.x-p.x; view.y += drag.point.y-p.y; update();
    }
  });
  root.addEventListener("pointerup", (e) => {
    const port = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-port]");
    const started = wire, nodeDrag = drag;
    cancel();
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    if (nodeDrag?.id) {
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
      if (nodeDrag.moved) { actions.move?.(nodeDrag.id, { ...layout.positions.get(nodeDrag.id) }); onSelect(nodeDrag.id); }
      else onSelect(nodeDrag.id);
    }
    if (started && port && root.contains(port) && port.dataset.port !== started.port) {
      const from = started.port === "output" ? started.node : port.dataset.id;
      const to = started.port === "input" ? started.node : port.dataset.id;
      try { actions.connect?.(from, to); } catch (err) { actions.error?.(err.message); }
    }
  });
  root.addEventListener("pointercancel", cancel);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); });
  root.addEventListener("contextmenu", (e) => {
    if (e.target.closest("[data-edge]")) return;
    e.preventDefault();
    const node = e.target.closest("[data-node]");
    if (node) { onSelect(node.dataset.node); return; }
    const canvas = point(e), r = host.getBoundingClientRect();
    menu.replaceChildren();
    for (const [kind, type] of Object.entries(NODE_TYPES)) {
      const button = document.createElement("button"); button.append(iconSVG(kind), type.title);
      button.onclick = () => { menu.hidden = true; actions.create?.(kind, { x: canvas.x, y: canvas.y }); };
      menu.append(button);
    }
    menu.style.left = `${Math.max(0, Math.min(e.clientX-r.left, r.width-170))}px`;
    menu.style.top = `${Math.max(0, Math.min(e.clientY-r.top, r.height-210))}px`;
    menu.hidden = false;
  });
  document.addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.hidden = true; });
  function fit() {
    if (!layout) return;
    autoFit = true;
    const r = host.getBoundingClientRect(), aspect = r.width && r.height ? r.width/r.height : 460/640;
    const w = Math.max(layout.width, layout.height*aspect), h = w/aspect;
    view = { x: layout.x+(layout.width-w)/2, y: layout.y+(layout.height-h)/2, w, h }; update();
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
    const changed = data?.template.id !== next.template.id;
    data = next; layout = layoutGraph(data.template); root.replaceChildren();
    for (const l of data.template.links) {
      const d = path(outputPoint(layout.positions.get(l.from)), inputPoint(layout.positions.get(l.to)));
      const group = svg("g", { "data-edge": `${l.from}:${l.to}`, tabindex: 0, role: "button", "aria-label": `Связь из ${l.from} в ${l.to}. Правая кнопка или Delete удаляет связь` });
      group.append(svg("path", { d, class: "graph-edge", "data-from": l.from, "data-to": l.to }));
      group.append(svg("path", { d, class: "graph-edge-hit" }));
      group.append(svg("title", {}, `Данные из ${l.from} в ${l.to}. ПКМ: удалить связь`));
      const remove = (e) => { e.preventDefault(); e.stopPropagation(); actions.remove?.(l.from, l.to); };
      group.addEventListener("contextmenu", remove);
      group.addEventListener("keydown", (e) => { if (e.key === "Delete" || e.key === "Backspace") remove(e); });
      root.append(group);
    }
    for (const n of layout.order) {
      const instances = data.zones.filter((z) => z.nodeId === n.id), p = layout.positions.get(n.id);
      const g = svg("g", { transform: `translate(${p.x} ${p.y})`, "data-node": n.id, tabindex: 0, role: "button", class: instances.length ? "" : "inactive", "aria-label": `${n.name}: ${instances.length} экземпляров` });
      g.append(svg("rect", { width: WIDTH, height: HEIGHT, rx: 6, class: "graph-node" }));
      g.append(svg("rect", { width: 5, height: HEIGHT, fill: KINDS[n.kind], rx: 2 }));
      const icon = iconSVG(n.kind); icon.setAttribute("x", "17"); icon.setAttribute("y", "16"); icon.setAttribute("width", "28"); icon.setAttribute("height", "28"); g.append(icon);
      g.append(svg("title", {}, n.name));
      g.append(svg("text", { x: 57, y: 25, class: "graph-name" }, n.name.length>28?n.name.slice(0,25)+"...":n.name));
      g.append(svg("text", { x: 57, y: 48, class: "graph-meta" }, instances.length ? `${NODE_TYPES[n.kind].title}  ${instances.length} экз.  Входов: ${layout.parents.get(n.id).length}` : "Нет входных данных"));
      for (const port of n.kind === "spawn" ? ["output"] : ["input", "output"]) {
        const c = svg("circle", { cx: 28, cy: port === "input" ? 0 : HEIGHT, r: 8, class: `graph-port ${port}`, "data-port": port, "data-id": n.id, fill: KINDS[n.kind] });
        c.append(svg("title", {}, port === "input" ? "Вход принимает несколько родительских нод" : "Выход можно подключить к нескольким нодам"));
        c.addEventListener("click", (e) => e.stopPropagation()); g.append(c);
      }
      const pick = () => { if (!suppressClick) onSelect(n.id); };
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.target === g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(); } });
      root.append(g);
    }
    if (changed || autoFit) fit();
    select(selected);
  }
  function suggest(id) {
    const parent = layout.positions.get(id), next = parent ? { x: parent.x+54, y: parent.y+106 } : { x: Math.round(view.x+view.w/2-150), y: Math.round(view.y+view.h/2-34) };
    while ([...layout.positions.values()].some((p) => Math.abs(p.x-next.x)<WIDTH+20 && Math.abs(p.y-next.y)<HEIGHT+20)) next.y += 106;
    return next;
  }
  function reveal(id) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (selected !== id) return;
      const p = layout.positions.get(id); if (!p) return;
      let moved = false;
      if (p.x < view.x+20) { view.x = p.x-20; moved = true; }
      if (p.x+WIDTH > view.x+view.w-20) { view.x = p.x+WIDTH-view.w+20; moved = true; }
      if (p.y < view.y+20) { view.y = p.y-20; moved = true; }
      if (p.y+HEIGHT > view.y+view.h-20) { view.y = p.y+HEIGHT-view.h+20; moved = true; }
      if (moved) { autoFit = false; update(); }
    }));
  }
  return { show, select, fit, suggest, reveal };
}
