import * as THREE from 'three';
import { makeRng, clamp, lerp, hashString } from './rng.js';
import { SKY_VERT, SKY_FRAG, WATER_VERT, WATER_FRAG, LAVA_FRAG } from './shaders.js';
import { makeBackground, makeSprite, glowTexture, flareTexture } from './visuals.js';
import { makeAppearance, starColor } from './procedural.js';

function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm2(x, y, seed, oct = 5) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, seed + i * 1013);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

function ridged2(x, y, seed, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, seed + i * 733) * 2 - 1);
    s += a * n * n;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}

function mixColor(a, b, t) {
  return a.clone().lerp(b, clamp(t, 0, 1));
}

export function buildSurface(engine, planet, system) {
  const scene = new THREE.Scene();
  const app = planet.appearance || makeAppearance(planet);
  const seed = hashString(`${planet.seed || planet.id}::surface`);
  const rng = makeRng(`${planet.seed || planet.id}::landing`);
  const isFrozen = app.shaderType === 3;
  const isLava = app.shaderType === 4;
  const isDesert = app.shaderType === 2;
  const isOcean = app.shaderType === 1;
  const isAirless = app.shaderType === 10;

  const atmoColor = new THREE.Color(app.atmo);
  const topColor = atmoColor.clone().multiplyScalar(isLava ? 0.18 : 0.34).lerp(new THREE.Color(isLava ? '#160504' : '#07142c'), isLava ? 0.55 : 0.42);
  const horizonColor = atmoColor.clone().multiplyScalar(0.95).lerp(new THREE.Color(isLava ? '#ff6a2a' : '#c8dff2'), isLava ? 0.42 : 0.3);
  const sunColor = new THREE.Color(starColor(system?.star?.tempK || 6000));
  const sunDir = new THREE.Vector3(0.58, 0.34, 0.74).normalize();

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: topColor },
      uHorizon: { value: horizonColor },
      uSunColor: { value: sunColor },
      uSunDir: { value: sunDir },
      uHaze: { value: isAirless ? 0.1 : 0.9 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3600, 48, 24), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  if (isAirless || (planet.pressure || 0) < 0.25) {
    makeBackground(engine, scene, 2600, 3200, `${planet.seed}::surface-stars`, { band: true, scale: 0.9 });
  }

  const sun = makeSprite(flareTexture(), sunColor, 34, 1.0);
  sun.position.copy(sunDir.clone().multiplyScalar(2800));
  scene.add(sun);
  const sunGlow = makeSprite(glowTexture(), sunColor, 110, 0.3);
  sunGlow.position.copy(sun.position);
  scene.add(sunGlow);

  // ---- terrain ----
  const size = 2600;
  const seg = engine.qualityName === 'low' ? 160 : engine.qualityName === 'high' ? 300 : 230;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const heightAt = (x, z) => {
    const base = fbm2(x * 0.0017, z * 0.0017, seed, 5);
    const detail = fbm2(x * 0.009, z * 0.009, seed + 9, 4);
    const ridge = ridged2(x * 0.0024, z * 0.0024, seed + 21, 4);
    let h = (base - 0.44) * 150 + ridge * 72 + (detail - 0.5) * 12;
    if (isFrozen) h = h * 0.62 + (detail - 0.5) * 18;
    if (isDesert) h = h * 0.7 + (ridge - 0.4) * 26;
    if (isOcean) h = h * 0.55 - 8;
    return h;
  };

  const centerH = heightAt(0, 0);
  // Ocean worlds need the camera just above a shoreline so the sea is visible;
  // dry worlds sit a little higher above their local ground.
  const offset = (isOcean || isFrozen) ? -centerH + 2.2 : isLava ? -centerH + 3.2 : 7 - centerH;
  const seaLevel = (isOcean || isFrozen) ? 0.15 : -1e9;
  const lavaLevel = 1.6;
  const positions = geo.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const cLow = new THREE.Color(app.baseA);
  const cMid = new THREE.Color(app.baseB);
  const cHigh = new THREE.Color(app.baseC);
  const cWater = new THREE.Color(app.water);
  const cIce = new THREE.Color(app.ice);
  const cSand = new THREE.Color(app.baseC).lerp(new THREE.Color('#d8c7a2'), 0.55);
  const cRock = new THREE.Color(app.baseC).multiplyScalar(0.62);

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const raw = heightAt(x, z);
    const h = raw + offset;
    positions.setY(i, h);
    const slope = Math.abs(heightAt(x + 4, z) - heightAt(x - 4, z)) + Math.abs(heightAt(x, z + 4) - heightAt(x, z - 4));
    const moisture = fbm2(x * 0.006 + 4, z * 0.006 - 3, seed + 55, 3);
    let c = cLow;
    if (isFrozen) {
      const crack = ridged2(x * 0.006, z * 0.006, seed + 77, 4);
      c = mixColor(cLow, cIce, clamp((h + 10) / 60, 0, 1));
      c = mixColor(c, cHigh, clamp(slope * 0.02, 0, 0.8));
      c = mixColor(c, new THREE.Color('#5b9fc4'), clamp(crack * 1.25 - 0.55, 0, 1) * 0.7);
    } else if (isLava) {
      const crack = ridged2(x * 0.006, z * 0.006, seed + 77, 4);
      c = mixColor(new THREE.Color('#171313'), new THREE.Color('#ff5a1e'), clamp(crack * 1.1 - 0.42, 0, 1));
      c = mixColor(c, cHigh, clamp(h / 120, 0, 0.5));
    } else if (isDesert) {
      c = mixColor(cLow, cMid, clamp((h + 20) / 70, 0, 1));
      c = mixColor(c, cHigh, clamp((h - 30) / 60, 0, 1) * 0.8);
      c = mixColor(c, cLow, clamp((moisture - 0.55) * 1.4, 0, 0.4));
    } else if (isOcean) {
      c = mixColor(cLow, cMid, clamp((h + 18) / 50, 0, 1));
      c = mixColor(c, cHigh, clamp((h - 28) / 60, 0, 1));
      // shoreline sand and exposed rock on steep slopes
      c = mixColor(c, cSand, clamp(1 - Math.abs(h - seaLevel) / 4.5, 0, 1) * 0.8);
      c = mixColor(c, cRock, clamp(1 - Math.abs(h - seaLevel - 0.55) / 0.9, 0, 1) * 0.45);
      c = mixColor(c, cRock, clamp(slope * 0.035, 0, 0.65));
      c = mixColor(c, cMid, clamp((moisture - 0.5) * 0.8, 0, 0.35));
    } else {
      const green = new THREE.Color(app.baseA).multiplyScalar(0.8 + moisture * 0.5);
      c = mixColor(green, cMid, clamp((h - 8) / 38, 0, 1) * 0.8);
      c = mixColor(c, cHigh, clamp((h - 42) / 50, 0, 1));
      c = mixColor(c, cLow, clamp((4 - h) / 20, 0, 1) * 0.55);
      if (h > 72) c = mixColor(c, cIce, clamp((h - 72) / 45, 0, 1));
    }
    const shade = 0.82 + 0.3 * fbm2(x * 0.02, z * 0.02, seed + 99, 2);
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: isFrozen ? 0.6 : isLava ? 1.0 : 0.95,
    metalness: isLava ? 0.15 : 0.02,
    emissive: isLava ? new THREE.Color('#ff3c08') : new THREE.Color('#000000'),
    emissiveIntensity: isLava ? 0.4 : 0,
  });
  const terrain = new THREE.Mesh(geo, terrainMat);
  scene.add(terrain);

  const hasWater = ['earth', 'ocean', 'jungle', 'tundra', 'eyeball', 'miniNeptune', 'frozen'].includes(planet.baseType || planet.type) || isFrozen;
  let waterMat = null;
  if (hasWater) {
    waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uWater: { value: new THREE.Color(isFrozen ? app.ice : app.water) },
        uSky: { value: horizonColor },
        uSunColor: { value: sunColor },
        uSunDir: { value: sunDir },
        uFogColor: { value: horizonColor },
        uFogNear: { value: 220 },
        uFogFar: { value: 1700 },
        uTime: { value: 0 },
      },
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(5600, 5600), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = seaLevel;
    water.renderOrder = 1;
    scene.add(water);
  } else if (isLava) {
    const lavaMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color('#1c0704') },
        uColorB: { value: new THREE.Color('#ff6a1a') },
        uFogColor: { value: horizonColor },
        uFogNear: { value: 180 },
        uFogFar: { value: 1600 },
        uTime: { value: 0 },
      },
      vertexShader: WATER_VERT,
      fragmentShader: LAVA_FRAG,
    });
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(5600, 5600), lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = lavaLevel;
    scene.add(lava);
    waterMat = lavaMat;
  }

  // rocks / vegetation
  {
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(isFrozen ? '#a8b8c0' : isLava ? '#241512' : app.baseC).multiplyScalar(isLava ? 1 : 0.55),
      roughness: 0.98,
    });
    const rockCount = isOcean ? 150 : isLava ? 170 : 110;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rockCount; i++) {
      const x = (rng() - 0.5) * 620;
      const z = (rng() - 0.5) * 620;
      const y = heightAt(x, z) + offset;
      if (y < seaLevel + 1.2) { dummy.scale.setScalar(0); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); continue; }
      dummy.position.set(x, y + 0.2, z);
      dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      const s = 0.4 + Math.pow(rng(), 2) * 3.4;
      dummy.scale.set(s, s * (0.6 + rng() * 0.8), s);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    scene.add(rocks);
  }

  if (['earth', 'jungle', 'tundra'].includes(planet.baseType || planet.type)) {
    const treeGeo = new THREE.ConeGeometry(1, 3, 6);
    const treeMat = new THREE.MeshStandardMaterial({
      color: planet.baseType === 'jungle' ? new THREE.Color('#2f6b2f') : new THREE.Color('#3e5d36'),
      roughness: 0.9,
    });
    const treeCount = 160;
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < treeCount; i++) {
      const x = (rng() - 0.5) * 500;
      const z = (rng() - 0.5) * 500;
      const y = heightAt(x, z) + offset;
      if (y < 3 || y > 70) { dummy.scale.setScalar(0); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix); continue; }
      dummy.position.set(x, y + 2.0, z);
      const s = 0.8 + rng() * 1.8;
      dummy.scale.set(s, s * (1.2 + rng() * 0.8), s);
      dummy.rotation.y = rng() * 3;
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    scene.add(trees);
  }

  const hemi = new THREE.HemisphereLight(horizonColor, new THREE.Color(app.baseA).multiplyScalar(0.4), 0.75);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(sunColor, 2.6);
  sunLight.position.copy(sunDir.clone().multiplyScalar(1000));
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x304050, 0.45));

  scene.fog = new THREE.Fog(horizonColor.clone().lerp(new THREE.Color('#ffffff'), 0.08), 220, 1700);

  // Pick a deterministic shoreline on ocean worlds so the first frame shows
  // water, sky and terrain together instead of an arbitrary green hillside.
  let startX = 0;
  let startZ = 0;
  let yaw = 0.7;
  if (isOcean || isFrozen || isLava) {
    const level = isLava ? lavaLevel : seaLevel;
    const margin = isLava ? -0.4 : 0.35;
    let best = -Infinity;
    for (let i = 0; i < 480; i++) {
      const x = (rng() * 2 - 1) * 540;
      const z = (rng() * 2 - 1) * 540;
      const h = heightAt(x, z) + offset;
      if (h < level + margin || h > level + 8) continue;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        let score = 0;
        for (const d of [10, 22, 42, 75, 120, 190]) {
          const hh = heightAt(x + dx * d, z + dz * d) + offset;
          score += hh < level ? (2.4 - d / 160) : -0.55;
        }
        score += (h - level) * 0.08;
        if (score > best) {
          best = score;
          startX = x;
          startZ = z;
          yaw = Math.atan2(-dx, -dz);
        }
      }
    }
  }
  const camY = heightAt(startX, startZ) + offset + 1.75;
  const controls = {
    mode: 'look',
    position: new THREE.Vector3(startX, camY, startZ),
    yaw,
    pitch: 0.015,
    minFov: 32,
    maxFov: 78,
  };

  const view = {
    scene,
    controls,
    labels: [],
    selectables: [],
    far: 9000,
    near: 0.1,
    fov: 62,
    sun: { getWorldPos: () => sun.position, intensity: 1 },
    lens: null,
    update: () => {
      if (waterMat) waterMat.uniforms.uTime.value = engine.simTime;
    },
    telemetry: () => ({
      altLabel: 'SURFACE ALTITUDE',
      altValue: '2.4 m',
      scale: '1 km',
      mode: 'SURFACE',
      detail: `${planet.name} · ${planet.classLabel || ''}`,
    }),
    zoomOut: () => engine.callbacks.onOrbitOut?.(planet),
    autopilot: () => {},
    getBody: () => null,
  };
  return view;
}
