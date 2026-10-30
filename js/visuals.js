import * as THREE from 'three';
import {
  PLANET_VERT, PLANET_FRAG, CLOUD_VERT, CLOUD_FRAG, ATMO_VERT, ATMO_FRAG,
  STAR_VERT, STAR_FRAG, POINTS_VERT, POINTS_FRAG, NEBULA_VERT, NEBULA_FRAG,
  RING_VERT, RING_FRAG, DISK_VERT, DISK_FRAG,
} from './shaders.js';
import { makeRng, clamp } from './rng.js';
import { starColor, jitterHex, makeAppearance } from './procedural.js';

let _glow;
let _flare;
let _selection;

export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.48, 'rgba(255,255,255,0.11)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

export function flareTexture() {
  if (_flare) return _flare;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 240);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.06, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createLinearGradient(0, 256, 512, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 250, 512, 12);
  const grad2 = ctx.createLinearGradient(256, 0, 256, 512);
  grad2.addColorStop(0, 'rgba(255,255,255,0)');
  grad2.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad2;
  ctx.fillRect(250, 0, 12, 512);
  _flare = new THREE.CanvasTexture(c);
  _flare.colorSpace = THREE.SRGBColorSpace;
  return _flare;
}

export function selectionTexture() {
  if (_selection) return _selection;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(115,238,255,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(115,238,255,0.35)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    ctx.strokeStyle = 'rgba(115,238,255,0.8)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
    ctx.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124);
    ctx.stroke();
  }
  _selection = new THREE.CanvasTexture(c);
  _selection.colorSpace = THREE.SRGBColorSpace;
  return _selection;
}

export function makeSprite(tex, color, scale, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale, 1);
  return s;
}

export function makePoints(engine, positions, colors, sizes, opts = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: engine.pixelRatio },
      uScale: { value: opts.scale || 1 },
    },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = opts.renderOrder ?? 0;
  engine.pointMaterials.add(mat);
  return points;
}

export function makeBackground(engine, scene, count, radius, seed, opts = {}) {
  const rng = makeRng(`${seed}::background`);
  const n = Math.max(500, Math.floor(count * engine.quality.factor));
  const pos = [];
  const col = [];
  const size = [];
  const palette = [
    [0.85, 0.9, 1.0], [1.0, 1.0, 1.0], [1.0, 0.88, 0.68],
    [0.68, 0.82, 1.0], [1.0, 0.78, 0.55], [0.9, 0.82, 1.0],
  ];
  for (let i = 0; i < n; i++) {
    let x;
    let y;
    let z;
    if (opts.band && i < n * 0.42) {
      const a = rng() * Math.PI * 2;
      const yy = rng.gauss() * 0.09;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      x = Math.cos(a) * rr;
      y = yy;
      z = Math.sin(a) * rr;
    } else {
      const zz = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - zz * zz));
      x = Math.cos(a) * rr;
      y = zz;
      z = Math.sin(a) * rr;
    }
    pos.push(x * radius, y * radius, z * radius);
    const c = palette[Math.floor(rng() * palette.length)];
    const k = 0.35 + rng() * 0.65;
    col.push(c[0] * k, c[1] * k, c[2] * k);
    size.push(0.7 + Math.pow(rng(), 3) * 2.8);
  }
  const points = makePoints(engine, pos, col, size, { scale: opts.scale || 1.1, renderOrder: -2 });
  scene.add(points);
  return points;
}

export function makeGalaxyPoints(engine, seed, count, opts = {}) {
  const rng = makeRng(`${seed}::stars`);
  const n = Math.max(3000, Math.floor(count * engine.quality.factor));
  const R = opts.radius || 1100;
  const arms = opts.arms || 4;
  const spin = opts.spin || 3.4;
  const pos = [];
  const col = [];
  const size = [];
  const bulge = Math.floor(n * 0.16);
  const halo = Math.floor(n * 0.05);
  for (let i = 0; i < n; i++) {
    let x;
    let y;
    let z;
    let cr;
    let cg;
    let cb;
    let sz;
    if (i < bulge) {
      const rr = Math.pow(rng(), 0.62) * R * 0.19;
      const th = rng() * Math.PI * 2;
      const ph = Math.acos(rng() * 2 - 1);
      x = Math.cos(th) * Math.sin(ph) * rr;
      z = Math.sin(th) * Math.sin(ph) * rr;
      y = Math.cos(ph) * rr * 0.48;
      const w = rng();
      cr = 1.0; cg = 0.68 + w * 0.2; cb = 0.36 + w * 0.2; sz = 1.0 + rng() * 2.4;
    } else if (i < bulge + halo) {
      const rr = R * (0.35 + Math.pow(rng(), 0.5) * 0.85);
      const th = rng() * Math.PI * 2;
      const ph = Math.acos(rng() * 2 - 1);
      x = Math.cos(th) * Math.sin(ph) * rr;
      z = Math.sin(th) * Math.sin(ph) * rr;
      y = Math.cos(ph) * rr * 0.75;
      cr = 0.7; cg = 0.78; cb = 1.0; sz = 0.5 + rng() * 1.2;
    } else {
      const t = Math.pow(rng(), 0.58);
      const r = 0.055 * R + t * R * 0.94;
      const arm = Math.floor(rng() * arms);
      const spread = 0.16 + t * 0.14;
      const th = arm * (Math.PI * 2 / arms) + Math.log(1 + r / R * 5.2) * spin + rng.gauss() * spread;
      const rr = r + rng.gauss() * R * 0.018;
      x = Math.cos(th) * rr;
      z = Math.sin(th) * rr;
      y = rng.gauss() * (R * 0.012 + R * 0.018 * (1 - t));
      const hot = rng();
      if (hot < 0.22) { cr = 0.66; cg = 0.8; cb = 1.0; }
      else if (hot < 0.55) { cr = 0.9; cg = 0.93; cb = 1.0; }
      else if (hot < 0.82) { cr = 1.0; cg = 0.86; cb = 0.66; }
      else { cr = 1.0; cg = 0.68; cb = 0.46; }
      const k = 0.5 + rng() * 0.7;
      cr *= k; cg *= k; cb *= k;
      sz = 0.55 + Math.pow(rng(), 2.5) * 2.8;
    }
    pos.push(x, y, z);
    col.push(cr, cg, cb);
    size.push(sz);
  }
  return makePoints(engine, pos, col, size, { scale: 1.55, renderOrder: 1 });
}

export function makePlanetVisual(engine, planet, opts = {}) {
  const app = planet.appearance || makeAppearance(planet);
  const group = new THREE.Group();
  const radius = opts.radius ?? 1;
  const seg = opts.segments || engine.quality.seg;
  const time = opts.time || { value: 0 };
  const lightDir = (opts.lightDir || new THREE.Vector3(0.55, 0.22, 0.8)).clone().normalize();
  const base = new THREE.Color(app.baseA);
  const craterArr = [];
  for (let i = 0; i < 12; i++) {
    const c = app.craters[i] || { x: 0, y: 1, z: 0, r: 0, d: 0 };
    craterArr.push(new THREE.Vector4(c.x, c.y, c.z, c.r || 0.0001));
  }
  const volcArr = [];
  for (let i = 0; i < 5; i++) {
    const v = app.volcanoes[i] || { x: 0, y: 1, z: 0, r: 0.001 };
    volcArr.push(new THREE.Vector4(v.x, v.y, v.z, v.r || 0.001));
  }
  const uniforms = {
    uLightDir: { value: lightDir },
    uBaseA: { value: base },
    uBaseB: { value: new THREE.Color(app.baseB) },
    uBaseC: { value: new THREE.Color(app.baseC) },
    uWater: { value: new THREE.Color(app.water) },
    uAtmo: { value: new THREE.Color(app.atmo) },
    uCloud: { value: new THREE.Color(app.cloud) },
    uIce: { value: new THREE.Color(app.ice) },
    uWaterLevel: { value: app.waterLevel },
    uCloudCover: { value: app.cloudCover },
    uCity: { value: app.city || 0 },
    uEmissive: { value: app.emissive || 0 },
    uScale: { value: app.scale },
    uSeed: { value: app.seedFloat },
    uTime: time,
    uType: { value: app.shaderType },
    uBands: { value: app.bands || 10 },
    uAtmoDensity: { value: clamp(0.2 + Math.log10(1 + (planet.pressure || 0)) * 0.45, 0.08, 1.1) },
    uTidal: { value: planet.tidallyLocked ? 1 : 0 },
    uCraters: { value: craterArr },
    uCraterCount: { value: Math.min(12, app.craters.length) },
    uVolcanoes: { value: volcArr },
    uVolcanoCount: { value: Math.min(5, app.volcanoes.length) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.max(24, Math.floor(seg / 2))), mat);
  sphere.userData.body = planet;
  group.add(sphere);

  let clouds = null;
  let cloudMat = null;
  if (app.cloudCover > 0.03 && !opts.noClouds && app.shaderType !== 5 && app.shaderType !== 6 && app.shaderType !== 7) {
    cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(app.cloudColor) },
        uLightDir: { value: lightDir },
        uCover: { value: app.cloudCover },
        uSeed: { value: app.seedFloat * 1.7 },
        uTime: time,
        uOpacity: { value: 0.82 },
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
    });
    clouds = new THREE.Mesh(new THREE.SphereGeometry(1.014, Math.max(32, seg / 2), Math.max(16, seg / 4)), cloudMat);
    clouds.renderOrder = 2;
    group.add(clouds);
  }

  let atmo = null;
  if (!opts.noAtmo && (planet.pressure || 0) > 0.02 && app.shaderType !== 10) {
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(app.atmo) },
        uLightDir: { value: lightDir },
        uStrength: { value: clamp(0.28 + Math.log10(1 + (planet.pressure || 0)) * 0.38, 0.2, 1.0) },
      },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    atmo = new THREE.Mesh(new THREE.SphereGeometry(1.075, Math.max(32, seg / 2), Math.max(16, seg / 4)), atmoMat);
    atmo.renderOrder = 3;
    group.add(atmo);
  }

  let ring = null;
  if (app.hasRings) {
    const inner = 1.38;
    const outer = 2.25 + (app.seedFloat % 1) * 0.3;
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(app.ringColor) },
        uLightDir: { value: lightDir },
        uOpacity: { value: app.ringOpacity },
        uSeed: { value: app.seedFloat },
        uInner: { value: inner },
        uOuter: { value: outer },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 4), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.y = 0.15;
    ring.renderOrder = 4;
    const ringGroup = new THREE.Group();
    ringGroup.rotation.x = 0.32;
    ringGroup.rotation.z = 0.12;
    ringGroup.add(ring);
    group.add(ringGroup);
  }

  if (opts.hit) {
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), hitMat);
    hit.scale.setScalar(2.15);
    hit.userData.body = planet;
    group.add(hit);
    group.userData.hit = hit;
  }

  group.scale.setScalar(radius);
  if (planet.axialTilt) group.rotation.z = planet.axialTilt;
  group.userData.planet = planet;
  return { group, sphere, clouds, atmo, ring, mat, cloudMat, uniforms, lightDir, time, radius };
}

export function makeStarVisual(engine, star, opts = {}) {
  const group = new THREE.Group();
  const radius = opts.radius || star.displayRadius || 2.4;
  const color = new THREE.Color((star.appearance && star.appearance.color) || starColor(star.tempK || 6000));
  const type = star.starType;
  const time = opts.time || { value: 0 };
  const materials = [];
  let lensRadius = 0;

  if (type === 'BH') {
    const black = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.52, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    group.add(black);
    const diskMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color('#fff2d0') },
        uColorB: { value: new THREE.Color('#ff6a1e') },
        uTime: time,
        uSeed: { value: star.appearance?.seedFloat || 1.2 },
        uInner: { value: radius * 1.05 },
        uOuter: { value: radius * 3.2 },
      },
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(radius * 1.05, radius * 3.6, 160, 8), diskMat);
    disk.rotation.x = -Math.PI / 2 + 0.34;
    disk.rotation.z = 0.2;
    group.add(disk);
    materials.push(diskMat);
    const photon = makeSprite(glowTexture(), new THREE.Color('#ffd8a0'), radius * 3.2, 0.55);
    group.add(photon);
    const ring = makeSprite(glowTexture(), new THREE.Color('#ffd8a0'), radius * 2.9, 0.3);
    ring.material.blending = THREE.AdditiveBlending;
    group.add(ring);
    lensRadius = radius;
  } else if (type === 'PSR' || type === 'NS') {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.55, 32, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#eaf6ff'), toneMapped: false })
    );
    group.add(core);
    const glow = makeSprite(glowTexture(), new THREE.Color('#cfeaff'), radius * 9, 0.85);
    group.add(glow);
    if (type === 'PSR') {
      const beamMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#9fe4ff'),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Group();
      for (const sign of [1, -1]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.8, radius * 16, 24, 1, true), beamMat);
        cone.position.y = sign * radius * 8;
        cone.rotation.z = sign > 0 ? 0 : Math.PI;
        beam.add(cone);
      }
      beam.rotation.z = 0.45;
      group.add(beam);
      group.userData.beam = beam;
    }
  } else {
    const colA = color.clone().multiplyScalar(1.35);
    const colB = color.clone().lerp(new THREE.Color('#ffffff'), 0.3).multiplyScalar(1.25);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: colA },
        uColorB: { value: colB },
        uTime: time,
        uSeed: { value: star.appearance?.seedFloat || 1.0 },
        uType: { value: 0 },
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
    group.add(sphere);
    materials.push(mat);
    const corona = makeSprite(flareTexture(), color, radius * 4.2, 0.34);
    group.add(corona);
    const soft = makeSprite(glowTexture(), color, radius * 2.5, 0.36);
    group.add(soft);
    if (type === 'WR') {
      const wind = makeSprite(glowTexture(), new THREE.Color('#7fd4ff'), radius * 12, 0.2);
      group.add(wind);
    }
  }
  group.userData.star = star;
  return { group, radius, color, materials, time, lensRadius };
}

export function makeOrbitLine(radius, color = '#67e8ff', opacity = 0.16, inclination = 0, segments = 180) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius * Math.sin(inclination), Math.sin(a) * radius * Math.cos(inclination)));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity });
  return new THREE.Line(geo, mat);
}

export function disposeObject(root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture && v !== _glow && v !== _flare && v !== _selection) v.dispose();
        }
        m.dispose();
      }
    }
  });
}
