import { useEffect, useRef, useState } from 'react';
import { Button, InlineNotification, Menu, MenuItem, MenuItemDivider, Tag } from '@carbon/react';
import { Maximize, Redo, Undo } from '@carbon/icons-react';
import { createTemplateGraph } from '../template-graph.js';
import { setupGraphPanel } from '../graph-panel.js';
import { NODE_TYPES } from '../node-types.js';
import { NodeInspector } from './NodeInspector.jsx';

export function GraphPanel({ snapshot, store, notify, hidden }) {
  const panel = useRef(), handle = useRef(), host = useRef(), graph = useRef();
  const [menu, setMenu] = useState(null);
  const safe = action => { try { return action(); } catch (error) { notify(error.message, true); } };
  const actions = useRef();
  actions.current = {
    connect: (from, to) => safe(() => store.connect(from, to)),
    remove: (from, to) => safe(() => store.remove(from, to)),
    move: (id, position) => safe(() => store.move(id, position)),
    create: (kind, canvas, parent) => safe(() => {
      const id = store.create(kind, canvas ?? graph.current.suggest(parent), parent);
      graph.current.reveal(id);
    }),
    duplicate: id => safe(() => { const next = store.duplicate(id, graph.current.suggest(id)); graph.current.reveal(next); }),
    deleteNode: id => safe(() => store.deleteNode(id)),
    undo: () => safe(() => store.travel('undo')),
    redo: () => safe(() => store.travel('redo')),
    arrange: () => safe(() => { store.arrange(); requestAnimationFrame(() => graph.current.fit()); }),
    error: message => notify(message, true),
    contextMenu: setMenu,
  };
  useEffect(() => {
    const proxy = Object.fromEntries(Object.keys(actions.current).map(key => [key, (...args) => actions.current[key](...args)]));
    graph.current = createTemplateGraph(host.current, id => store.select(id), proxy);
    const cleanup = setupGraphPanel(panel.current, handle.current);
    return () => { graph.current.dispose(); cleanup?.(); };
  }, [store]);
  useEffect(() => { graph.current.show(snapshot.applied); }, [snapshot.applied]);
  useEffect(() => { graph.current.select(snapshot.selected); }, [snapshot.selected, snapshot.applied]);
  useEffect(() => {
    if (hidden) { setMenu(null); return; }
    function keydown(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true],[role=menu]')) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); actions.current[event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo']();
      }
      if (event.key === 'Delete' && store.getSnapshot().selected && !event.target.closest('[data-edge]')) {
        event.preventDefault(); actions.current.deleteNode(store.getSnapshot().selected);
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [hidden, store]);
  const command = action => () => { setMenu(null); action(); };
  return <aside id="templateCard" className="graph-panel" ref={panel} hidden={hidden} aria-label="Граф шаблона">
    <div ref={handle} id="graphSplitter" role="separator" tabIndex={0} aria-label="Ширина панели графа" aria-orientation="vertical" />
    <div className="graph-heading">
      <h2>Граф</h2>
      <div className="button-row">
        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Undo} iconDescription="Отменить" disabled={!snapshot.canUndo} onClick={() => actions.current.undo()} />
        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Redo} iconDescription="Повторить" disabled={!snapshot.canRedo} onClick={() => actions.current.redo()} />
        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Maximize} iconDescription="Вписать граф" onClick={() => graph.current.fit()} />
      </div>
    </div>
    <div className="graph-summary"><Tag type="gray" size="sm">{snapshot.parameters.players} игроков</Tag><Tag type="gray" size="sm">{snapshot.applied.zones.length} областей</Tag><Tag type="gray" size="sm">{snapshot.applied.debug.metal} металла</Tag></div>
    <div className="graph-canvas">
      <div ref={host} id="nodeCanvas" />
      <NodeInspector snapshot={snapshot} store={store} actions={actions.current} />
    </div>
    {snapshot.applied.debug.error && <div className="graph-notice"><InlineNotification kind="error" title="Ошибка шаблона" subtitle={snapshot.applied.debug.error} hideCloseButton lowContrast /></div>}
    <Menu open={!!menu && !hidden} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)} label="Действия с графом">
      <MenuItem label={menu?.nodeId ? 'Создать дочернюю ноду' : 'Создать ноду'}>
        {Object.entries(NODE_TYPES).map(([kind, type]) => <MenuItem key={kind} label={type.title} onClick={command(() => actions.current.create(kind, menu?.nodeId ? undefined : menu?.canvas, menu?.nodeId))} />)}
      </MenuItem>
      {menu?.nodeId && <MenuItem label="Копировать ноду" onClick={command(() => actions.current.duplicate(menu.nodeId))} />}
      {menu?.nodeId && <MenuItem label="Удалить ноду" kind="danger" onClick={command(() => actions.current.deleteNode(menu.nodeId))} />}
      <MenuItemDivider />
      <MenuItem label="Отменить" shortcut="Ctrl+Z" disabled={!snapshot.canUndo} onClick={command(() => actions.current.undo())} />
      <MenuItem label="Повторить" shortcut="Ctrl+Shift+Z" disabled={!snapshot.canRedo} onClick={command(() => actions.current.redo())} />
      <MenuItemDivider />
      <MenuItem label="Разложить граф" onClick={command(() => actions.current.arrange())} />
      <MenuItem label="Вписать граф" onClick={command(() => graph.current.fit())} />
    </Menu>
  </aside>;
}
