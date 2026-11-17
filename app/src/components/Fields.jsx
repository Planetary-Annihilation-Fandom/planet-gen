import { Checkbox, NumberInput, Select, SelectItem, TextInput } from '@carbon/react';
import { FIELDS, TEMPLATE_HIDDEN_FIELDS } from '../model/planet.js';

export function NumericField({ id, label, value, onChange, ...props }) {
  return <NumberInput id={id} label={label} value={value ?? ''} allowEmpty hideSteppers size="sm"
    invalidText="Введите число в допустимом диапазоне" onChange={(_, data) => onChange(data.value === '' ? '' : Number(data.value))} {...props} />;
}
export function Choice({ id, label, value, options, onChange, ...props }) {
  return <Select id={id} labelText={label} value={value} size="sm" onChange={event => onChange(event.target.value)} {...props}>
    {options.map(option => {
      const [value, title] = Array.isArray(option) ? option : [option, option];
      return <SelectItem key={value} value={value} text={String(title)} />;
    })}
  </Select>;
}
export function GeneratorFields({ parameters, onChange, template, disabled }) {
  return <div className="generator-fields">
    {FIELDS.filter(([key]) => !template || !TEMPLATE_HIDDEN_FIELDS.has(key)).map(([key, label, type]) => {
      const props = { id: `p_${key}`, label, value: parameters[key], disabled, onChange: value => onChange({ ...parameters, [key]: value }) };
      if (Array.isArray(type)) return <div className="wide-field" key={key}><Choice {...props} options={type} /></div>;
      if (type === 'checkbox') return <div className="wide-field" key={key}><Checkbox id={props.id} labelText={label} disabled={disabled}
        checked={!!parameters[key]} onChange={(_, { checked }) => props.onChange(checked)} /></div>;
      if (type === 'text') return <TextInput key={key} id={props.id} labelText={label} value={props.value ?? ''} disabled={disabled} onChange={e => props.onChange(e.target.value)} />;
      return <NumericField key={key} {...props} step="any" />;
    })}
  </div>;
}
