import { seeded, hash } from "./generation-math.js";
const physical = new Set(["metal", "blocker", "ramp"]);

// Раскрытие управляет экземплярами; пространственные циклы сохраняются как связи.
export function expandComposition(template, seed) {
  const byId = new Map(template.nodes.map((n) => [n.id, n]));
  const outgoing = (id) => template.links.filter((l) => l.from === id);
  const definitions = new Map();
  for (const n of template.nodes.filter((n) => n.kind === "fragment")) {
    if (definitions.has(n.fragment))
      throw new Error(`Два входа фрагмента №${n.fragment}`);
    definitions.set(n.fragment, n);
  }
  const definitionNodes = new Set();
  function mark(id) {
    if (definitionNodes.has(id)) return;
    definitionNodes.add(id);
    if (byId.get(id).kind !== "exit") outgoing(id).forEach((l) => mark(l.to));
  }
  definitions.forEach((n) => mark(n.id));
  const nodes = [],
    links = [],
    trace = [],
    used = new Set();
  const rng = seeded(seed ^ hash(template.id));
  let serial = 0,
    steps = 0;
  function edge(from, to) {
    if (from !== to && !links.some((l) => l.from === from && l.to === to))
      links.push({ from, to });
  }
  function scope(roots, incoming, counts = {}, depth = 0) {
    if (depth > 24) throw new Error("Превышена глубина раскрытия фрагментов");
    const instances = new Map(),
      choices = new Map(),
      exits = new Set();
    let hasExit = false;
    const scopeId = serial++;
    function visit(id, previous) {
      if (++steps > 3000 || nodes.length > 240)
        throw new Error(
          "Раскрытие превысило предел 240 элементов или 3000 переходов",
        );
      const n = byId.get(id);
      used.add(id);
      if (n.kind === "exit") {
        hasExit = true;
        previous.forEach((p) => exits.add(p));
        return;
      }
      if (physical.has(n.kind)) {
        let instance = instances.get(id);
        if (instance) {
          previous.forEach((p) => edge(p, instance));
          return;
        }
        instance = `s${scopeId}_${id}`;
        instances.set(id, instance);
        nodes.push({ ...n, id: instance, sourceId: id, canvas: undefined });
        previous.forEach((p) => edge(p, instance));
        outgoing(id).forEach((l) => visit(l.to, [instance]));
        return;
      }
      if (n.kind === "call") {
        const definition = definitions.get(n.fragment);
        if (!definition) throw new Error(`Не найден фрагмент №${n.fragment}`);
        const count = counts[n.fragment] ?? 0;
        let result = previous;
        if (count < n.maxRepeats) {
          trace.push({
            call: id,
            fragment: n.fragment,
            instance: serial,
            depth: count + 1,
          });
          used.add(definition.id);
          const expanded = scope(
            outgoing(definition.id).map((l) => l.to),
            previous,
            { ...counts, [n.fragment]: count + 1 },
            depth + 1,
          );
          result = expanded.endpoints;
          if (!expanded.hasExit)
            throw new Error(
              `Фрагмент №${n.fragment} не имеет достижимого выхода`,
            );
        }
        outgoing(id).forEach((l) => visit(l.to, result));
        return;
      }
      if (n.kind === "choice") {
        const count = choices.get(id) ?? 0;
        choices.set(id, count + 1);
        let options = outgoing(id).filter((l) => (l.weight ?? 1) > 0);
        if (count >= n.maxVisits)
          options = options.filter((l) => byId.get(l.to).kind === "exit");
        if (!options.length)
          throw new Error(
            `${n.name}: нет доступного выхода${count >= n.maxVisits ? " после предела повторов; соедините выбор с выходом фрагмента" : ""}`,
          );
        let pick = rng() * options.reduce((s, l) => s + (l.weight ?? 1), 0);
        const selected =
          options.find((l) => (pick -= l.weight ?? 1) < 0) ?? options.at(-1);
        trace.push({ choice: id, to: selected.to, visit: count + 1 });
        visit(selected.to, previous);
        return;
      }
      if (n.kind === "fragment")
        throw new Error("Вход фрагмента запускается только через вызов");
      outgoing(id).forEach((l) => visit(l.to, previous));
    }
    roots.forEach((id) => visit(id, incoming));
    return { endpoints: [...exits], hasExit };
  }
  const main = template.nodes.filter((n) => !definitionNodes.has(n.id));
  const entries = main.filter((n) => n.kind === "composition");
  if (entries.length)
    scope(
      entries.map((n) => n.id),
      [],
    );
  else {
    // Для каждой самостоятельной компоненты выбираем корни до случайного выбора.
    // Невыбранные ветви не становятся новыми корнями после раскрытия.
    const remaining = new Set(main.map((n) => n.id));
    while (remaining.size) {
      const first = remaining.values().next().value,
        component = new Set([first]),
        queue = [first];
      remaining.delete(first);
      for (let i = 0; i < queue.length; i++)
        for (const l of template.links) {
          const other =
            l.from === queue[i] ? l.to : l.to === queue[i] ? l.from : null;
          if (remaining.has(other)) {
            remaining.delete(other);
            component.add(other);
            queue.push(other);
          }
        }
      const roots = [...component].filter(
        (id) =>
          !template.links.some((l) => l.to === id && component.has(l.from)),
      );
      scope(roots.length ? roots : [first], []);
    }
  }
  return {
    nodes,
    links,
    trace,
    inactiveNodes: template.nodes
      .filter((n) => !used.has(n.id))
      .map((n) => n.id),
  };
}
