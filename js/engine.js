import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { LENSING_VERT, LENSING_FRAG } from './shaders.js';
import { clamp } from './rng.js';
import { selectionTexture, disposeObject } from './visuals.js';
import { buildGalaxy, buildNebula, buildSystem, buildPlanet } from './views.js';
import { buildSurface } from './surface.js';

const QUALITY = {
  low: { dpr: 1.0, factor: 0.42, galaxy: 15000, bg: 2800, seg: 64, bloom: 0.62, bloomSize: 0.5 },
  medium: { dpr: 1.5, factor: 0.7, galaxy: 30000, bg: 5200, seg: 96, bloom: 0.82, bloomSize: 0.72 },
  high: { dpr: 2.0, factor: 1.0, galaxy: 56000, bg: 9000, seg: 128, bloom: 0.92, bloomSize: 1.0 },
};

const LensingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uRadius: { value: 0.08 },
    uStrength: { value: 1.0 },
    uActive: { value: 0.0 },
    uAspect: { value: 1.0 },
  },
  vertexShader: LENSING_VERT,
  fragmentShader: LENSING_FRAG,
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n).toLocaleString('en-US');
  return n.toFixed(digits);
}

export class Engine {
  constructor({ container, labels, fade, quality = 'medium' }) {
    this.container = container;
    this.labelsEl = labels;
    this.fadeEl = fade;
    this.qualityName = quality;
    this.quality = QUALITY[quality] || QUALITY.medium;
    this.callbacks = {};
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    this.pointMaterials = new Set();
    this._labelBuffer = [];
    this._selectableBuffer = [];
    this.selected = null;
    this.selectedId = null;
    this.selectionSprite = null;
    this.transitioning = false;
    this.autopilot = false;
    this.time = 0;
    this.simTime = 0;
    this.timeWarp = 1;
    this.sunScreen = { visible: false, x: 0, y: 0, intensity: 0 };
    this._tap = { time: 0, obj: null };
    this._drag = null;
    this._pinch = null;
    this._suppressTap = false;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'space-canvas';

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 20000);
    this.scene = new THREE.Scene();

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.lensingPass = new ShaderPass(LensingShader);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), this.quality.bloom, 0.62, 0.58);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.lensingPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._initInput();
  }

  setCallbacks(cb) {
    this.callbacks = { ...this.callbacks, ...cb };
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.size = { w, h };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.dpr));
    this.pixelRatio = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.lensingPass.uniforms.uAspect.value = w / h;
    for (const m of this.pointMaterials) m.uniforms.uPixelRatio.value = this.pixelRatio;
  }

  setQuality(name) {
    if (!QUALITY[name]) return;
    this.qualityName = name;
    this.quality = QUALITY[name];
    this.bloomPass.strength = this.quality.bloom;
    this.bloomPass.resolution.set(
      Math.max(64, Math.floor((this.size?.w || window.innerWidth) * 0.5 * this.quality.bloomSize)),
      Math.max(64, Math.floor((this.size?.h || window.innerHeight) * 0.5 * this.quality.bloomSize))
    );
    this.resize();
    this.callbacks.onQuality?.(name);
  }

  async setView(spec, { instant = false, fade = true } = {}) {
    if (this.transitioning) return;
    this.transitioning = true;
    if (fade && !instant && this.fadeEl) {
      this.fadeEl.classList.add('on');
      await wait(240);
    }
    this.disposeView();
    this._labelBuffer = [];
    this._selectableBuffer = [];
    try {
      this.buildView(spec);
    } catch (err) {
      console.error('Failed to build view', err);
      this.transitioning = false;
      this.fadeEl?.classList.remove('on');
      return;
    }
    this.callbacks.onView?.(this.view);
    if (fade && !instant && this.fadeEl) {
      requestAnimationFrame(() => this.fadeEl.classList.remove('on'));
      await wait(380);
    }
    this.transitioning = false;
  }

  buildView(spec) {
    let view;
    if (spec.kind === 'galaxy') view = buildGalaxy(this, spec.data);
    else if (spec.kind === 'nebula') view = buildNebula(this, spec.data);
    else if (spec.kind === 'system') view = buildSystem(this, spec.system, spec);
    else if (spec.kind === 'planet') view = buildPlanet(this, spec.planet, spec.system);
    else if (spec.kind === 'surface') view = buildSurface(this, spec.planet, spec.system);
    else throw new Error(`Unknown view ${spec.kind}`);
    view.kind = spec.kind;
    view.labels = this._labelBuffer;
    view.selectables = this._selectableBuffer;
    this.view = view;
    this.scene = view.scene;
    this.renderPass.scene = view.scene;
    this.camera.fov = view.fov || 55;
    this.camera.near = view.near || 0.01;
    this.camera.far = view.far || 20000;
    this.camera.updateProjectionMatrix();
    this.lensingPass.uniforms.uActive.value = 0;
    this.selected = null;
    this.selectedId = null;
    this.selectionSprite = null;
    this.autopilot = false;
    this.updateCamera(0);
    this.camera.updateMatrixWorld(true);
    this.updateLabels();
  }

  disposeView() {
    if (!this.view) return;
    for (const l of this.view.labels || []) l.el.remove();
    if (this.selectionSprite) {
      this.selectionSprite.removeFromParent();
      this.selectionSprite.material.dispose();
      this.selectionSprite = null;
    }
    disposeObject(this.view.scene);
    this.view = null;
    this.scene = new THREE.Scene();
    this.pointMaterials.clear();
    if (this.labelsEl) this.labelsEl.innerHTML = '';
  }

  addLabel(obj, getPos, opts = {}) {
    const el = document.createElement('button');
    el.className = `marker ${opts.className || ''}`;
    el.type = 'button';
    el.innerHTML = `<span class="marker-dot"></span><span class="marker-name">${opts.label || obj.name}</span>`;
    el.dataset.id = obj.id;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (this._tap.obj && this._tap.obj.id === obj.id && now - this._tap.time < 380) {
        this._tap = { time: 0, obj: null };
        this.callbacks.onTravel?.(obj);
      } else {
        this._tap = { time: now, obj };
        this.callbacks.onSelect?.(obj);
      }
    });
    if (this.labelsEl) this.labelsEl.appendChild(el);
    const label = { el, obj, getPos, opts };
    this._labelBuffer.push(label);
    return label;
  }

  addSelectable(mesh, obj) {
    mesh.userData.body = obj;
    this._selectableBuffer.push(mesh);
  }

  updateCamera(dt) {
    const v = this.view;
    if (!v) return;
    const c = v.controls;
    if (!c) return;
    if (c.mode === 'look') {
      if (c.position) this.camera.position.copy(c.position);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = c.yaw;
      this.camera.rotation.x = c.pitch;
      this.camera.rotation.z = 0;
      this.camera.updateMatrixWorld(true);
      return;
    }
    let target = c.target;
    if (c.follow) {
      const t = c.follow();
      if (t) target = t;
    }
    if (!target) return;
    const k = dt > 0 ? Math.min(1, dt * 7) : 1;
    c.target.lerp(target, k);
    const cp = Math.cos(c.pitch);
    this.camera.position.set(
      c.target.x + c.distance * cp * Math.sin(c.yaw),
      c.target.y + c.distance * Math.sin(c.pitch),
      c.target.z + c.distance * cp * Math.cos(c.yaw)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c.target);
    this.camera.updateMatrixWorld(true);
  }

  updateLabels() {
    const v = this.view;
    if (!v || !v.labels) return;
    const w = this.size?.w || window.innerWidth;
    const h = this.size?.h || window.innerHeight;
    const camSpace = new THREE.Vector3();
    const candidates = [];

    for (const l of v.labels) {
      let p = l.getPos();
      if (!p) {
        l.el.style.display = 'none';
        continue;
      }
      if (p.isObject3D) p = p.getWorldPosition(new THREE.Vector3());
      camSpace.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
      if (camSpace.z > -0.01) {
        l.el.style.display = 'none';
        continue;
      }
      const ndc = p.clone().project(this.camera);
      if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1.15 || Math.abs(ndc.y) > 1.15) {
        l.el.style.display = 'none';
        continue;
      }
      const x = (ndc.x * 0.5 + 0.5) * w;
      const y = (-ndc.y * 0.5 + 0.5) * h;
      const name = l.opts.label || l.obj?.name || '';
      const selected = this.selectedId === l.obj?.id;
      const sun = String(l.opts.className || '').includes('sun');
      candidates.push({
        l, x, y, selected,
        w: Math.min(190, 24 + String(name).length * 6.2),
        h: 18,
        dist: camSpace.length(),
        priority: (selected ? 100 : 0) + (sun ? 40 : 0) + (l.obj?.kind === 'star' ? 20 : 0) - camSpace.length() * 0.0001,
      });
    }

    // Greedy declutter: the selected target and the local star win ties, and
    // overlapping labels fade out instead of turning the HUD into mush.
    candidates.sort((a, b) => b.priority - a.priority);
    const boxes = [];
    for (const c of candidates) {
      const box = {
        left: c.x - c.w / 2 - 5,
        right: c.x + c.w / 2 + 5,
        top: c.y - c.h / 2 - 3,
        bottom: c.y + c.h / 2 + 3,
      };
      const clash = boxes.some((o) => !(box.right < o.left || box.left > o.right || box.bottom < o.top || box.top > o.bottom));
      if (clash && !c.selected) {
        c.l.el.style.display = 'none';
        continue;
      }
      boxes.push(box);
      c.l.el.style.display = '';
      c.l.el.style.transform = `translate(-50%, -50%) translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
      c.l.el.classList.toggle('selected', c.selected);
      if (c.l.opts.fade) {
        const o = c.selected ? 1 : clamp(1.25 - c.dist / c.l.opts.fade, 0.18, 1);
        c.l.el.style.opacity = o.toFixed(2);
      }
    }
  }

  updateSunScreen() {
    const v = this.view;
    this.sunScreen.visible = false;
    if (!v || !v.sun) return;
    const wp = v.sun.getWorldPos ? v.sun.getWorldPos() : v.sun.position;
    if (!wp) return;
    const camSpace = wp.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (camSpace.z > -0.1) return;
    const ndc = wp.clone().project(this.camera);
    if (Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2 || ndc.z > 1) return;
    const w = this.size.w;
    const h = this.size.h;
    this.sunScreen.visible = true;
    this.sunScreen.x = (ndc.x * 0.5 + 0.5) * w;
    this.sunScreen.y = (-ndc.y * 0.5 + 0.5) * h;
    const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
    this.sunScreen.intensity = clamp(1.2 - edge * 0.8, 0.1, 1.0) * (v.sun.intensity ?? 1);
  }

  updateLensing(dt) {
    const v = this.view;
    const u = this.lensingPass.uniforms;
    if (!v || !v.lens) {
      u.uActive.value = Math.max(0, u.uActive.value - dt * 4);
      return;
    }
    const wp = v.lens.getWorldPos();
    const camSpace = wp.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (camSpace.z < -0.1) {
      const ndc = wp.clone().project(this.camera);
      u.uCenter.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
      const dist = camSpace.length();
      const ang = Math.atan2(v.lens.radius, dist);
      const frac = ang / (this.camera.fov * Math.PI / 360);
      u.uRadius.value = clamp(frac * 0.72, 0.02, 0.5);
      u.uActive.value = Math.min(1, u.uActive.value + dt * 4);
    } else {
      u.uActive.value = Math.max(0, u.uActive.value - dt * 4);
    }
  }

  updateSelection() {
    if (!this.selected || !this.view) return;
    if (this.view.getBody) {
      const body = this.view.getBody(this.selected);
      if (body) {
        if (!this.selectionSprite) {
          this.selectionSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: selectionTexture(),
            color: new THREE.Color('#7deeff'),
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
          }));
          this.view.scene.add(this.selectionSprite);
        }
        const p = body.group.getWorldPosition(new THREE.Vector3());
        this.selectionSprite.position.copy(p);
        const s = (body.radius || 1) * 4.6;
        this.selectionSprite.scale.set(s, s, 1);
        this.selectionSprite.visible = true;
      } else {
        if (this.selectionSprite) this.selectionSprite.visible = false;
      }
    } else if (this.selectionSprite) {
      this.selectionSprite.visible = false;
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.simTime += dt * 0.12 * this.timeWarp;
    if (this.view) {
      if (this.view.time) this.view.time.value = this.simTime;
      if (this.view.update) this.view.update(dt, this);
      if (this.autopilot && this.view.autopilot) this.view.autopilot(dt, this);
      this.updateCamera(dt);
      this.updateLabels();
      this.updateSunScreen();
      this.updateLensing(dt);
      this.updateSelection();
    }
    this.render();
  }

  render() {
    if (!this.view) {
      this.renderer.clear();
      return;
    }
    for (const m of this.pointMaterials) {
      if (m.uniforms.uPixelRatio) m.uniforms.uPixelRatio.value = this.pixelRatio;
    }
    this.composer.render();
  }

  _initInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    const pointers = new Map();
    const dist = () => {
      const a = [...pointers.values()];
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        this._drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, time: Date.now() };
        this._suppressTap = false;
      } else if (pointers.size === 2) {
        this._pinch = { dist: dist(), distance: this.view?.controls?.distance || 1, fov: this.camera.fov };
        this._drag = null;
        this._suppressTap = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && this._pinch) {
        const d = dist();
        const ratio = this._pinch.dist / Math.max(1, d);
        const c = this.view?.controls;
        if (!c) return;
        if (c.mode === 'look') {
          this.setFov(clamp(this._pinch.fov * ratio, c.minFov || 32, c.maxFov || 78), true);
        } else {
          this.setDistance(clamp(this._pinch.distance * ratio, c.min, c.max), true);
        }
        this._suppressTap = true;
        return;
      }
      if (this._drag) {
        const dx = e.clientX - this._drag.x;
        const dy = e.clientY - this._drag.y;
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        this._drag.moved += Math.abs(dx) + Math.abs(dy);
        if (this._drag.moved > 4) this.rotate(dx, dy);
      }
    });
    const end = (e) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (wasSingle && this._drag && this._drag.moved < 8 && !this._suppressTap) {
          this.handleTap(e.clientX, e.clientY);
        }
        this._drag = null;
        this._pinch = null;
      }
      if (pointers.size === 1) {
        this._pinch = null;
        this._suppressTap = true;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      this._drag = null;
      this._pinch = null;
      this._suppressTap = true;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      this.zoom(factor);
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const obj = this.pick(e.clientX, e.clientY);
      if (obj) this.callbacks.onTravel?.(obj);
    });
  }

  handleTap(x, y) {
    const obj = this.pick(x, y);
    if (obj) {
      const now = Date.now();
      if (this._tap.obj && this._tap.obj.id === obj.id && now - this._tap.time < 360) {
        this._tap = { time: 0, obj: null };
        this.callbacks.onTravel?.(obj);
      } else {
        this._tap = { time: now, obj };
        this.callbacks.onSelect?.(obj);
      }
    } else {
      this._tap = { time: 0, obj: null };
      this.callbacks.onSelect?.(null);
    }
  }

  pick(x, y) {
    if (!this.view || !this.view.selectables?.length) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.view.selectables, false);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.body) o = o.parent;
      if (o?.userData.body) return o.userData.body;
    }
    return null;
  }

  rotate(dx, dy) {
    const c = this.view?.controls;
    if (!c) return;
    if (c.mode === 'look') {
      c.yaw -= dx * 0.0032;
      c.pitch = clamp(c.pitch - dy * 0.0032, -1.25, 1.25);
    } else {
      c.yaw -= dx * 0.0045;
      c.pitch = clamp(c.pitch + dy * 0.0045, c.pitchMin ?? -1.4, c.pitchMax ?? 1.4);
    }
    this.callbacks.onAutopilotChange?.(false);
    this.autopilot = false;
  }

  setDistance(d, fromGesture = false) {
    const c = this.view?.controls;
    if (!c || c.mode === 'look') return;
    c.distance = clamp(d, c.min, c.max);
    if (fromGesture) {
      this.autopilot = false;
      this.callbacks.onAutopilotChange?.(false);
    }
  }

  setFov(f, fromGesture = false) {
    const c = this.view?.controls;
    if (!c) return;
    this.camera.fov = clamp(f, c.minFov || 32, c.maxFov || 78);
    this.camera.updateProjectionMatrix();
    if (fromGesture && this.camera.fov >= (c.maxFov || 78) - 0.4) this.view.zoomOut?.();
    if (fromGesture) {
      this.autopilot = false;
      this.callbacks.onAutopilotChange?.(false);
    }
  }

  zoom(factor) {
    const c = this.view?.controls;
    if (!c) return;
    this.autopilot = false;
    this.callbacks.onAutopilotChange?.(false);
    if (c.mode === 'look') {
      this.setFov(clamp(this.camera.fov / factor, c.minFov || 32, c.maxFov || 78));
      if (this.camera.fov >= (c.maxFov || 78) - 0.4 && factor < 1) this.view.zoomOut?.();
      return;
    }
    const next = clamp(c.distance / factor, c.min, c.max);
    c.distance = next;
    if (next >= c.max - 1e-4 && factor < 1) this.view.zoomOut?.();
  }

  focusObject(obj) {
    this.view?.focusObject?.(obj, this);
  }

  dive() {
    this.view?.dive?.(this);
  }

  setSelected(obj) {
    this.selected = obj;
    this.selectedId = obj?.id || null;
    if (!obj && this.selectionSprite) this.selectionSprite.visible = false;
    this.updateLabels();
  }

  getTelemetry() {
    if (!this.view) return { altLabel: 'ALTITUDE', altValue: '—', scale: '—', mode: 'SPACE' };
    if (this.view.telemetry) return this.view.telemetry(this);
    return { altLabel: 'ALTITUDE', altValue: '—', scale: '—', mode: 'SPACE' };
  }

  capture() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.disposeView();
    this.renderer.dispose();
    this.composer.dispose?.();
    this.renderer.domElement.remove();
  }
}

export { fmtNum };
