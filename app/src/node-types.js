const DEG = 180/Math.PI;
export const KINDS = { spawn: "#24a56a", region: "#8b6cd6", metal: "#e5ae22", blocker: "#e34c50", ramp: "#4089e8" };
const field = (path, label, min, max, step = 1, extra = {}) => ({ path, label, type: "number", min, max, step, ...extra });
const angle = (path, label, min, max, extra = {}) => field(path, label, min, max, 1, { scale: DEG, ...extra });
const choice = (path, label, options, extra = {}) => ({ path, label, type: "select", options, ...extra });
const placement = { mode: "each", distance: 0.2, bearing: 0, jitter: 0, pairing: "owner", side: "both" };
const relativeFields = [
  choice("placement.mode", "Получать области", [["each", "От каждого входа"], ["between", "Между входами"], ["centroid", "Общий центр входов"], ["hubs", "Два направления от кольца входов"]]),
  choice("placement.pairing", "Сопоставлять входы", [["owner", "По игроку"], ["nearest", "По ближайшему соседу"]], { when: (n) => n.placement.mode === "between" }),
  choice("placement.side", "Направления", [["both", "Оба"], ["positive", "Первое"], ["negative", "Противоположное"]], { when: (n) => n.placement.mode === "hubs" }),
  angle("placement.distance", "Удаление от входа, °", 0, 90),
  angle("placement.bearing", "Направление смещения, °", -180, 180),
  angle("placement.jitter", "Разброс положения, °", 0, 15),
];
const common = [{ path: "name", label: "Название", type: "text", maxLength: 100 }, angle("radius", "Радиус области, °", 0.5, 26)];
export const NODE_TYPES = {
  spawn: { title: "Спавны", defaults: { radius: 0.1, layout: "ring", count: 0, latitude: 0, phase: 0, jitter: 0 }, fields: [
    ...common, choice("layout", "Распределение", [["ring", "Кольцо"], ["sphere", "Вся сфера"]]),
    field("count", "Количество (0 = число игроков)", 0, 12), angle("latitude", "Широта кольца, °", -60, 60, { when: (n) => n.layout === "ring" }),
    angle("phase", "Поворот распределения, °", -180, 180), angle("jitter", "Разброс спавнов, °", 0, 10),
  ] },
  region: { title: "Область", defaults: { radius: 0.1, placement }, fields: [...common, ...relativeFields] },
  metal: { title: "Металл", defaults: { radius: 0.085, placement, spots: 7 }, fields: [...common, ...relativeFields, field("spots", "Точек металла", 1, 100)] },
  blocker: { title: "Блокер", defaults: { radius: 0.055, placement: { ...placement, distance: 0 }, height: 0.7, pattern: "single", chain: { count: 4, step: 0.085, gap: 0.13 } }, fields: [
    ...common, ...relativeFields, field("height", "Высота купола к радиусу", 0.1, 2, 0.1),
    choice("pattern", "Размещение блокеров", [["single", "Один"], ["gate", "Две цепочки с проходом"]]),
    field("chain.count", "Блокеров с каждой стороны", 1, 10, 1, { when: (n) => n.pattern === "gate" }),
    angle("chain.step", "Шаг цепочки, °", 1, 25, { when: (n) => n.pattern === "gate" }),
    angle("chain.gap", "Удаление от центра прохода, °", 1, 30, { when: (n) => n.pattern === "gate" }),
  ] },
  ramp: { title: "Рампа", defaults: { radius: 0.065, placement: { ...placement, distance: 0.2 }, height: 0.4 }, fields: [...common, ...relativeFields, field("height", "Высота купола к радиусу", 0.1, 2, 0.1)] },
};
export function getField(node, path) { return path.split(".").reduce((v, k) => v?.[k], node); }
export function setField(node, path, value) {
  const keys = path.split("."), last = keys.pop();
  let target = node; for (const key of keys) target = target[key] ??= {};
  target[last] = value;
}
export function createNode(kind, existing = [], canvas) {
  if (!Object.hasOwn(NODE_TYPES, kind)) throw new Error("Неизвестный тип ноды");
  let i = 1; while (existing.some((n) => n.id === `${kind}_${i}`)) i++;
  return { id: `${kind}_${i}`, kind, name: NODE_TYPES[kind].title, ...structuredClone(NODE_TYPES[kind].defaults), ...(canvas ? { canvas } : {}) };
}
export function upgradeTemplate(raw) {
  if (!raw || ![1, 2].includes(raw.version) || !Array.isArray(raw.nodes)) throw new Error("Поддерживаются JSON-шаблоны версий 1 и 2");
  const t = structuredClone(raw);
  if (t.version === 1) {
    t.nodes = t.nodes.map((old) => {
      if (!NODE_TYPES[old.kind]) throw new Error("Неизвестный тип ноды");
      const n = { ...structuredClone(NODE_TYPES[old.kind].defaults), ...old };
      if (n.kind !== "spawn") {
        const [x, y] = old.offset ?? [0, 0];
        n.placement = { ...placement, mode: old.anchor === "fronts" && t.links.some((l) => l.to === old.id && t.nodes.find((v) => v.id === l.from)?.kind === "spawn") ? "between" : "each", distance: Math.hypot(x, y), bearing: Math.atan2(x, y) };
        if (["north", "south"].includes(old.anchor)) Object.assign(n.placement, { mode: "hubs", side: old.anchor === "north" ? "positive" : "negative" });
        if (old.chain) n.pattern = "gate";
      }
      delete n.anchor; delete n.offset; return n;
    });
    t.links = t.links.map(({ from, to }) => ({ from, to })); t.version = 2;
  }
  return t;
}
export function validateNode(node) {
  const type = NODE_TYPES[node?.kind];
  if (!type) throw new Error("Неизвестный тип ноды");
  for (const f of type.fields) {
    const v = getField(node, f.path);
    if (f.type === "number" && (!Number.isFinite(v) || v*(f.scale ?? 1) < f.min-1e-8 || v*(f.scale ?? 1) > f.max+1e-8 || f.step === 1 && !f.scale && !Number.isInteger(v))) throw new Error(`${f.label}: допустимо от ${f.min} до ${f.max}`);
    if (f.type === "select" && !f.options.some(([key]) => key === v)) throw new Error(`Неверное значение: ${f.label}`);
    if (f.type === "text" && (typeof v !== "string" || !v.trim() || v.length > f.maxLength)) throw new Error(`${f.label}: нужно от 1 до ${f.maxLength} символов`);
  }
  if (node.kind === "blocker" && node.pattern === "gate" && node.chain.step > node.radius*2+1e-8) throw new Error("Шаг цепочки не должен превышать диаметр блокера");
  if (node.canvas && ![node.canvas.x, node.canvas.y].every((v) => Number.isFinite(v))) throw new Error("Некорректное положение ноды");
}
