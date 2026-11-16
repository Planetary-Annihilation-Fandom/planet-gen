// Один вход задаёт родителя ноды; выход может питать несколько ветвей.
export function analyzeGraph(template) {
  const nodes = new Map(template.nodes.map((n) => [n.id, n]));
  const parent = new Map(), children = new Map(template.nodes.map((n) => [n.id, []]));
  for (const link of template.links) {
    if (!nodes.has(link.from) || !nodes.has(link.to)) throw new Error("Связь ссылается на неизвестную ноду");
    if (nodes.get(link.to).kind === "spawn") throw new Error("У стартовой ноды нет входа");
    if (parent.has(link.to)) throw new Error("У ноды может быть только один вход. Переподключите существующую связь");
    parent.set(link.to, link.from); children.get(link.from).push(link.to);
  }
  const state = new Map(), order = [], active = new Set(), depths = new Map();
  function visit(id, depth, connected) {
    if (state.get(id) === 1) throw new Error("Связь создаёт цикл. Граф должен идти от спавнов к зависимым нодам");
    if (state.get(id) === 2) return;
    state.set(id, 1); depths.set(id, depth);
    if (connected) active.add(id);
    order.push(nodes.get(id));
    for (const child of children.get(id)) visit(child, depth + 1, connected);
    state.set(id, 2);
  }
  for (const n of template.nodes) if (n.kind === "spawn") visit(n.id, 0, true);
  for (const n of template.nodes) if (!parent.has(n.id)) visit(n.id, 0, false);
  for (const n of template.nodes) if (!state.has(n.id)) visit(n.id, 0, false);
  return { order, parent, children, active, depths };
}

export function layoutGraph(template) {
  const graph = analyzeGraph(template);
  const positions = new Map(graph.order.map((n, i) => [n.id, { x: 32 + graph.depths.get(n.id)*54, y: 28+i*106 }]));
  const width = Math.max(...[...positions.values()].map((p) => p.x+300)) + 32;
  return { ...graph, positions, width, height: graph.order.length*106+24 };
}

export function connectNodes(template, from, to) {
  if (from === to) throw new Error("Нельзя соединить ноду с собой");
  const source = template.nodes.find((n) => n.id === from), target = template.nodes.find((n) => n.id === to);
  if (!source || !target) throw new Error("Неизвестная нода");
  const match = [source.anchor, target.anchor].some((a) => ["north", "south"].includes(a)) ? "all"
    : source.anchor === "players" && target.anchor === "fronts" ? "adjacent" : "owner";
  const next = { ...structuredClone(template), links: [...template.links.filter((l) => l.to !== to), { from, to, match }] };
  analyzeGraph(next);
  return next;
}

export function disconnectNodes(template, from, to) {
  return { ...structuredClone(template), links: template.links.filter((l) => l.from !== from || l.to !== to).map((l) => ({ ...l })) };
}
