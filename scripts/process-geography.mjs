import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import OpenCC from 'opencc-js';

const [countriesPath, admin1Path, placesPath] = process.argv.slice(2);
if (!countriesPath || !admin1Path || !placesPath) {
  throw new Error('Usage: node scripts/process-geography.mjs <countries.geojson> <admin1.geojson> <places.geojson>');
}

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const continentNames = {
  Africa: '非洲', Antarctica: '南极洲', Asia: '亚洲', Europe: '欧洲',
  'North America': '北美洲', Oceania: '大洋洲', 'South America': '南美洲'
};

// Natural Earth uses "Seven seas (open ocean)" as a technical bucket for
// scattered oceanic territories. It is not a continent and must never become
// a user-facing geographic level. These overrides collapse the UN M49
// geographic regions into this project's seven-continent display model.
// Clipperton (CLP), which has no standalone M49 entry, is assigned by its
// physical location in the north-eastern Pacific, west of Mexico.
const openOceanContinentOverrides = {
  SGS: '南美洲',
  IOT: '非洲',
  SHN: '非洲',
  SYC: '非洲',
  MUS: '非洲',
  MDV: '亚洲',
  ATF: '非洲',
  HMD: '大洋洲',
  CLP: '北美洲'
};
const allowedContinents = new Set(Object.values(continentNames));

function resolveContinent(properties) {
  const upstreamName = properties.CONTINENT;
  const code = properties.ADM0_A3;
  const continent = upstreamName === 'Seven seas (open ocean)'
    ? openOceanContinentOverrides[code]
    : continentNames[upstreamName];
  if (!continent || !allowedContinents.has(continent)) {
    throw new Error(`Unresolved continent for ${code || properties.NAME || 'unknown area'}: ${upstreamName || '(missing)'}`);
  }
  return continent;
}

const readGeo = async path => JSON.parse(await readFile(path, 'utf8'));
const closeRing = ring => {
  if (!ring.length) return ring;
  const first = ring[0], last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};
function simplifyRing(ring, tolerance) {
  if (ring.length < 16) return closeRing(ring.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]));
  const result = [ring[0]];
  const threshold = tolerance * tolerance;
  for (let i = 1; i < ring.length - 1; i++) {
    const previous = result[result.length - 1], current = ring[i];
    const dx = current[0] - previous[0], dy = current[1] - previous[1];
    if (dx * dx + dy * dy >= threshold) result.push(current);
  }
  result.push(ring[ring.length - 1]);
  if (result.length < 4) return closeRing(ring);
  return closeRing(result.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]));
}
function polygonsOf(geometry, tolerance) {
  const source = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return source.map(polygon => polygon.map(ring => simplifyRing(ring, tolerance))).filter(polygon => polygon[0]?.length >= 4);
}
function bboxOf(polygons) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const polygon of polygons) for (const ring of polygon) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY].map(value => Number(value.toFixed(4)));
}
function normalizeName(value, fallback) { return toSimplified(value || fallback || '未命名地区'); }
function isCountryDuplicatePlaceholder(region, countryNames) {
  return countryNames.get(region.countryCode) === region.name && /-X\d+~$/.test(region.code);
}

const [countriesGeo, admin1Geo, placesGeo] = await Promise.all([readGeo(countriesPath), readGeo(admin1Path), readGeo(placesPath)]);
let countries = countriesGeo.features.map(feature => {
  const p = feature.properties;
    const polygons = polygonsOf(feature.geometry, 0.12);
  return {
    id: `country-${p.NE_ID}`,
    name: normalizeName(p.NAME_ZH, p.NAME),
    code: p.ADM0_A3,
    continent: resolveContinent(p),
    bbox: bboxOf(polygons), polygons
  };
});
const countryNames = new Map(countries.map(country => [country.code, country.name]));
const admin1 = admin1Geo.features.map(feature => {
  const p = feature.properties;
    const polygons = polygonsOf(feature.geometry, 0.14);
  return {
    id: `admin1-${p.ne_id}`,
    name: normalizeName(p.name_zh, p.name),
    code: p.iso_3166_2 || p.gn_a1_code || '',
    countryCode: p.adm0_a3,
    bbox: bboxOf(polygons), polygons
  };
}).filter(region => !isCountryDuplicatePlaceholder(region, countryNames));
const china = countries.find(country => country.code === 'CHN');
const taiwan = countries.find(country => country.code === 'TWN');
if (china && taiwan) {
  china.name = '中国';
  china.polygons.push(...taiwan.polygons);
  china.bbox = bboxOf(china.polygons);
  admin1.push({
    id: 'admin1-taiwan', name: '台湾省', code: 'CN-TW', countryCode: 'CHN',
    bbox: taiwan.bbox, polygons: taiwan.polygons
  });
  countries = countries.filter(country => country.code !== 'TWN');
}
const cities = placesGeo.features.map(feature => {
  const p = feature.properties;
  return {
    id: `ne-${p.NE_ID}`,
    name: normalizeName(p.NAME_ZH, p.NAMEASCII || p.NAME),
    countryCode: p.ADM0_A3 === 'TWN' ? 'CHN' : (p.ADM0_A3 || '---'),
    latitude: Number(feature.geometry.coordinates[1].toFixed(5)),
    longitude: Number(feature.geometry.coordinates[0].toFixed(5)),
    populationRank: Number(p.RANK_MAX || 0)
  };
});

const adminDirectory = 'public/assets/geography/admin1';
await rm(adminDirectory, { recursive: true, force: true });
await mkdir(adminDirectory, { recursive: true });
const adminByCountry = Map.groupBy(admin1, region => region.countryCode);
await Promise.all([
  writeFile('public/assets/geography/countries.json', JSON.stringify(countries)),
  ...countries.map(country => writeFile(`${adminDirectory}/${country.code}.json`, JSON.stringify(adminByCountry.get(country.code) ?? []))),
  writeFile('src/data/cities.json', JSON.stringify(cities))
]);
console.log(`Wrote ${countries.length} countries, ${admin1.length} admin-1 regions and ${cities.length} Chinese city names.`);
