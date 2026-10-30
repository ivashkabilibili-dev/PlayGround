import * as THREE from 'three';
import { makeRng, clamp } from './rng.js';
import { starColor, starDisplayRadius } from './procedural.js';
import { getObject } from './catalog.js';
import {
  makeBackground, makeGalaxyPoints, makePoints, makeSprite, glowTexture, flareTexture,
  makePlanetVisual, makeStarVisual, makeOrbitLine, selectionTexture,
} from './visuals.js';
import { NEBULA_VERT, NEBULA_FRAG } from './shaders.js';

const CYAN = '#6ee7ff';

function dirFromRaDec(raDeg, decDeg) {
  const ra = (raDeg || 0) * Math.PI / 180;
  const dec = (decDeg || 0) * Math.PI / 180;
  return new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.sin(dec), Math.cos(dec) * Math.sin(ra));
}

function nice(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  const v = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return v * p;
}

function fmt(n, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n).toLocaleString('en-US');
  if (n >= 100) return Math.round(n).toLocaleString('en-US');
  return n.toFixed(digits);
}

export function buildGalaxy(engine, galaxy) {
  const scene = new THREE.Scene();
  const seed = galaxy.seed || galaxy.id;
  const isAndromeda = galaxy.id === 'andromeda';
  const radius = 1150;
  makeBackground(engine, scene, engine.quality.bg * 1.4, 6500, `${seed}::bg`, { band: true, scale: 1.05 });

  const group = new THREE.Group();
  scene.add(group);
  const points = makeGalaxyPoints(engine, seed, isAndromeda ? engine.quality.galaxy * 0.7 : engine.quality.galaxy, {
    radius,
    arms: isAndromeda ? 2 : 4,
    spin: isAndromeda ? 2.6 : 3.4,
  });
  group.add(points);

  // flattened galactic haze, then the warm core
  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.55, radius * 2.55),
    new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: new THREE.Color(isAndromeda ? '#ffd7b0' : '#ffd9a8'),
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  haze.rotation.x = -Math.PI / 2;
  haze.position.y = -2;
  group.add(haze);
  const core = makeSprite(glowTexture(), new THREE.Color(isAndromeda ? '#ffe7c4' : '#ffd9a0'), radius * 0.52, 0.42);
  core.position.y = 0;
  group.add(core);
  const core2 = makeSprite(flareTexture(), new THREE.Color('#fff0d8'), radius * 0.32, 0.38);
  group.add(core2);

  // dust/nebula knots in the arms
  const rng = makeRng(`${seed}::knots`);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * (0.18 + rng() * 0.7);
    const cloud = makeSprite(glowTexture(), new THREE.Color(rng() < 0.5 ? '#ff7fb0' : '#69d8ff'), radius * (0.06 + rng() * 0.11), 0.12 + rng() * 0.12);
    cloud.position.set(Math.cos(a) * r, (rng() - 0.5) * 30, Math.sin(a) * r);
    group.add(cloud);
  }

  if (isAndromeda) {
    group.rotation.x = 1.02;
    group.rotation.z = 0.45;
    const companion = makeSprite(glowTexture(), new THREE.Color('#ffe4c0'), 90, 0.35);
    companion.position.set(-150, 40, 160);
    group.add(companion);
  }

  const sunAngle = 0.72;
  const sunPos = new THREE.Vector3(Math.cos(sunAngle) * 600, 8, Math.sin(sunAngle) * 600);
  const markers = [];

  // The local-bubble markers only make sense inside the Milky Way. Andromeda
  // gets its own clean, distant-galaxy view instead of Sol-era labels.
  if (!isAndromeda) {
    const markerObjs = [
      'sol', 'proxima-centauri', 'sirius', 'betelgeuse', 'rigel', 'vy-cma',
      'trappist-1', 'kepler-22', 'kepler-452', 'k2-18', 'toi-700',
      'orion-nebula', 'crab-pulsar', 'cygnus-x-1', 'wr-104',
    ];

    function place(obj) {
      if (obj.id === 'sol') return sunPos.clone();
      const d = Math.max(0, obj.distanceLy || 0);
      const dir = dirFromRaDec(obj.raDeg, obj.decDeg);
      const radial = 16 + 195 * Math.pow(Math.log10(1 + d) / Math.log10(9000), 0.92);
      return sunPos.clone().addScaledVector(dir, radial);
    }

    for (const id of markerObjs) {
      const obj = getObject(id);
      if (!obj) continue;
      const p = place(obj);
      const isSun = obj.id === 'sol';
      const col = isSun ? new THREE.Color('#ffd27a') : obj.kind === 'nebula' ? new THREE.Color('#ff8fbe') : new THREE.Color(starColor(obj.tempK || 6500));
      const sprite = makeSprite(glowTexture(), col, isSun ? 24 : 13, isSun ? 0.85 : 0.6);
      sprite.position.copy(p);
      group.add(sprite);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isSun ? 2.6 : 1.8, 8, 6),
        new THREE.MeshBasicMaterial({ color: col })
      );
      dot.position.copy(p);
      group.add(dot);
      const label = engine.addLabel(obj, () => p, {
        className: isSun ? 'galaxy-label sun-label' : 'galaxy-label',
        fade: 3000,
      });
      markers.push({ obj, p, label, sprite });
    }

    // local bubble / Orion spur indicator
    const bubblePts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      bubblePts.push(new THREE.Vector3(sunPos.x + Math.cos(a) * 120, 6, sunPos.z + Math.sin(a) * 120));
    }
    const bubble = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(bubblePts),
      new THREE.LineBasicMaterial({ color: new THREE.Color(CYAN), transparent: true, opacity: 0.16 })
    );
    group.add(bubble);
  }

  engine.addLabel(galaxy, () => new THREE.Vector3(0, 0, 0), { className: 'star-label', fade: 5000 });

  const controls = {
    mode: 'orbit',
    target: new THREE.Vector3(0, 0, 0),
    distance: isAndromeda ? 2900 : 2050,
    min: 360,
    max: isAndromeda ? 4200 : 3400,
    yaw: 0.85,
    pitch: isAndromeda ? 0.58 : 0.64,
    pitchMin: 0.06,
    pitchMax: 1.45,
  };

  const view = {
    scene,
    controls,
    labels: [],
    selectables: [],
    far: 20000,
    near: 1,
    sun: null,
    lens: null,
    update: (dt) => {
      points.rotation.y += dt * 0.002;
    },
    telemetry: () => {
      const alt = controls.distance * 45;
      return {
        altLabel: 'GALACTIC ALTITUDE',
        altValue: `${fmt(alt)} ly`,
        scale: `${fmt(nice(alt / 5))} ly`,
        mode: isAndromeda ? 'M31 · ANDROMEDA' : 'MILKY WAY',
        detail: `${fmt(galaxy.radiusLy)} ly across`,
      };
    },
    focusObject: (obj) => {
      const m = markers.find((x) => x.obj.id === obj.id);
      if (m) {
        controls.target.copy(m.p);
        controls.distance = Math.min(controls.distance, 680);
      }
    },
    dive: () => {
      if (engine.selected) engine.callbacks.onTravel?.(engine.selected);
    },
    getBody: () => null,
  };
  return view;
}

function makeNebulaPlane(engine, colors, size, opacity, seed, rng) {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colors[0]) },
      uColorB: { value: new THREE.Color(colors[1]) },
      uSeed: { value: seed },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
    },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  return mesh;
}

export function buildNebula(engine, nebula) {
  const scene = new THREE.Scene();
  const seed = nebula.seed || nebula.id;
  makeBackground(engine, scene, engine.quality.bg * 1.5, 5000, `${seed}::bg`, { band: true, scale: 1.2 });
  const rng = makeRng(`${seed}::clouds`);
  const time = { value: 0 };
  const clouds = [];
  const palettes = [
    ['#2b6f8f', '#d05a7a'], ['#1f8f8a', '#a85cff'], ['#3560a0', '#ff6f9e'],
    ['#4fb3b3', '#e88a52'], ['#6a4fa0', '#ff9a6a'],
  ];
  for (let i = 0; i < 26; i++) {
    const size = 120 + rng() * 280;
    const plane = makeNebulaPlane(engine, palettes[Math.floor(rng() * palettes.length)], size, 0.10 + rng() * 0.18, rng() * 12, rng);
    plane.position.set((rng() - 0.5) * 300, (rng() - 0.5) * 180, (rng() - 0.5) * 300);
    plane.userData.time = time;
    scene.add(plane);
    clouds.push(plane);
  }
  // dark dust lanes
  for (let i = 0; i < 7; i++) {
    const size = 180 + rng() * 240;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#06080d'),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    plane.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    plane.position.set((rng() - 0.5) * 240, (rng() - 0.5) * 120, (rng() - 0.5) * 240);
    scene.add(plane);
  }

  // embedded young cluster
  const clusterPos = [];
  const clusterCol = [];
  const clusterSize = [];
  for (let i = 0; i < 60; i++) {
    const p = new THREE.Vector3(rng.gauss() * 20, rng.gauss() * 14, rng.gauss() * 20);
    clusterPos.push(p.x, p.y, p.z);
    clusterCol.push(0.8 + rng() * 0.2, 0.86 + rng() * 0.14, 1.0);
    clusterSize.push(1.5 + rng() * 3.5);
  }
  const cluster = makePoints(engine, clusterPos, clusterCol, clusterSize, { scale: 1.1 });
  scene.add(cluster);
  const glow = makeSprite(flareTexture(), new THREE.Color('#ffd9e8'), 80, 0.4);
  scene.add(glow);
  const glow2 = makeSprite(glowTexture(), new THREE.Color('#6fe3ff'), 130, 0.22);
  scene.add(glow2);

  const controls = {
    mode: 'orbit',
    target: new THREE.Vector3(0, 0, 0),
    distance: 210,
    min: 42,
    max: 620,
    yaw: 0.45,
    pitch: 0.18,
    pitchMin: -1.2,
    pitchMax: 1.2,
  };

  const view = {
    scene,
    controls,
    labels: [],
    selectables: [],
    far: 10000,
    near: 0.05,
    sun: null,
    lens: null,
    time,
    update: (dt) => {
      time.value += dt;
      for (const c of clouds) c.material.uniforms.uTime.value = time.value;
      cluster.rotation.y += dt * 0.002;
    },
    telemetry: () => ({
      altLabel: 'NEBULA ALTITUDE',
      altValue: `${fmt(controls.distance * 0.18)} ly`,
      scale: `${fmt(nice(controls.distance * 0.04))} ly`,
      mode: 'DEEP SKY',
      detail: nebula.classLabel,
    }),
    getBody: () => null,
  };
  const labelObj = { ...nebula };
  engine.addLabel(labelObj, () => new THREE.Vector3(0, 0, 0), { className: 'star-label', fade: 2000 });
  return view;
}

export function buildSystem(engine, system, spec = {}) {
  const scene = new THREE.Scene();
  const seed = system.seed || system.star.seed;
  makeBackground(engine, scene, engine.quality.bg, 6500, `${seed}::bg`, { band: true, scale: 1.0 });
  scene.add(new THREE.AmbientLight(0x28384a, 0.55));
  const light = new THREE.PointLight(0xffffff, 2.8, 0, 0);
  scene.add(light);

  const time = { value: 0 };
  const starVis = makeStarVisual(engine, system.star, { time });
  scene.add(starVis.group);
  const starRadius = starVis.radius;

  const bodies = [];
  const orbitLines = [];
  const selectables = [];

  // orbital paths
  for (const p of system.planets) {
    const line = makeOrbitLine(p.orbitVisual, CYAN, 0.15, p.orbitInclination);
    scene.add(line);
    orbitLines.push(line);
  }

  // planets
  for (const p of system.planets) {
    const visualRadius = p.displayRadius * 1.85;
    const pv = makePlanetVisual(engine, p, {
      radius: visualRadius,
      segments: Math.max(40, Math.floor(engine.quality.seg * 0.65)),
      time,
      hit: true,
      lightDir: new THREE.Vector3(1, 0, 0),
    });
    scene.add(pv.group);
    if (pv.group.userData.hit) {
      engine.addSelectable(pv.group.userData.hit, p);
      selectables.push(pv.group.userData.hit);
    }
    const moons = [];
    for (const m of p.moonData || []) {
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 12),
        new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.95, metalness: 0.05 })
      );
      moon.scale.setScalar(m.radius);
      scene.add(moon);
      moons.push({ mesh: moon, data: m });
    }
    bodies.push({ planet: p, group: pv.group, vis: pv, radius: visualRadius, moons, orbitAngle: 0 });
    engine.addLabel(p, () => {
      const v = new THREE.Vector3(0, visualRadius * 1.4, 0);
      return pv.group.position.clone().add(v);
    }, { className: 'body-label', fade: 1800 });
  }

  // binary companion
  let companion = null;
  if (system.star.companion) {
    const c = system.star.companion;
    const compStar = {
      ...c,
      name: c.name,
      kind: 'star',
      id: `${system.star.id}-companion`,
      appearance: { color: starColor(c.tempK || 9000), seedFloat: 1.3 },
      displayRadius: starDisplayRadius(c),
    };
    const compVis = makeStarVisual(engine, compStar, { time, radius: starDisplayRadius(c) * 0.42 });
    scene.add(compVis.group);
    const orbitR = Math.max(40, (c.orbitAU || 1) * 18 + 28);
    const compOrbit = makeOrbitLine(orbitR, '#ffbf7a', 0.12, 0.18);
    scene.add(compOrbit);
    engine.addLabel(compStar, () => compVis.group.position.clone().add(new THREE.Vector3(0, compVis.radius * 1.8, 0)), { className: 'star-label', fade: 1600 });
    companion = { data: c, star: compStar, group: compVis.group, radius: orbitR, vis: compVis };
  }

  const sunWorld = new THREE.Vector3(0, 0, 0);
  const starObj = { ...system.star };

  function updateOrbits(dt) {
    for (const b of bodies) {
      const p = b.planet;
      const ang = p.orbitPhase + (engine.simTime / Math.max(0.1, p.periodDays)) * Math.PI * 2;
      b.orbitAngle = ang;
      const inc = p.orbitInclination || 0;
      const x = Math.cos(ang) * p.orbitVisual;
      const y = Math.sin(ang) * p.orbitVisual * Math.sin(inc);
      const z = Math.sin(ang) * p.orbitVisual * Math.cos(inc);
      b.group.position.set(x, y, z);
      const dir = new THREE.Vector3(-x, -y, -z).normalize();
      b.vis.uniforms.uLightDir.value.copy(dir);
      b.vis.lightDir.copy(dir);
      if (b.vis.cloudMat) b.vis.cloudMat.uniforms.uLightDir.value.copy(dir);
      const tidal = p.tidallyLocked;
      if (tidal) b.group.rotation.y = ang - Math.PI / 2;
      else b.group.rotation.y += dt * 0.08 * (engine.timeWarp || 1) * (p.spinSpeed || 0.1) * 8;
      if (b.vis.clouds) b.vis.clouds.rotation.y += dt * 0.01 * (engine.timeWarp || 1);
      for (const m of b.moons) {
        const ma = m.data.phase + (engine.simTime / m.data.period) * Math.PI * 2;
        const r = m.data.orbit;
        m.mesh.position.set(
          x + Math.cos(ma) * r,
          y + Math.sin(ma) * r * Math.sin(m.data.inclination),
          z + Math.sin(ma) * r * Math.cos(m.data.inclination)
        );
      }
    }
    if (companion) {
      const a = engine.simTime * 0.06;
      companion.group.position.set(Math.cos(a) * companion.radius, Math.sin(a) * companion.radius * 0.2, Math.sin(a) * companion.radius);
    }
    if (system.star.starType === 'PSR' && starVis.group.userData.beam) {
      starVis.group.userData.beam.rotation.y += dt * 2.0;
    }
  }

  const controls = {
    mode: 'orbit',
    target: new THREE.Vector3(0, 0, 0),
    distance: 70,
    min: 8,
    max: 320,
    yaw: 0.8,
    pitch: 0.24,
    pitchMin: -1.35,
    pitchMax: 1.35,
    follow: null,
  };

  const focusBodyRef = { body: null };

  function focusStar() {
    const outer = bodies.reduce((m, b) => Math.max(m, b.planet.orbitVisual || 0), 0);
    const ref = bodies[0];
    focusBodyRef.body = null;
    controls.follow = null;
    controls.target.set(0, 0, 0);
    controls.distance = clamp(Math.max(55, starRadius * 18, outer * 2.4 + 20, (companion?.radius || 0) * 2.4), 55, 1000);
    controls.min = Math.max(6, starRadius * 2.4);
    controls.max = Math.max(420, outer * 3.2, (companion?.radius || 0) * 3.4);
    controls.yaw = ref ? Math.atan2(ref.group.position.x, ref.group.position.z) + Math.PI * 0.55 : 0.8;
    controls.pitch = 0.22;
  }

  function focusPlanetBody(body, opts = {}) {
    focusBodyRef.body = body;
    controls.follow = () => body.group.position;
    controls.target.copy(body.group.position);
    controls.distance = body.radius * (opts.distanceFactor || 5.4);
    controls.min = body.radius * 2.15;
    controls.max = Math.max(60, body.radius * 34);
    if (opts.yaw !== undefined) controls.yaw = opts.yaw;
    else controls.yaw = Math.atan2(body.group.position.x, body.group.position.z) + 1.25;
    controls.pitch = opts.pitch ?? 0.14;
  }

  updateOrbits(0);

  if (spec.focusId) {
    const b = bodies.find((x) => x.planet.id === spec.focusId);
    if (b) focusPlanetBody(b, { yaw: Math.atan2(b.group.position.x, b.group.position.z) + 1.15, distanceFactor: 4.8 });
    else focusStar();
  } else if (spec.focusPlanet) {
    const b = bodies.find((x) => x.planet.id === spec.focusPlanet);
    if (b) focusPlanetBody(b);
    else focusStar();
  } else {
    // No explicit target: show the whole system with the star and orbits.
    focusStar();
  }

  const view = {
    scene,
    controls,
    labels: [],
    selectables,
    far: 12000,
    near: 0.01,
    time,
    sun: { getWorldPos: () => sunWorld, intensity: system.star.starType === 'BH' ? 0.4 : 0.9 },
    lens: system.star.starType === 'BH' ? { getWorldPos: () => sunWorld, radius: starRadius } : null,
    getBody: (obj) => bodies.find((b) => b.planet.id === obj.id) || null,
    focusObject: (obj) => {
      if (!obj) return;
      if (obj.kind === 'star' && obj.id === system.star.id) focusStar();
      else {
        const b = bodies.find((x) => x.planet.id === obj.id);
        if (b) focusPlanetBody(b);
      }
    },
    dive: () => {
      const b = focusBodyRef.body || bodies.find((x) => x.planet.id === engine.selected?.id);
      if (b) engine.callbacks.onDive?.(b.planet);
      else engine.callbacks.onStarDive?.(system.star);
    },
    zoomOut: () => {
      if (focusBodyRef.body) focusStar();
    },
    autopilot: (dt) => {
      const b = focusBodyRef.body;
      if (!b) return;
      controls.distance = Math.max(b.radius * 2.35, controls.distance * (1 - dt * 0.55));
      if (controls.distance <= b.radius * 2.4) {
        engine.autopilot = false;
        engine.callbacks.onAutopilotChange?.(false);
        engine.callbacks.onDive?.(b.planet);
      }
    },
    telemetry: () => {
      const b = focusBodyRef.body;
      if (b) {
        const km = b.planet.aAU * 149.6e6;
        return {
          altLabel: 'ORBITAL DISTANCE',
          altValue: `${b.planet.aAU.toFixed(3)} AU`,
          scale: `${fmt(nice(b.planet.aAU * 0.28))} AU`,
          mode: 'PLANETARY SYSTEM',
          detail: `${fmt(km)} km from ${system.star.name}`,
        };
      }
      return {
        altLabel: 'SYSTEM SCALE',
        altValue: `${fmt(controls.distance * 0.035)} AU`,
        scale: `${fmt(nice(controls.distance * 0.01))} AU`,
        mode: 'PLANETARY SYSTEM',
        detail: `${system.planets.length} worlds · ${system.star.spectral}`,
      };
    },
    update: (dt) => {
      updateOrbits(dt);
      starVis.group.rotation.y += dt * 0.01;
    },
  };

  engine.addLabel(system.star, () => new THREE.Vector3(0, starRadius * 1.35, 0), { className: 'star-label', fade: 2600 });
  return view;
}

export function buildPlanet(engine, planet, system) {
  const scene = new THREE.Scene();
  const seed = planet.seed || planet.id;
  makeBackground(engine, scene, engine.quality.bg * 1.25, 6000, `${seed}::sky`, { band: true, scale: 1.05 });
  const time = { value: 0 };
  const lightDir = new THREE.Vector3(0.72, 0.18, 0.62).normalize();
  const pv = makePlanetVisual(engine, planet, {
    radius: 1,
    segments: Math.max(64, engine.quality.seg),
    time,
    lightDir,
    hit: false,
  });
  scene.add(pv.group);

  // local star
  const starColorHex = system ? starColor(system.star.tempK || 6000) : '#fff0d0';
  const sunPos = lightDir.clone().multiplyScalar(55);
  const sun = makeSprite(flareTexture(), new THREE.Color(starColorHex), 5.5, 0.9);
  sun.position.copy(sunPos);
  scene.add(sun);
  const sunGlow = makeSprite(glowTexture(), new THREE.Color(starColorHex), 14, 0.28);
  sunGlow.position.copy(sunPos);
  scene.add(sunGlow);

  // moons
  const moons = [];
  const rng = makeRng(`${seed}::viewmoons`);
  const moonCount = Math.min(2, planet.moons || 0);
  for (let i = 0; i < moonCount; i++) {
    const r = 2.5 + i * 1.5;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.06 + rng() * 0.06, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xb0aca4, roughness: 0.95 })
    );
    m.userData.orbit = r;
    m.userData.phase = rng() * Math.PI * 2;
    m.userData.speed = 0.12 + rng() * 0.12;
    scene.add(m);
    moons.push(m);
  }
  scene.add(new THREE.PointLight(0xffffff, 1.6, 0, 0));
  scene.add(new THREE.AmbientLight(0x243040, 0.7));

  const aspect = engine.size?.h ? engine.size.w / engine.size.h : 1;
  const fitDistance = 3.2 / Math.max(0.72, Math.min(1, aspect * 1.35));
  const controls = {
    mode: 'orbit',
    target: new THREE.Vector3(0, 0, 0),
    distance: fitDistance,
    min: 1.045,
    max: 16,
    yaw: 0.72,
    pitch: 0.1,
    pitchMin: -1.35,
    pitchMax: 1.35,
  };
  let triggered = false;

  const view = {
    scene,
    controls,
    labels: [],
    selectables: [],
    far: 9000,
    near: 0.005,
    time,
    sun: { getWorldPos: () => sunPos, intensity: 1 },
    lens: null,
    update: (dt) => {
      if (planet.tidallyLocked) pv.group.rotation.y = 0;
      else pv.group.rotation.y += dt * 0.022 * (engine.timeWarp || 1);
      if (pv.clouds) pv.clouds.rotation.y += dt * 0.008 * (engine.timeWarp || 1);
      for (const m of moons) {
        const a = m.userData.phase + engine.simTime * m.userData.speed * 2;
        m.position.set(Math.cos(a) * m.userData.orbit, Math.sin(a) * m.userData.orbit * 0.18, Math.sin(a) * m.userData.orbit);
      }
      if (!triggered && controls.distance < 1.075) {
        triggered = true;
        engine.callbacks.onSurface?.(planet);
      }
      if (!triggered && controls.distance > 15.4) {
        triggered = true;
        engine.callbacks.onOrbitOut?.(planet);
      }
    },
    telemetry: () => {
      const radiusKm = planet.radiusEarth * 6371;
      const alt = Math.max(0, (controls.distance - 1) * radiusKm);
      return {
        altLabel: 'ALTITUDE',
        altValue: alt > 10000 ? `${fmt(alt / 1000)} thousand km` : `${fmt(alt)} km`,
        scale: `${fmt(nice(alt / 4 || 10))} km`,
        mode: 'ORBITAL VIEW',
        detail: `${fmt(radiusKm)} km radius · ${planet.classLabel || ''}`,
      };
    },
    dive: () => engine.callbacks.onSurface?.(planet),
    zoomOut: () => engine.callbacks.onOrbitOut?.(planet),
    autopilot: (dt) => {
      controls.distance = Math.max(1.09, controls.distance * (1 - dt * 0.35));
      if (controls.distance <= 1.1) {
        engine.autopilot = false;
        engine.callbacks.onAutopilotChange?.(false);
        engine.callbacks.onSurface?.(planet);
      }
    },
    getBody: () => null,
  };
  return view;
}
