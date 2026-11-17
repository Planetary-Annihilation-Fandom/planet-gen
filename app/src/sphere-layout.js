const HALF = Math.PI / 2;
const GAP = .003;
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const radiusOf = node => node.kind === 'front' ? 0 : node.size / 200 * HALF;
const clamp = value => Math.max(-1, Math.min(1, value));
function position(t, bearing, radius) {
  return { t, bearing, radius, direction: [Math.cos(t), Math.sin(t)*Math.cos(bearing), Math.sin(t)*Math.sin(bearing)] };
}
function separate(a, b) { return dot(a.direction, b.direction) <= Math.cos(a.radius + b.radius + GAP) + 1e-10; }

// 1. Связи определяют общие уровни. Размеры и порядок записи в JSON здесь не участвуют.
export function planLevels(graph) {
  const active = graph.order.filter(node => graph.active.has(node.id));
  const depth = new Map();
  for (const node of active) depth.set(node.id, node.kind === 'spawn' ? 0 : 1 + Math.max(0, ...graph.parents.get(node.id).filter(id => graph.active.has(id)).map(id => depth.get(id))));
  const nodes = active.filter(node => !['spawn', 'front'].includes(node.kind));
  const end = Math.max(0, ...nodes.map(node => depth.get(node.id))) + 1;
  const levels = new Map();
  for (const node of nodes) {
    const rank = depth.get(node.id);
    if (!levels.has(rank)) levels.set(rank, []);
    levels.get(rank).push(node);
  }
  return [...levels].sort(([a], [b]) => a-b).map(([rank, group]) => ({ rank, target: HALF * rank / end, nodes: group.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }));
}

// 2. Весь ряд центрируется относительно направляющей. У первой ноды нет привилегии.
function arrangeRow(nodes, t, phase) {
  if (t <= 0 || t >= HALF) return null;
  const radii = nodes.map(radiusOf), angles = [0], sin2 = Math.sin(t)**2, cos2 = Math.cos(t)**2;
  if (radii.some(radius => t + radius > HALF + 1e-9)) return null;
  for (let i = 1; i < nodes.length; i++) {
    const cosine = (Math.cos(radii[i-1] + radii[i] + GAP) - cos2) / sin2;
    if (cosine < -1) return null;
    angles.push(angles[i-1] + Math.acos(clamp(cosine)));
  }
  // Центрируем занимаемую ширину, включая края областей.
  const widths = radii.map(radius => Math.asin(Math.min(1, Math.sin(radius)/Math.sin(t))));
  const center = (angles[0]-widths[0] + angles.at(-1)+widths.at(-1))/2;
  const result = nodes.map((node,i) => [node.id, position(t, angles[i]-center+phase, radii[i])]);
  for (let i=0;i<result.length;i++) for(let j=0;j<i;j++) if(!separate(result[i][1],result[j][1])) return null;
  return result;
}
function arrangeGroup(group, t, phase, rows) {
  const chunks = Array.from({length: rows}, () => []);
  group.nodes.forEach((node,i) => chunks[i % rows].push(node));
  const step = Math.max(...group.nodes.map(radiusOf))*2 + GAP;
  const placements = chunks.flatMap((nodes,i) => arrangeRow(nodes, t + (i-(rows-1)/2)*step, phase) ?? []);
  if (placements.length !== group.nodes.length) return null;
  for(let i=0;i<placements.length;i++) for(let j=0;j<i;j++) if(!separate(placements[i][1],placements[j][1])) return null;
  return placements;
}

// 3. Сначала сохраняем идеальные уровни, затем сдвигаем и расширяем целые группы.
// Возврат пересматривает предыдущие группы; проверяются вся полусфера и порядок связей.
export function placeSide(graph) {
  const levels = planLevels(graph), spawn = graph.order.find(node => node.kind === 'spawn');
  const placed = new Map([[spawn.id, position(0,0,radiusOf(spawn))]]);
  const area = [...levels.flatMap(group => group.nodes),spawn].reduce((sum,node) => sum+1-Math.cos(radiusOf(node)),0);
  if(area>1+1e-8) throw new Error('Резервируемые диски занимают больше площади полусферы. Уменьшите размеры или число областей.');
  let attempts=0, failed;
  const candidates = levels.map(group => {
    const choices=[];
    // Точная позиция уровня всегда проверяется раньше дискретной сетки.
    for(let row=0;row<=32;row++) {
      const t=HALF*(row+.5)/33;
      for(let column=0;column<48;column++) {
        const phase=(column%2?1:-1)*Math.ceil(column/2)*Math.PI/24;
        choices.push({t,phase,rows:1,cost:Math.abs(t-group.target)+Math.abs(phase)*.08});
      }
    }
    choices.push({t:group.target,phase:0,rows:1,cost:-1});
    for(let rows=2;rows<=Math.min(4,group.nodes.length);rows++) {
      for(let row=0;row<=16;row++) for(const phase of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI]) {
        const t=HALF*(row+.5)/17;
        choices.push({t,phase,rows,cost:.2*(rows-1)+Math.abs(t-group.target)+Math.abs(phase)*.08});
      }
    }
    return choices.sort((a,b)=>a.cost-b.cost);
  });
  function search(index) {
    if(index===levels.length) return true;
    const group=levels[index]; failed=group;
    for(const choice of candidates[index]) {
      if(++attempts>180000) return false;
      const positions=arrangeGroup(group,choice.t,choice.phase,choice.rows);
      if(!positions) continue;
      const valid=positions.every(([id,p]) => {
        const parents=graph.parents.get(id).filter(parent=>placed.has(parent));
        return parents.every(parent=>p.t>placed.get(parent).t+.002) && [...placed.values()].every(q=>separate(p,q));
      });
      if(!valid) continue;
      for(const [id,p] of positions) placed.set(id,p);
      if(search(index+1)) return true;
      for(const [id] of positions) placed.delete(id);
    }
    return false;
  }
  if(!search(0)) throw new Error(`Не удалось разместить уровень ${failed.rank} (${failed.nodes.map(node=>node.name).join(', ')}) без пересечений и нарушения порядка связей${attempts>180000?': достигнут предел поиска':': свободного места на сетке поиска нет'}. Уменьшите размеры или число областей. Для полос и рамп резервируется описанная окружность.`);
  return placed;
}
