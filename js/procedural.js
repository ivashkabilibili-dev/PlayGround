// Procedural star systems, planets and surface palettes.
// Pure deterministic functions: same seed -> same universe.

import { makeRng, clamp, lerp, hashString } from './rng.js';
import { getObject, getPlanets } from './catalog.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export const TYPE_LABELS = {
  lava: 'Volcanic lava world',
  scorched: 'Scorched rocky world',
  cratered: 'Cratered airless world',
  desert: 'Arid desert world',
  earth: 'Temperate terrestrial',
  ocean: 'Ocean world',
  jungle: 'Humid jungle world',
  tundra: 'Cold tundra world',
  frozen: 'Frozen ice world',
  rogue: 'Rogue planetary-mass object',
  carbon: 'Carbon world',
  iron: 'Iron world',
  superEarth: 'Super-Earth',
  miniNeptune: 'Mini-Neptune',
  gasGiant: 'Gas giant',
  hotJupiter: 'Hot Jupiter',
  iceGiant: 'Ice giant',
  brownDwarf: 'Brown dwarf',
  tidallyLocked: 'Tidally locked world',
  eyeball: 'Eyeball ocean world',
  ringed: 'Ringed world',
  binary: 'Binary planet',
};

// shaderType: 0 terrestrial, 1 ocean, 2 desert, 3 frozen, 4 lava,
// 5 gas, 6 ice giant, 7 brown dwarf, 8 carbon, 9 iron, 10 airless
const PALETTES = {
  earth: {
    baseA: '#2f5d3a', baseB: '#8a7a4b', baseC: '#d7d0b8', water: '#123c68',
    atmo: '#6fb6ff', cloud: '#f4f7ff', ice: '#e8f3ff', waterLevel: 0.5,
    cloudCover: 0.55, scale: 2.9, shaderType: 0, city: 1,
  },
  ocean: {
    baseA: '#1f5c52', baseB: '#6c8a62', baseC: '#cfd3b8', water: '#0b2f5c',
    atmo: '#66c6ff', cloud: '#f2f8ff', ice: '#dff0ff', waterLevel: 0.68,
    cloudCover: 0.68, scale: 2.4, shaderType: 1, city: 0,
  },
  jungle: {
    baseA: '#1f5730', baseB: '#4f7a2e', baseC: '#b8a865', water: '#163f52',
    atmo: '#8fe0b0', cloud: '#f2fff7', ice: '#e9f7ef', waterLevel: 0.47,
    cloudCover: 0.62, scale: 3.3, shaderType: 0, city: 0.25,
  },
  tundra: {
    baseA: '#5c6b5a', baseB: '#9a9a7a', baseC: '#e3e6da', water: '#1b3a50',
    atmo: '#9fd0ff', cloud: '#eef4ff', ice: '#f4f9ff', waterLevel: 0.46,
    cloudCover: 0.4, scale: 2.7, shaderType: 0, city: 0,
  },
  frozen: {
    baseA: '#a7c7d9', baseB: '#dbe9f0', baseC: '#ffffff', water: '#7fb4d4',
    atmo: '#b6e4ff', cloud: '#ffffff', ice: '#ffffff', waterLevel: 0.38,
    cloudCover: 0.3, scale: 2.2, shaderType: 3, city: 0,
  },
  desert: {
    baseA: '#9a5c2e', baseB: '#d09a5c', baseC: '#f0d5a6', water: '#5a7a78',
    atmo: '#f0b06a', cloud: '#f6e3c8', ice: '#f4ead8', waterLevel: 0.26,
    cloudCover: 0.12, scale: 3.4, shaderType: 2, city: 0,
  },
  lava: {
    baseA: '#1b1414', baseB: '#4a2418', baseC: '#7a3a22', water: '#ff4a12',
    atmo: '#ff6a2a', cloud: '#3a1a12', ice: '#ffb080', waterLevel: 0.12,
    cloudCover: 0.08, scale: 3.2, shaderType: 4, city: 0, emissive: 1,
  },
  scorched: {
    baseA: '#4a3a32', baseB: '#7a5a44', baseC: '#b08a66', water: '#5c3a28',
    atmo: '#c88a5a', cloud: '#5a4438', ice: '#e0d0b8', waterLevel: 0.1,
    cloudCover: 0.05, scale: 3.6, shaderType: 10, city: 0,
  },
  cratered: {
    baseA: '#4a4a4e', baseB: '#787878', baseC: '#b8b4ac', water: '#2e3236',
    atmo: '#9aa8b8', cloud: '#888888', ice: '#d8dce0', waterLevel: 0.05,
    cloudCover: 0.0, scale: 3.8, shaderType: 10, city: 0,
  },
  carbon: {
    baseA: '#16181a', baseB: '#383c40', baseC: '#767c80', water: '#0d0f10',
    atmo: '#6a7a8a', cloud: '#303438', ice: '#a8b0b4', waterLevel: 0.08,
    cloudCover: 0.1, scale: 3.1, shaderType: 8, city: 0,
  },
  iron: {
    baseA: '#5c2c1e', baseB: '#9a4a2c', baseC: '#d08a5c', water: '#3a1c12',
    atmo: '#c87a4a', cloud: '#4a2a1e', ice: '#e0b090', waterLevel: 0.06,
    cloudCover: 0.05, scale: 3.0, shaderType: 9, city: 0,
  },
  superEarth: {
    baseA: '#3a5a44', baseB: '#8a7a52', baseC: '#d8d0b8', water: '#164468',
    atmo: '#7cc4ff', cloud: '#f4f8ff', ice: '#e8f4ff', waterLevel: 0.5,
    cloudCover: 0.5, scale: 2.8, shaderType: 0, city: 0.18,
  },
  miniNeptune: {
    baseA: '#2a5f7a', baseB: '#4c8fa8', baseC: '#a8d4e0', water: '#1b4a6a',
    atmo: '#8fd8ff', cloud: '#e6f6ff', ice: '#d8f0ff', waterLevel: 0.9,
    cloudCover: 0.45, scale: 2.6, shaderType: 1, city: 0,
  },
  gasGiant: {
    baseA: '#b07a4c', baseB: '#e0c49a', baseC: '#6a4a32', water: '#8a5a3a',
    atmo: '#ffd8a8', cloud: '#fff0d8', ice: '#f0e0c8', waterLevel: 1.0,
    cloudCover: 0.0, scale: 2.0, shaderType: 5, city: 0, bands: 14,
  },
  hotJupiter: {
    baseA: '#3a1a1a', baseB: '#b04a24', baseC: '#f08a3c', water: '#7a2a14',
    atmo: '#ff8a4a', cloud: '#ffb080', ice: '#ffd0a0', waterLevel: 1.0,
    cloudCover: 0.0, scale: 1.8, shaderType: 5, city: 0, bands: 10,
  },
  iceGiant: {
    baseA: '#1e5f7a', baseB: '#5fb8d0', baseC: '#c8f0f8', water: '#1a4a6a',
    atmo: '#8fe8ff', cloud: '#e8ffff', ice: '#d8f8ff', waterLevel: 1.0,
    cloudCover: 0.0, scale: 1.7, shaderType: 6, city: 0, bands: 8,
  },
  brownDwarf: {
    baseA: '#2a1014', baseB: '#7a2a2a', baseC: '#c06a4a', water: '#4a1818',
    atmo: '#ff6a5a', cloud: '#5a2020', ice: '#e0a080', waterLevel: 1.0,
    cloudCover: 0.0, scale: 1.5, shaderType: 7, city: 0, bands: 9,
  },
  eyeball: {
    baseA: '#4a5a46', baseB: '#9a8a5e', baseC: '#e0d8c0', water: '#123c68',
    atmo: '#7cc8ff', cloud: '#f4f8ff', ice: '#e8f4ff', waterLevel: 0.56,
    cloudCover: 0.4, scale: 2.8, shaderType: 1, city: 0,
  },
};

const BASE_FOR_MODIFIER = {
  ringed: 'superEarth',
  binary: 'desert',
  tidallyLocked: 'eyeball',
  rogue: 'frozen',
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r, g, b) {
  const f = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function jitterHex(hex, rng, amount = 0.08) {
  const [r, g, b] = hexToRgb(hex);
  const k = 1 + (rng() * 2 - 1) * amount;
  return rgbToHex(r * k, g * (1 + (rng() * 2 - 1) * amount), b * (1 + (rng() * 2 - 1) * amount));
}

export function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}

export function starColor(tempK) {
  const t = clamp(tempK, 1800, 42000) / 100;
  let r;
  let g;
  let b;
  if (t <= 66) {
    r = 255;
    g = clamp(99.47 * Math.log(t) - 161.12, 0, 255);
    b = t <= 19 ? 0 : clamp(138.52 * Math.log(t - 10) - 305.04, 0, 255);
  } else {
    r = clamp(329.7 * Math.pow(t - 60, -0.1332), 0, 255);
    g = clamp(288.12 * Math.pow(t - 60, -0.0755), 0, 255);
    b = 255;
  }
  return rgbToHex(r, g, b);
}

function randomUnit(rng) {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(a) * r, z, Math.sin(a) * r];
}

export function makeAppearance(planet) {
  const rng = makeRng(`${planet.seed || planet.id}::look`);
  const baseKey = planet.baseType || BASE_FOR_MODIFIER[planet.type] || planet.type || 'cratered';
  const base = PALETTES[baseKey] || PALETTES.cratered;
  const p = { ...base };
  p.baseA = jitterHex(base.baseA, rng, 0.11);
  p.baseB = jitterHex(base.baseB, rng, 0.1);
  p.baseC = jitterHex(base.baseC, rng, 0.08);
  p.water = jitterHex(base.water, rng, 0.08);
  p.atmo = jitterHex(base.atmo, rng, 0.06);
  p.cloud = jitterHex(base.cloud, rng, 0.03);
  p.ice = jitterHex(base.ice, rng, 0.03);
  p.scale = base.scale * (0.85 + rng() * 0.35);
  p.waterLevel = clamp(base.waterLevel + (rng() * 2 - 1) * 0.035, 0.05, 0.92);
  p.cloudCover = clamp(base.cloudCover + (rng() * 2 - 1) * 0.12, 0, 0.85);
  p.city = base.city || 0;
  p.emissive = base.emissive || 0;
  p.bands = (base.bands || 0) + Math.floor(rng() * 5);
  p.shaderType = base.shaderType;
  p.cloudColor = p.cloud;
  p.ringColor = mixHex(p.baseB, '#d8c8a8', rng() * 0.6);
  p.ringOpacity = 0.35 + rng() * 0.5;
  if (planet.procedural !== true) {
    // Real catalogue worlds keep their observed (or unknown = absent) rings.
    p.hasRings = !!planet.rings;
  } else {
    p.hasRings = planet.rings || planet.type === 'ringed' || (rng() < 0.18 && !['gasGiant', 'iceGiant', 'hotJupiter', 'brownDwarf', 'miniNeptune'].includes(baseKey));
    if (['gasGiant', 'iceGiant', 'hotJupiter', 'brownDwarf'].includes(baseKey)) {
      p.hasRings = planet.rings || planet.type === 'ringed' || rng() < 0.55;
    }
  }
  if (planet.cityLights) p.city = 1;
  if (planet.type === 'eyeball' || planet.tidallyLocked) {
    p.waterLevel = clamp(p.waterLevel + 0.06, 0.1, 0.85);
    p.cloudCover = clamp(p.cloudCover * 0.7, 0, 0.6);
  }
  p.craters = [];
  if (p.shaderType === 10 || p.shaderType === 2 || p.shaderType === 3) {
    const n = p.shaderType === 10 ? 12 : 5;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = randomUnit(rng);
      p.craters.push({ x, y, z, r: 0.035 + rng() * (p.shaderType === 10 ? 0.11 : 0.05), d: 0.5 + rng() * 0.5 });
    }
  }
  p.volcanoes = [];
  if (p.shaderType === 4 || (p.shaderType === 10 && rng() < 0.4)) {
    for (let i = 0; i < 5; i++) {
      const [x, y, z] = randomUnit(rng);
      p.volcanoes.push({ x, y, z, r: 0.02 + rng() * 0.05 });
    }
  }
  p.seedFloat = (hashString(String(planet.seed || planet.id)) % 9973) / 97;
  return p;
}

const STAR_DEFS = [
  { type: 'M', w: 0.30, mass: [0.08, 0.55], radius: [0.1, 0.6], temp: [2400, 3900] },
  { type: 'K', w: 0.18, mass: [0.55, 0.85], radius: [0.6, 0.9], temp: [3900, 5200] },
  { type: 'G', w: 0.15, mass: [0.85, 1.15], radius: [0.9, 1.2], temp: [5200, 6000] },
  { type: 'F', w: 0.10, mass: [1.15, 1.6], radius: [1.2, 1.6], temp: [6000, 7500] },
  { type: 'A', w: 0.07, mass: [1.6, 2.5], radius: [1.6, 2.4], temp: [7500, 10000] },
  { type: 'B', w: 0.035, mass: [2.5, 15], radius: [2.4, 6], temp: [10000, 30000] },
  { type: 'O', w: 0.012, mass: [15, 60], radius: [6, 15], temp: [30000, 45000] },
  { type: 'BD', w: 0.03, mass: [0.013, 0.08], radius: [0.08, 0.12], temp: [800, 2400] },
  { type: 'WD', w: 0.025, mass: [0.5, 1.2], radius: [0.008, 0.015], temp: [6000, 40000] },
  { type: 'RG', w: 0.02, mass: [0.8, 2.5], radius: [8, 40], temp: [3200, 5000] },
  { type: 'RSG', w: 0.008, mass: [8, 25], radius: [200, 1200], temp: [3200, 4000] },
  { type: 'BSG', w: 0.006, mass: [15, 40], radius: [30, 100], temp: [10000, 20000] },
  { type: 'WR', w: 0.004, mass: [8, 20], radius: [1, 5], temp: [40000, 90000] },
  { type: 'NS', w: 0.003, mass: [1.2, 2.0], radius: [0.00001, 0.00002], temp: [500000, 1000000] },
  { type: 'PSR', w: 0.002, mass: [1.2, 2.2], radius: [0.00001, 0.00002], temp: [500000, 1000000] },
  { type: 'BH', w: 0.0015, mass: [5, 40], radius: [0, 0], temp: [0, 0] },
];

const STAR_PREFIXES = ['HD', 'HIP', 'GJ', 'TYC', 'TOI', 'K2', 'KOI', 'PSR'];
const STAR_NAMES = ['Aster', 'Caelum', 'Draconis', 'Erebus', 'Fenrir', 'Gliese', 'Helios', 'Icarus', 'Juno', 'Kepler', 'Lyra', 'Mira', 'Nyx', 'Orionis', 'Pavo', 'Quasar', 'Rhea', 'Sirrah', 'Titan', 'Umbriel', 'Vega', 'Wolf', 'Xenon', 'Yildun', 'Zephyr'];

function weightedPick(rng, defs) {
  const total = defs.reduce((s, d) => s + d.w, 0);
  let x = rng() * total;
  for (const d of defs) {
    x -= d.w;
    if (x <= 0) return d;
  }
  return defs[0];
}

function makeName(rng) {
  if (rng() < 0.38) return `${rng.pick(STAR_NAMES)} ${rng.int(2, 99)}`;
  const prefix = rng.pick(STAR_PREFIXES);
  if (prefix === 'PSR') return `PSR J${rng.int(1000, 2359)}+${rng.int(10, 69)}`;
  return `${prefix} ${rng.int(1000, 99999)}`;
}

export function generateStar(seed) {
  const rng = makeRng(`${seed}::star`);
  const def = weightedPick(rng, STAR_DEFS);
  const massSolar = rng.range(def.mass[0], def.mass[1]);
  const radiusSolar = rng.range(def.radius[0], def.radius[1]);
  const tempK = rng.range(def.temp[0], def.temp[1]);
  let lumSolar = 0;
  if (def.type === 'BH' || def.type === 'NS' || def.type === 'PSR') lumSolar = 0;
  else lumSolar = Math.pow(radiusSolar, 2) * Math.pow(tempK / 5772, 4);
  const name = makeName(rng);
  const id = `proc-${seed.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
  return {
    id,
    name,
    kind: 'star',
    procedural: true,
    seed,
    ra: `${String(rng.int(0, 23)).padStart(2, '0')}h ${String(rng.int(0, 59)).padStart(2, '0')}m ${String(rng.int(0, 59)).padStart(2, '0')}s`,
    dec: `${rng.chance(0.5) ? '+' : '−'}${String(rng.int(0, 89)).padStart(2, '0')}° ${String(rng.int(0, 59)).padStart(2, '0')}′`,
    distanceLy: Math.round(10 + Math.pow(rng(), 2.4) * 4200),
    spectral: def.type === 'G' ? `G${rng.int(0, 9)}V` : def.type,
    starType: def.type,
    massSolar,
    radiusSolar,
    tempK,
    lumSolar,
    aliases: [],
    planets: [],
    description: `A procedurally generated ${def.type}-type system. Every surface, orbit and atmosphere is reconstructed deterministically from seed ${seed}.`,
  };
}

const TERRESTRIAL = ['earth', 'ocean', 'jungle', 'tundra', 'desert', 'superEarth', 'eyeball'];
const BARREN = ['cratered', 'scorched', 'carbon', 'iron', 'lava'];
const GIANT = ['gasGiant', 'iceGiant', 'hotJupiter', 'miniNeptune'];

function choosePlanetType(rng, teq, a) {
  if (teq > 1100) return rng.chance(0.55) ? 'hotJupiter' : 'lava';
  if (teq > 700) return rng.chance(0.45) ? 'hotJupiter' : rng.chance(0.6) ? 'scorched' : 'lava';
  if (teq > 480) return rng.chance(0.35) ? 'miniNeptune' : rng.chance(0.5) ? 'desert' : 'scorched';
  if (teq > 330) return rng.chance(0.4) ? 'desert' : rng.chance(0.5) ? 'miniNeptune' : 'superEarth';
  if (teq > 255) {
    const r = rng();
    if (r < 0.22) return 'earth';
    if (r < 0.36) return 'ocean';
    if (r < 0.48) return 'jungle';
    if (r < 0.64) return 'superEarth';
    if (r < 0.8) return 'desert';
    return 'miniNeptune';
  }
  if (teq > 190) return rng.chance(0.3) ? 'tundra' : rng.chance(0.5) ? 'ocean' : 'frozen';
  if (a > 3 && rng.chance(0.5)) return rng.chance(0.6) ? 'iceGiant' : 'gasGiant';
  return rng.chance(0.55) ? 'frozen' : rng.chance(0.5) ? 'iceGiant' : 'cratered';
}

function makeProceduralPlanet(seed, star, a, index) {
  const rng = makeRng(`${seed}::planet::${index}`);
  const teq = star.lumSolar > 0 ? 278 * Math.pow(star.lumSolar, 0.25) / Math.sqrt(a) : 60;
  let type = choosePlanetType(rng, teq, a);
  if (a < 0.12 && rng.chance(0.55)) type = rng.chance(0.5) ? 'lava' : 'scorched';
  const giant = GIANT.includes(type);
  let radiusEarth;
  if (type === 'gasGiant' || type === 'hotJupiter') radiusEarth = 7 + rng() * 6;
  else if (type === 'iceGiant') radiusEarth = 3.2 + rng() * 2.4;
  else if (type === 'miniNeptune') radiusEarth = 1.8 + rng() * 1.4;
  else if (type === 'superEarth') radiusEarth = 1.25 + rng() * 1.2;
  else if (type === 'brownDwarf') radiusEarth = 8 + rng() * 3;
  else radiusEarth = 0.45 + rng() * 0.9;
  const massEarth = giant
    ? Math.pow(radiusEarth, 1.8) * (0.5 + rng() * 0.6)
    : Math.pow(radiusEarth, 2.6) * (0.7 + rng() * 0.6);
  const tidallyLocked = a < 0.18 || (a < 0.4 && rng.chance(0.3));
  const rings = (giant && rng.chance(0.5)) || rng.chance(0.1);
  const cityLights = ['earth', 'jungle'].includes(type) && teq > 240 && teq < 320 && rng.chance(0.22);
  const pressure = type === 'gasGiant' || type === 'iceGiant' || type === 'hotJupiter' ? 100 + rng() * 900 : type === 'frozen' || type === 'cratered' ? 0.02 + rng() * 0.2 : 0.2 + rng() * 2;
  const atmosphere =
    type === 'gasGiant' ? 'H₂ 90% · He 10%' :
    type === 'iceGiant' ? 'H₂ · He · CH₄' :
    type === 'hotJupiter' ? 'H₂ · He · silicates' :
    type === 'miniNeptune' ? 'H₂ · He · H₂O · CH₄' :
    type === 'lava' ? 'SO₂ · CO₂ · rock vapour' :
    type === 'frozen' ? 'N₂ · CH₄ · CO' :
    type === 'cratered' ? 'trace Na · O' :
    type === 'desert' ? 'CO₂ · N₂ · Ar' :
    type === 'earth' || type === 'jungle' ? 'N₂ · O₂ · H₂O' :
    type === 'ocean' || type === 'eyeball' ? 'N₂ · H₂O · CO₂' :
    'CO₂ · N₂ · Ar';
  let habitability = 0;
  if (TERRESTRIAL.includes(type)) {
    habitability = clamp(1 - Math.abs(teq - 288) / 130, 0.04, 0.94);
    if (type === 'eyeball') habitability += 0.04;
    if (tidallyLocked) habitability *= 0.86;
  }
  if (type === 'miniNeptune') habitability = 0.3;
  const periodDays = 365.25 * Math.pow(a, 1.5) / Math.sqrt(Math.max(star.massSolar, 0.08));
  const baseType = tidallyLocked ? (type === 'ocean' ? 'eyeball' : type) : type;
  const id = `${star.id}-${String.fromCharCode(98 + index)}`;
  return {
    id,
    name: `${star.name} ${String.fromCharCode(98 + index)}`,
    kind: 'planet',
    procedural: true,
    host: star.id,
    type: tidallyLocked ? 'tidallyLocked' : type,
    baseType,
    classLabel: tidallyLocked ? `Tidally locked ${TYPE_LABELS[type].toLowerCase()}` : TYPE_LABELS[type],
    radiusEarth,
    massEarth,
    periodDays,
    aAU: a,
    teqK: Math.round(teq),
    tempK: Math.round(teq * (type === 'gasGiant' ? 1.05 : 1.0)),
    atmosphere,
    pressure,
    habitability,
    rings,
    tidallyLocked,
    cityLights,
    seed: `${seed}::p${index}`,
    moons: giant ? Math.floor(rng() * 4) : rng.chance(0.25) ? 1 : 0,
    hostName: star.name,
    hostDistance: star.distanceLy,
    hostSpectral: star.spectral,
    description: `${TYPE_LABELS[type]} generated from seed ${seed}. Equilibrium temperature ${Math.round(teq)} K at ${a.toFixed(3)} AU.`,
  };
}

export function generateSystem(seed) {
  const star = generateStar(seed);
  const rng = makeRng(`${seed}::system`);
  const n = star.starType === 'BH' || star.starType === 'NS' || star.starType === 'PSR' ? rng.int(0, 2) : rng.int(1, 7);
  const planets = [];
  let a = 0.06 + rng() * 0.12;
  for (let i = 0; i < n; i++) {
    planets.push(makeProceduralPlanet(seed, star, a, i));
    a *= 1.45 + rng() * 0.75;
    if (a > 40) break;
  }
  return decorateSystem({ star, planets, seed, procedural: true });
}

export function decorateSystem(system) {
  const star = system.star;
  const planets = (system.planets || []).slice().sort((x, y) => x.aAU - y.aAU);
  const rng = makeRng(`${system.seed || star.seed}::decorate`);
  let prev = 0;
  const phaseBase = rng() * Math.PI * 2;
  planets.forEach((p, i) => {
    const raw = 12 + 40 * Math.log10(1 + p.aAU * 8);
    p.orbitVisual = Math.max(raw, prev + 3.35);
    prev = p.orbitVisual;
    p.orbitPhase = phaseBase + i * 1.9 + rng() * 0.5;
    p.orbitInclination = (rng() * 2 - 1) * 0.055;
    p.spinSpeed = 0.06 + rng() * 0.14;
    p.axialTilt = (rng() * 2 - 1) * 0.35;
    p.displayRadius = clamp(0.42 + 0.4 * Math.pow(p.radiusEarth, 0.52), 0.4, 2.5) * (GIANT.includes(p.baseType || p.type) ? 1.12 : 1);
    p.appearance = makeAppearance(p);
    p.moons = p.moons || 0;
    p.moonData = [];
    const mrng = makeRng(`${p.seed}::moons`);
    for (let m = 0; m < Math.min(p.moons, 4); m++) {
      p.moonData.push({
        seed: `${p.seed}::moon${m}`,
        orbit: p.displayRadius * (1.9 + m * 0.75),
        radius: p.displayRadius * (0.16 + mrng() * 0.14),
        period: 1.2 + mrng() * 4,
        phase: mrng() * Math.PI * 2,
        inclination: (mrng() * 2 - 1) * 0.35,
      });
    }
  });
  return {
    ...system,
    star: {
      ...star,
      displayRadius: starDisplayRadius(star),
      appearance: {
        color: starColor(star.tempK || 6000),
        corona: starColor((star.tempK || 6000) * 0.8),
        seedFloat: (hashString(String(star.seed || star.id)) % 9973) / 97,
      },
    },
    planets,
    planetById: new Map(planets.map((p) => [p.id, p])),
  };
}

export function starDisplayRadius(star) {
  switch (star.starType) {
    case 'O': return 4.0;
    case 'B': return 3.3;
    case 'A': return 2.9;
    case 'F': return 2.7;
    case 'G': return 2.6;
    case 'K': return 2.35;
    case 'M': return 2.1;
    case 'RSG': return 5.4;
    case 'BSG': return 4.6;
    case 'RG': return 3.8;
    case 'WR': return 3.2;
    case 'WD': return 1.5;
    case 'NS': return 0.8;
    case 'PSR': return 0.8;
    case 'BH': return 2.2;
    case 'BD': return 2.0;
    default: return 2.4;
  }
}

export function systemForStarId(id) {
  const star = getObject(id);
  if (!star || star.kind !== 'star') return null;
  const planets = getPlanets(id).map((p) => ({
    ...p,
    orbitVisual: 0,
    orbitPhase: 0,
    orbitInclination: 0,
    spinSpeed: 0.1,
    axialTilt: 0.2,
    displayRadius: 1,
    procedural: false,
    appearance: makeAppearance(p),
    moons: p.moons || 0,
    moonData: [],
  }));
  return decorateSystem({ star, planets, seed: star.seed, procedural: false });
}

export function systemForSeed(seed) {
  return generateSystem(seed);
}

export function getPlanetInSystem(system, id) {
  return system.planetById ? system.planetById.get(id) : system.planets.find((p) => p.id === id);
}

export function planetTypeLabel(p) {
  return p.classLabel || TYPE_LABELS[p.type] || 'Planetary body';
}

export function habitabilityLabel(v) {
  if (v >= 0.8) return 'HABITABLE';
  if (v >= 0.6) return 'PROMISING';
  if (v >= 0.35) return 'MARGINAL';
  if (v >= 0.1) return 'HOSTILE';
  return 'UNINHABITABLE';
}
