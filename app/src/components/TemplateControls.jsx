import { useState } from 'react';
import { Button, Checkbox, FileUploaderButton, InlineNotification, Modal, TextInput } from '@carbon/react';
import { Add, Download, Renew } from '@carbon/icons-react';
import { Choice, NumericField } from './Fields.jsx';
import { downloadJSON } from '../model/planet.js';

const APPLIED_LAYERS = { spawn: 'Спавны', metal: 'Металл', blocker: 'Блокеры', ramp: 'Рампы', front: 'Фронт и направляющая', links: 'Связи', debug: 'Подписи', icons: 'Значки областей' };

export function TemplateControls({ store, snapshot, notify, base, layers, setLayers, placements, disabled }) {
  const { template, templates, parameters, applied } = snapshot;
  const [open, setOpen] = useState(false), [form, setForm] = useState({ id: '', name: '', copy: false }), [error, setError] = useState('');
  const attempt = action => { try { action(); } catch (error) { notify(error.message, true); } };
  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 256000) throw new Error('JSON должен быть меньше 256 КБ');
      const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      store.add(raw);
    } catch (error) { notify(error.message, true); }
    event.target.value = '';
  }
  function create() {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(form.id)) { setError('ID должен начинаться с латинской буквы и содержать только буквы, цифры, _ или -'); return; }
    if (!form.name.trim() || form.name.trim().length > 100) { setError('Введите название длиной до 100 символов'); return; }
    try { store.newTemplate(form); setOpen(false); } catch (error) { setError(error.message); }
  }
  return <>
    <Choice id="templateSelect" label="Шаблон" value={template.id} options={templates.map(t => [t.id, t.name])} onChange={id => attempt(() => store.choose(id))} disabled={disabled} />
    <p className="helper-text">{template.description}</p>
    <div className="button-row">
      <Button id="newTemplate" kind="tertiary" size="sm" renderIcon={Add} disabled={disabled} onClick={() => { setForm({ id: '', name: '', copy: false }); setError(''); setOpen(true); }}>Создать</Button>
      <Button id="exportTemplate" kind="ghost" size="sm" renderIcon={Download} onClick={() => downloadJSON(`${template.id}.json`, template)}>JSON</Button>
    </div>
    <FileUploaderButton id="importTemplate" labelText="Загрузить шаблон JSON" buttonKind="ghost" size="sm" accept={['.json']} disableLabelChanges onChange={importFile} disabled={disabled} />
    <div className="section-heading">Шаблон 1v1</div>
    <p className="helper-text">Размер: диаметр в процентах пути от спавна до фронта. При текущем радиусе 10% ≈ {Math.round(parameters.planetRadius * Math.PI / 20)} единиц поверхности. Насыщенность металла: число точек для области размера 10%; число растёт с площадью.</p>
    <NumericField id="templateSeed" label="Зерно шаблона" min={0} max={4294967295} value={parameters.seed} disabled={disabled} onChange={seed => store.parameters({ seed })} />
    <Choice id="metalScale" label="Количество металла" value={parameters.metalScale} options={[[0.5, 'Половина'], [1, 'Обычное'], [1.5, 'В 1.5 раза больше'], [2, 'Вдвое больше']]}
      disabled={disabled} onChange={value => store.parameters({ metalScale: Number(value) })} />
    <Button id="rerollTemplate" kind="tertiary" size="sm" renderIcon={Renew} disabled={disabled} onClick={() => store.parameters({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })}>Новый вариант</Button>
    <div className="section-heading">Слои шаблона</div>
    <div className="layer-options">{Object.entries(APPLIED_LAYERS).map(([key, title]) => <Checkbox key={key} id={`layer-${key}`} labelText={title} checked={!!layers[key]}
      onChange={(_, { checked }) => setLayers(previous => ({ ...previous, [key]: checked }))} />)}</div>
    <Button id="exportResult" kind="tertiary" size="sm" renderIcon={Download} disabled={!base || !!applied.debug.error || disabled}
      onClick={() => downloadJSON(`${template.id}-result.json`, { base, applied: { ...applied, result: placements.current } })}>Сохранить результат</Button>
    <Modal open={open} modalHeading="Новый шаблон" modalLabel="Редактор шаблонов" primaryButtonText="Создать" secondaryButtonText="Отмена"
      onRequestClose={() => setOpen(false)} onRequestSubmit={create} selectorPrimaryFocus="#newTemplateId">
      <form className="modal-form" onSubmit={event => { event.preventDefault(); create(); }}>
        <Choice id="newTemplateMode" label="Основа" value={form.copy ? 'copy' : 'empty'} options={[['empty', 'Пустой со стартовой нодой'], ['copy', 'Копия выбранного шаблона']]}
          onChange={value => setForm({ ...form, copy: value === 'copy' })} />
        <TextInput id="newTemplateId" labelText="ID на латинице" maxLength={80} value={form.id} onChange={event => setForm({ ...form, id: event.target.value })} placeholder="my_template" required />
        <TextInput id="newTemplateName" labelText="Название" maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required />
        {error && <InlineNotification kind="error" title="Шаблон не создан" subtitle={error} hideCloseButton lowContrast />}
      </form>
    </Modal>
  </>;
}
