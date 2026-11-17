import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Accordion, AccordionItem, Button, InlineNotification, Menu, MenuItem, MenuItemDivider, Tag } from '@carbon/react';
import { setupGraphPanel } from '../graph-panel.js';
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

// React Flow измеряет карточку, но её раскрытие не запускает раскладку или движение камеры.
function TemplateNode({ data, selected }) {
  const { node, store, inactive } = data;
  const [open, setOpen] = useState(false);
  const type = NODE_TYPES[node.kind];
  const fields = type.fields.filter(field => !field.when || field.when(node));
  const primary = fields.filter(field => type.primaryFields.includes(field.path));
  const extra = fields.filter(field => !type.primaryFields.includes(field.path));
  return <section className={`template-node${selected ? ' selected' : ''}${inactive ? ' inactive' : ''}${open ? ' expanded' : ''}`} aria-label={node.name}>
    {node.kind !== 'spawn' && <Handle type="target" position={Position.Left} id="input" aria-label="Вход" />}
    <header className="template-node-heading"><strong>{node.name}</strong><span>{NODE_TYPES[node.kind].title}</span></header>
    {node.kind !== 'front' && <Handle type="source" position={Position.Right} id="output" aria-label="Выход" />}
    <div className="node-fields node-primary-fields nodrag nowheel nopan" aria-label="Основные параметры">
      {primary.map(field => <NodeField key={field.path} node={node} field={field} store={store} />)}
    </div>
    <Accordion size="sm" className="nodrag nowheel nopan">
      <AccordionItem title="Дополнительно" open={open} onHeadingClick={() => setOpen(value => !value)}>
        {open && <div className="node-fields">{extra.map(field => <NodeField key={field.path} node={node} field={field} store={store} />)}</div>}
      </AccordionItem>
    </Accordion>
  </section>;
}
const nodeTypes = { template: TemplateNode };

export function GraphPanel({ snapshot, store, notify, hidden, collapsed, onCollapse }) {
  const panel = useRef(), handle = useRef(), flow = useRef(), views = useRef(readViews());
  const [menu, setMenu] = useState(null), [nodes, setNodes] = useState([]), [viewport, setViewport] = useState(() => {
    const saved = views.current[snapshot.template.id];
    return validView(saved) ? saved : { x: 24, y: 24, zoom: 0.7 };
  });
  const templateId = useRef(snapshot.template.id);
  const safe = action => { try { return action(); } catch (error) { notify(error.message, true); } };
  useEffect(() => setupGraphPanel(panel.current, handle.current), []);
  useEffect(() => {
    if (templateId.current !== snapshot.template.id) {
      templateId.current = snapshot.template.id;
      const saved = views.current[snapshot.template.id];
      setViewport(validView(saved) ? saved : { x: 24, y: 24, zoom: 0.7 });
    }
    setNodes(snapshot.template.nodes.map(node => ({ id: node.id, type: 'template', position: node.canvas,
      selected: snapshot.selected === node.id, zIndex: snapshot.selected === node.id ? 100 : 1, data: { node, store, inactive: snapshot.applied.debug.inactiveNodes.includes(node.id) } })));
  }, [snapshot.template, snapshot.selected, snapshot.applied, store]);
  function saveView(view) {
    views.current[templateId.current] = view;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(views.current)); } catch { /* Навигация работает и без сохранения. */ }
  }
  const edges = useMemo(() => snapshot.template.links.map(link => ({ id: `${link.from}:${link.to}`, source: link.from, target: link.to,
    sourceHandle: 'output', targetHandle: 'input', type: 'smoothstep' })), [snapshot.template]);
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
  const menuNode = snapshot.template.nodes.find(n => n.id === menu?.nodeId);
  const command = action => () => { setMenu(null); action(); };
  return <aside id="templateCard" className="graph-panel" ref={panel} hidden={hidden} aria-label="Граф шаблона">
    <div ref={handle} id="graphSplitter" role="separator" tabIndex={0} aria-label="Ширина панели графа" aria-orientation="vertical" />
    <div className="graph-heading"><h2>Граф</h2><div className="button-row">
      <Button kind="ghost" size="sm" onClick={onCollapse} aria-expanded={!collapsed}>{collapsed ? 'Граф' : 'Свернуть'}</Button>
      <Button kind="ghost" size="sm" disabled={!snapshot.canUndo} onClick={actions.undo}>Отменить</Button>
      <Button kind="ghost" size="sm" disabled={!snapshot.canRedo} onClick={actions.redo}>Повторить</Button>
    </div></div>
    <div className="graph-summary"><Tag type="gray" size="sm">1v1</Tag><Tag type="gray" size="sm">{snapshot.applied.zones.length} областей</Tag><Tag type="gray" size="sm">{snapshot.applied.debug.metal} металла</Tag></div>
    <div className="graph-canvas" id="nodeCanvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultEdgeOptions={{ zIndex: 0 }} elevateEdgesOnSelect={false} onInit={instance => { flow.current = instance; }}
        onNodesChange={changes => {
          setNodes(current => changes.applyTo(current));
          // Сохраняем завершённое перемещение мышью и шаги с клавиатуры.
          for (const change of changes) {
            if (change.type === 'position' && change.position && !change.dragging) safe(() => store.move(change.id, change.position));
          }
        }}
        onNodeDragStop={(_, node) => safe(() => store.move(node.id, node.position))}
        onNodeClick={(_, node) => store.select(node.id)} onPaneClick={() => { store.select(null); setMenu(null); }}
        onConnect={({ source, target }) => safe(() => store.connect(source, target))}
        onEdgeContextMenu={(event, edge) => { event.preventDefault(); safe(() => store.remove(edge.source, edge.target)); }}
        onNodeContextMenu={contextMenu} onPaneContextMenu={event => contextMenu(event)}
        viewport={viewport} onViewportChange={setViewport} onMoveEnd={(_, view) => saveView(view)}
        minZoom={0.02} maxZoom={4} autoPanOnNodeDrag={false} autoPanOnConnect={false} autoPanOnNodeFocus={false}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} selectNodesOnDrag={false}
        zoomOnDoubleClick={false} colorMode="dark">
        <Background />
      </ReactFlow>
    </div>
    <div className="graph-navigation button-row" aria-label="Навигация по графу">
      <Button kind="ghost" size="sm" onClick={() => flow.current?.zoomOut()}>−</Button>
      <Button kind="ghost" size="sm" onClick={() => flow.current?.zoomIn()}>+</Button>
      <Button kind="ghost" size="sm" onClick={() => flow.current?.fitView({ padding: 0.15 })}>Вписать граф</Button>
    </div>
    {!!snapshot.applied.debug.warnings.length && <div className="graph-notice"><InlineNotification kind="warning" title="Незавершённый граф" subtitle={snapshot.applied.debug.warnings.join("; ")} hideCloseButton lowContrast /></div>}
    {snapshot.applied.debug.error && <div className="graph-notice"><InlineNotification kind="error" title="Ошибка шаблона" subtitle={snapshot.applied.debug.error} hideCloseButton lowContrast /></div>}
    <Menu open={!!menu && !hidden && !collapsed} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)} label="Действия с графом">
      <MenuItem disabled={menuNode?.kind === 'front'} label={menu?.nodeId ? 'Создать дочернюю ноду' : 'Создать ноду'}>
        {Object.entries(NODE_TYPES).filter(([kind]) => kind !== 'spawn' && menuNode?.kind !== 'front').map(([kind, type]) => <MenuItem key={kind} label={type.title} onClick={command(() => safe(() => store.create(kind, menu?.nodeId ? suggest(menu.nodeId) : menu.canvas, menu?.nodeId)))} />)}
      </MenuItem>
      {menu?.nodeId && menuNode?.kind !== 'spawn' && <MenuItem label="Копировать ноду" onClick={command(() => actions.duplicate(menu.nodeId))} />}
      {menu?.nodeId && menuNode?.kind !== 'spawn' && <MenuItem label="Удалить ноду" kind="danger" onClick={command(() => actions.deleteNode(menu.nodeId))} />}
      <MenuItemDivider />
      <MenuItem label="Отменить" shortcut="Ctrl+Z" disabled={!snapshot.canUndo} onClick={command(actions.undo)} />
      <MenuItem label="Повторить" shortcut="Ctrl+Shift+Z" disabled={!snapshot.canRedo} onClick={command(actions.redo)} />
      <MenuItem label="Вписать граф" onClick={command(() => flow.current?.fitView({ padding: 0.15 }))} />
    </Menu>
  </aside>;
}
