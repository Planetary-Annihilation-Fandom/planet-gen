/**
 * Подбирает старты после реализации карты.
 * Сначала исключает пересечения с областями и непригодные площадки, затем сравнивает наборы по доступности ресурсов, выходам и путям между игроками.
 * Поля сохраняются для показа причин выбора на планете.
 */
import { hasSpawnClearance } from "./composition-layout.js";
import { angle, tangentBasis } from "./generation-math.js";
import { nearest, shortestPaths, pathTo } from "./navigation.js";

// Число непересекающихся путей из площадки наружу: вершины имеют ёмкость 1.
// Ограниченный локальный max-flow отличает широкий выход от единственной теснины.
function localExits(mesh, start) {
  const local = mesh.directions
    .map((d, i) => ({ i, distance: angle(d, mesh.directions[start]) }))
    .filter((v) => v.distance < 0.32 && mesh.walkable[v.i]);
  const ids = new Map(local.map((v, i) => [v.i, i])),
    sink = local.length * 2,
    capacity = Array.from({ length: sink + 1 }, () => new Map());
  const add = (a, b, c) => {
    capacity[a].set(b, c);
    if (!capacity[b].has(a)) capacity[b].set(a, 0);
  };
  for (const { i, distance } of local) {
    const k = ids.get(i);
    add(k * 2, k * 2 + 1, i === start ? 6 : 1);
    if (distance > 0.23) add(k * 2 + 1, sink, 6);
    for (const j of mesh.neighbors[i])
      if (ids.has(j) && Number.isFinite(mesh.edgeCost(i, j)))
        add(k * 2 + 1, ids.get(j) * 2, 6);
  }
  const source = ids.get(start) * 2;
  let flow = 0;
  while (flow < 6) {
    const previous = Array(sink + 1).fill(-1),
      queue = [source];
    previous[source] = source;
    for (let k = 0; k < queue.length && previous[sink] < 0; k++)
      for (const [j, c] of capacity[queue[k]])
        if (c > 0 && previous[j] < 0) {
          previous[j] = queue[k];
          queue.push(j);
        }
    if (previous[sink] < 0) break;
    for (let j = sink; j !== source; j = previous[j]) {
      const i = previous[j];
      capacity[i].set(j, capacity[i].get(j) - 1);
      capacity[j].set(i, (capacity[j].get(i) ?? 0) + 1);
    }
    flow++;
  }
  return flow;
}

/** Сохраняет маски отсева и оценки кандидатов вместе с выбранным набором стартов. */
export function evaluateSpawns(
  mesh,
  zones,
  { players, planetRadius, contact = "balanced" },
) {
  const metal = zones.filter((z) => z.kind === "metal");
  const resources = metal.map((z) => {
    const i = nearest(mesh, z.direction, (j) => mesh.walkable[j]);
    return { zone: z, ...shortestPaths(mesh, i, mesh.edgeCost) };
  });
  const n = mesh.directions.length,
    r = planetRadius;
  const fields = {
    baseHeight: mesh.baseHeights,
    deformation: mesh.heights.map((h, i) => h - mesh.baseHeights[i]),
    height: mesh.heights,
    slope: mesh.slopes,
    walkable: mesh.walkable.map((v) => +v),
    buildable: [],
    clearance: mesh.directions.map((direction) =>
      Number(hasSpawnClearance(direction, zones)),
    ),
    wealthShort: [],
    wealthMedium: [],
    wealthLong: [],
  };
  for (let i = 0; i < n; i++) {
    const local = [];
    for (let j = 0; j < n; j++)
      if (angle(mesh.directions[i], mesh.directions[j]) < 0.12) local.push(j);
    fields.buildable[i] = mesh.walkable[i]
      ? local.filter(
          (j) =>
            mesh.walkable[j] &&
            mesh.slopes[j] < 15 &&
            Math.abs(mesh.heights[j] - mesh.heights[i]) < r * 0.018,
        ).length / Math.max(1, local.length)
      : 0;
    for (const [key, range] of [
      ["wealthShort", 0.4],
      ["wealthMedium", 0.85],
      ["wealthLong", 1.7],
    ])
      fields[key][i] = resources.reduce((s, m) => {
        const d = m.distances[i];
        return (
          s + (d < r * range ? m.zone.points.length * (1 - d / (r * range)) : 0)
        );
      }, 0);
  }
  // Маска сохраняется для просмотра причин отсева на самой планете.
  fields.spawnEligibility = mesh.directions.map((direction, index) =>
    Number(
      fields.clearance[index] === 1 &&
        fields.buildable[index] >= 0.75 &&
        fields.wealthShort[index] > 0 &&
        mesh.neighbors[index].filter((neighbor) =>
          Number.isFinite(mesh.edgeCost(index, neighbor)),
        ).length >= 3,
    ),
  );
  let eligible = mesh.directions
    .map((direction, index) => index)
    .filter((index) => fields.spawnEligibility[index] === 1);
  eligible.sort(
    (a, b) =>
      fields.buildable[b] +
        Math.log1p(fields.wealthShort[b]) * 0.15 -
        (fields.buildable[a] + Math.log1p(fields.wealthShort[a]) * 0.15) ||
      a - b,
  );
  const candidates = [];
  for (const i of eligible) {
    if (
      candidates.every(
        (c) => angle(mesh.directions[i], mesh.directions[c.index]) > 0.18,
      )
    ) {
      const exits = localExits(mesh, i);
      if (exits < 2) continue;
      const paths = shortestPaths(mesh, i, mesh.edgeCost);
      candidates.push({
        index: i,
        buildable: fields.buildable[i],
        wealth: [
          fields.wealthShort[i],
          fields.wealthMedium[i],
          fields.wealthLong[i],
        ],
        exits,
        ...paths,
      });
      if (candidates.length >= 56) break;
    }
  }
  const [minimum, maximum, target] =
    contact === "early"
      ? [0.55, 2, 1.1]
      : contact === "late"
        ? [1.6, 4.8, 2.6]
        : [0.95, 4, 1.9];
  const relative = (a, b) => Math.abs(a - b) / Math.max(1, a, b);
  const arrivalDifference = (a, b) => {
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
    return Math.min(1, Math.abs(a - b) / r);
  };
  /** Отбрасывает недопустимые сочетания до суммирования различий, чтобы богатство не компенсировало нарушение условий. */
  function assess(set) {
    let imbalance = 0,
      tempo = 0;
    for (let i = 0; i < set.length; i++)
      for (let j = 0; j < i; j++) {
        const a = set[i],
          b = set[j],
          distance = a.distances[b.index] / r;
        if (
          !Number.isFinite(distance) ||
          distance < minimum ||
          distance > maximum ||
          relative(a.wealth[0], b.wealth[0]) > 0.6
        )
          return Infinity;
        imbalance +=
          a.wealth.reduce((s, v, k) => s + relative(v, b.wealth[k]), 0) +
          relative(a.buildable, b.buildable) +
          relative(a.exits, b.exits) * 0.25;
        // Сравниваем каждый ресурс с одинаковой ценностью для сторон по времени прибытия.
        imbalance +=
          (resources.reduce(
            (s, m) =>
              s +
              arrivalDifference(m.distances[a.index], m.distances[b.index]) *
                m.zone.points.length,
            0,
          ) /
            Math.max(
              1,
              resources.reduce((s, m) => s + m.zone.points.length, 0),
            )) *
          0.4;
        tempo += Math.abs(distance - target) * 0.15;
      }
    return imbalance + tempo;
  }
  let beam = candidates.map((c, i) => ({ indices: [i], set: [c], score: 0 }));
  for (let size = 2; size <= players; size++) {
    const next = [];
    for (const b of beam)
      for (let j = b.indices.at(-1) + 1; j < candidates.length; j++) {
        const set = [...b.set, candidates[j]],
          score = assess(set);
        if (Number.isFinite(score))
          next.push({ indices: [...b.indices, j], set, score });
      }
    beam = next.sort((a, b) => a.score - b.score).slice(0, 80);
    if (!beam.length) break;
  }
  const best = beam.find((b) => b.set.length === players);
  const spawns = best
    ? best.set.map((c, i) => ({
        id: `spawn_${i}`,
        nodeId: null,
        kind: "spawn",
        name: `Игрок ${i + 1}`,
        owner: i,
        direction: mesh.directions[c.index],
        basis: tangentBasis(mesh.directions[c.index]),
        radius: 0.065,
        height: 0,
        points: [],
        inputs: [],
        metrics: {
          buildable: c.buildable,
          wealth: c.wealth,
          exits: c.exits,
          index: c.index,
        },
      }))
    : [];
  const paths = [];
  if (best)
    for (let i = 0; i < best.set.length; i++)
      for (let j = 0; j < i; j++) {
        const a = best.set[i],
          b = best.set[j];
        paths.push({
          from: spawns[i].id,
          to: spawns[j].id,
          cost: a.distances[b.index],
          points: pathTo(a.previous, a.index, b.index).map(
            (k) => mesh.directions[k],
          ),
        });
      }
  fields.spawnScore = mesh.directions.map((direction, index) =>
    fields.spawnEligibility[index]
      ? fields.buildable[index] + Math.log1p(fields.wealthShort[index]) * 0.15
      : Infinity,
  );
  fields.exits = mesh.directions.map(() => Infinity);
  for (const candidate of candidates)
    fields.exits[candidate.index] = candidate.exits;
  fields.arrival = mesh.directions.map((_, i) =>
    best ? Math.min(...best.set.map((c) => c.distances[i])) : Infinity,
  );
  fields.owner = mesh.directions.map((_, i) => {
    if (!best) return -1;
    let owner = -1,
      d = Infinity;
    best.set.forEach((c, k) => {
      if (c.distances[i] < d) {
        d = c.distances[i];
        owner = k;
      }
    });
    return owner;
  });
  return {
    spawns,
    paths,
    fields,
    candidates: candidates.map(({ distances, previous, ...c }) => c),
    score: best?.score ?? null,
    criteria: {
      minimumBuildable: 0.75,
      minimumExits: 2,
      minimumSeparation: minimum * r,
      maximumSeparation: maximum * r,
      maximumWealthDifference: 0.6,
      spawnRadius: 0.065 * r,
    },
    error: best
      ? ""
      : `Не найден набор из ${players} допустимых стартов: требуется площадка, доступный металл, выходы и подходящая длина путей. Смените seed, композицию или темп контакта.`,
  };
}
