import neighbors from '../templates/neighbor_fronts.json';
import shared from '../templates/shared_regions.json';
import { validateTemplate, applyTemplate } from '../template-engine.js';
import { connectNodes, disconnectNodes } from '../graph-model.js';
import { createNode, setField } from '../node-types.js';

const STORAGE = 'planet-gen.templates.v1';

// The editor model owns persistence and history; React and the SVG renderer consume snapshots.
export function createTemplateStore(storage = globalThis.localStorage) {
  let templates = [validateTemplate(neighbors), validateTemplate(shared)];
  let loadError = '';
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE) ?? '[]');
    if (!Array.isArray(saved) || saved.length > 52) throw new Error('Некорректный список шаблонов');
    const restored = saved.map(validateTemplate);
    for (const item of restored) {
      const i = templates.findIndex(t => t.id === item.id);
      if (i < 0) templates.push(item); else templates[i] = item;
    }
  } catch (error) { loadError = `Сохранённые шаблоны не загружены: ${error.message}`; }
  let id = templates[0].id, selected = null;
  let parameters = { players: templates[0].players.default, seed: 42, metalScale: 1 };
  const histories = new Map(), listeners = new Set();
  const template = () => templates.find(t => t.id === id);
  const history = () => {
    if (!histories.has(id)) histories.set(id, { past: [], future: [] });
    return histories.get(id);
  };
  function compile() {
    try { return applyTemplate(template(), parameters); }
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
        if (path === 'pattern' && value === 'gate') node.chain.step = Math.min(node.chain.step, node.radius * 1.8);
      });
    },
    connect(from, to) { commit(connectNodes(template(), from, to)); },
    remove(from, to) { commit(disconnectNodes(template(), from, to)); },
    move(nodeId, canvas) { edit(t => { t.nodes.find(n => n.id === nodeId).canvas = canvas; }, { generate: false }); },
    create(kind, canvas, parent) {
      const node = createNode(kind, template().nodes, canvas);
      edit(t => { t.nodes.push(node); if (parent && kind !== 'spawn') t.links.push({ from: parent, to: node.id }); });
      store.select(node.id); return node.id;
    },
    duplicate(nodeId, canvas) {
      const original = template().nodes.find(n => n.id === nodeId);
      const node = { ...structuredClone(original), id: createNode(original.kind, template().nodes).id,
        name: `${original.name} копия`.slice(0, 100), canvas };
      edit(t => t.nodes.push(node)); store.select(node.id); return node.id;
    },
    deleteNode(nodeId) {
      edit(t => { t.nodes = t.nodes.filter(n => n.id !== nodeId); t.links = t.links.filter(l => l.from !== nodeId && l.to !== nodeId); });
    },
    arrange() { edit(t => { for (const node of t.nodes) delete node.canvas; }, { generate: false }); },
    travel(direction) {
      const h = history(), from = direction === 'undo' ? h.past : h.future, to = direction === 'undo' ? h.future : h.past;
      if (!from.length) return;
      const old = structuredClone(template());
      commit(from.at(-1), { remember: false }); from.pop(); to.push(old); emit();
    },
    add(raw) {
      const next = validateTemplate(raw);
      if (templates.some(t => t.id === next.id)) throw new Error(`Шаблон ${next.id} уже существует; используйте другой ID`);
      if (templates.length >= 52) throw new Error('Сохранено слишком много шаблонов');
      save([...templates, next]); store.choose(next.id);
    },
    newTemplate({ id, name, copy }) {
      const next = copy ? structuredClone(template()) : {
        version: 2, players: { min: 3, max: 12, default: 4 }, nodes: [{ ...createNode('spawn'), id: 'starts' }], links: [],
      };
      next.id = id.trim(); next.name = name.trim(); store.add(next);
    },
  };
  emit(); return store;
}
