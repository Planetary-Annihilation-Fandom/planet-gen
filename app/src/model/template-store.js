import composition from '../templates/composition.json';
import duel from '../templates/duel.json';
import branches from '../templates/branches.json';
import { validateTemplate, applyTemplate } from '../template-engine.js';
import { connectNodes, disconnectNodes, layoutGraph, moveThroughLink } from '../graph-model.js';
import { createNode, setField } from '../node-types.js';

const STORAGE = 'planet-gen.templates.v4';

// Модель хранит шаблоны и историю; исходная раскладка назначается один раз при загрузке.
function withPositions(raw) {
  const template = validateTemplate(raw);
  const { positions } = layoutGraph(template);
  for (const node of template.nodes) node.canvas ??= positions.get(node.id);
  return template;
}
/** Хранит исходные шаблоны и историю отдельно от результатов worker; перестановка карточек не запускает расчёт карты. */
export function createTemplateStore(storage = globalThis.localStorage) {
  let templates = [withPositions(composition), withPositions(duel), withPositions(branches)];
  let loadError = '';
  storage?.removeItem('planet-gen.templates.v1');
  storage?.removeItem('planet-gen.legacy-imports');
  let savedSource = storage?.getItem(STORAGE) ?? storage?.getItem('planet-gen.templates.v3');
  try {
    const saved = JSON.parse(savedSource ?? '[]');
    if (!Array.isArray(saved) || saved.length > 52) throw new Error('Некорректный список шаблонов');
    const current = saved.filter(raw => ![1, 2].includes(raw?.version));
    if (current.length !== saved.length) { savedSource = JSON.stringify(current); storage?.setItem(STORAGE, savedSource); }
    for (const raw of current) {
      try {
        const item = withPositions(raw), i = templates.findIndex(t => t.id === item.id);
        if (i < 0) templates.push(item); else templates[i] = item;
      } catch (error) {
        loadError = `Часть шаблонов не загружена: ${error.message}.`;
      }
    }
  } catch (error) {
    loadError = `Сохранённые шаблоны не загружены: ${error.message}. Исходные данные будут сохранены в архив восстановления перед изменениями.`;
  }
  let id = templates[0].id, selected = null;
  let parameters = { players: 2, seed: 42, metalScale: 1, planetRadius: 500 };
  const histories = new Map(), listeners = new Set();
  const template = () => templates.find(t => t.id === id);
  const history = () => {
    if (!histories.has(id)) histories.set(id, { past: [], future: [] });
    return histories.get(id);
  };
  let surface = null, sentSurface = null, request = 0;
  let worker = typeof Worker === 'function' ? new Worker(new URL('../generation-worker.js', import.meta.url), { type: 'module' }) : null;
  if (worker) worker.onerror = event => {
    request++; worker.terminate(); worker = null; sentSurface = null;
    applied = { ...applied, debug: { ...applied.debug, pending: false, error: event.message || 'Расчёт в worker завершился с ошибкой' } };
    emit();
  };
  if (worker) worker.onmessage = ({ data }) => {
    if (data.id !== request) return;
    if (data.error) applied = { ...applied, debug: { ...applied.debug, pending: false, error: data.error, balance: 'Исправьте параметры или связи.' } };
    else applied = data.applied;
    emit();
  };
  function compile() {
    try {
      request++;
      if (worker && surface && template().version === 4) {
        const preliminary = applyTemplate(template(), parameters);
        worker.postMessage({id:request,template:template(),parameters,...(sentSurface !== surface ? {surface} : {})});
        sentSurface = surface;
        return { ...preliminary, debug: { ...preliminary.debug, pending: true, balance: 'Расчёт рельефа, навигации и стартов…' } };
      }
      return applyTemplate(template(), parameters, surface);
    }
    catch (error) {
      return { template: template(), parameters, zones: [], links: [], debug: {
        rules: template().nodes.length, inactiveNodes: template().nodes.map(n => n.id),
        metal: 0, warnings: [], error: error.message, balance: 'Исправьте параметры или связи.',
      } };
    }
  }
  let applied = compile(), snapshot;
  function emit() {
    snapshot = { templates, template: template(), parameters, applied, selected, loadError,
      canUndo: history().past.length > 0, canRedo: history().future.length > 0 };
    listeners.forEach(listener => listener());
  }
  function save(next) {
    if (loadError && savedSource) storage?.setItem('planet-gen.templates.v4.recovery', savedSource);
    storage?.setItem(STORAGE, JSON.stringify(next));
    templates = next;
  }
  function commit(raw, { generate = true, remember = true } = {}) {
    const next = validateTemplate(raw), old = template();
    if (JSON.stringify(next) === JSON.stringify(old)) return;
    save(templates.map(t => t.id === id ? next : t));
    if (remember) {
      history().past.push(structuredClone(old));
      if (history().past.length > 50) history().past.shift();
      history().future = [];
    }
    if (!next.nodes.some(n => n.id === selected)) selected = null;
    applied = generate ? compile() : { ...applied, template: next };
    emit();
  }
  function edit(callback, options) {
    const next = structuredClone(template());
    callback(next); commit(next, options);
  }
  const store = {
    surface(value) { surface = value; parameters = { ...parameters, planetRadius: value.radius }; applied = compile(); emit(); },
    linkWeight(from, to, weight) { edit(t => { t.links.find(l => l.from === from && l.to === to).weight = weight; }); },
    dispose() { request++; worker?.terminate(); worker = null; listeners.clear(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    select(nodeId) { selected = nodeId; emit(); },
    choose(templateId) {
      if (!templates.some(t => t.id === templateId)) return;
      id = templateId; selected = null;
      parameters = { ...parameters, players: template().players.default };
      applied = compile(); emit();
    },
    parameters(next) { parameters = { ...parameters, ...next }; applied = compile(); emit(); },
    change(nodeId, path, value) {
      edit(t => {
        const node = t.nodes.find(n => n.id === nodeId);
        setField(node, path, value);
      });
    },
    connect(from, to) { commit(connectNodes(template(), from, to)); },
    remove(from, to) { commit(disconnectNodes(template(), from, to)); },
    moveThroughLink(nodeId, canvas, edge) { commit(moveThroughLink(template(), nodeId, canvas, edge)); },
    move(nodeId, canvas) { edit(t => { t.nodes.find(n => n.id === nodeId).canvas = canvas; }, { generate: false }); },
    create(kind, canvas, parent) {
      const node = createNode(kind, template().nodes, canvas);
      edit(t => { t.nodes.push(node); if (parent && !['spawn','composition','fragment'].includes(kind)) t.links.push({ from: parent, to: node.id }); });
      store.select(node.id); return node.id;
    },
    duplicate(nodeId, canvas) {
      const original = template().nodes.find(n => n.id === nodeId);
      const node = { ...structuredClone(original), id: createNode(original.kind, template().nodes).id,
        name: `${original.name} копия`.slice(0, 100), canvas };
      edit(t => t.nodes.push(node)); store.select(node.id); return node.id;
    },
    deleteNode(nodeId) {
      if (template().version === 3 && template().nodes.find(n => n.id === nodeId)?.kind === 'spawn') throw new Error('Единственный спавн нельзя удалить');
      edit(t => { t.nodes = t.nodes.filter(n => n.id !== nodeId); t.links = t.links.filter(l => l.from !== nodeId && l.to !== nodeId); });
    },
    travel(direction) {
      const h = history(), from = direction === 'undo' ? h.past : h.future, to = direction === 'undo' ? h.future : h.past;
      if (!from.length) return;
      const old = structuredClone(template());
      commit(from.at(-1), { remember: false }); from.pop(); to.push(old); emit();
    },
    add(raw) {
      const next = withPositions(raw);
      if (templates.some(t => t.id === next.id)) throw new Error(`Шаблон ${next.id} уже существует; используйте другой ID`);
      if (templates.length >= 52) throw new Error('Сохранено слишком много шаблонов');
      save([...templates, next]); store.choose(next.id);
    },
    convertToComposition() {
      const original = template(), next = structuredClone(original);
      let suffix = 1; while (templates.some(t => t.id === `${original.id}_composition_${suffix}`)) suffix++;
      next.id = `${original.id}_composition_${suffix}`; next.name = `${original.name}: композиция`.slice(0,100);
      next.version = 4; next.players = {min:2,max:8,default:2};
      next.nodes = next.nodes.filter(n => n.kind !== 'front').map(n => n.kind === 'spawn' ? {...createNode('composition'), id:n.id,canvas:n.canvas} : n);
      const ids = new Set(next.nodes.map(n => n.id)); next.links = next.links.filter(l => ids.has(l.from) && ids.has(l.to));
      next.description = 'Композиция преобразована из стороны 1v1; исходный шаблон сохранён отдельно. Проверьте композицию всей планеты.';
      store.add(next);
    },
    newTemplate({ id, name, copy }) {
      const next = copy ? structuredClone(template()) : {
        version: 4, players: { min: 2, max: 8, default: 2 }, nodes: [{ ...createNode('composition'), id: 'root' }], links: [],
      };
      next.id = id.trim(); next.name = name.trim(); store.add(next);
    },
  };
  emit(); return store;
}
