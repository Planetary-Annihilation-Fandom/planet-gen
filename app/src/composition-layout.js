import {
  angle,
  dot,
  norm,
  seeded,
  spherePoint,
  tangentBasis,
  offset,
} from "./generation-math.js";

export function placeComposition(graph, seed, metalScale) {
  const rng = seeded(seed),
    positions = graph.nodes.map(() => spherePoint(rng));
  const radii = graph.nodes.map((n) => ((n.size / 200) * Math.PI) / 2);
  if (radii.reduce((s, r) => s + 1 - Math.cos(r), 0) > 1.5)
    throw new Error(
      "Композиция слишком плотная для размещения без пересечений",
    );
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  for (let step = 0; step < 400; step++) {
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
    if (step < 260)
      for (const l of graph.links) {
        const i = index.get(l.from),
          j = index.get(l.to),
          d = angle(positions[i], positions[j]);
        push(i, j, 0.012 * (d - radii[i] - radii[j] - 0.22));
      }
    for (let i = 0; i < positions.length; i++)
      positions[i] = norm(positions[i].map((v, k) => v + forces[i][k]));
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
      const count = Math.max(
        1,
        Math.round(
          ((n.density * (1 - Math.cos(zone.radius))) /
            (1 - Math.cos(Math.PI * 0.025))) *
            metalScale,
        ),
      );
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
