import { expandComposition } from "./composition-graph.js";
import { placeComposition } from "./composition-layout.js";
import { realizeComposition } from "./navigation.js";
import { norm, dot } from "./generation-math.js";
import { evaluateSpawns } from "./spawn-selection.js";
export function applyComposition(template, parameters, base) {
  const graph = expandComposition(template, parameters.seed),
    zones = placeComposition(graph, parameters.seed, parameters.metalScale);
  const links = graph.links.map((l) => ({
    ...l,
    fromNode: graph.nodes.find((n) => n.id === l.from).sourceId,
    toNode: graph.nodes.find((n) => n.id === l.to).sourceId,
  }));
  const result = {
    template,
    parameters,
    zones,
    links,
    finalGraph: graph,
    debug: {
      rules: template.nodes.length,
      inactiveNodes: graph.inactiveNodes,
      zones: zones.length,
      metal: zones.reduce((s, z) => s + z.points.length, 0),
      warnings: [],
      balance: "Для оценки стартов сгенерируйте основу.",
    },
  };
  if (!base) return result;
  const { surface, mesh, routes } = realizeComposition(base, zones, links),
    selection = evaluateSpawns(mesh, zones, parameters);
  const bins = new Map(),
    cell = (d) => d.map((v) => Math.floor((v + 1) * 12));
  const baseDirections = base.positions.map(norm);
  baseDirections.forEach((d, i) => {
    const key = cell(d).join(",");
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(i);
  });
  const sourceIndices = mesh.directions.map((d) => {
    const c = cell(d),
      candidates = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          candidates.push(
            ...(bins.get([c[0] + x, c[1] + y, c[2] + z].join(",")) ?? []),
          );
    let best = 0,
      score = -Infinity;
    for (const i of candidates) {
      const s = dot(d, baseDirections[i]);
      if (s > score) {
        score = s;
        best = i;
      }
    }
    return best;
  });
  const fieldLabels = {};
  for (const f of base.generation_fields ?? []) {
    selection.fields[f.id] = sourceIndices.map((i) => f.values[i]);
    fieldLabels[f.id] = f.label;
  }
  for (let b = 0; b < (base.biomes?.length ?? 0); b++) {
    const id = `biome_${b}`;
    selection.fields[id] = sourceIndices.map(
      (i) => base.biome_weights[i * base.biomes.length + b] / 255,
    );
    fieldLabels[id] = `Доля подбиома: ${base.biomes[b].name}`;
  }
  result.surface = surface;
  result.zones = [...zones, ...selection.spawns];
  result.routes = routes;
  result.analysis = {
    fieldLabels,
    directions: mesh.directions,
    triangles: mesh.triangles,
    neighbors: mesh.neighbors,
    fields: selection.fields,
    candidates: selection.candidates,
    paths: selection.paths,
    score: selection.score,
  };
  result.debug.metal = zones.reduce((s, z) => s + z.points.length, 0);
  result.debug.zones = result.zones.length;
  result.debug.balance =
    selection.error ||
    `Найдено ${selection.spawns.length} стартов. Оценка различий: ${selection.score.toFixed(3)}; меньшее значение означает более близкие условия.`;
  if (selection.error) result.debug.warnings.push(selection.error);
  result.debug.warnings.push(
    "Навигация и выбор стартов рассчитаны на собственной сетке поверхности; это приближение к навигации PA.",
  );
  return result;
}
