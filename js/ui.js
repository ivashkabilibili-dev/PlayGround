import {
  CATALOG, STARS, PLANETS, DEEP_SKY, getObject, getPlanets, getHost,
  searchCatalog, SPECTRAL_CLASSES,
} from './catalog.js';
import { habitabilityLabel, planetTypeLabel, makeAppearance, starColor, TYPE_LABELS } from './procedural.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtMass(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 50) return `${(m / 317.8).toFixed(2)} M♃`;
  if (m >= 0.01) return `${m.toFixed(2)} M⊕`;
  return `${m.toExponential(1)} M⊕`;
}

function fmtRadius(r) {
  if (!Number.isFinite(r)) return '—';
  if (r >= 4) return `${(r / 11.21).toFixed(2)} R♃`;
  return `${r.toFixed(2)} R⊕`;
}

function distanceOf(obj) {
  if (!obj) return 0;
  if (obj.distanceLy !== undefined) return obj.distanceLy;
  const host = getHost(obj);
  return host?.distanceLy || 0;
}

function metaOf(obj) {
  if (obj.kind === 'planet') {
    const host = getHost(obj) || (obj.hostName ? { name: obj.hostName, distanceLy: obj.hostDistance } : null);
    return `${host?.name || 'Unknown host'} · ${fmtRadius(obj.radiusEarth)} · ${obj.periodDays ? obj.periodDays.toFixed(1) + ' d' : '—'}`;
  }
  if (obj.kind === 'star') {
    return `${obj.spectral || '—'} · ${obj.distanceLy ? obj.distanceLy.toLocaleString('en-US') + ' ly' : 'local'}`;
  }
  return `${obj.classLabel || obj.kind} · ${obj.distanceLy ? obj.distanceLy.toLocaleString('en-US') + ' ly' : 'home galaxy'}`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.navTab = 'catalog';
    this.searchIndex = 0;
    this.searchResults = [];
    this.lastObj = null;
    this._bind();
    this.renderQuick();
    this.setSeed(app.seed);
    this.renderNav();
  }

  _bind() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      const app = this.app;
      if (a === 'collapse-info') {
        $('#info-panel').classList.toggle('collapsed');
        btn.textContent = $('#info-panel').classList.contains('collapsed') ? '+' : '−';
      } else if (a === 'close-nav') $('#nav-panel').classList.remove('open');
      else if (a === 'toggle-nav') $('#nav-panel').classList.toggle('open');
      else if (a === 'zoom-in') app.engine.zoom(1.6);
      else if (a === 'zoom-out') app.engine.zoom(1 / 1.6);
      else if (a === 'warp') app.cycleWarp();
      else if (a === 'autopilot') app.toggleAutopilot();
      else if (a === 'scan') app.scan();
      else if (a === 'search') this.openSearch();
      else if (a === 'photo') app.togglePhoto();
      else if (a === 'achievements') this.showAchievements();
      else if (a === 'settings') this.showSettings();
      else if (a === 'dive') app.dive();
      else if (a === 'dossier') this.showDossier(app.selected);
      else if (a === 'bookmark') app.toggleBookmark();
      else if (a === 'copy-seed') app.shareSeed();
      else if (a === 'apply-seed') app.applySeed($('#seed-input').value);
      else if (a === 'new-seed') app.newSeed();
      else if (a === 'close-search') this.closeSearch();
      else if (a === 'close-modal') this.closeModal();
      else if (a === 'capture') app.capturePhoto();
      else if (a === 'exit-photo') app.togglePhoto(false);
      else if (a === 'quality') app.setQuality(btn.dataset.quality);
      else if (a === 'reset-save') app.resetSave();
      else if (a === 'apply-settings-seed') app.applySeed($('#settings-seed')?.value || '');
      else if (a === 'share-link') app.shareSeed();
      else if (a === 'crumb-galaxy') app.showGalaxy(getObject('milky-way'));
      else if (a === 'crumb-system') app.showCurrentSystem();
      else if (a === 'crumb-planet') app.showCurrentPlanet();
    });

    $$('.nav-tabs button').forEach((b) => b.addEventListener('click', () => {
      this.navTab = b.dataset.tab;
      $$('.nav-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      this.renderNav();
    }));
    $('#nav-filter').addEventListener('input', () => this.renderNav());
    $('#seed-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.app.applySeed($('#seed-input').value);
    });
    $('#search-input').addEventListener('input', (e) => this.renderSearch(e.target.value));
    $('#search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSearch();
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSearch(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSearch(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.chooseSearch(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName)) {
        e.preventDefault();
        this.openSearch();
      } else if (e.key === 'Escape') {
        this.closeSearch();
        this.closeModal();
      } else if (e.key === '+' || e.key === '=') this.app.engine.zoom(1.4);
      else if (e.key === '-') this.app.engine.zoom(1 / 1.4);
      else if (e.key === ' ') { e.preventDefault(); this.app.toggleAutopilot(); }
      else if (e.key.toLowerCase() === 'p') this.app.togglePhoto();
    });
    $('#search-overlay').addEventListener('click', (e) => { if (e.target.id === 'search-overlay') this.closeSearch(); });
    $('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') this.closeModal(); });
  }

  setSeed(seed) {
    this.app.seed = seed;
    const inp = $('#seed-input');
    if (inp) inp.value = seed;
    const boot = $('#boot-seed');
    if (boot) boot.textContent = seed;
    const hash = $('#seed-hash');
    if (hash) hash.textContent = `#${String(seed).length} · DETERMINISTIC`;
    const ticker = $('#discovery-ticker');
    if (ticker) ticker.textContent = `LOCAL BUBBLE // SEED ${seed} // ${Object.keys(this.app.save.discoveries).length} DISCOVERIES // ${this.app.save.credits} CR`;
  }

  setTelemetry(t) {
    if (!t) return;
    $('#scale-alt-label').textContent = t.altLabel || 'ALTITUDE';
    $('#scale-alt-value').textContent = t.altValue || '—';
    $('#scale-mode').textContent = t.mode || 'SPACE';
    $('#scale-value').textContent = t.scale || '—';
  }

  setFps(fps) {
    $('#fps').textContent = String(Math.min(999, Math.round(fps)));
  }

  setQuality(name) {
    $('#quality-chip').textContent = name === 'high' ? 'HIGH' : name === 'low' ? 'LOW' : 'MED';
    $$('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === name));
  }

  setAutopilot(on) {
    $('[data-action="autopilot"]')?.classList.toggle('active', on);
  }

  setWarp(n) {
    $('#warp-label').textContent = `×${n >= 1000 ? n / 1000 + 'k' : n}`;
  }

  setBreadcrumb(items) {
    const el = $('#breadcrumb');
    if (!el) return;
    el.innerHTML = items.map((it, i) => {
      const label = esc(it.label);
      return `${i ? '<span>/</span>' : ''}<button data-action="crumb-${esc(it.kind)}">${label}</button>`;
    }).join('');
  }

  renderInfo(obj) {
    this.lastObj = obj;
    const save = this.app.save;
    if (!obj) {
      $('#obj-kicker').textContent = 'TARGET // NONE';
      $('#obj-class').textContent = 'FREE FLIGHT';
      $('#obj-name').textContent = 'Deep Space';
      $('#obj-sub').textContent = 'No target locked · drag to look · pinch to zoom';
      $('#obj-stats').innerHTML = `<div class="stat"><span>MODE</span><b>FREE</b></div><div class="stat"><span>SEED</span><b>${esc(this.app.seed)}</b></div><div class="stat"><span>STATUS</span><b>NOMINAL</b></div>`;
      $('#obj-desc').textContent = 'Select a body, star, nebula or galaxy to open its dossier. Every object is deterministic from its seed.';
      $('#hab-fill').style.width = '0%';
      $('#hab-value').textContent = '—';
      $('#hab-label').textContent = 'NO TARGET';
      $('.hab-block').style.opacity = '0.35';
      $('#scan-state-text').textContent = 'AWAITING TARGET';
      $('#scan-state').classList.remove('done');
      $('[data-action="bookmark"]').classList.remove('on');
      $('#dive-label').textContent = 'DIVE';
      return;
    }
    const isPlanet = obj.kind === 'planet';
    const isStar = obj.kind === 'star';
    const isDeep = obj.kind === 'nebula' || obj.kind === 'galaxy';
    const host = getHost(obj);
    const disc = save.discoveries[obj.id];
    const app = this.app;

    $('#obj-kicker').textContent = isPlanet ? 'TARGET // EXOPLANET' : isStar ? 'TARGET // STELLAR' : 'TARGET // DEEP SKY';
    $('#obj-class').textContent = (obj.classLabel || TYPE_LABELS[obj.type] || (isStar ? `${obj.spectral || ''} STAR` : obj.kind)).toUpperCase();
    $('#obj-name').textContent = obj.name;
    const dist = distanceOf(obj);
    const subParts = [];
    if (isPlanet) {
      subParts.push(host?.name || obj.hostName || 'UNKNOWN HOST');
      if (host?.spectral) subParts.push(host.spectral);
      subParts.push(`${obj.aAU?.toFixed(3)} AU`);
    } else if (isStar) {
      if (obj.spectral) subParts.push(obj.spectral);
      if (obj.starType) subParts.push(`${obj.starType}-CLASS`);
      subParts.push(dist ? `${dist.toLocaleString('en-US')} ly` : 'LOCAL');
    } else {
      subParts.push(obj.classLabel || obj.kind);
      subParts.push(dist ? `${dist.toLocaleString('en-US')} ly` : 'MILKY WAY');
    }
    $('#obj-sub').textContent = subParts.join(' · ');

    let stats = '';
    if (isPlanet) {
      const g = obj.massEarth / Math.max(0.01, obj.radiusEarth * obj.radiusEarth);
      stats = [
        ['MASS', fmtMass(obj.massEarth)],
        ['RADIUS', fmtRadius(obj.radiusEarth)],
        ['TEMP', `${Math.round(obj.tempK || obj.teqK)} K`],
        ['ORBIT', `${obj.aAU?.toFixed(3)} AU`],
        ['PERIOD', obj.periodDays ? `${obj.periodDays.toFixed(1)} d` : '—'],
        ['GRAVITY', `${g.toFixed(2)} g`],
        ['ATMOSPHERE', obj.atmosphere || '—'],
        ['PRESSURE', obj.pressure ? `${obj.pressure.toFixed(1)} atm` : 'vacuum'],
      ].map(([k, v]) => `<div class="stat"><span>${k}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('');
    } else if (isStar) {
      const sp = SPECTRAL_CLASSES[obj.starType] || {};
      stats = [
        ['MASS', `${(obj.massSolar ?? 0).toFixed(2)} M☉`],
        ['RADIUS', `${(obj.radiusSolar ?? 0).toFixed(2)} R☉`],
        ['TEMP', `${Math.round(obj.tempK || 0).toLocaleString('en-US')} K`],
        ['LUMINOSITY', `${(obj.lumSolar ?? 0).toFixed(3)} L☉`],
        ['RA', obj.ra || '—'],
        ['DEC', obj.dec || '—'],
        ['DISTANCE', dist ? `${dist.toLocaleString('en-US')} ly` : 'LOCAL'],
        ['WORLDS', String(getPlanets(obj.id).length)],
      ].map(([k, v]) => `<div class="stat"><span>${k}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('');
    } else {
      stats = [
        ['CLASS', obj.classLabel || obj.kind],
        ['DISTANCE', dist ? `${dist.toLocaleString('en-US')} ly` : '—'],
        ['RADIUS', obj.radiusLy ? `${obj.radiusLy.toLocaleString('en-US')} ly` : '—'],
        ['RA', obj.ra || '—'],
        ['DEC', obj.dec || '—'],
        ['SEED', obj.seed || '—'],
      ].map(([k, v]) => `<div class="stat"><span>${k}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('');
    }
    $('#obj-stats').innerHTML = stats;
    $('#obj-desc').textContent = obj.description || 'No dossier entry yet. Scan the object to populate its record.';

    const hab = isPlanet ? (obj.habitability || 0) : 0;
    $('.hab-block').style.opacity = isPlanet ? '1' : '0.35';
    $('#hab-fill').style.width = `${Math.round(hab * 100)}%`;
    $('#hab-value').textContent = isPlanet ? hab.toFixed(2) : '—';
    $('#hab-label').textContent = isPlanet ? habitabilityLabel(hab) : isStar ? 'STELLAR HOST' : 'NON-PLANETARY';

    const done = !!disc;
    $('#scan-state').classList.toggle('done', done);
    $('#scan-state-text').textContent = done
      ? `CATALOGUED · DISCOVERY ${String(disc.index || 0).padStart(4, '0')}`
      : 'UNSCANNED · SIGNAL NOMINAL';

    const isBookmarked = save.bookmarks.includes(obj.id);
    $('[data-action="bookmark"]').classList.toggle('on', isBookmarked);
    $('[data-action="bookmark"]').textContent = isBookmarked ? '★' : '☆';

    const dive = $('#dive-label');
    if (app.currentKind === 'system' && isPlanet) dive.textContent = 'DIVE';
    else if (app.currentKind === 'planet') dive.textContent = 'SURFACE';
    else if (isStar) dive.textContent = 'SYSTEM';
    else if (obj.kind === 'nebula') dive.textContent = 'ENTER';
    else if (obj.kind === 'galaxy') dive.textContent = 'TRAVEL';
    else dive.textContent = 'DIVE';

    this.renderNav();
  }

  renderNav() {
    const app = this.app;
    const filter = ($('#nav-filter')?.value || '').trim().toLowerCase();
    const list = $('#nav-list');
    $('#log-count').textContent = String(Object.keys(app.save.discoveries).length);
    if (!list) return;
    let html = '';
    if (this.navTab === 'catalog') {
      const groups = [
        ['STARS & SYSTEMS', STARS, 'star'],
        ['EXOPLANETS', PLANETS, 'planet'],
        ['DEEP SKY', DEEP_SKY, 'deep'],
      ];
      for (const [title, arr, cls] of groups) {
        const items = arr.filter((o) => !filter || o.name.toLowerCase().includes(filter) || (o.aliases || []).some((a) => a.toLowerCase().includes(filter)));
        if (!items.length) continue;
        html += `<div class="nav-section">${title} <span style="float:right;color:var(--faint)">${items.length}</span></div>`;
        for (const o of items) {
          html += `<button class="nav-item ${cls} ${app.selected?.id === o.id ? 'active' : ''}" data-nav="${esc(o.id)}">
            <i class="nav-dot"></i><span class="nav-main"><span class="nav-name">${esc(o.name)}</span><span class="nav-meta">${esc(metaOf(o))}</span></span><span class="nav-go">›</span>
          </button>`;
        }
      }
      if (!html) html = `<div class="nav-empty">NO MATCHING OBJECTS<br>Try a seed or real catalogue name.</div>`;
    } else if (this.navTab === 'bookmarks') {
      const items = app.save.bookmarks.map((id) => getObject(id)).filter(Boolean);
      if (!items.length) html = `<div class="nav-empty">NO BOOKMARKS YET<br>Open a dossier and tap ☆ to save a target.</div>`;
      else {
        html += `<div class="nav-section">SAVED TARGETS</div>`;
        for (const o of items) {
          html += `<button class="nav-item ${o.kind === 'planet' ? 'planet' : o.kind === 'star' ? '' : 'deep'} ${app.selected?.id === o.id ? 'active' : ''}" data-nav="${esc(o.id)}">
            <i class="nav-dot"></i><span class="nav-main"><span class="nav-name">${esc(o.name)}</span><span class="nav-meta">${esc(metaOf(o))}</span></span><span class="nav-go">›</span>
          </button>`;
        }
      }
    } else {
      const entries = Object.entries(app.save.discoveries).sort((a, b) => b[1].at - a[1].at);
      $('#log-count').textContent = String(entries.length);
      if (!entries.length) html = `<div class="nav-empty">DISCOVERY LOG EMPTY<br>Scan a body to register it in the local archive.</div>`;
      else {
        html += `<div class="nav-section">ARCHIVE · ${entries.length} OBJECTS</div>`;
        for (const [id, d] of entries) {
          const o = getObject(id);
          html += `<button class="nav-item ${d.kind === 'planet' ? 'planet' : d.kind === 'star' ? '' : 'deep'}" data-nav="${esc(id)}">
            <i class="nav-dot"></i><span class="nav-main"><span class="nav-name">${esc(d.name)}</span><span class="nav-meta">${esc((d.class || d.kind).toUpperCase())} · #${String(d.index || 0).padStart(4, '0')}</span></span><span class="nav-go">›</span>
          </button>`;
        }
      }
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
      const o = getObject(b.dataset.nav);
      if (o) app.travelTo(o);
      else {
        const d = app.save.discoveries[b.dataset.nav];
        if (d?.seed) app.travelToSeed(d.seed);
        else this.toast('ARCHIVE ENTRY', 'This procedural object is no longer in the current universe seed.');
      }
    }));
  }

  renderQuick() {
    const chips = ['Kepler-22 b', 'TRAPPIST-1 e', 'Proxima b', 'K2-18 b', 'TOI-700 d', 'Sirius', 'Betelgeuse', 'Orion Nebula', 'Andromeda', 'Cygnus X-1', 'Crab Pulsar', 'Earth'];
    $('#search-quick').innerHTML = chips.map((c) => `<button data-quick="${esc(c)}">${esc(c)}</button>`).join('');
    $$('#search-quick [data-quick]').forEach((b) => b.addEventListener('click', () => {
      const obj = searchCatalog(b.dataset.quick)[0];
      if (obj) this.app.travelTo(obj);
      this.closeSearch();
    }));
  }

  openSearch() {
    $('#search-overlay').classList.add('open');
    const inp = $('#search-input');
    inp.value = '';
    this.renderSearch('');
    setTimeout(() => inp.focus(), 50);
  }

  closeSearch() {
    $('#search-overlay').classList.remove('open');
  }

  renderSearch(query) {
    const q = String(query || '').trim();
    const results = q ? searchCatalog(q).slice(0, 12) : [];
    this.searchResults = results;
    this.searchIndex = 0;
    let html = '';
    if (!q) {
      html = `<div class="search-empty">SEARCH THE REAL UNIVERSE<br><span style="color:var(--muted)">Exoplanets · stars · nebulae · galaxies · seeds</span></div>`;
    } else {
      for (let i = 0; i < results.length; i++) {
        const o = results[i];
        const icon = o.kind === 'planet' ? '◐' : o.kind === 'star' ? '✦' : o.kind === 'galaxy' ? '◉' : '✧';
        html += `<button class="search-result ${i === 0 ? 'sel' : ''}" data-sr="${i}">
          <span class="sr-icon">${icon}</span>
          <span class="sr-main"><span class="sr-name">${esc(o.name)}</span><span class="sr-meta">${esc(metaOf(o))} · ${esc((o.classLabel || o.kind).toUpperCase())}</span></span>
          <span class="sr-go">TRAVEL ›</span>
        </button>`;
      }
      if (q.length >= 3) {
        html += `<button class="search-result" data-seed="${esc(q)}">
          <span class="sr-icon">⌬</span>
          <span class="sr-main"><span class="sr-name">Generate “${esc(q)}”</span><span class="sr-meta">PROCEDURAL SYSTEM · SEED-DERIVED · DETERMINISTIC</span></span>
          <span class="sr-go">GENERATE ›</span>
        </button>`;
      }
      if (!html) html = `<div class="search-empty">NO CELESTIAL MATCH<br>Try “TRAPPIST”, “Sirius”, “M31”, or a seed.</div>`;
    }
    $('#search-results').innerHTML = html;
    $$('#search-results [data-sr]').forEach((b) => b.addEventListener('click', () => {
      const o = this.searchResults[Number(b.dataset.sr)];
      if (o) this.app.travelTo(o);
      this.closeSearch();
    }));
    $$('#search-results [data-seed]').forEach((b) => b.addEventListener('click', () => {
      this.app.applySeed(b.dataset.seed);
      this.closeSearch();
    }));
  }

  moveSearch(dir) {
    if (!this.searchResults.length) return;
    this.searchIndex = (this.searchIndex + dir + this.searchResults.length) % this.searchResults.length;
    $$('#search-results [data-sr]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.sr) === this.searchIndex));
  }

  chooseSearch() {
    const o = this.searchResults[this.searchIndex];
    if (o) this.app.travelTo(o);
    this.closeSearch();
  }

  openModal(html) {
    $('#modal-body').innerHTML = html;
    $('#modal-overlay').classList.add('open');
  }

  closeModal() {
    $('#modal-overlay').classList.remove('open');
  }

  showDossier(obj) {
    if (!obj) return;
    const app = this.app;
    const isPlanet = obj.kind === 'planet';
    const isStar = obj.kind === 'star';
    const appr = isPlanet ? (obj.appearance || makeAppearance(obj)) : null;
    const orbStyle = isPlanet
      ? `background: radial-gradient(circle at 34% 30%, ${appr.baseC}, ${appr.baseB} 32%, ${appr.baseA} 62%, ${appr.water} 100%);`
      : isStar
        ? `background: radial-gradient(circle at 40% 36%, #fff, ${starColor(obj.tempK || 6000)} 36%, #1a0c05 100%); box-shadow: 0 0 70px ${starColor(obj.tempK || 6000)}88, inset -20px -16px 50px rgba(0,0,0,.6);`
        : `background: radial-gradient(circle at 42% 40%, ${obj.kind === 'nebula' ? '#ff9ec4' : '#ffe1b0'}, ${obj.kind === 'nebula' ? '#3f1a56' : '#6a3c1a'} 45%, #05080d 80%); box-shadow: 0 0 60px rgba(255,160,190,.25);`;
    const dist = distanceOf(obj);
    const stats = isPlanet ? [
      ['MASS', fmtMass(obj.massEarth)],
      ['RADIUS', fmtRadius(obj.radiusEarth)],
      ['TEMP', `${Math.round(obj.tempK || obj.teqK)} K`],
      ['ORBIT', `${obj.aAU?.toFixed(3)} AU`],
      ['PERIOD', `${obj.periodDays?.toFixed(2)} d`],
      ['ATMOSPHERE', obj.atmosphere || '—'],
      ['PRESSURE', obj.pressure ? `${obj.pressure.toFixed(1)} atm` : 'vacuum'],
      ['HABITABILITY', (obj.habitability || 0).toFixed(2)],
    ] : isStar ? [
      ['MASS', `${(obj.massSolar ?? 0).toFixed(2)} M☉`],
      ['RADIUS', `${(obj.radiusSolar ?? 0).toFixed(2)} R☉`],
      ['TEMP', `${Math.round(obj.tempK || 0).toLocaleString('en-US')} K`],
      ['LUMINOSITY', `${(obj.lumSolar ?? 0).toFixed(3)} L☉`],
      ['DISTANCE', dist ? `${dist.toLocaleString('en-US')} ly` : 'local'],
      ['SPECTRAL', obj.spectral || '—'],
      ['RA', obj.ra || '—'],
      ['DEC', obj.dec || '—'],
    ] : [
      ['CLASS', obj.classLabel || obj.kind],
      ['DISTANCE', dist ? `${dist.toLocaleString('en-US')} ly` : '—'],
      ['RADIUS', obj.radiusLy ? `${obj.radiusLy.toLocaleString('en-US')} ly` : '—'],
      ['RA', obj.ra || '—'],
      ['DEC', obj.dec || '—'],
      ['SEED', obj.seed || '—'],
    ];
    const disc = app.save.discoveries[obj.id];
    const html = `
      <div class="dossier-top">
        <div class="dossier-visual"><div class="grid-line"></div><div class="orb" style="${orbStyle}"></div>${isPlanet && appr.hasRings ? '<div class="ring"></div>' : ''}</div>
        <div>
          <div class="dossier-kicker">${isPlanet ? 'EXOPLANET DOSSIER' : isStar ? 'STELLAR DOSSIER' : 'DEEP SKY DOSSIER'} // ${esc(obj.id.toUpperCase())}</div>
          <div class="dossier-title">${esc(obj.name)}</div>
          <div class="dossier-sub">${esc(obj.classLabel || obj.spectral || obj.kind)} ${dist ? '· ' + dist.toLocaleString('en-US') + ' LY' : ''} ${disc ? '· CATALOGUED' : '· UNSCANNED'}</div>
          <div style="margin-top:12px">${(obj.aliases || []).map((a) => `<span class="tag">${esc(a.toUpperCase())}</span>`).join('')}<span class="tag">SEED ${esc(obj.seed || obj.id)}</span></div>
        </div>
      </div>
      <div class="dossier-grid">${stats.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="dossier-body">${esc(obj.description || 'No catalogue description available.')}</div>
      <div class="section-title">ORBITAL / PHYSICAL PROFILE</div>
      <div class="dossier-body" style="font-size:10px;color:var(--muted)">
        ${isPlanet ? `Equilibrium temperature ${Math.round(obj.teqK || 0)} K · ${obj.tidallyLocked ? 'tidally locked' : 'rotating'} · ${obj.rings ? 'ring system detected' : 'no ring system'} · ${obj.moons || 0} natural satellite(s).` : ''}
        ${isStar ? `Spectral class ${obj.spectral || '—'} · ${getPlanets(obj.id).length} confirmed world(s) in the local archive.` : ''}
        ${!isPlanet && !isStar ? `Located at ${obj.ra || '—'} ${obj.dec || '—'}. Procedural structure reconstructed deterministically from seed ${obj.seed || obj.id}.` : ''}
      </div>
      <div class="dossier-foot">
        <button class="action primary" data-modal-travel>TRAVEL</button>
        <button class="action" data-modal-scan>${disc ? 'RESCAN' : 'SCAN'}</button>
        <button class="action" data-modal-book>${app.save.bookmarks.includes(obj.id) ? '★ BOOKMARKED' : '☆ BOOKMARK'}</button>
      </div>`;
    this.openModal(html);
    $('[data-modal-travel]')?.addEventListener('click', () => { this.closeModal(); app.travelTo(obj); });
    $('[data-modal-scan]')?.addEventListener('click', () => { this.closeModal(); app.scan(); });
    $('[data-modal-book]')?.addEventListener('click', () => { app.toggleBookmark(); this.showDossier(obj); });
  }

  showAchievements() {
    const app = this.app;
    const list = app.achievementDefs.map((a) => {
      const on = !!app.save.achievements[a.id];
      return `<div class="ach-card ${on ? 'on' : ''}">
        <div class="ach-icon">${on ? '★' : '·'}</div>
        <div><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div></div>
      </div>`;
    }).join('');
    const count = app.achievementDefs.filter((a) => app.save.achievements[a.id]).length;
    this.openModal(`
      <div class="dossier-kicker">PILOT RECORD // ${count}/${app.achievementDefs.length} UNLOCKED</div>
      <div class="dossier-title" style="font-size:32px">Achievements</div>
      <div class="dossier-sub">${app.save.credits} credits · ${Object.keys(app.save.discoveries).length} discoveries · ${app.save.visits.length} worlds visited</div>
      <div class="ach-grid">${list}</div>
    `);
  }

  showSettings() {
    const app = this.app;
    this.openModal(`
      <div class="dossier-kicker">SYSTEM // CONFIGURATION</div>
      <div class="dossier-title" style="font-size:32px">Settings</div>
      <div class="dossier-sub">AETHER · deterministic procedural universe · offline-ready</div>
      <div class="settings-row">
        <div class="label">RENDER PRESET<small>Lower presets reduce star count, bloom and mesh density.</small></div>
        <div class="seg">
          <button data-quality="low" data-action="quality" class="${app.engine.qualityName === 'low' ? 'on' : ''}">LOW</button>
          <button data-quality="medium" data-action="quality" class="${app.engine.qualityName === 'medium' ? 'on' : ''}">MEDIUM</button>
          <button data-quality="high" data-action="quality" class="${app.engine.qualityName === 'high' ? 'on' : ''}">HIGH</button>
        </div>
      </div>
      <div class="settings-row">
        <div class="label">UNIVERSE SEED<small>Changing the seed regenerates every procedural object.</small></div>
        <div style="display:flex;gap:4px"><input id="settings-seed" value="${esc(app.seed)}" style="width:140px;height:28px;background:rgba(0,0,0,.3);border:1px solid var(--line);padding:0 8px;color:var(--cyan);font-size:9px"><button class="mini-btn" data-action="apply-settings-seed">GO</button></div>
      </div>
      <div class="settings-row">
        <div class="label">OFFLINE PLAY<small>Service worker caches the full engine after first load.</small></div>
        <span style="font-size:8px;color:var(--good);letter-spacing:.12em">${navigator.onLine ? 'CACHED / READY' : 'OFFLINE MODE'}</span>
      </div>
      <div class="settings-row">
        <div class="label">SAVE DATA<small>${app.save.credits} credits · ${Object.keys(app.save.discoveries).length} discoveries</small></div>
        <button class="action" data-action="reset-save" style="flex:0 0 auto;padding:0 12px">RESET</button>
      </div>
      <div class="settings-actions">
        <button class="action" data-action="share-link">SHARE SEED LINK</button>
        <button class="action" data-action="new-seed">NEW SEED</button>
      </div>
      <div class="section-title">ABOUT</div>
      <div class="dossier-body" style="font-size:10px;color:var(--muted)">AETHER is a seed-driven space engine: galaxies, stars, planets, atmospheres, rings and surfaces are generated locally and rendered with three.js. Real objects use J2000 coordinates and published physical data; procedural bodies are pure functions of their seed. No network is required after the first load.</div>
    `);
    const input = $('#settings-seed');
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.applySeed(input.value); });
    $('[data-action="apply-settings-seed"]')?.addEventListener('click', () => app.applySeed(input.value));
  }

  showScan(obj) {
    $('#scan-overlay').classList.add('on');
    $('#scan-target').textContent = obj?.name || 'UNKNOWN';
    this.setScanProgress(0, 'ACQUIRING SIGNAL…');
  }

  setScanProgress(p, text) {
    $('#scan-ring').style.setProperty('--p', String(Math.round(p * 100)));
    $('#scan-pct').textContent = `${Math.round(p * 100)}%`;
    if (text) $('#scan-log').textContent = text;
  }

  hideScan() {
    $('#scan-overlay').classList.remove('on');
  }

  toast(title, body, gold = false) {
    const el = document.createElement('div');
    el.className = `toast ${gold ? 'gold' : ''}`;
    el.innerHTML = `<div class="t-title">${esc(title)}</div><div class="t-body">${esc(body)}</div>`;
    $('#toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 4100);
  }

  updateFlare(sun) {
    const el = $('#flare');
    if (!el) return;
    if (!sun?.visible) { el.style.opacity = '0'; return; }
    el.style.opacity = String(0.25 + sun.intensity * 0.75);
    el.style.left = `${sun.x}px`;
    el.style.top = `${sun.y}px`;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dx = (w / 2 - sun.x) * 0.34;
    const dy = (h / 2 - sun.y) * 0.34;
    const ghosts = el.querySelectorAll('.flare-ghost');
    ghosts.forEach((g, i) => {
      const k = (i + 1) * 0.7;
      g.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    });
    el.querySelector('.flare-streak.h').style.transform = `translate(-50%, -50%) scaleX(${0.7 + sun.intensity * 0.6})`;
    el.querySelector('.flare-streak.v').style.transform = `translate(-50%, -50%) scaleY(${0.7 + sun.intensity * 0.6})`;
  }

  setPhoto(on) {
    document.body.classList.toggle('photo', on);
  }
}
