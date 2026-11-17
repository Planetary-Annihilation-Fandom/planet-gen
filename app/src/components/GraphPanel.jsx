/**
 * Канвас редактирует исходный шаблон, сохраняя положения карточек отдельно от карты.
 * Цвет входа и вызовов одного фрагмента определяется его номером, чтобы ссылки
 * между разнесёнными частями канваса можно было найти без раскрытия параметров.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Login, Logout } from '@carbon/icons-react';
import { NumericField } from './Fields.jsx';
import { Button, InlineNotification, Menu, MenuItem, MenuItemDivider, Tag } from '@carbon/react';
import { setupGraphPanel } from '../graph-panel.js';
import { moveThroughLink } from '../graph-model.js';
import { NODE_TYPES } from '../node-types.js';
import { NodeField } from './NodeField.jsx';

const VIEW_KEY = 'planet-gen.graph-view.v1';
function readViews() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}
function validView(view) {
  return view && [view.x, view.y, view.zoom].every(Number.isFinite) && view.zoom >= 0.02 && view.zoom <= 4;
}

function TemplateNode({ data, selected }) {
  const { node, store, inactive } = data;
  const type = NODE_TYPES[node.kind];
  const fields = type.fields.filter(field => !field.when || field.when(node));
  const primary = fields.filter(field => type.primaryFields.includes(field.path));
  return <section className={`template-node${selected ? ' selected' : ''}${inactive ? ' inactive' : ''}`} aria-label={node.name}>
    {!['spawn','composition','fragment'].includes(node.kind) && <Handle type="target" position={Position.Left} id="input" aria-label="Вход"><Login size={16} /></Handle>}
    <header className="template-node-heading" style={['fragment','call'].includes(node.kind) ? {
      background: `hsl(${(node.fragment * 137.508 + 235) % 360} 38% 28%)`,
      borderTop: `3px solid hsl(${(node.fragment * 137.508 + 235) % 360} 65% 68%)`,
    } : undefined}><strong>{node.name}</strong><span>{type.title}</span></header>
    {!['front','exit'].includes(node.kind) && <Handle type="source" position={Position.Right} id="output" aria-label="Выход"><Logout size={16} /></Handle>}
    <div className="node-fields node-primary-fields nodrag nowheel nopan" aria-label="Основные параметры">
      {(selected ? fields : primary).map(field => <NodeField key={field.path} node={node} field={field} store={store} />)}
    </div>
  </section>;
}
const nodeTypes = { template: TemplateNode };

export function GraphPanel({ snapshot, store, notify, hidden, collapsed, onCollapse }) {
  const panel = useRef(), handle = useRef(), flow = useRef(), views = useRef(readViews());
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [menu, setMenu] = useState(null), [nodes, setNodes] = useState([]), [viewport, setViewport] = useState(() => {
    const saved = views.current[snapshot.template.id];
    return validView(saved) ? saved : { x: 24, y: 24, zoom: 0.7 };
  });
  const dragging = useRef(false), lastDrag = useRef(null), pathSamples = useRef(null);
  const [preview, setPreview] = useState(null);
  const templateId = useRef(snapshot.template.id);
  const safe = action => { try { return action(); } catch (error) { notify(error.message, true); } };
  useEffect(() => setupGraphPanel(panel.current, handle.current), []);
  useEffect(() => {
    if (templateId.current !== snapshot.template.id) {
      templateId.current = snapshot.template.id;
      const saved = views.current[snapshot.template.id];
      setViewport(validView(saved) ? saved : { x: 24, y: 24, zoom: 0.7 });
    }
    setNodes(snapshot.template.nodes.map(node => ({ id: node.id, type: 'template', position: node.canvas, dragHandle: '.template-node-heading',
      selected: snapshot.selected === node.id, zIndex: snapshot.selected === node.id ? 100 : 1, data: { node, store, inactive: snapshot.applied.debug.inactiveNodes.includes(node.id) } })));
  }, [snapshot.template, snapshot.selected, snapshot.applied, store]);
  function saveView(view) {
    views.current[templateId.current] = view;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(views.current)); } catch { /* Навигация работает и без сохранения. */ }
  }
  const edges = useMemo(() => snapshot.template.links.map(link => ({ id: `${link.from}:${link.to}`, source: link.from, target: link.to,
    sourceHandle: 'output', targetHandle: 'input', type: 'default', label: snapshot.template.nodes.find(n => n.id === link.from)?.kind === 'choice' ? `Вес ${link.weight ?? 1}` : undefined })), [snapshot.template]);
  function suggest(parent) {
    const position = snapshot.template.nodes.find(node => node.id === parent)?.canvas;
    return position ? { x: position.x + 360, y: position.y + 120 } : flow.current.screenToFlowPosition({ x: panel.current.getBoundingClientRect().left + 80, y: 180 });
  }
  const actions = {
    duplicate: id => safe(() => store.duplicate(id, suggest(id))),
    deleteNode: id => safe(() => store.deleteNode(id)),
    undo: () => safe(() => store.travel('undo')), redo: () => safe(() => store.travel('redo')),
  };
  useEffect(() => {
    if (hidden || collapsed) { setMenu(null); return; }
    function keydown(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true],[role=menu]')) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); safe(() => store.travel(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'));
      }
      if (event.key === 'Delete' && store.getSnapshot().selected) { event.preventDefault(); safe(() => store.deleteNode(store.getSnapshot().selected)); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [hidden, collapsed, store]);
  function contextMenu(event, node) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node?.id, canvas: flow.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
  }
  function dragPreview(event, node) {
    lastDrag.current = { event, node };
    if (!event.altKey || !['metal','blocker','ramp','call','choice'].includes(node.data.node.kind)) { setPreview(null); return null; }
    const element = panel.current.querySelector(`[data-id="${node.id}"]`);
    const rect = element?.getBoundingClientRect(), origin = flow.current.flowToScreenPosition(node.position);
    if (!rect) return null;
    const bounds = { left: origin.x - 8, right: origin.x + rect.width + 8, top: origin.y - 8, bottom: origin.y + rect.height + 8 };
    let nearest = null, distance = Infinity;
    if (!pathSamples.current) {
      pathSamples.current = [];
      for (const group of panel.current.querySelectorAll('.react-flow__edge')) {
        const edge = edges.find(e => e.id === group.dataset.id);
        if (!edge || edge.source === node.id || edge.target === node.id) continue;
        const path = group.querySelector('.react-flow__edge-path'), matrix = path?.getScreenCTM();
        if (!matrix) continue;
        const length = path.getTotalLength();
        const points = Array.from({ length: 81 }, (_, i) => path.getPointAtLength(length * i / 80).matrixTransform(matrix));
        pathSamples.current.push({ edge, points });
      }
    }
    for (const { edge, points } of pathSamples.current) for (const point of points) {
      if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) continue;
      const d = Math.hypot(point.x - origin.x - rect.width / 2, point.y - origin.y - rect.height / 2);
      if (d < distance) { distance = d; nearest = { from: edge.source, to: edge.target }; }
    }
    let result;
    try {
      const next = moveThroughLink(snapshot.template, node.id, node.position, nearest);
      result = { edge: nearest, links: next.links, message: nearest ? 'Отпустите: вставить в подсвеченную связь' : 'Отпустите: извлечь ноду и соединить её соседей' };
    } catch (error) { result = { error: error.message, message: error.message }; }
    setPreview(result); return result;
  }
  useEffect(() => {
    function modifiers(event) {
      const last = lastDrag.current;
      if (dragging.current && last && event.key === 'Alt') dragPreview({ ...last.event, altKey: event.type === 'keydown' }, last.node);
    }
    document.addEventListener('keydown', modifiers); document.addEventListener('keyup', modifiers);
    return () => { document.removeEventListener('keydown', modifiers); document.removeEventListener('keyup', modifiers); };
  });
  function dropNode(event, node) {
    const result = dragPreview(event, node);
    dragging.current = false; lastDrag.current = null; pathSamples.current = null; setPreview(null);
    if (!result) safe(() => store.move(node.id, node.position));
    else if (result.error) { safe(() => store.move(node.id, node.position)); notify(result.error, true); }
    else safe(() => store.moveThroughLink(node.id, node.position, result.edge));
  }
  const previewKeys = new Set(preview?.links?.map(l => `${l.from}:${l.to}`));
  const displayEdges = preview?.links ? [
    ...edges.map(edge => ({ ...edge, className: preview.edge && edge.id === `${preview.edge.from}:${preview.edge.to}` ? 'edge-target' : !previewKeys.has(edge.id) ? 'edge-removing' : '' })),
    ...preview.links.filter(l => !edges.some(e => e.source === l.from && e.target === l.to)).map(l => ({ id: `preview:${l.from}:${l.to}`, source: l.from, target: l.to, sourceHandle: 'output', targetHandle: 'input', type: 'default', className: 'edge-preview', selectable: false, focusable: false })),
  ] : edges;
  const menuNode = snapshot.template.nodes.find(n => n.id === menu?.nodeId);
  const command = action => () => { setMenu(null); action(); };
  return <aside id="templateCard" className="graph-panel" ref={panel} hidden={hidden} aria-label="Граф шаблона">
    <div ref={handle} id="graphSplitter" role="separator" tabIndex={0} aria-label="Ширина панели графа" aria-orientation="vertical" />
    <div className="graph-heading"><h2>Граф</h2><div className="button-row">
      <Button kind="ghost" size="sm" onClick={onCollapse} aria-expanded={!collapsed}>{collapsed ? 'Граф' : 'Свернуть'}</Button>
      <Button kind="ghost" size="sm" disabled={!snapshot.canUndo} onClick={actions.undo}>Отменить</Button>
      <Button kind="ghost" size="sm" disabled={!snapshot.canRedo} onClick={actions.redo}>Повторить</Button>
    </div></div>
    <div className="graph-summary"><Tag type="gray" size="sm">{snapshot.template.version === 4 ? "Композиция" : "1v1"}</Tag><Tag type="gray" size="sm">{snapshot.applied.zones.length} областей</Tag><Tag type="gray" size="sm">{snapshot.applied.debug.metal} металла</Tag></div>
    <div className="graph-canvas" id="nodeCanvas">
      <ReactFlow nodes={nodes} edges={displayEdges} nodeTypes={nodeTypes} connectionLineType="default" defaultEdgeOptions={{ zIndex: 0 }} elevateEdgesOnSelect={false} onInit={instance => { flow.current = instance; }}
        onNodesChange={changes => {
          setNodes(current => changes.applyTo(current));
          // Сохраняем завершённое перемещение мышью и шаги с клавиатуры.
          for (const change of changes) {
            if (change.type === 'position' && change.position && !change.dragging && !dragging.current) safe(() => store.move(change.id, change.position));
          }
        }}
        nodeDragThreshold={0} onNodeDragStart={(event, node) => { dragging.current = true; pathSamples.current = null; store.select(node.id); dragPreview(event, node); }} onNodeDrag={dragPreview} onNodeDragStop={dropNode}
        onNodeClick={(_, node) => store.select(node.id)} onPaneClick={() => { store.select(null); setMenu(null); }}
        onConnect={({ source, target }) => safe(() => store.connect(source, target))}
        onEdgeClick={(_, edge) => setSelectedEdge({ from: edge.source, to: edge.target })}
        onEdgeContextMenu={(event, edge) => { event.preventDefault(); safe(() => store.remove(edge.source, edge.target)); }}
        onNodeContextMenu={contextMenu} onPaneContextMenu={event => contextMenu(event)}
        viewport={viewport} onViewportChange={view => { pathSamples.current = null; setViewport(view); }} onMoveEnd={(_, view) => saveView(view)}
        minZoom={0.02} maxZoom={4} autoPanOnNodeDrag={false} autoPanOnConnect={false} autoPanOnNodeFocus={false}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} selectNodesOnDrag
        zoomOnDoubleClick={false} colorMode="dark">
        <Background />
      </ReactFlow>
    </div>
    {selectedEdge && snapshot.template.nodes.find(n => n.id === selectedEdge.from)?.kind === 'choice' && snapshot.template.links.some(l => l.from === selectedEdge.from && l.to === selectedEdge.to) && <div className="graph-notice"><NumericField id="choiceWeight" label={`Вес связи от ${selectedEdge.from} к ${selectedEdge.to}`} min={0} max={1000} value={snapshot.template.links.find(l => l.from === selectedEdge.from && l.to === selectedEdge.to)?.weight ?? 1} onChange={weight => safe(() => store.linkWeight(selectedEdge.from, selectedEdge.to, weight))} /></div>}
    {preview && <div className={`drag-preview-status${preview.error ? ' invalid' : ''}`} role="status">{preview.message}</div>}
    <div className="graph-navigation button-row" aria-label="Навигация по графу">
      <Button kind="ghost" size="sm" onClick={() => flow.current?.zoomOut()}>−</Button>
      <Button kind="ghost" size="sm" onClick={() => flow.current?.zoomIn()}>+</Button>
      <Button kind="ghost" size="sm" onClick={() => flow.current?.fitView({ padding: 0.15 })}>Вписать граф</Button>
    </div>
    {snapshot.applied.debug.error && <div className="graph-notice"><InlineNotification kind="error" title="Ошибка шаблона" subtitle={snapshot.applied.debug.error} hideCloseButton lowContrast /></div>}
    <Menu open={!!menu && !hidden && !collapsed} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)} label="Действия с графом">
      {Object.entries(NODE_TYPES).filter(([kind]) => (snapshot.template.version === 4 ? !['spawn','front'].includes(kind) : !['composition','fragment','call','choice','exit','spawn'].includes(kind)) && !['front','exit'].includes(menuNode?.kind)).map(([kind, type]) => <MenuItem key={kind} label={type.title} onClick={command(() => safe(() => store.create(kind, menu?.nodeId ? suggest(menu.nodeId) : menu.canvas, menu?.nodeId)))} />)}
      {menu?.nodeId && !['spawn', 'front'].includes(menuNode?.kind) && <MenuItemDivider />}
      {menu?.nodeId && menuNode?.kind !== 'spawn' && <MenuItem label="Копировать ноду" onClick={command(() => actions.duplicate(menu.nodeId))} />}
      {menu?.nodeId && menuNode?.kind !== 'spawn' && <MenuItem label="Удалить ноду" kind="danger" onClick={command(() => actions.deleteNode(menu.nodeId))} />}
    </Menu>
  </aside>;
}
