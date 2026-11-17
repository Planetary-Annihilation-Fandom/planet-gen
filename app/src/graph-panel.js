// Разделитель сохраняет ширину панели между запусками и доступен с клавиатуры.
export function setupGraphPanel(panel, handle) {
  const controller = new AbortController();
  const { signal } = controller;
  const key = "planet-gen.graph-width.v1";
  let start = null;
  function bounds() {
    const left = document.getElementById("panel").getBoundingClientRect().width || 300;
    return { min: 320, max: Math.max(320, window.innerWidth-left-280) };
  }
  function resize(width, save = true) {
    const { min, max } = bounds();
    const next = Math.max(min, Math.min(max, width));
    document.body.style.setProperty("--graph-width", `${next}px`);
    handle.setAttribute("aria-valuemin", min); handle.setAttribute("aria-valuemax", max); handle.setAttribute("aria-valuenow", Math.round(next));
    if (save) { try { localStorage.setItem(key, String(next)); } catch { /* Ширина остаётся действующей в текущем окне. */ } }
  }
  try { const saved = Number(localStorage.getItem(key)); if (saved > 0) resize(saved, false); } catch { /* Используется ширина CSS. */ }
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); start = { x: e.clientX, width: panel.getBoundingClientRect().width };
    handle.setPointerCapture(e.pointerId); document.body.classList.add("resizing-graph");
  }, { signal });
  handle.addEventListener("pointermove", (e) => { if (start) resize(start.width+start.x-e.clientX, false); }, { signal });
  const finish = () => {
    if (start) resize(panel.getBoundingClientRect().width);
    start = null; document.body.classList.remove("resizing-graph");
  };
  handle.addEventListener("pointerup", finish, { signal }); handle.addEventListener("pointercancel", finish, { signal });
  handle.addEventListener("lostpointercapture", finish, { signal });
  handle.addEventListener("keydown", (e) => {
    const current = panel.getBoundingClientRect().width, { min, max } = bounds();
    const widths = { ArrowLeft: current+32, ArrowRight: current-32, Home: min, End: max };
    if (Object.hasOwn(widths, e.key)) { e.preventDefault(); resize(widths[e.key]); }
  }, { signal });
  handle.addEventListener("dblclick", () => {
    document.body.style.removeProperty("--graph-width");
    try { localStorage.removeItem(key); } catch { /* Сброс текущего окна всё равно выполнен. */ }
  }, { signal });
  window.addEventListener("resize", () => {
    if (!panel.hidden && document.body.style.getPropertyValue("--graph-width")) resize(parseFloat(document.body.style.getPropertyValue("--graph-width")), false);
  }, { signal });
  return () => { controller.abort(); document.body.classList.remove("resizing-graph"); };
}
