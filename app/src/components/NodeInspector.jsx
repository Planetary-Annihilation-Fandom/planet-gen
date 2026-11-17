import { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionItem, Button, TextInput } from '@carbon/react';
import { Copy, TrashCan } from '@carbon/icons-react';
import { NODE_TYPES, getField } from '../node-types.js';
import { Choice, NumericField } from './Fields.jsx';

function NodeField({ node, field, store }) {
  const external = getField(node, field.path);
  const formatted = field.type === 'number' ? Math.round(external * (field.scale ?? 1) * 1000) / 1000 : external;
  const [draft, setDraft] = useState(formatted), [error, setError] = useState('');
  const timer = useRef(), dirty = useRef(false);
  useEffect(() => { setDraft(formatted); setError(''); dirty.current = false; }, [formatted]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function commit(value) {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    try {
      store.change(node.id, field.path, field.type === 'number' ? value === '' ? NaN : Number(value) / (field.scale ?? 1) : value);
      dirty.current = false; setError('');
    } catch (error) { setError(error.message); }
  }
  function change(value) {
    dirty.current = true; setDraft(value); clearTimeout(timer.current);
    if (field.type === 'select') commit(value);
    else timer.current = setTimeout(() => commit(value), 240);
  }
  const props = { id: `node-${node.id}-${field.path.replaceAll('.', '-')}`, value: draft, onChange: change, invalid: !!error, invalidText: error };
  return <div className={field.type === 'number' ? '' : 'wide-field'}>
    {field.type === 'select' ? <Choice {...props} label={field.label} options={field.options} />
      : field.type === 'number' ? <NumericField {...props} label={field.label} min={field.min} max={field.max} step={field.step} onBlur={() => commit(draft)} />
        : <TextInput {...props} id={props.id} labelText={field.label} size="sm" maxLength={field.maxLength} onChange={event => change(event.target.value)} onBlur={() => commit(draft)} />}
  </div>;
}

export function NodeInspector({ snapshot, store, actions }) {
  const node = snapshot.template.nodes.find(n => n.id === snapshot.selected);
  const fields = node ? NODE_TYPES[node.kind].fields.filter(field => !field.when || field.when(node)) : [];
  const instances = snapshot.applied.zones.filter(zone => zone.nodeId === node?.id).map(({ id, owner, inputs }) => ({ id, owner, inputs }));
  return <section className="node-inspector" aria-label="Настройки ноды">
    <div className="inspector-heading">
      <h3>{node ? `${NODE_TYPES[node.kind].title}: ${node.name}` : 'Выберите ноду'}</h3>
      {node && <div className="button-row">
        <Button id="duplicateNode" kind="ghost" size="sm" hasIconOnly renderIcon={Copy} iconDescription="Копировать ноду" onClick={() => actions.duplicate(node.id)} />
        <Button id="deleteNode" kind="danger--ghost" size="sm" hasIconOnly renderIcon={TrashCan} iconDescription="Удалить ноду" onClick={() => actions.deleteNode(node.id)} />
      </div>}
    </div>
    {node ? <>
      <div id="nodeFields" className="node-fields">{fields.map(field => <NodeField key={`${node.id}:${field.path}`} node={node} field={field} store={store} />)}</div>
      <Accordion size="sm">
        <AccordionItem title={`Данные экземпляров (${instances.length})`}><pre>{JSON.stringify({ id: node.id, instances }, null, 2)}</pre></AccordionItem></Accordion>
      <Button kind="ghost" size="sm" onClick={() => store.select(null)}>Снять выделение</Button>
    </> : <p className="helper-text">Выберите область на планете или ноду в графе, чтобы изменить её параметры.</p>}
  </section>;
}
