import { useEffect, useRef, useState } from 'react';
import { TextInput } from '@carbon/react';
import { getField } from '../node-types.js';
import { Choice, NumericField } from './Fields.jsx';

export function NodeField({ node, field, store }) {
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

