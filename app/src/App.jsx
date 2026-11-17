import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Accordion, AccordionItem, Button, Checkbox, Content, Layer, InlineLoading, InlineNotification, Theme, ToastNotification } from '@carbon/react';
import { Close, Menu, Play, SettingsAdjust } from '@carbon/icons-react';
import { createScene } from './scene.js';
import { cleanBasePlanet } from './template-engine.js';
import { createTemplateStore } from './model/template-store.js';
import { BASE_SOURCE, asSystem, randomPlanet } from './model/planet.js';
import { GeneratorFields, NumericField } from './components/Fields.jsx';
import { TemplateControls } from './components/TemplateControls.jsx';
import { GraphPanel } from './components/GraphPanel.jsx';
import { ResultPanel } from './components/ResultPanel.jsx';

const SURFACE_LAYERS = { textures: 'Текстуры', water: 'Вода и лава', csg: 'CSG', subtract: 'Вычитание', metal: 'Металл', candidates: 'Кандидаты металла', wire: 'Сетка поверхности' };
const INITIAL_LAYERS = { textures: true, water: true, csg: true, subtract: false, metal: true, candidates: false, wire: false };

export default function App() {
  const [store] = useState(() => createTemplateStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const host = useRef(), sceneRef = useRef(), busyRef = useRef(false), baseSource = useRef(structuredClone(BASE_SOURCE)), placements = useRef();
  const [sceneReady, setSceneReady] = useState(false), [systems, setSystems] = useState([]), [planetIndex, setPlanetIndex] = useState(0);
  const [mode, setMode] = useState('templates'), [randomSource, setRandomSource] = useState(null), [parameters, setParameters] = useState({});
  const [slope, setSlope] = useState(40), [settingsOpen, setSettingsOpen] = useState(true);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [result, setResult] = useState(null), [base, setBase] = useState(null);
  const [notification, setNotification] = useState(null), [layersOpen, setLayersOpen] = useState(false), [layers, setLayers] = useState(INITIAL_LAYERS);
  const [appliedLayers, setAppliedLayers] = useState({ spawn: true, metal: true, blocker: true, ramp: true, region: true, links: true, debug: false, icons: true });
  const tauri = !!window.__TAURI_INTERNALS__;
  const template = mode === 'templates';
  function notify(message, error = false) { setNotification({ message: String(message), error, key: Date.now() }); }

  useEffect(() => {
    try { sceneRef.current = createScene(host.current); setSceneReady(true); }
    catch (error) { notify(`Не удалось открыть 3D-просмотр: ${error.message}`, true); }
    return () => sceneRef.current?.dispose();
  }, []);
  useEffect(() => { if (snapshot.loadError) notify(snapshot.loadError, true); }, [snapshot.loadError]);
  useEffect(() => {
    sceneRef.current?.toggle({ ...layers, ...(template ? { water: false, csg: false, subtract: false, metal: false, candidates: false } : {}) });
  }, [layers, template, result]);
  useEffect(() => {
    if (!sceneReady) return;
    placements.current = sceneRef.current.setApplied(template && base ? snapshot.applied : null, id => store.select(id));
    sceneRef.current.toggleApplied(appliedLayers);
    sceneRef.current.selectNode(snapshot.selected);
  }, [sceneReady, snapshot.applied, base, template, store]);
  useEffect(() => { sceneRef.current?.toggleApplied(appliedLayers); }, [appliedLayers]);
  useEffect(() => { sceneRef.current?.selectNode(snapshot.selected); }, [snapshot.selected]);

  async function generate(nextMode, source, values, systemName = systems[0]?.name ?? '') {
    if (!source || busyRef.current) return;
    if (!tauri) { notify('Для генерации откройте приложение planet-gen.', true); return; }
    if (!sceneRef.current) return;
    if (nextMode === 'templates' && (!Number.isFinite(Number(values.radius)) || Number(values.radius) < 100 || Number(values.radius) > 1200)) {
      notify('Для основы выберите радиус от 100 до 1200.', true); return;
    }
    busyRef.current = true; setBusy(true); setStatus('Генерация поверхности');
    try {
      const numeric = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
      const start = performance.now();
      let planet = await invoke(nextMode === 'templates' ? 'generate_base' : 'generate', {
        planet: { planet: numeric, planetCSG: nextMode === 'templates' ? [] : source.planetCSG ?? [] }, maxSlope: Number(slope),
      });
      const ms = performance.now() - start;
      setStatus('Загрузка текстур');
      let nextBase = null;
      if (nextMode === 'templates') { nextBase = cleanBasePlanet(planet, numeric); planet = nextBase.result; }
      await sceneRef.current.show(planet, { template: nextMode === 'templates' });
      if (nextBase) { baseSource.current = { ...BASE_SOURCE, planet: numeric }; setBase(nextBase); }
      setResult({ planet, name: source.name ?? 'Планета', ms, system: nextMode === 'templates' ? 'Основа шаблона' : nextMode === 'random' ? 'Случайная планета' : systemName });
    } catch (error) { notify(String(error), true); }
    finally { busyRef.current = false; setBusy(false); setStatus(''); }
  }
  useEffect(() => {
    if (!sceneReady || !tauri) return;
    let active = true;
    Promise.all([invoke('default_systems').catch(error => { notify(`Системы игры не прочитаны: ${error}`, true); return []; }), invoke('startup_args')])
      .then(async ([list, args]) => {
        if (!active) return;
        if (args.path) { const doc = await invoke('read_system', { path: args.path }); list = [{ ...asSystem(doc, args.path), __file: true }, ...list]; }
        if (!active) return;
        setSystems(list);
        const index = args.path ? args.planet ?? 0 : 0;
        setPlanetIndex(index);
        const nextMode = args.templates ? 'templates' : args.random ? 'random' : args.path ? 'existing' : 'templates';
        const source = nextMode === 'templates' ? baseSource.current : nextMode === 'random' ? randomPlanet(args.random) : list[0]?.planets?.[index];
        if (nextMode === 'random') setRandomSource(source);
        setMode(nextMode); setParameters({ ...source?.planet });
        await generate(nextMode, source, source?.planet ?? {}, list[0]?.name ?? '');
      }).catch(error => notify(error, true));
    return () => { active = false; };
  }, [sceneReady]);

  const source = template ? baseSource.current : mode === 'random' ? randomSource : systems[0]?.planets?.[planetIndex];
  return <Theme theme="g90" className="app-theme">
    <Content id="main-content" tabIndex={-1} className={`workspace${template ? ' template-mode' : ''}`}>
      <aside id="panel" className="settings-panel" hidden={!settingsOpen} aria-label="Параметры генерации">
        <div className="settings-heading"><h1>Параметры</h1>
          <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Скрыть параметры" onClick={() => setSettingsOpen(false)} />
        </div>
        {template && <Layer className="source-form"><TemplateControls store={store} snapshot={snapshot} notify={notify} base={base} layers={appliedLayers} setLayers={setAppliedLayers} placements={placements} disabled={busy} /></Layer>}
        <Accordion className="generator-accordion" size="sm">
          <AccordionItem title={template ? 'Параметры основы' : 'Параметры генератора'} open>
          <GeneratorFields parameters={parameters} onChange={setParameters} template={template} disabled={busy} />
        </AccordionItem></Accordion>
        <div className="generation-actions">
          {!template && <NumericField id="slope" label="Уклон для металла, °" value={slope} min={0} max={90} disabled={busy} onChange={setSlope} />}
          <Button id="run" kind="primary" size="lg" renderIcon={Play} disabled={busy || !source || !tauri || !sceneReady} onClick={() => generate(mode, source, parameters)}>{template ? 'Сгенерировать основу' : 'Сгенерировать'}</Button>
        </div>
      </aside>
      <section className="planet-workspace" aria-label="Просмотр планеты">
        <div className={`viewport-toolbar${settingsOpen ? ' settings-open' : ''}`}>
          {!settingsOpen && <Button kind="secondary" size="sm" hasIconOnly renderIcon={Menu} iconDescription="Показать параметры" aria-controls="panel" aria-expanded={false} onClick={() => setSettingsOpen(true)} />}
          <Button kind="secondary" size="sm" hasIconOnly renderIcon={SettingsAdjust} iconDescription="Слои поверхности" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)} />
          {layersOpen && <section className="surface-layers" aria-label="Слои поверхности"><h3>Слои поверхности</h3>
            {Object.entries(SURFACE_LAYERS).filter(([key]) => !template || ['textures', 'wire'].includes(key)).map(([key, label]) => <Checkbox id={`surface-${key}`} key={key} labelText={label} checked={layers[key]} onChange={(_, { checked }) => setLayers({ ...layers, [key]: checked })} />)}
          </section>}
        </div>
        <div ref={host} id="view" />
        {!result && !busy && <div className="viewport-empty"><h3>Планета появится здесь</h3></div>}
        {!tauri && <div className="runtime-notice"><InlineNotification kind="info" title="Режим просмотра интерфейса" subtitle="Для генерации запустите приложение через npm run tauri -- dev." hideCloseButton lowContrast /></div>}
        {busy && <div className="generation-status" role="status"><InlineLoading description={status} /></div>}
      </section>
      <ResultPanel result={result} hidden={template} />
      <GraphPanel snapshot={snapshot} store={store} notify={notify} hidden={!template} />
    </Content>
    {notification && <div className="notification-stack"><ToastNotification key={notification.key} kind={notification.error ? 'error' : 'info'} title={notification.error ? 'Не удалось выполнить действие' : 'Planet-gen'} subtitle={notification.message}
      timeout={notification.error ? 10000 : 5000} onCloseButtonClick={() => setNotification(null)} onClose={() => {}} /></div>}
  </Theme>;
}
