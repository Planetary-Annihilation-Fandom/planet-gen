// Несколько входов объединяются в ориентированный граф без циклов.
export function analyzeGraph(template) {
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
