/**
 * Рассчитывает маршруты между областями композиции на исходной поверхности.
 * Сферическая расчётная сетка хранит соседство, высоты и неизменные стоимости рёбер; поиски путей используют уже рассчитанные значения.
 */
import * as THREE from "three";
import { angle, norm, dot } from "./generation-math.js";
import { createSurfaceProjector } from "./primitives.js";
import { zoneDistance } from "./composition-layout.js";

// Единая сферическая расчётная сетка без шва по долготе и дублирования полюсов.
/** Сшивает одинаковые вершины икосферы, чтобы навигация не имела разрывов на границах треугольников. */
export function makeNavigationMesh(detail = 16) {
  const geometry = new THREE.IcosahedronGeometry(1, detail),
    array = geometry.attributes.position.array;
  const directions = [],
    triangles = [],
    indices = new Map(),
    neighbors = [];
  for (let i = 0; i < array.length; i += 9) {
    const tri = [];
    for (let j = 0; j < 9; j += 3) {
      const d = norm(Array.from(array.slice(i + j, i + j + 3))),
        key = d.map((v) => v.toFixed(6)).join(",");
      if (!indices.has(key)) {
        indices.set(key, directions.length);
        directions.push(d);
        neighbors.push(new Set());
      }
      tri.push(indices.get(key));
    }
    triangles.push(tri);
    for (let j = 0; j < 3; j++) {
      neighbors[tri[j]].add(tri[(j + 1) % 3]);
      neighbors[tri[(j + 1) % 3]].add(tri[j]);
    }
  }
  geometry.dispose();
  return { directions, triangles, neighbors: neighbors.map((s) => [...s]) };
}
/** Дейкстра возвращает стоимость и предшественника для каждой достижимой вершины; Infinity запрещает ребро. */
export function shortestPaths(mesh, start, cost) {
  const distances = mesh.directions.map(() => Infinity),
    previous = mesh.directions.map(() => -1),
    heap = [];
  function push(id, d) {
    let i = heap.length;
    heap.push([id, d]);
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p][1] <= d) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = [id, d];
  }
  distances[start] = 0;
  push(start, 0);
  while (heap.length) {
    const [i, d] = heap[0],
      last = heap.pop();
    if (heap.length) {
      let k = 0;
      while (2 * k + 1 < heap.length) {
        let c = 2 * k + 1;
        if (c + 1 < heap.length && heap[c + 1][1] < heap[c][1]) c++;
        if (heap[c][1] >= last[1]) break;
        heap[k] = heap[c];
        k = c;
      }
      heap[k] = last;
    }
    if (d !== distances[i]) continue;
    for (const j of mesh.neighbors[i]) {
      const w = cost(i, j),
        next = d + w;
      if (next < distances[j]) {
        distances[j] = next;
        previous[j] = i;
        push(j, next);
      }
    }
  }
  return { distances, previous };
}
/** Находит ближайшую разрешённую вершину; возвращает -1, если предикат исключил всю сетку. */
export function nearest(mesh, d, predicate = () => true) {
  let found = -1,
    best = -Infinity;
  mesh.directions.forEach((v, i) => {
    const score = dot(v, d);
    if (score > best && predicate(i)) {
      best = score;
      found = i;
    }
  });
  return found;
}
/** Восстанавливает маршрут по предшественникам; недостижимая цель даёт пустой путь. */
const pathTo = (previous, start, end) => {
  const p = [end];
  while (p.at(-1) !== start) {
    const i = previous[p.at(-1)];
    if (i < 0) return [];
    p.push(i);
    if (p.length > previous.length) return [];
  }
  return p.reverse();
};

/** Строит расчётные маршруты на исходной основе. Блокеры пока представлены резервами шаблона. */
export function realizeComposition(base, zones, links) {
  const mesh = makeNavigationMesh(),
    project = createSurfaceProjector(base),
    blockers = zones.filter((zone) => zone.kind === "blocker"),
    byId = new Map(zones.map((zone) => [zone.id, zone])),
    routes = [];
  const inside = (direction) =>
    blockers.some((zone) => zoneDistance(direction, zone) < 1.05);
  mesh.heights = mesh.directions.map((direction) =>
    project(new THREE.Vector3(...direction), 0).length(),
  );
  mesh.walkable = mesh.directions.map((direction) => !inside(direction));
  const edgeCosts = mesh.neighbors.map(() => new Map());
  const calculateEdgeCost = (i, j) => {
    if (!mesh.walkable[i] || !mesh.walkable[j]) return Infinity;
    const middle = norm(
      mesh.directions[i].map((v, k) => v + mesh.directions[j][k]),
    );
    if (inside(middle)) return Infinity;
    return angle(mesh.directions[i], mesh.directions[j]) * base.radius;
  };
  for (let vertex = 0; vertex < mesh.neighbors.length; vertex++) {
    for (const neighbor of mesh.neighbors[vertex]) {
      if (neighbor < vertex) continue;
      const cost = calculateEdgeCost(vertex, neighbor);
      edgeCosts[vertex].set(neighbor, cost);
      edgeCosts[neighbor].set(vertex, cost);
    }
  }
  mesh.edgeCost = (from, to) => edgeCosts[from].get(to) ?? Infinity;
  for (const route of links) {
    const a = byId.get(route.from),
      b = byId.get(route.to),
      start = nearest(mesh, a.direction, (i) => mesh.walkable[i]),
      end = nearest(mesh, b.direction, (i) => mesh.walkable[i]);
    if (start < 0 || end < 0)
      throw new Error("На композиции нет проходимых областей");
    const found = shortestPaths(mesh, start, mesh.edgeCost),
      path = pathTo(found.previous, start, end);
    if (!path.length)
      throw new Error(
        `Не удалось реализовать проход ${a.name} — ${b.name}. Смените seed или уменьшите блокеры`,
      );
    routes.push({
      ...route,
      fromNode: a.nodeId,
      toNode: b.nodeId,
      points: path.map((i) => mesh.directions[i]),
      cost: found.distances[end],
    });
  }
  // Металл переносится на ближайшие допустимые участки своей области.
  for (const z of zones.filter((z) => z.kind === "metal")) {
    z.points = z.points
      .map((d) => {
        const i = nearest(
          mesh,
          d,
          (j) =>
            mesh.walkable[j] &&
            angle(mesh.directions[j], z.direction) < z.radius,
        );
        if (i < 0)
          throw new Error(`${z.name}: нет проходимой поверхности для металла`);
        return angle(d, mesh.directions[i]) < 0.055 ? d : mesh.directions[i];
      })
      .filter((d, i, a) => a.indexOf(d) === i);
  }
  return { mesh, routes };
}
export { pathTo };
