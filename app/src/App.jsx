import { DisplayControls } from './components/DisplayControls.jsx';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Accordion, AccordionItem, Button, Checkbox, Content, Layer, InlineLoading, InlineNotification, Theme, ToastNotification } from '@carbon/react';
import { Close, Menu, Play, SettingsAdjust } from '@carbon/icons-react';
import { createScene } from './scene.js';
import { cleanBasePlanet } from './template-engine.js';
import { createTemplateStore } from './model/template-store.js';
import { BASE_SOURCE, asSystem, randomPlanet } from './model/planet.js';
import { Choice, GeneratorFields, NumericField } from './components/Fields.jsx';
import { TemplateControls } from './components/TemplateControls.jsx';
import { GraphPanel } from './components/GraphPanel.jsx';
import { FinalGraphPanel } from './components/FinalGraphPanel.jsx';
import { ResultPanel } from './components/ResultPanel.jsx';

const SURFACE_LAYERS = {
  textures: 'Текстуры', water: 'Вода и лава', csg: 'CSG', csgWire: 'Каркас CSG',
  subtract: 'Вычитание', metal: 'Металл', candidates: 'Кандидаты металла',
  wire: 'Сетка поверхности', paNavigation: 'Воксели навигации PA',
};
const INITIAL_LAYERS = {
  textures: true, water: true, csg: true, csgWire: false,
  subtract: false, metal: true, candidates: false, wire: false, paNavigation: false,
};
const TEMPLATE_SURFACE_LAYERS = {
  water: false, csg: false, csgWire: false, subtract: false, metal: false, candidates: false, paNavigation: false,
};

/** Связывает режимы генерации и независимые настройки слоёв просмотрщика. */
export default function App() {
  const [store] = useState(() => createTemplateStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const host = useRef(), sceneRef = useRef(), busyRef = useRef(false), baseSource = useRef(structuredClone(BASE_SOURCE)), placements = useRef();
  const [sceneReady, setSceneReady] = useState(false), [systems, setSystems] = useState([]), [planetIndex, setPlanetIndex] = useState(0);
  const [systemIndex, setSystemIndex] = useState(0);
  const [mode, setMode] = useState('templates'), [randomSource, setRandomSource] = useState(null), [parameters, setParameters] = useState({});
  const [finalOpen, setFinalOpen] = useState(false);
  const shownSurface = useRef(null), surfaceRender = useRef(Promise.resolve()), display = useRef();
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [slope, setSlope] = useState(40), [settingsOpen, setSettingsOpen] = useState(true);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [result, setResult] = useState(null), [base, setBase] = useState(null);
  const [notification, setNotification] = useState(null), [layersOpen, setLayersOpen] = useState(false), [layers, setLayers] = useState(INITIAL_LAYERS);
  const [appliedLayers, setAppliedLayers] = useState({ spawn: true, metal: true, blocker: true, ramp: true, front: true, links: true, debug: false, icons: true });
  display.current = { layers, appliedLayers, selected: snapshot.selected };
  const tauri = !!window.__TAURI_INTERNALS__;
  const template = mode === 'templates';
  function notify(message, error = false) { setNotification({ message: String(message), error, key: Date.now() }); }

  useEffect(() => {
    try {
      sceneRef.current = createScene(host.current, error => notify(`Не удалось показать воксели навигации. ${error}`, true));
      setSceneReady(true);
    }
    catch (error) { notify(`Не удалось открыть 3D-просмотр: ${error.message}`, true); }
    return () => sceneRef.current?.dispose();
  }, []);
  useEffect(() => { if (snapshot.loadError) notify(snapshot.loadError, true); }, [snapshot.loadError]);
  useEffect(() => {
    sceneRef.current?.toggle(template ? { ...layers, ...TEMPLATE_SURFACE_LAYERS } : layers);
  }, [layers, template, result]);
  useEffect(() => {
    if (!sceneReady) return;
    let active = true;
    async function update() {
      const surface = template ? base?.result : null;
      if (surface && shownSurface.current !== surface) {
        shownSurface.current = surface;
        surfaceRender.current = sceneRef.current.show(surface, { template: true });
      }
      await surfaceRender.current;
      if (!active) return;
      placements.current = sceneRef.current.setApplied(template && base ? snapshot.applied : null, id => store.select(id));
      const currentLayers = display.current.layers;
      sceneRef.current.toggle(template ? { ...currentLayers, ...TEMPLATE_SURFACE_LAYERS } : currentLayers);
      sceneRef.current.toggleApplied(display.current.appliedLayers);
      sceneRef.current.selectNode(display.current.selected);
    }
    update().catch(error => notify(error.message, true));
    return () => { active = false; };
  }, [sceneReady, snapshot.applied, base, template, store]);
  useEffect(() => { sceneRef.current?.toggleApplied(appliedLayers); }, [appliedLayers]);
  useEffect(() => { sceneRef.current?.selectNode(snapshot.selected); }, [snapshot.selected]);

  async function generate(nextMode, source, values, systemName = systems[systemIndex]?.name ?? '') {
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
      if (nextMode !== 'templates') await sceneRef.current.show(planet);
      if (nextBase) { baseSource.current = { ...BASE_SOURCE, planet: numeric }; setBase(nextBase); store.surface(nextBase.result); }
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
        const index = Math.min(args.planet ?? 0, Math.max(0, (list[0]?.planets?.length ?? 1) - 1));
        setPlanetIndex(index);
        const nextMode = args.templates ? 'templates' : args.random ? 'random' : args.path || args.viewer ? 'existing' : 'templates';
        const source = nextMode === 'templates' ? baseSource.current : nextMode === 'random' ? randomPlanet(args.random) : list[0]?.planets?.[index];
        if (nextMode === 'random') setRandomSource(source);
        setMode(nextMode); setParameters({ ...source?.planet });
        await generate(nextMode, source, source?.planet ?? {}, list[0]?.name ?? '');
      }).catch(error => notify(error, true));
    return () => { active = false; };
  }, [sceneReady]);

  const source = template ? baseSource.current : mode === 'random' ? randomSource : systems[systemIndex]?.planets?.[planetIndex];
  function selectPlanet(system, planet) {
    const source = systems[system]?.planets?.[planet];
    setSystemIndex(system); setPlanetIndex(planet); setParameters({ ...source?.planet });
    generate('existing', source, source?.planet ?? {}, systems[system]?.name ?? '');
  }
  return <Theme theme="g90" className="app-theme">
    <Content id="main-content" tabIndex={-1} className={`workspace${template ? ' template-mode' : ''}${settingsOpen ? ' settings-visible' : ''}${graphCollapsed ? ' graph-collapsed' : ''}`}>
      <aside id="panel" className="settings-panel" hidden={!settingsOpen} aria-label="Параметры генерации">
        <div className="settings-heading"><h1>Параметры</h1>
          <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Скрыть параметры" onClick={() => setSettingsOpen(false)} />
        </div>
        {template && <Layer className="source-form"><TemplateControls store={store} snapshot={snapshot} notify={notify} base={base} placements={placements} disabled={busy} /></Layer>}
        {mode === 'existing' && <div className="source-form">
          <Choice id="viewer-system" label="Система" value={systemIndex} disabled={busy} options={systems.map((system, i) => [i, system.name ?? `Система ${i + 1}`])} onChange={value => selectPlanet(Number(value), 0)} />
          <Choice id="viewer-planet" label="Планета" value={planetIndex} disabled={busy} options={(systems[systemIndex]?.planets ?? []).map((planet, i) => [i, planet.name ?? `Планета ${i + 1}`])} onChange={value => selectPlanet(systemIndex, Number(value))} />
        </div>}
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
          <Button kind="secondary" size="sm" hasIconOnly renderIcon={SettingsAdjust} iconDescription="Слои планеты и расчёт стартов" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)} />
          {/* Слои доступны над планетой и не зависят от видимости панели генерации. */}
          {layersOpen && <section className="surface-layers" aria-label="Слои планеты"><h3>Поверхность</h3>
            {Object.entries(SURFACE_LAYERS).filter(([key]) => !template || ['textures', 'wire'].includes(key)).map(([key, label]) => <Checkbox id={`surface-${key}`} key={key} labelText={label} checked={layers[key]} onChange={(_, { checked }) => setLayers({ ...layers, [key]: checked })} />)}
            {!template && layers.paNavigation && <p className="helper-text">Рельеф для амфибий. Зелёный — поверхность для движения, красный — преграда.</p>}
            {template && <DisplayControls snapshot={snapshot} layers={appliedLayers} setLayers={setAppliedLayers} />}
          </section>}
        </div>
        {template && <div className="final-graph-toggle"><Button size="sm" kind="secondary" onClick={() => setFinalOpen(v => !v)} aria-expanded={finalOpen}>Конечный граф</Button></div>}
        {template && finalOpen && <FinalGraphPanel applied={snapshot.applied} onClose={() => setFinalOpen(false)} onSelect={id => store.select(id)} />}
        <div ref={host} id="view" />
        {!result && !busy && <div className="viewport-empty"><h3>Планета появится здесь</h3></div>}
        {!tauri && <div className="runtime-notice"><InlineNotification kind="info" title="Режим просмотра интерфейса" subtitle="Для генерации запустите приложение через npm run tauri -- dev." hideCloseButton lowContrast /></div>}
        {(busy || snapshot.applied.debug.pending) && <div className="generation-status" role="status"><InlineLoading description={busy ? status : 'Рельеф, навигация и спавны'} /></div>}
      </section>
      <ResultPanel result={result} hidden={template} />
      <GraphPanel collapsed={graphCollapsed} onCollapse={() => setGraphCollapsed(value => !value)} snapshot={snapshot} store={store} notify={notify} hidden={!template} />
    </Content>
    {notification && <div className="notification-stack"><ToastNotification key={notification.key} kind={notification.error ? 'error' : 'info'} title={notification.error ? 'Не удалось выполнить действие' : 'Planet-gen'} subtitle={notification.message}
      timeout={notification.error ? 10000 : 5000} onCloseButtonClick={() => setNotification(null)} onClose={() => {}} /></div>}
  </Theme>;
}
