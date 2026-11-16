// Правила JSON затем экземпляры зон и связей. Геометрия базовой планеты здесь не меняется.
export const KINDS = { spawn: "#24a56a", metal: "#e5ae22", blocker: "#e34c50", ramp: "#4089e8" };
const anchors = ["players", "fronts", "north", "south"];
const ident = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const finite = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;

export function validateTemplate(t) {
  const fail = (s) => { throw new Error(`Шаблон: ${s}`); };
  if (!t || !ident.test(t.id ?? "")) fail("id должен начинаться с латинской буквы и содержать только латиницу, цифры, _ и -");
  if (t.version !== 1 || typeof t.name !== "string" || !t.name.trim() || t.name.length > 100) fail("нужны version: 1 и название до 100 символов");
  if (!Number.isInteger(t.players?.min) || !Number.isInteger(t.players?.max) || t.players.min < 3 || t.players.max > 12 || t.players.min > t.players.max) fail("диапазон игроков должен быть внутри 3–12");
  if (!Number.isInteger(t.players.default) || !finite(t.players.default, t.players.min, t.players.max)) fail("неверное число игроков по умолчанию");
  if (!Array.isArray(t.nodes) || !t.nodes.length || t.nodes.length > 40 || !Array.isArray(t.links) || t.links.length > 100) fail("нужны 1–40 нод и массив links до 100 связей");
  const ids = new Set();
  for (const n of t.nodes) {
    if (!ident.test(n.id ?? "") || ids.has(n.id)) fail("id нод должны быть уникальны");
    ids.add(n.id);
    if (!Object.hasOwn(KINDS, n.kind) || !anchors.includes(n.anchor) || typeof n.name !== "string" || n.name.length > 100) fail(`неверная нода ${n.id}`);
    if (!finite(n.radius, 0.01, 0.45)) fail(`радиус ${n.id}: допустимо 0.01–0.45 радиана`);
    if (n.offset && (!Array.isArray(n.offset) || n.offset.length !== 2 || !n.offset.every((v) => finite(v, -1, 1)))) fail(`неверное смещение ${n.id}`);
    if (n.kind === "metal" && (!Number.isInteger(n.spots) || !finite(n.spots, 1, 100))) fail(`неверное число точек ${n.id}`);
    if (n.chain && (n.kind !== "blocker" || !Number.isInteger(n.chain.count) || !finite(n.chain.count, 1, 10) || !finite(n.chain.step, 0.01, n.radius * 2) || !finite(n.chain.gap, n.radius, 0.5))) fail(`неверная цепочка ${n.id}: шаг не должен превышать диаметр блокера`);
  }
  for (const l of t.links) if (!ids.has(l.from) || !ids.has(l.to) || !["owner", "adjacent", "all"].includes(l.match)) fail("неверная связь");
  return t;
}

function random(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let n = Math.imul(s ^ s >>> 15, 1 | s); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, k) => a.map((v) => v * k);
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

export function applyTemplate(template, { players, seed, metalScale = 1 }) {
  validateTemplate(template);
  if (!Number.isInteger(players) || !finite(players, template.players.min, template.players.max)) throw new Error(`Число игроков: ${template.players.min}–${template.players.max}`);
  if (!Number.isInteger(seed) || !finite(seed, 0, 4294967295) || !finite(metalScale, 0.25, 3)) throw new Error("Некорректные параметры шаблона");
  const rng = random(seed);
  // Общий случайный поворот сохраняет отношения между сторонами и не выделяет полюса.
  const z = rng() * 2 - 1, a = rng() * Math.PI * 2;
  const pole = [Math.sqrt(1-z*z)*Math.cos(a), Math.sqrt(1-z*z)*Math.sin(a), z];
  const east = norm(cross(pole, Math.abs(z) < 0.9 ? [0,0,1] : [1,0,0]));
  const north = cross(pole, east), phase = rng() * Math.PI * 2;
  const rotate = (d) => add(add(mul(east, d[0]), mul(north, d[1])), mul(pole, d[2]));
  const offset = (d, x, y) => {
    const tangent = norm(cross(Math.abs(d[2]) < 0.9 ? [0,0,1] : [1,0,0], d));
    const up = cross(d, tangent);
    const length = Math.hypot(x, y);
    return length ? norm(add(mul(d, Math.cos(length)), mul(add(mul(tangent, x), mul(up, y)), Math.sin(length) / length))) : d;
  };
  const zones = [], byNode = new Map();
  for (const n of template.nodes) {
    const count = ["players", "fronts"].includes(n.anchor) ? players : 1;
    const instances = [];
    for (let i = 0; i < count; i++) {
      const phi = phase + (i + (n.anchor === "fronts" ? 0.5 : 0)) * Math.PI * 2 / players;
      const root = n.anchor === "north" ? [0,0,1] : n.anchor === "south" ? [0,0,-1] : [Math.cos(phi), Math.sin(phi), 0];
      const center = n.offset ? offset(root, ...n.offset) : root;
      const placements = n.chain ? Array.from({ length: n.chain.count * 2 }, (_, k) => {
        const side = k < n.chain.count ? -1 : 1;
        return offset(center, side * (n.chain.gap + k % n.chain.count * n.chain.step), 0);
      }) : [center];
      placements.forEach((d, k) => {
        const direction = rotate(d);
        const zone = { id: `${n.id}:${i}:${k}`, nodeId: n.id, kind: n.kind, name: n.name, owner: count === 1 && !["players", "fronts"].includes(n.anchor) ? null : i, direction, radius: n.radius, points: [] };
        if (n.kind === "metal") {
          const tangent = norm(cross(direction, Math.abs(direction[2]) < 0.9 ? [0,0,1] : [1,0,0]));
          const bitangent = cross(direction, tangent);
          for (let j = 0; j < Math.round(n.spots * metalScale); j++) {
            const angle = rng() * Math.PI * 2;
            const r = n.radius * 0.82 * Math.sqrt((j + 0.5) / Math.round(n.spots * metalScale));
            zone.points.push(norm(add(mul(direction, Math.cos(r)), mul(add(mul(tangent, Math.cos(angle)), mul(bitangent, Math.sin(angle))), Math.sin(r)))));
          }
        }
        zones.push(zone); instances.push(zone);
      });
    }
    byNode.set(n.id, instances);
  }
  const links = [];
  for (const rule of template.links) for (const from of byNode.get(rule.from)) for (const to of byNode.get(rule.to)) {
    if (rule.match === "owner" && from.owner !== to.owner) continue;
    if (rule.match === "adjacent" && from.owner !== to.owner && from.owner !== (to.owner + 1) % players) continue;
    links.push({ id: `${from.id}>${to.id}`, from: from.id, to: to.id, fromNode: from.nodeId, toNode: to.nodeId });
  }
  return { template: structuredClone(template), parameters: { players, seed, metalScale }, zones, links,
    debug: { rules: template.nodes.length, zones: zones.length, metal: zones.reduce((s, z) => s + z.points.length, 0), balance: "Демонстрация структуры; проходимость и баланс не проверяются." } };
}

export function cleanBasePlanet(result, parameters) {
  return { parameters: structuredClone(parameters), postprocessing: { removeCSG: true, removeMetal: true, removeSpawns: true, dry: true }, result: {
    ...result, water_radius: null, lava_radius: null, planetCSG: [], landing_zones: [],
    csg: { brushes: [], skipped: [] }, metal: { ...result.metal, spots: [], candidates: [], limit_is_random: false },
  } };
}
