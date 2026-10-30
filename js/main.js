import { Engine } from './engine.js';
import { UI } from './ui.js';
import { getObject, getHost, getPlanets, searchCatalog } from './catalog.js';
import { systemForStarId, systemForSeed, makeAppearance } from './procedural.js';
import { randomSeed } from './rng.js';

const SAVE_KEY = 'aether.save.v2';
const DEFAULT_SAVE = () => ({
  discoveries: {},
  achievements: {},
  bookmarks: ['kepler-22b', 'trappist-1e', 'orion-nebula'],
  credits: 0,
  visits: [],
  scans: 0,
  generated: 0,
  quality: 'medium',
});

function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_SAVE();
    return { ...DEFAULT_SAVE(), ...raw, discoveries: raw.discoveries || {}, achievements: raw.achievements || {}, bookmarks: raw.bookmarks || [], visits: raw.visits || [] };
  } catch {
    return DEFAULT_SAVE();
  }
}

const ACHIEVEMENTS = [
  { id: 'first-light', name: 'First Light', desc: 'Open AETHER and lock a target.' },
  { id: 'first-scan', name: 'Spectroscopist', desc: 'Complete your first spectral scan.' },
  { id: 'exoplanet-hunter', name: 'Exoplanet Hunter', desc: 'Catalogue five planets.' },
  { id: 'trappist', name: 'Seven Sisters', desc: 'Scan all seven TRAPPIST-1 worlds.' },
  { id: 'grand-tour', name: 'Grand Tour', desc: 'Visit five real catalogue objects.' },
  { id: 'event-horizon', name: 'Event Horizon', desc: 'Visit the Cygnus X-1 black hole.' },
  { id: 'andromeda', name: 'Intergalactic', desc: 'Travel to the Andromeda Galaxy.' },
  { id: 'ringworld', name: 'Ringworld', desc: 'Visit a planet with a ring system.' },
  { id: 'deep-time', name: 'Deep Time', desc: 'Set time warp to ×1000 or higher.' },
  { id: 'photographer', name: 'Light Collector', desc: 'Capture a frame in photo mode.' },
  { id: 'seedmaster', name: 'Seedmaster', desc: 'Share a universe seed link.' },
  { id: 'cartographer', name: 'Cartographer', desc: 'Generate three procedural systems.' },
];

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const p = new URLSearchParams(h);
  return { seed: p.get('seed'), obj: p.get('obj') };
}

class App {
  constructor() {
    this.seed = parseHash().seed || 'AETHER-7F2A';
    this.save = loadSave();
    this.selected = null;
    this.system = null;
    this.currentPlanet = null;
    this.currentKind = 'system';
    this.currentSpec = null;
    this.timeWarp = 1;
    this.photoMode = false;
    this.scanning = false;
    this.achievementDefs = ACHIEVEMENTS;
    this._navToken = 0;

    const quality = new URLSearchParams(location.search).get('quality') || this.save.quality || 'medium';
    this.engine = new Engine({
      container: document.getElementById('stage'),
      labels: document.getElementById('markers'),
      fade: document.getElementById('fade'),
      quality,
    });
    this.ui = new UI(this);
    this.ui.setQuality(this.engine.qualityName);
    this.ui.setWarp(this.timeWarp);
    this.engine.setCallbacks({
      onSelect: (obj) => this.selectObject(obj),
      onTravel: (obj) => this.travelTo(obj),
      onDive: (planet) => this.showPlanet(planet, this.system),
      onStarDive: (star) => this.showSystem(star),
      onSurface: (planet) => this.showSurface(planet, this.system),
      onOrbitOut: (planet) => this.showSystemForPlanet(planet),
      onAutopilotChange: (on) => this.ui.setAutopilot(on),
      onView: (view) => this.onView(view),
      onQuality: (name) => this.ui.setQuality(name),
    });
    this.ui.setBreadcrumb([{ kind: 'galaxy', label: 'MILKY WAY' }]);
    this.start();
    this._clock = performance.now();
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    requestAnimationFrame((t) => this.loop(t));
    setTimeout(() => this.ui.toast('AETHER ONLINE', `Seed ${this.seed} · deterministic universe ready`), 1300);
    setTimeout(() => this.unlock('first-light'), 1700);
    this._registerSW();
  }

  _registerSW() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  async start() {
    const h = parseHash();
    if (h.obj) {
      const obj = getObject(h.obj);
      if (obj) {
        this.seed = h.seed || this.seed;
        if (obj.kind === 'planet') {
          const sys = this.systemForObject(obj);
          if (sys) {
            this.ui.setSeed(h.seed || this.seed);
            await this.showPlanet(obj, sys, { instant: true });
            this.markVisit(obj);
            return;
          }
        } else if (obj.kind === 'star') {
          this.ui.setSeed(h.seed || this.seed);
          await this.showSystem(obj, null, { instant: true });
          return;
        } else {
          this.ui.setSeed(h.seed || this.seed);
          if (obj.kind === 'nebula') await this.showNebula(obj, { instant: true });
          else await this.showGalaxy(obj, { instant: true });
          return;
        }
      }
    }
    if (h.seed) {
      this.seed = h.seed;
      this.ui.setSeed(h.seed);
      await this.showSystemSeed(h.seed, { instant: true });
      return;
    }
    await this.showSystem('kepler-22', 'kepler-22b', { instant: true });
  }

  systemForObject(obj) {
    if (obj.kind === 'planet') {
      const host = getHost(obj);
      if (host) return systemForStarId(host.id);
      if (this.system && this.system.planetById?.has(obj.id)) return this.system;
    }
    if (obj.kind === 'star') {
      if (obj.procedural) return systemForSeed(obj.seed);
      return systemForStarId(obj.id);
    }
    return null;
  }

  onView(view) {
    this.ui.setTelemetry(view.telemetry ? view.telemetry(this.engine) : null);
    if (this.selected) this.engine.setSelected(this.selected);
  }

  loop(t) {
    const dt = Math.min(0.1, (t - this._clock) / 1000);
    this._clock = t;
    this.engine.update(dt);
    this.ui.updateFlare(this.engine.sunScreen);
    this._fpsAcc += dt;
    this._fpsFrames += 1;
    if (this._fpsAcc > 0.5) {
      this.ui.setFps(this._fpsFrames / this._fpsAcc);
      this.ui.setTelemetry(this.engine.getTelemetry());
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  async showSystem(starOrId, focusId = null, opts = {}) {
    const star = typeof starOrId === 'string' ? getObject(starOrId) : starOrId;
    if (!star) return;
    let system;
    if (star.procedural) system = systemForSeed(star.seed);
    else system = systemForStarId(star.id);
    if (!system) return;
    await this._enterSystem(system, focusId, opts);
  }

  async showSystemSeed(seed, opts = {}) {
    const system = systemForSeed(seed);
    await this._enterSystem(system, null, opts);
  }

  async _enterSystem(system, focusId, opts = {}) {
    this.system = system;
    this.currentKind = 'system';
    this.currentPlanet = null;
    this.currentSpec = { kind: 'system', system, focusId };
    const token = ++this._navToken;
    await this.engine.setView(this.currentSpec, { instant: opts.instant });
    if (token !== this._navToken) return;
    const planet = focusId ? system.planetById?.get(focusId) : null;
    const obj = planet || system.star;
    this.selectObject(obj, { focus: false });
    this.ui.setBreadcrumb([
      { kind: 'galaxy', label: 'MILKY WAY' },
      { kind: 'system', label: system.star.name.toUpperCase() },
      ...(planet ? [{ kind: 'planet', label: planet.name.toUpperCase() }] : []),
    ]);
    this.markVisit(system.star);
    this.ui.renderNav();
    this.updateHash();
  }

  async showPlanet(planet, system, opts = {}) {
    if (!planet) return;
    if (!system) system = this.systemForObject(planet);
    if (!system) return;
    // Prefer the decorated planet from the system: it carries appearance,
    // rings, moons and orbital metadata used by the renderers.
    planet = system.planetById?.get(planet.id) || planet;
    this.system = system;
    this.currentPlanet = planet;
    this.currentKind = 'planet';
    this.currentSpec = { kind: 'planet', planet, system };
    const token = ++this._navToken;
    await this.engine.setView(this.currentSpec, { instant: opts.instant });
    if (token !== this._navToken) return;
    this.selectObject(planet, { focus: false });
    this.ui.setBreadcrumb([
      { kind: 'galaxy', label: 'MILKY WAY' },
      { kind: 'system', label: system.star.name.toUpperCase() },
      { kind: 'planet', label: planet.name.toUpperCase() },
    ]);
    this.markVisit(planet);
    this.updateHash();
  }

  async showSurface(planet, system, opts = {}) {
    if (!planet || !system) return;
    planet = system.planetById?.get(planet.id) || planet;
    this.currentKind = 'surface';
    this.currentSpec = { kind: 'surface', planet, system };
    const token = ++this._navToken;
    await this.engine.setView(this.currentSpec, { instant: opts.instant });
    if (token !== this._navToken) return;
    this.selectObject(planet, { focus: false });
    this.ui.setBreadcrumb([
      { kind: 'galaxy', label: 'MILKY WAY' },
      { kind: 'system', label: system.star.name.toUpperCase() },
      { kind: 'planet', label: planet.name.toUpperCase() },
    ]);
    this.ui.toast('TOUCHDOWN', `${planet.name} · surface coordinates acquired`, true);
    this.markVisit(planet);
    this.updateHash();
  }

  async showGalaxy(galaxy, opts = {}) {
    if (!galaxy) return;
    this.currentKind = 'galaxy';
    this.currentSpec = { kind: 'galaxy', data: galaxy };
    const token = ++this._navToken;
    await this.engine.setView(this.currentSpec, { instant: opts.instant });
    if (token !== this._navToken) return;
    this.selectObject(galaxy, { focus: false });
    this.ui.setBreadcrumb([
      { kind: 'galaxy', label: galaxy.id === 'milky-way' ? 'MILKY WAY' : galaxy.name.toUpperCase() },
    ]);
    this.markVisit(galaxy);
    this.updateHash();
  }

  async showNebula(nebula, opts = {}) {
    if (!nebula) return;
    this.currentKind = 'nebula';
    this.currentSpec = { kind: 'nebula', data: nebula };
    const token = ++this._navToken;
    await this.engine.setView(this.currentSpec, { instant: opts.instant });
    if (token !== this._navToken) return;
    this.selectObject(nebula, { focus: false });
    this.ui.setBreadcrumb([
      { kind: 'galaxy', label: 'MILKY WAY' },
      { kind: 'system', label: nebula.name.toUpperCase() },
    ]);
    this.markVisit(nebula);
    this.updateHash();
  }

  async showSystemForPlanet(planet) {
    if (!planet) return;
    const system = this.system && this.system.planetById?.has(planet.id) ? this.system : this.systemForObject(planet);
    if (system) await this.showSystem(system.star, planet.id);
  }

  showCurrentSystem() {
    if (this.system) this.showSystem(this.system.star, this.currentPlanet?.id || null);
  }

  showCurrentPlanet() {
    if (this.currentPlanet) this.showPlanet(this.currentPlanet, this.system);
    else if (this.selected?.kind === 'planet') {
      const sys = this.systemForObject(this.selected);
      if (sys) this.showPlanet(this.selected, sys);
    }
  }

  selectObject(obj, opts = {}) {
    if (!obj) {
      this.selected = null;
      this.engine.setSelected(null);
      this.ui.renderInfo(null);
      return;
    }
    this.selected = obj;
    this.engine.setSelected(obj);
    this.ui.renderInfo(obj);
    if (opts.focus !== false && this.currentKind === 'system') {
      this.engine.focusObject(obj);
    }
    this.ui.renderNav();
    document.title = `${obj.name} — AETHER`;
  }

  travelTo(obj, opts = {}) {
    if (!obj) return;
    this.warpFlash();
    this.markVisit(obj);
    if (obj.kind === 'planet') {
      const system = this.system && this.system.planetById?.has(obj.id) ? this.system : this.systemForObject(obj);
      if (!system) return;
      if (opts.dive) this.showPlanet(obj, system);
      else this.showSystem(system.star, obj.id);
    } else if (obj.kind === 'star') {
      this.showSystem(obj);
    } else if (obj.kind === 'nebula') {
      this.showNebula(obj);
    } else if (obj.kind === 'galaxy') {
      this.showGalaxy(obj);
    }
    document.getElementById('nav-panel')?.classList.remove('open');
    if (this.photoMode) this.togglePhoto(false);
  }

  travelToSeed(seed) {
    this.applySeed(seed);
  }

  async applySeed(seed) {
    const s = String(seed || '').trim().toUpperCase().slice(0, 24);
    if (!s) return;
    this.seed = s;
    this.ui.setSeed(s);
    this.save.generated = (this.save.generated || 0) + 1;
    this.persist();
    this.warpFlash();
    await this.showSystemSeed(s);
    this.updateHash();
    this.ui.toast('UNIVERSE REGENERATED', `Seed ${s} · procedural systems rebuilt`, true);
    if (this.save.generated >= 3) this.unlock('cartographer');
  }

  newSeed() {
    this.applySeed(randomSeed());
  }

  dive() {
    const obj = this.selected;
    if (!obj) {
      this.ui.toast('NO TARGET', 'Select a planet or star first.');
      return;
    }
    if (this.currentKind === 'planet') {
      this.showSurface(obj, this.system);
    } else if (this.currentKind === 'system') {
      if (obj.kind === 'planet') this.showPlanet(obj, this.system);
      else if (obj.kind === 'star') this.ui.toast('STELLAR CORE', 'No solid surface — the star is rendered as a volumetric photosphere.');
    } else if (obj.kind === 'galaxy') {
      this.ui.toast('GALACTIC STRUCTURE', 'Zoom continues through the spiral arms. Select a star marker to enter a system.');
    } else if (obj.kind === 'nebula') {
      if (this.currentKind === 'galaxy') this.showNebula(obj);
      else this.ui.toast('NEBULA INTERIOR', 'You are inside the cloud. Drag to look around the star-forming core.');
    } else {
      this.travelTo(obj, { dive: true });
    }
  }

  toggleAutopilot() {
    this.engine.autopilot = !this.engine.autopilot;
    this.ui.setAutopilot(this.engine.autopilot);
    if (this.engine.autopilot) {
      if (this.currentKind === 'system' && this.selected?.kind === 'planet') this.engine.focusObject(this.selected);
      else if (this.currentKind !== 'planet' && this.currentKind !== 'surface') {
        this.ui.toast('AUTOPILOT', 'Select a planet in a system to begin an automatic approach.');
      }
    }
  }

  cycleWarp() {
    const seq = [1, 10, 100, 1000, 10000];
    const i = seq.indexOf(this.timeWarp);
    this.timeWarp = seq[(i + 1) % seq.length];
    this.engine.timeWarp = this.timeWarp;
    this.ui.setWarp(this.timeWarp);
    this.ui.toast('TIME WARP', `Simulation clock ×${this.timeWarp.toLocaleString('en-US')}`);
    if (this.timeWarp >= 1000) this.unlock('deep-time');
  }

  scan() {
    const obj = this.selected;
    if (!obj) {
      this.ui.toast('NO TARGET', 'Select an object to scan.');
      return;
    }
    if (this.scanning) return;
    if (this.save.discoveries[obj.id]) {
      this.ui.toast('ALREADY CATALOGUED', `${obj.name} is already in the local archive.`, true);
      return;
    }
    this.scanning = true;
    this.ui.showScan(obj);
    const start = performance.now();
    const duration = 2500;
    const steps = [
      'ACQUIRING SIGNAL…',
      'CALIBRATING SPECTROMETER…',
      'RESOLVING ATMOSPHERIC LINES…',
      'MAPPING SURFACE ALBEDO…',
      'CROSS-REFERENCING CATALOGUE…',
      'WRITING DISCOVERY RECORD…',
    ];
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      this.ui.setScanProgress(p, steps[Math.min(steps.length - 1, Math.floor(p * steps.length))]);
      if (p < 1) requestAnimationFrame(tick);
      else this.finishScan(obj);
    };
    requestAnimationFrame(tick);
  }

  finishScan(obj) {
    this.scanning = false;
    this.ui.hideScan();
    const count = Object.keys(this.save.discoveries).length + 1;
    this.save.discoveries[obj.id] = {
      name: obj.name,
      kind: obj.kind,
      class: obj.classLabel || obj.type || obj.spectral || obj.kind,
      seed: obj.seed || obj.id,
      at: Date.now(),
      index: count,
    };
    this.save.scans += 1;
    this.save.credits += obj.kind === 'planet' ? 35 : 20;
    this.persist();
    this.ui.renderInfo(obj);
    this.ui.renderNav();
    this.ui.toast('DISCOVERY LOGGED', `${obj.name} · archive #${String(count).padStart(4, '0')} · +${obj.kind === 'planet' ? 35 : 20} CR`, true);
    this.unlock('first-scan');
    const planets = Object.entries(this.save.discoveries).filter(([id]) => getObject(id)?.kind === 'planet');
    if (planets.length >= 5) this.unlock('exoplanet-hunter');
    const trap = ['trappist-1b', 'trappist-1c', 'trappist-1d', 'trappist-1e', 'trappist-1f', 'trappist-1g', 'trappist-1h'];
    if (trap.every((id) => this.save.discoveries[id])) this.unlock('trappist');
    if (obj.kind === 'planet' && (obj.rings || obj.appearance?.hasRings)) this.unlock('ringworld');
    this.updateHash();
    setTimeout(() => { if (!this.photoMode) this.ui.showDossier(obj); }, 700);
  }

  toggleBookmark() {
    const obj = this.selected;
    if (!obj) return;
    const i = this.save.bookmarks.indexOf(obj.id);
    if (i >= 0) {
      this.save.bookmarks.splice(i, 1);
      this.ui.toast('BOOKMARK REMOVED', obj.name);
    } else {
      this.save.bookmarks.push(obj.id);
      this.ui.toast('BOOKMARK SAVED', obj.name, true);
    }
    this.persist();
    this.ui.renderInfo(obj);
    this.ui.renderNav();
  }

  markVisit(obj) {
    if (!obj) return;
    const key = obj.id;
    if (!this.save.visits.includes(key)) {
      this.save.visits.push(key);
      this.persist();
    }
    const realVisits = this.save.visits.filter((id) => getObject(id)?.real);
    if (realVisits.length >= 5) this.unlock('grand-tour');
    if (key === 'cygnus-x-1') this.unlock('event-horizon');
    if (key === 'andromeda') this.unlock('andromeda');
    if (obj.kind === 'planet' && (obj.rings || obj.appearance?.hasRings)) this.unlock('ringworld');
  }

  unlock(id) {
    if (this.save.achievements[id]) return;
    const def = this.achievementDefs.find((a) => a.id === id);
    if (!def) return;
    this.save.achievements[id] = Date.now();
    this.save.credits += 50;
    this.persist();
    this.ui.toast('ACHIEVEMENT UNLOCKED', `${def.name} · +50 CR`, true);
  }

  shareSeed() {
    const url = `${location.origin}${location.pathname}#seed=${encodeURIComponent(this.seed)}${this.selected ? `&obj=${encodeURIComponent(this.selected.id)}` : ''}`;
    history.replaceState(null, '', url);
    const done = () => {
      this.ui.toast('SEED LINK COPIED', url, true);
      this.unlock('seedmaster');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(done);
    else done();
  }

  updateHash() {
    const url = `${location.origin}${location.pathname}#seed=${encodeURIComponent(this.seed)}${this.selected ? `&obj=${encodeURIComponent(this.selected.id)}` : ''}`;
    history.replaceState(null, '', url);
  }

  warpFlash() {
    document.body.classList.remove('warping');
    void document.body.offsetWidth;
    document.body.classList.add('warping');
    setTimeout(() => document.body.classList.remove('warping'), 1100);
  }

  togglePhoto(force) {
    this.photoMode = force === undefined ? !this.photoMode : !!force;
    this.ui.setPhoto(this.photoMode);
    if (this.photoMode) this.ui.toast('PHOTO MODE', 'HUD hidden · capture the frame when ready');
  }

  capturePhoto() {
    const data = this.engine.capture();
    const a = document.createElement('a');
    a.href = data;
    a.download = `aether-${(this.selected?.name || 'space').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.unlock('photographer');
    this.ui.toast('FRAME CAPTURED', 'PNG saved to downloads', true);
  }

  setQuality(name) {
    this.save.quality = name;
    this.persist();
    this.engine.setQuality(name);
    this.ui.setQuality(name);
    this.ui.toast('RENDER PRESET', `${name.toUpperCase()} · rebuilding scene`);
    if (this.currentSpec) {
      this.engine.setView(this.currentSpec, { fade: true }).then(() => {
        if (this.selected) {
          this.engine.setSelected(this.selected);
          this.ui.renderInfo(this.selected);
        }
      });
    }
    this.ui.closeModal();
  }

  resetSave() {
    this.save = DEFAULT_SAVE();
    this.persist();
    this.ui.renderNav();
    this.ui.renderInfo(this.selected);
    this.ui.toast('SAVE RESET', 'Discoveries, bookmarks and achievements cleared');
    this.ui.closeModal();
  }

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch {}
  }
}

function bootAether() {
  const boot = document.getElementById('boot');
  const app = new App();
  window.__AETHER__ = app;
  setTimeout(() => boot.classList.add('done'), 900);
  window.addEventListener('error', (e) => {
    console.error('AETHER error', e.error || e.message);
  });
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bootAether);
else bootAether();
