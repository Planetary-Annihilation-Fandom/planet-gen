export const KINDS = { spawn: '#24a56a', metal: '#e5ae22', blocker: '#e34c50', ramp: '#4089e8', front: '#8b6cd6', composition: '#a6c8ff', fragment: '#d4bbff', call: '#be95ff', choice: '#ff7eb6', exit: '#82cfff' };
const number = (path, label, min, max, step = 1) => ({ path, label, type: 'number', min, max, step });
const size = number('size', 'Размер, %', 1, 100);
const name = { path: 'name', label: 'Название', type: 'text', maxLength: 100 };
export const NODE_TYPES = {
  spawn: { title: 'Спавн игрока', primaryFields: ['size'], defaults: { size: 12 }, fields: [name, size] },
  metal: { title: 'Металл', primaryFields: ['size', 'density'], defaults: { size: 10, density: 7 }, fields: [name, size, number('density', 'Насыщенность', 1, 100)] },
  blocker: { title: 'Блокер', primaryFields: ['size', 'shape'], defaults: { size: 16, shape: 'circle' }, fields: [name, size,
    { path: 'shape', label: 'Форма', type: 'select', options: [['circle', 'Окружность'], ['strip', 'Полоса']] }] },
  ramp: { title: 'Рампа', primaryFields: ['size', 'orientation'], defaults: { size: 12, orientation: 0 }, fields: [name, size, number('orientation', 'Угол к направляющей, °', -180, 180)] },
  composition: { title: 'Композиция', primaryFields: [], defaults: {}, fields: [name] },
  fragment: { title: 'Вход фрагмента', primaryFields: ['fragment'], defaults: { fragment: 1 }, fields: [name, number('fragment', 'Номер фрагмента', 1, 999)] },
  call: { title: 'Вызов фрагмента', primaryFields: ['fragment', 'maxRepeats'], defaults: { fragment: 1, maxRepeats: 3 }, fields: [name, number('fragment', 'Номер фрагмента', 1, 999), number('maxRepeats', 'Предел вложений', 1, 12)] },
  choice: { title: 'Выбор', primaryFields: ['maxVisits'], defaults: { maxVisits: 3 }, fields: [name, number('maxVisits', 'Предел повторов', 1, 12)] },
  exit: { title: 'Выход фрагмента', primaryFields: [], defaults: {}, fields: [name] },
  front: { title: 'Фронт', primaryFields: [], defaults: {}, fields: [name] },
};
export function getField(node, path) { return node[path]; }
export function setField(node, path, value) { node[path] = value; }
export function createNode(kind, existing = [], canvas) {
  if (!Object.hasOwn(NODE_TYPES, kind)) throw new Error('Неизвестный тип ноды');
  if (kind === 'spawn' && existing.some(n => n.kind === 'spawn')) throw new Error('В шаблоне 1v1 ровно один спавн; второй создаётся зеркально');
  let i = 1; while (existing.some(n => n.id === `${kind}_${i}`)) i++;
  return { id: `${kind}_${i}`, kind, name: NODE_TYPES[kind].title, ...structuredClone(NODE_TYPES[kind].defaults), ...(canvas ? { canvas } : {}) };
}
export function upgradeTemplate(raw) {
  if (![3, 4].includes(raw?.version)) throw new Error('Нужен шаблон версии 3 или 4');
  return structuredClone(raw);
}
export function validateNode(node) {
  const type = NODE_TYPES[node?.kind];
  if (!type) throw new Error('Неизвестный тип ноды');
  for (const f of type.fields) {
    const value = node[f.path];
    if (f.type === 'number' && (!Number.isFinite(value) || value < f.min || value > f.max || !Number.isInteger(value))) throw new Error(`${f.label}: допустимо целое от ${f.min} до ${f.max}`);
    if (f.type === 'select' && !f.options.some(([key]) => key === value)) throw new Error(`Неверное значение: ${f.label}`);
    if (f.type === 'text' && (typeof value !== 'string' || !value.trim() || value.length > f.maxLength)) throw new Error(`${f.label}: нужно от 1 до ${f.maxLength} символов`);
  }
  if (node.canvas && ![node.canvas.x, node.canvas.y].every(Number.isFinite)) throw new Error('Некорректное положение ноды');
}
