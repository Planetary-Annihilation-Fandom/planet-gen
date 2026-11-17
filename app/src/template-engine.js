import { analyzeGraph } from './graph-model.js';
import { validateNode, upgradeTemplate } from './node-types.js';
export { KINDS } from './node-types.js';
const HALF = Math.PI / 2;
const ident = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const finite = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, k) => a.map(v => v * k);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => mul(a, 1 / Math.hypot(...a));
const angularRadius = n => n.kind === 'front' ? 0 : n.size / 200 * HALF;
function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function random(seed) { let s = seed >>> 0; return () => { s += 0x6d2b79f5; let n = Math.imul(s ^ s >>> 15, 1 | s); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
export function validateTemplate(raw) {
  const t = upgradeTemplate(raw);
  if (!ident.test(t.id ?? '') || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 100) throw new Error('Нужны id на латинице и название до 100 символов');
  if (t.players?.min !== 2 || t.players?.max !== 2 || t.players?.default !== 2) throw new Error('Шаблон 1v1 рассчитан ровно на двух игроков');
  if (!Array.isArray(t.nodes) || !t.nodes.length || t.nodes.length > 60 || !Array.isArray(t.links) || t.links.length > 200) throw new Error('Допустимо 1–60 нод и до 200 связей');
  const ids = new Set();
  for (const n of t.nodes) {
    if (!ident.test(n?.id ?? '') || ids.has(n.id)) throw new Error('Нужны уникальные id нод на латинице');
    ids.add(n.id); validateNode(n);
  }
  if (t.nodes.filter(n => n.kind === 'spawn').length !== 1) throw new Error('В шаблоне 1v1 должен быть ровно один спавн');
  analyzeGraph(t); return t;
}

// Поиск выполняется на одной полусфере. t — расстояние от спавна, bearing —
// отклонение от направляющей. Все дочерние центры дальше от спавна, чем входы.
// Для фигур резервируется описанный диск: это консервативная проверка вместимости.
function placeSide(graph) {
  const order = graph.order.filter(n => graph.active.has(n.id) && n.kind !== 'front');
  const radii = new Map(order.map(n => [n.id, angularRadius(n)]));
  const weights = new Map(), remaining = new Map();
  const activeOrder = graph.order.filter(n => graph.active.has(n.id));
  for (const n of activeOrder) weights.set(n.id, Math.max(0, ...graph.parents.get(n.id).filter(id => graph.active.has(id)).map(id => weights.get(id))) + angularRadius(n) * 2);
  for (const n of [...activeOrder].reverse()) remaining.set(n.id, angularRadius(n) * 2 + Math.max(0, ...graph.children.get(n.id).filter(id => graph.active.has(id)).map(id => remaining.get(id))));
  const placed = new Map();
  const spawn = order[0];
  placed.set(spawn.id, { t: 0, direction: [1, 0, 0], bearing: 0, radius: radii.get(spawn.id) });
  const area = order.reduce((sum, n) => sum + 1 - Math.cos(radii.get(n.id)), 0);
  if (area > 1 + 1e-8) throw new Error('Резервируемые диски занимают больше площади полусферы. Уменьшите размеры или число областей.');
  let attempts = 0, failed = order[1];
  const candidates = new Map(order.slice(1).map(n => {
    const radius = radii.get(n.id), target = HALF * (weights.get(n.id) - radius) / (weights.get(n.id) + remaining.get(n.id) - 2 * radius);
    const values = [];
    for (let row = 0; row <= 32; row++) {
      const t = radius + (HALF - 2 * radius) * row / 32;
      for (let column = 0; column < 48; column++) {
        const bearing = column === 0 ? 0 : (column % 2 ? 1 : -1) * Math.ceil(column / 2) * Math.PI / 24;
        values.push({ t, bearing, radius, direction: [Math.cos(t), Math.sin(t)*Math.cos(bearing), Math.sin(t)*Math.sin(bearing)], cost: Math.abs(t - target) + Math.abs(bearing) * .08 });
      }
    }
    // Сначала пробуем точное положение на направляющей, затем сетку полусферы.
    values.push({ t: target, bearing: 0, radius, direction: [Math.cos(target), Math.sin(target), 0], cost: -1 });
    return [n.id, values.filter(p => p.t >= radius && p.t + radius <= HALF + 1e-8).sort((a, b) => a.cost - b.cost)];
  }));
  function search(index) {
    if (index === order.length) return true;
    const n = order[index];
    failed = n;
    const minimum = Math.max(0, ...graph.parents.get(n.id).map(id => placed.get(id)?.t ?? 0)) + .002;
    for (const p of candidates.get(n.id)) {
      if (++attempts > 180000) return false;
      if (p.t < minimum) continue;
      if ([...placed.values()].some(q => dot(p.direction, q.direction) > Math.cos(p.radius + q.radius + .003))) continue;
      placed.set(n.id, p);
      if (search(index + 1)) return true;
      placed.delete(n.id);
    }
    return false;
  }
  if (!search(1)) throw new Error(`Не удалось разместить «${failed?.name ?? 'области'}» без пересечений в своей половине, сохранив порядок связей${attempts > 180000 ? ': достигнут предел поиска' : ': свободного места на сетке поиска нет'}. Уменьшите размеры или число областей. Для полос и рамп резервируется описанная окружность.`);
  return placed;
}
export function applyTemplate(raw, { players = 2, seed, metalScale = 1, planetRadius = 500 }) {
  const template = validateTemplate(raw);
  if (players !== 2 || !Number.isInteger(seed) || !finite(seed, 0, 4294967295) || !finite(metalScale, .25, 3) || !finite(planetRadius, 100, 1200)) throw new Error('Неверные параметры шаблона 1v1');
  const graph = analyzeGraph(template), placed = placeSide(graph), zones = [], links = [], warnings = [];
  const rng = random(seed), z = rng()*2-1, a = rng()*Math.PI*2;
  const axis = [Math.sqrt(1-z*z)*Math.cos(a), Math.sqrt(1-z*z)*Math.sin(a), z];
  const east = norm(cross(axis, Math.abs(z) < .9 ? [0, 0, 1] : [1, 0, 0])), north = cross(axis, east);
  const rotate = d => add(add(mul(axis, d[0]), mul(east, d[1])), mul(north, d[2]));
  const mirror = (d, side) => rotate([d[0] * (side === 0 ? 1 : -1), d[1], d[2]]);
  let metalCount = 0;
  for (const n of graph.order) {
    if (!graph.active.has(n.id)) continue;
    if (n.kind !== 'front' && !graph.children.get(n.id).length) warnings.push(`${n.name}: путь ещё не завершён фронтом`);
    for (const side of n.kind === 'front' ? [null] : [0, 1]) {
      const p = n.kind === 'front' ? { t: HALF, bearing: 0, radius: .012, direction: [0, 1, 0] } : placed.get(n.id);
      const forward = [-Math.sin(p.t), Math.cos(p.t)*Math.cos(p.bearing), Math.cos(p.t)*Math.sin(p.bearing)];
      const right = cross(forward, p.direction), angle = (n.orientation ?? 0) * Math.PI / 180;
      const basis = { forward: mirror(add(mul(forward, Math.cos(angle)), mul(right, Math.sin(angle))), side), right: mirror(add(mul(right, Math.cos(angle)), mul(forward, -Math.sin(angle))), side) };
      const zone = { id: `${n.id}:${side ?? 'front'}`, nodeId: n.id, kind: n.kind, name: n.name, owner: side, direction: mirror(p.direction, side), basis, radius: p.radius, size: n.size, shape: n.shape, orientation: n.orientation, height: 0, points: [], inputs: [] };
      if (n.kind === 'metal') {
        // Насыщенность — число точек в эталонной области размера 10%; плотность
        // сохраняется при изменении площади. Парные точки отражаются вместе с зоной.
        const count = Math.max(1, Math.round(n.density * (1-Math.cos(p.radius)) / (1-Math.cos(HALF*.05)) * metalScale));
        if (metalCount + count > 10000) throw new Error('Больше 10000 точек металла. Уменьшите насыщенность или размер областей.');
        const mr = random(seed ^ hash(n.id));
        for (let j = 0; j < count; j++) {
          const r = p.radius*.82*Math.sqrt((j+.5)/count), phi = mr()*Math.PI*2;
          const tangent = add(mul(forward, Math.cos(phi)), mul(right, Math.sin(phi)));
          zone.points.push(mirror(add(mul(p.direction, Math.cos(r)), mul(tangent, Math.sin(r))), side));
        }
        metalCount += count;
      }
      zones.push(zone);
    }
  }
  for (const l of template.links) {
    const from = zones.filter(z => z.nodeId === l.from), to = zones.filter(z => z.nodeId === l.to);
    for (const s of from) for (const t of to.filter(z => z.owner === s.owner || z.owner === null)) {
      t.inputs.push(s.id); links.push({ id: `${s.id}>${t.id}`, from: s.id, to: t.id, fromNode: l.from, toNode: l.to });
    }
  }
  return { template, parameters: { players, seed, metalScale, planetRadius }, zones, links,
    guide: { from: rotate([1, 0, 0]), middle: rotate([0, 1, 0]), to: rotate([-1, 0, 0]), boundary: Array.from({ length: 97 }, (_, i) => rotate([0, Math.cos(i*Math.PI/48), Math.sin(i*Math.PI/48)])) },
    debug: { rules: template.nodes.length, inactiveNodes: template.nodes.filter(n => !graph.active.has(n.id)).map(n => n.id), zones: zones.length, metal: metalCount, warnings, balance: 'Зеркальные области; проходимость, CSG и баланс рельефа не проверяются.' } };
}
export function cleanBasePlanet(result, parameters) {
  return { parameters: structuredClone(parameters), postprocessing: { removeCSG: true, removeMetal: true, removeSpawns: true, dry: true }, result: { ...result, water_radius: null, lava_radius: null, planetCSG: [], landing_zones: [], csg: { brushes: [], skipped: [] }, metal: { ...result.metal, spots: [], candidates: [], limit_is_random: false } } };
}
