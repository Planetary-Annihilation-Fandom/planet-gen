/**
 * Размещает элементы конечного графа на всей сфере. Равномерные опорные точки
 * удерживают глобальный масштаб карты, а связи уточняют соседство между областями.
 * Размер области влияет на занимаемое место, насыщенность определяет число точек металла.
 */
import {
  angle,
  dot,
  norm,
  seeded,
  spherePoint,
  tangentBasis,
  offset,
  metalSpotCount,
} from "./generation-math.js";

/**
 * Выбирает разнесённые опоры последовательным поиском самой удалённой точки.
 * Повторение одного seed сохраняет раскладку; соседние элементы графа не могут
 * стянуть все опоры на один участок поверхности.
 */
function globalAnchors(count, random) {
  const pool = Array.from({ length: Math.max(384, count * 12) }, () =>
    spherePoint(random),
  );
  const anchors = [];
  const nearestDot = pool.map(() => -1);
  for (let index = 0; index < count; index++) {
    let selected = 0;
    for (let candidate = 1; candidate < pool.length; candidate++) {
      if (nearestDot[candidate] < nearestDot[selected]) selected = candidate;
    }
    const anchor = pool[selected];
    anchors.push(anchor);
    for (let candidate = 0; candidate < pool.length; candidate++) {
      nearestDot[candidate] = Math.max(
        nearestDot[candidate],
        dot(pool[candidate], anchor),
      );
    }
  }
  return anchors;
}

/** Создаёт области с центрами, локальными осями и конечным набором металлических точек. */
export function placeComposition(graph, seed, metalScale) {
  const rng = seeded(seed);
  const anchors = globalAnchors(graph.nodes.length, rng);
  const positions = anchors.map((direction) => [...direction]);
  const radii = graph.nodes.map((n) => ((n.size / 200) * Math.PI) / 2);
  if (radii.reduce((s, r) => s + 1 - Math.cos(r), 0) > 1.5)
    throw new Error(
      "Композиция слишком плотная для размещения без пересечений",
    );
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const neighborDistance = Math.min(
    Math.PI,
    Math.sqrt((4 * Math.PI) / Math.max(1, positions.length)),
  );
  for (let step = 0; step < 180; step++) {
    const forces = positions.map(() => [0, 0, 0]);
    function push(i, j, strength) {
      for (let k = 0; k < 3; k++) {
        const v = (positions[j][k] - positions[i][k]) * strength;
        forces[i][k] += v;
        forces[j][k] -= v;
      }
    }
    for (let i = 0; i < positions.length; i++)
      for (let j = 0; j < i; j++) {
        const d = angle(positions[i], positions[j]),
          minimum = radii[i] + radii[j] + 0.045;
        if (d < minimum)
          push(i, j, (-0.22 * (minimum - d)) / Math.max(d, 0.01));
      }
    if (step < 120)
      for (const l of graph.links) {
        const i = index.get(l.from),
          j = index.get(l.to),
          d = angle(positions[i], positions[j]);
        push(
          i,
          j,
          0.006 * (d - Math.max(neighborDistance, radii[i] + radii[j] + 0.045)),
        );
      }
    for (let i = 0; i < positions.length; i++)
      positions[i] = norm(
        positions[i].map(
          (v, k) => v + forces[i][k] + (anchors[i][k] - v) * 0.08,
        ),
      );
  }
  for (let i = 0; i < positions.length; i++)
    for (let j = 0; j < i; j++)
      if (angle(positions[i], positions[j]) < radii[i] + radii[j] + 0.01)
        throw new Error(
          "Не удалось разместить композицию без пересечений. Уменьшите области или смените seed",
        );
  let total = 0;
  return graph.nodes.map((n, i) => {
    const direction = positions[i],
      basis = tangentBasis(direction),
      a = ((n.orientation ?? 0) * Math.PI) / 180;
    const rotated = {
      forward: basis.forward.map(
        (v, k) => v * Math.cos(a) + basis.right[k] * Math.sin(a),
      ),
      right: basis.right.map(
        (v, k) => v * Math.cos(a) - basis.forward[k] * Math.sin(a),
      ),
    };
    const zone = {
      ...n,
      id: n.id,
      nodeId: n.sourceId,
      owner: null,
      direction,
      basis: rotated,
      radius: radii[i],
      height: 0,
      points: [],
      inputs: graph.links.filter((l) => l.to === n.id).map((l) => l.from),
    };
    if (n.kind === "metal") {
      const count = metalSpotCount(n.density, metalScale);
      if ((total += count) > 10000)
        throw new Error(
          "Больше 10000 точек металла; уменьшите насыщенность или размер областей",
        );
      for (let k = 0; k < count; k++) {
        const r = zone.radius * 0.8 * Math.sqrt((k + 0.5) / count),
          p = rng() * Math.PI * 2;
        zone.points.push(
          offset(direction, rotated, r * Math.cos(p), r * Math.sin(p)),
        );
      }
    }
    return zone;
  });
}
/** Возвращает расстояние до центра в долях радиуса эллиптической области. */
export function zoneDistance(d, z) {
  const theta = angle(d, z.direction),
    sin = Math.sin(theta);
  if (theta < 1e-9) return 0;
  const x = (dot(d, z.basis.forward) * theta) / sin,
    y = (dot(d, z.basis.right) * theta) / sin;
  return (
    Math.hypot(
      x,
      y / (z.shape === "strip" ? 0.25 : z.kind === "ramp" ? 0.55 : 1),
    ) / z.radius
  );
}

/**
 * Проверяет пересечение площадки старта с областью. Для эллипсов берётся
 * описанная окружность: свободное место с запасом важнее плотной упаковки старта.
 * Отступ учитывает радиус всей площадки, а не только её центральную точку.
 */
export function hasSpawnClearance(direction, zones, spawnRadius = 0.065) {
  return zones.every(
    (zone) =>
      angle(direction, zone.direction) > zone.radius + spawnRadius + 0.025,
  );
}
