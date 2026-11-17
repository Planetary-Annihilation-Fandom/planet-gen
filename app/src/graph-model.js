// Версия 3 хранит зависимости размещения; версия 4 допускает циклы графа карты.
export function analyzeGraph(template) {
  if (template.version === 4) {
    const nodes = new Map(template.nodes.map(n => [n.id, n]));
    const parents = new Map(template.nodes.map(n => [n.id, []])), children = new Map(template.nodes.map(n => [n.id, []]));
    const seen = new Set();
    for (const l of template.links) {
      if (!nodes.has(l.from) || !nodes.has(l.to)) throw new Error('Связь ссылается на неизвестную ноду');
      if (['composition','fragment'].includes(nodes.get(l.to).kind)) throw new Error('У входа композиции и фрагмента нет входного пина; используйте вызов фрагмента');
      if (nodes.get(l.from).kind === 'exit') throw new Error('У выхода фрагмента нет выходного пина');
      const key = l.from + ':' + l.to;
      if (seen.has(key)) throw new Error('Эта связь уже существует');
      if (l.weight !== undefined && (!Number.isFinite(l.weight) || l.weight < 0 || l.weight > 1000)) throw new Error('Вес выбора должен быть от 0 до 1000');
      seen.add(key); parents.get(l.to).push(l.from); children.get(l.from).push(l.to);
    }
    return { order: template.nodes, parents, children, active: new Set(nodes.keys()), depths: new Map(template.nodes.map(n => [n.id, 0])) };
  }
  const nodes = new Map(template.nodes.map(n => [n.id, n]));
  const parents = new Map(template.nodes.map(n => [n.id, []]));
  const children = new Map(template.nodes.map(n => [n.id, []]));
  const seen = new Set();
  for (const l of template.links) {
    if (!nodes.has(l.from) || !nodes.has(l.to)) throw new Error("Связь ссылается на неизвестную ноду");
    if (nodes.get(l.to).kind === "spawn") throw new Error("У стартовой ноды нет входа");
    if (nodes.get(l.from).kind === "front") throw new Error("Фронт завершает путь и не имеет выхода");
    const key = l.from+":"+l.to;
    if (seen.has(key)) throw new Error("Эта связь уже существует");
    seen.add(key); parents.get(l.to).push(l.from); children.get(l.from).push(l.to);
  }
  const indegree = new Map([...parents].map(([id, ps]) => [id, ps.length]));
  const queue = template.nodes.filter(n => !indegree.get(n.id)).map(n => n.id);
  const order = [], active = new Set(), depths = new Map(template.nodes.map(n => [n.id, 0]));
  while (queue.length) {
    const id = queue.shift(), n = nodes.get(id); order.push(n);
    if (n.kind === "spawn" || parents.get(id).some(p => active.has(p))) active.add(id);
    for (const child of children.get(id)) {
      depths.set(child, Math.max(depths.get(child), depths.get(id)+1));
      indegree.set(child, indegree.get(child)-1);
      if (!indegree.get(child)) queue.push(child);
    }
  }
  if (order.length !== template.nodes.length) throw new Error("Связь создаёт цикл. Генерация требует граф без циклов");
  return { order, parents, children, active, depths };
}
export function layoutGraph(template) {
  const graph = analyzeGraph(template);
  const positions = new Map(graph.order.map((n,i) => [n.id, n.canvas ?? {x:32+graph.depths.get(n.id)*54,y:28+i*106}]));
  const xs = [...positions.values()].map(p=>p.x), ys = [...positions.values()].map(p=>p.y);
  const x = Math.min(...xs)-32, y = Math.min(...ys)-28;
  return {...graph, positions, x, y, width:Math.max(...xs)+332-x,height:Math.max(...ys)+96-y};
}
export function connectNodes(template, from, to) {
  if (from === to) throw new Error("Нельзя соединить ноду с собой");
  const next = structuredClone(template);
  if (next.links.some(l=>l.from===from&&l.to===to)) return next;
  next.links.push({from,to}); analyzeGraph(next); return next;
}
export function disconnectNodes(template, from, to) {
  const next=structuredClone(template); next.links=next.links.filter(l=>l.from!==from||l.to!==to); return next;
}
export function moveThroughLink(template, nodeId, canvas, edge) {
  const next = structuredClone(template), node = next.nodes.find(n => n.id === nodeId);
  if (!['metal', 'blocker', 'ramp', 'call', 'choice'].includes(node.kind)) throw new Error('Вставлять в связь и извлекать можно металл, блокер, рампу, вызов и выбор');
  const parents = next.links.filter(l => l.to === nodeId).map(l => l.from);
  const children = next.links.filter(l => l.from === nodeId).map(l => l.to);
  next.links = next.links.filter(l => l.from !== nodeId && l.to !== nodeId);
  for (const from of parents) for (const to of children) {
    if (!next.links.some(l => l.from === from && l.to === to)) next.links.push({ from, to });
  }
  if (edge) {
    if (!next.links.some(l => l.from === edge.from && l.to === edge.to)) throw new Error('Выберите связь между другими нодами');
    next.links = next.links.filter(l => l.from !== edge.from || l.to !== edge.to);
    next.links.push({ from: edge.from, to: nodeId }, { from: nodeId, to: edge.to });
  }
  node.canvas = canvas;
  analyzeGraph(next); return next;
}
