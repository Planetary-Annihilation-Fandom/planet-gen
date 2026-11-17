import * as THREE from "three";
import { angle, norm, dot, offset } from "./generation-math.js";
import { createSurfaceProjector } from "./primitives.js";
import { zoneDistance } from "./composition-layout.js";

// Единая сферическая расчётная сетка без шва по долготе и дублирования полюсов.
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

export function realizeComposition(base, zones, links) {
  const mesh = makeNavigationMesh(),
    project = createSurfaceProjector(base),
    radius = base.radius;
  const heights = mesh.directions.map((d) =>
    project(new THREE.Vector3(...d), 0).length(),
  );
  const blockers = zones.filter((z) => z.kind === "blocker"),
    ramps = zones.filter((z) => z.kind === "ramp");
  const inside = (d) => blockers.some((z) => zoneDistance(d, z) < 1.05);
  const byId = new Map(zones.map((z) => [z.id, z])),
    corridors = [],
    routes = [];
  // Для требуемых связей сначала ищем обход, при необходимости прорезаем коридор.
  for (const l of links) {
    const a = byId.get(l.from),
      b = byId.get(l.to);
    const start = nearest(
        mesh,
        a.direction,
        (i) => !inside(mesh.directions[i]),
      ),
      end = nearest(mesh, b.direction, (i) => !inside(mesh.directions[i]));
    const result = shortestPaths(
      mesh,
      start,
      (i, j) =>
        angle(mesh.directions[i], mesh.directions[j]) *
        radius *
        (inside(mesh.directions[j])
          ? 30
          : 1 + Math.abs(heights[i] - heights[j]) / 8),
    );
    const path = pathTo(result.previous, start, end);
    const points = path.map((i, k) => ({
      direction: mesh.directions[i],
      height:
        heights[start] +
        ((heights[end] - heights[start]) * k) / Math.max(1, path.length - 1),
    }));
    corridors.push(...points);
    routes.push({
      ...l,
      fromNode: a.nodeId,
      toNode: b.nodeId,
      points: points.map((p) => p.direction),
    });
  }
  const width = 0.065;
  function sample(d, h) {
    let change = 0;
    for (const z of blockers) {
      const r = zoneDistance(d, z);
      if (r < 1.15) {
        const profile = Math.max(0, Math.min(1, (1.15 - r) / 0.15));
        change = Math.max(change, radius * 0.11 * profile);
      }
    }
    for (const z of ramps) {
      const r = zoneDistance(d, z);
      if (r < 1) {
        const along = dot(d, z.basis.forward) / Math.sin(z.radius);
        const target = radius * 0.045 * (along + 1);
        change += target * Math.min(1, (1 - r) * 5);
      }
    }
    let nearestPoint = null,
      best = width;
    for (const p of corridors) {
      const a = angle(d, p.direction);
      if (a < best) {
        best = a;
        nearestPoint = p;
      }
    }
    if (nearestPoint) {
      const blend = Math.min(1, (width - best) / 0.025);
      return (h + change) * (1 - blend) + nearestPoint.height * blend;
    }
    return h + change;
  }
  const positions = base.positions.map((p) => {
    const d = norm(p),
      h = sample(d, Math.hypot(...p));
    return d.map((v) => v * h);
  });
  const surface = { ...base, positions, min_radius: Infinity, max_radius: 0 };
  for (const p of positions) {
    const r = Math.hypot(...p);
    surface.min_radius = Math.min(surface.min_radius, r);
    surface.max_radius = Math.max(surface.max_radius, r);
  }
  // Оценки берутся с детализированной поверхности, а не с исходной сферы.
  const detailedProject = createSurfaceProjector(surface);
  mesh.baseHeights = heights;
  mesh.heights = mesh.directions.map((d) =>
    detailedProject(new THREE.Vector3(...d), 0).length(),
  );
  mesh.slopes = mesh.directions.map((d, i) =>
    Math.max(
      ...mesh.neighbors[i].map(
        (j) =>
          (Math.atan2(
            Math.abs(mesh.heights[i] - mesh.heights[j]),
            angle(d, mesh.directions[j]) * radius,
          ) *
            180) /
          Math.PI,
      ),
    ),
  );
  mesh.walkable = mesh.directions.map(
    (d, i) =>
      mesh.slopes[i] <= 38 &&
      (!inside(d) || corridors.some((p) => angle(d, p.direction) < 0.045)),
  );
  mesh.edgeCost = (i, j) => {
    if (!mesh.walkable[i] || !mesh.walkable[j]) return Infinity;
    const distance = angle(mesh.directions[i], mesh.directions[j]) * radius;
    if (
      Math.abs(mesh.heights[i] - mesh.heights[j]) / distance >
      Math.tan((38 * Math.PI) / 180)
    )
      return Infinity;
    const middle = norm(
      mesh.directions[i].map((v, k) => v + mesh.directions[j][k]),
    );
    if (
      inside(middle) &&
      !corridors.some((p) => angle(middle, p.direction) < 0.045)
    )
      return Infinity;
    return (
      distance *
      (1 + Math.abs(mesh.heights[i] - mesh.heights[j]) / Math.max(1, distance))
    );
  };
  for (const route of routes) {
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
    route.points = path.map((i) => mesh.directions[i]);
    route.cost = found.distances[end];
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
  return { surface, mesh, routes };
}
export { pathTo };
