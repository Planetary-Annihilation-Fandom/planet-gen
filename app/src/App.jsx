import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Accordion, AccordionItem, Button, Checkbox, Content, Layer, FileUploaderButton, Header, HeaderName, InlineLoading, InlineNotification, Tab, TabList, TabPanel, TabPanels, Tabs, Tag, Theme, ToastNotification, SkipToContent } from '@carbon/react';
import { Play, Renew, SettingsAdjust } from '@carbon/icons-react';
import { createScene } from './scene.js';
import { cleanBasePlanet } from './template-engine.js';
import { createTemplateStore } from './model/template-store.js';
import { ARCHETYPES, BASE_SOURCE, asSystem, randomPlanet } from './model/planet.js';
import { Choice, GeneratorFields, NumericField } from './components/Fields.jsx';
import { TemplateControls } from './components/TemplateControls.jsx';
import { GraphPanel } from './components/GraphPanel.jsx';
import { ResultPanel } from './components/ResultPanel.jsx';

const MODES = ['existing', 'random', 'templates'];
const SURFACE_LAYERS = { textures: 'Текстуры', water: 'Вода и лава', csg: 'CSG', subtract: 'Вычитание', metal: 'Металл', candidates: 'Кандидаты металла', wire: 'Сетка поверхности' };
const INITIAL_LAYERS = { textures: true, water: true, csg: true, subtract: false, metal: true, candidates: false, wire: false };

export default function App() {
  const [store] = useState(() => createTemplateStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const host = useRef(), sceneRef = useRef(), busyRef = useRef(false), baseSource = useRef(structuredClone(BASE_SOURCE)), placements = useRef();
  const [sceneReady, setSceneReady] = useState(false), [systems, setSystems] = useState([]), [systemIndex, setSystemIndex] = useState(0), [planetIndex, setPlanetIndex] = useState(0);
  const [mode, setMode] = useState('existing'), [randomSource, setRandomSource] = useState(null), [parameters, setParameters] = useState({});
  const [randomOptions, setRandomOptions] = useState({ biome: 'earth', min: 300, max: 900 }), [slope, setSlope] = useState(40);
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
        let nextMode = args.templates ? 'templates' : args.random ? 'random' : 'existing';
        let source = nextMode === 'templates' ? baseSource.current : nextMode === 'random' ? randomPlanet(args.random) : list[0]?.planets?.[index];
        if (nextMode === 'random') { setRandomSource(source); setRandomOptions(previous => ({ ...previous, biome: args.random })); }
        setMode(nextMode); setParameters({ ...source?.planet });
        await generate(nextMode, source, source?.planet ?? {}, list[0]?.name ?? '');
      }).catch(error => notify(error, true));
    return () => { active = false; };
  }, [sceneReady]);

  const source = template ? baseSource.current : mode === 'random' ? randomSource : systems[systemIndex]?.planets?.[planetIndex];
  function switchMode(index) {
    if (busyRef.current) return;
    const next = MODES[index]; if (next === mode) return;
    let src = next === 'templates' ? baseSource.current : next === 'random' ? randomSource ?? randomPlanet(randomOptions.biome, randomOptions.min, randomOptions.max) : systems[systemIndex]?.planets?.[planetIndex];
    if (next === 'random') setRandomSource(src);
    setMode(next); setLayersOpen(false); setParameters({ ...src?.planet });
    if (next === 'templates' && base) {
      busyRef.current = true; setBusy(true);
      sceneRef.current.show(base.result, { template: true }).then(() => {
        placements.current = sceneRef.current.setApplied(store.getSnapshot().applied, id => store.select(id));
        sceneRef.current.toggleApplied(appliedLayers); sceneRef.current.selectNode(store.getSnapshot().selected);
        setResult({ planet: base.result, name: 'Основа шаблона', system: 'Основа шаблона', ms: 0 });
      }).catch(error => notify(error, true)).finally(() => { busyRef.current = false; setBusy(false); });
    } else generate(next, src, src?.planet ?? {});
  }
  function choosePlanet(system, planet, list = systems) {
    const src = list[system]?.planets?.[planet];
    setSystemIndex(system); setPlanetIndex(planet); setParameters({ ...src?.planet });
    if (src) generate('existing', src, src.planet ?? {}, list[system]?.name ?? '');
  }
  function reroll(options = randomOptions) {
    const src = randomPlanet(options.biome, options.min, options.max);
    setRandomSource(src); setParameters(src.planet); generate('random', src, src.planet);
  }
  async function importSystem(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const doc = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      const sys = asSystem(doc, file.name);
      if (!Array.isArray(sys.planets) || !sys.planets.length) throw new Error('В файле нет планет');
      const list = [{ ...sys, __file: true }, ...systems.filter(item => !item.__file)];
      setSystems(list); setMode('existing'); choosePlanet(0, 0, list);
    } catch (error) { notify(`Не удалось открыть систему: ${error.message}`, true); }
    event.target.value = '';
  }
  return <Theme theme="g90" className="app-theme">
    <Header aria-label="Planet-gen"><SkipToContent href="#main-content" /><HeaderName prefix="PA" href="#main-content">Planet-gen</HeaderName><span className="header-description">Генератор планет</span><Tag type="gray" size="sm">Прототип</Tag></Header>
    <Content id="main-content" tabIndex={-1} className={`workspace${template ? ' template-mode' : ''}`}>
      <aside id="panel" className="settings-panel" aria-label="Параметры генерации">
        <div className="panel-intro"><p className="eyebrow">Источник планеты</p><h1>Генератор</h1></div>
        <Tabs selectedIndex={MODES.indexOf(mode)} onChange={({ selectedIndex }) => switchMode(selectedIndex)}>
          <TabList aria-label="Режим генерации" contained fullWidth><Tab disabled={busy}>Система</Tab><Tab disabled={busy}>Случайная</Tab><Tab disabled={busy}>Шаблоны</Tab></TabList>
          <TabPanels>
            <TabPanel><Layer className="source-form">
              <Choice id="system" label="Система" value={systemIndex} disabled={busy || !systems.length} options={systems.length ? systems.map((item, i) => [i, item.name ?? `Система ${i}`]) : [[0, 'Системы не загружены']]}
                onChange={value => choosePlanet(Number(value), 0)} />
              <Choice id="planet" label="Планета" value={planetIndex} disabled={busy || !systems[systemIndex]?.planets?.length} options={(systems[systemIndex]?.planets ?? []).map((item, i) => [i, `${item.name ?? i} (${item.planet?.biome ?? '?'})`])}
                onChange={value => choosePlanet(systemIndex, Number(value))} />
              <FileUploaderButton id="file" labelText="Открыть .pas или JSON" buttonKind="tertiary" size="sm" accept={['.pas', '.json']} disableLabelChanges onChange={importSystem} disabled={busy} />
              <p className="helper-text">Параметры и кисти CSG берутся из системы. Перед генерацией их можно изменить.</p>
            </Layer></TabPanel>
            <TabPanel><Layer className="source-form">
              <Choice id="rndBiome" label="Архетип" value={randomOptions.biome} options={ARCHETYPES} disabled={busy} onChange={biome => { const next = { ...randomOptions, biome }; setRandomOptions(next); reroll(next); }} />
              <div className="field-pair"><NumericField id="rndRadiusMin" label="Радиус от" value={randomOptions.min} min={100} max={1200} disabled={busy} onChange={min => setRandomOptions({ ...randomOptions, min })} />
                <NumericField id="rndRadiusMax" label="Радиус до" value={randomOptions.max} min={100} max={1200} disabled={busy} onChange={max => setRandomOptions({ ...randomOptions, max })} /></div>
              <Button id="reroll" kind="tertiary" size="sm" renderIcon={Renew} disabled={busy} onClick={() => reroll()}>Новая планета</Button>
              <p className="helper-text">Параметры выбираются в пределах редактора систем игры. Процедурные кисти биома пока не добавляются.</p>
            </Layer></TabPanel>
            <TabPanel><Layer className="source-form"><TemplateControls store={store} snapshot={snapshot} notify={notify} base={base} layers={appliedLayers} setLayers={setAppliedLayers} placements={placements} disabled={busy} /></Layer></TabPanel>
          </TabPanels>
        </Tabs>
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
        <div className="viewport-toolbar">
          <div><h2>{result?.name ?? 'Просмотр планеты'}</h2><p className="helper-text">{result ? `${result.system} · ${result.planet.biome} · радиус ${result.planet.radius}` : 'Выберите источник и параметры генерации'}</p></div>
          <Button kind="ghost" size="sm" hasIconOnly renderIcon={SettingsAdjust} iconDescription="Слои поверхности" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)} />
          {layersOpen && <section className="surface-layers" aria-label="Слои поверхности"><h3>Слои поверхности</h3>
            {Object.entries(SURFACE_LAYERS).filter(([key]) => !template || ['textures', 'wire'].includes(key)).map(([key, label]) => <Checkbox id={`surface-${key}`} key={key} labelText={label} checked={layers[key]} onChange={(_, { checked }) => setLayers({ ...layers, [key]: checked })} />)}
          </section>}
        </div>
        <div ref={host} id="view" />
        {!result && !busy && <div className="viewport-empty"><h3>Планета появится здесь</h3><p>Вращайте её мышью, меняйте масштаб колесом.</p></div>}
        {!tauri && <div className="runtime-notice"><InlineNotification kind="info" title="Режим просмотра интерфейса" subtitle="Для генерации запустите приложение через npm run tauri -- dev." hideCloseButton lowContrast /></div>}
        {busy && <div className="generation-status" role="status"><InlineLoading description={status} /></div>}
        <div className="viewport-footer"><span>Мышь: вращение · Колесо: масштаб</span><span>{template ? 'Редактор шаблонов' : 'Planetary Annihilation: TITANS'}</span></div>
      </section>
      <ResultPanel result={result} hidden={template} />
      <GraphPanel snapshot={snapshot} store={store} notify={notify} baseReady={!!base} hidden={!template} />
    </Content>
    {notification && <div className="notification-stack"><ToastNotification key={notification.key} kind={notification.error ? 'error' : 'info'} title={notification.error ? 'Не удалось выполнить действие' : 'Planet-gen'} subtitle={notification.message}
      timeout={notification.error ? 10000 : 5000} onCloseButtonClick={() => setNotification(null)} onClose={() => {}} /></div>}
  </Theme>;
}
