import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { geographyLevelLabel, placeDisplayLabel, placeKindLabel } from './adminLabels';
import { EARTH_RADIUS, latLonToVector3 } from './geo';
import { cityIndex, loadAdmin1, loadGeography, type GeographyIndex } from './geography';
import type { City, FocusTarget, GeographyLevel, HoverLocation, Place, PlaceKind, SavedPoint, TrajectoryStep } from './types';

interface SceneProps {
  points: SavedPoint[];
  archivedPlaceIds: string[];
  nationalityCountryCodes: string[];
  highlightedPlaces: Place[];
  trajectorySteps: TrajectoryStep[];
  interactionPaused: boolean;
  viewMode: 'globe' | 'map';
  archiveHoverActive: boolean;
  onAdd: (place: Place) => void;
  onViewArchives: (place: Place) => void;
  onViewNationalityTrajectory: (countryCode: string) => void;
  onMiss: () => void;
  onExplore: (message: string) => void;
  onFocus: (target: FocusTarget) => void;
  focusTarget: FocusTarget | null;
  onFocused: () => void;
  onReady: () => void;
  onHoverLocation: (location: HoverLocation | null) => void;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const levelFromZoom = (zoom: number): GeographyLevel => zoom < 2.2 ? 'continent' : zoom < 3.8 ? 'country' : zoom < 5.8 ? 'admin1' : 'city';
const nextZoom: Record<Exclude<GeographyLevel, 'city'>, number> = { continent: 3.05, country: 4.75, admin1: 6.6 };
const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });
let converterPromise: Promise<(value: string) => string> | undefined;

export function isCompactCountry(region: { bbox: [number, number, number, number] }) {
  const [west, south, east, north] = region.bbox;
  return east - west <= 4 && north - south <= 4;
}

function countryPlace(country: { code: string; name: string; continent?: string; bbox: [number, number, number, number] }): Place {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = country.bbox;
  return {
    id: `country-${country.code}`, name: country.name, kind: 'country', displayKind: '国家 / 地区', countryCode: country.code,
    latitude: (minLatitude + maxLatitude) / 2, longitude: (minLongitude + maxLongitude) / 2,
    parents: [country.continent].filter(Boolean) as string[], source: 'natural-earth'
  };
}

function graticuleCollection(step = 15) {
  const features: any[] = [];
  for (let longitude = -180; longitude <= 180; longitude += step) {
    const coordinates = [];
    for (let latitude = -85; latitude <= 85; latitude += 2) coordinates.push([longitude, latitude]);
    features.push({ type: 'Feature', properties: { major: longitude === 0 ? 1 : 0 }, geometry: { type: 'LineString', coordinates } });
  }
  for (let latitude = -75; latitude <= 75; latitude += step) {
    const coordinates = [];
    for (let longitude = -180; longitude <= 180; longitude += 2) coordinates.push([longitude, latitude]);
    features.push({ type: 'Feature', properties: { major: latitude === 0 ? 1 : 0 }, geometry: { type: 'LineString', coordinates } });
  }
  return { type: 'FeatureCollection', features };
}

function placeKind(value: string): PlaceKind | null {
  if (value === 'country') return 'country';
  if (value === 'state' || value === 'province') return 'province';
  if (value === 'island') return 'island';
  if (value === 'county') return 'county';
  if (['borough', 'suburb', 'quarter', 'neighbourhood'].includes(value)) return 'district';
  if (value === 'city') return 'city';
  if (value === 'town') return 'town';
  if (['village', 'hamlet', 'isolated_dwelling'].includes(value)) return 'village';
  return null;
}

async function simplifiedName(properties: Record<string, unknown>) {
  const hans = properties['name:zh-Hans'] ?? properties.name_zh_Hans;
  if (typeof hans === 'string' && hans.trim()) return hans.trim();
  const zh = properties['name:zh'] ?? properties.name_zh;
  const original = typeof properties.name === 'string' ? properties.name.trim() : '';
  const candidate = typeof zh === 'string' && zh.trim() ? zh.trim() : original;
  if (!candidate || !/[\u3400-\u9fff]/u.test(candidate)) return candidate;
  converterPromise ??= import('opencc-js').then(module => module.default.Converter({ from: 'tw', to: 'cn' }));
  try { return (await converterPromise)(candidate); } catch { return candidate; }
}

function chineseStyle(style: any) {
  style.projection = { type: 'globe' };
  style.sky = {
    'sky-color': 'rgba(244,241,234,0)',
    'horizon-color': 'rgba(126,118,92,0.20)',
    'sky-horizon-blend': 0.035,
    'horizon-fog-blend': 0.08,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.11, 6, 0.035, 9, 0]
  };
  const unwanted = /(building|poi_|poi$|landuse_residential|service_track|path_pedestrian|road_minor|street_casing|road_street|one_way_arrow|transit_rail|road_area)/;
  const taiwanNames = ['Taiwan', '台湾', '臺灣', 'Taiwan Province of China'];
  for (const layer of style.layers ?? []) {
    layer.layout ??= {};
    layer.paint ??= {};
    if (layer.id === 'background') layer.paint['background-opacity'] = 0;
    if (unwanted.test(layer.id) || layer.type === 'fill-extrusion' || layer.id === 'boundary_disputed') layer.layout.visibility = 'none';
    if (layer.type === 'symbol' && layer.layout['text-field']) {
      layer.layout['text-field'] = [
        'case',
        ['==', ['get', 'iso_a2'], 'TW'], '台湾省',
        ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name_zh_Hans'], ['get', 'name:zh'], ['get', 'name_zh'], ['get', 'name']]
      ];
      layer.paint['text-color'] = '#3f3528';
      layer.paint['text-halo-color'] = 'rgba(244,241,234,0.86)';
      layer.paint['text-halo-width'] = 1.1;
      layer.paint['text-halo-blur'] = 0.4;
      if (layer['source-layer'] === 'place') {
        layer.layout.visibility = 'visible';
      }
    }
    if (layer.id === 'natural_earth') {
      delete layer.maxzoom;
      layer.minzoom = 0;
      layer.paint['raster-opacity'] = 1;
      layer.paint['raster-brightness-min'] = 0.40;
      layer.paint['raster-brightness-max'] = 0.88;
      layer.paint['raster-contrast'] = -0.06;
      layer.paint['raster-saturation'] = -0.76;
      layer.paint['raster-hue-rotate'] = 28;
    }
    if (/^(park|landcover_|landuse_)/.test(layer.id) && layer.type === 'fill') {
      layer.paint['fill-opacity'] = 0.20;
      layer.paint['fill-color'] = '#a89f80';
    }
    if (layer.id === 'water') {
      layer.paint['fill-color'] = '#a8b2aa';
      layer.paint['fill-opacity'] = 1;
    }
    if (/boundary/.test(layer.id) && layer.type === 'line') {
      layer.paint['line-color'] = '#706a56';
      layer.paint['line-opacity'] = 0.26;
    }
  }
  return style;
}

function pointFeature(place: Place) {
  return { type: 'Feature', properties: { id: place.id, name: place.name, kind: place.kind }, geometry: { type: 'Point', coordinates: [place.longitude, place.latitude] } };
}

function highlightLineFeature(places: Place[]) {
  if (places.length < 2) return emptyCollection();
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: places.map(place => [place.longitude, place.latitude]) } }] };
}

export function greatCircleCoordinates(origin: Place, destination: Place, samples = 120) {
  const radians = Math.PI / 180;
  const startLatitude = origin.latitude * radians;
  const startLongitude = origin.longitude * radians;
  const endLatitude = destination.latitude * radians;
  const endLongitude = destination.longitude * radians;
  const start = [Math.cos(startLatitude) * Math.cos(startLongitude), Math.cos(startLatitude) * Math.sin(startLongitude), Math.sin(startLatitude)];
  const end = [Math.cos(endLatitude) * Math.cos(endLongitude), Math.cos(endLatitude) * Math.sin(endLongitude), Math.sin(endLatitude)];
  const angle = Math.acos(Math.max(-1, Math.min(1, start[0] * end[0] + start[1] * end[1] + start[2] * end[2])));
  if (angle < 1e-7) return [[origin.longitude, origin.latitude], [destination.longitude, destination.latitude]];
  const sine = Math.sin(angle);
  return Array.from({ length: samples + 1 }, (_, index) => {
    const progress = index / samples;
    const startWeight = Math.sin((1 - progress) * angle) / sine;
    const endWeight = Math.sin(progress * angle) / sine;
    const x = startWeight * start[0] + endWeight * end[0];
    const y = startWeight * start[1] + endWeight * end[1];
    const z = startWeight * start[2] + endWeight * end[2];
    return [Math.atan2(y, x) / radians, Math.atan2(z, Math.hypot(x, y)) / radians];
  });
}

export function splitAntimeridian(coordinates: number[][]) {
  if (coordinates.length < 2) return coordinates.length === 0 ? [] : [[coordinates[0].slice()]];
  const segments: number[][][] = [];
  let segment = [coordinates[0].slice()];
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const longitudeDelta = current[0] - previous[0];
    if (Math.abs(longitudeDelta) <= 180) {
      segment.push(current.slice());
      continue;
    }
    const crossingLongitude = longitudeDelta < -180 ? 180 : -180;
    const unwrappedLongitude = current[0] + (longitudeDelta < -180 ? 360 : -360);
    const crossingProgress = (crossingLongitude - previous[0]) / (unwrappedLongitude - previous[0]);
    const crossingLatitude = previous[1] + (current[1] - previous[1]) * crossingProgress;
    segment.push([crossingLongitude, crossingLatitude]);
    segments.push(segment);
    segment = [[-crossingLongitude, crossingLatitude], current.slice()];
  }
  segments.push(segment);
  return segments.filter(part => part.length >= 2);
}

export function planarCoordinates(origin: Place, destination: Place, samples = 120) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const progress = index / samples;
    return [
      origin.longitude + (destination.longitude - origin.longitude) * progress,
      origin.latitude + (destination.latitude - origin.latitude) * progress
    ];
  });
}

export function trajectoryLegCoordinates(steps: TrajectoryStep[], samples = 120, viewMode: 'globe' | 'map' = 'globe') {
  if (steps.length < 2) return [];
  const origin = steps[0].place;
  const coordinateBuilder = viewMode === 'globe' ? greatCircleCoordinates : planarCoordinates;
  return steps.slice(1).map(step => coordinateBuilder(origin, step.place, samples));
}

function partialArc(coordinates: number[][], progress: number) {
  const bounded = Math.max(0, Math.min(1, progress));
  if (bounded >= 1) return coordinates.map(point => [...point]);
  const position = bounded * (coordinates.length - 1);
  const index = Math.floor(position);
  const fraction = position - index;
  const result = coordinates.slice(0, index + 1).map(point => [...point]);
  const current = coordinates[index];
  const next = coordinates[Math.min(index + 1, coordinates.length - 1)];
  result.push([current[0] + (next[0] - current[0]) * fraction, current[1] + (next[1] - current[1]) * fraction]);
  return result;
}

function trajectoryGeometry(map: any, steps: TrajectoryStep[], progress: number, viewMode: 'globe' | 'map') {
  if (steps.length < 2 || progress <= 0) return { lines: emptyCollection(), arrows: emptyCollection() };
  const lines: any[] = [];
  const arrows: any[] = [];
  const legCoordinates = trajectoryLegCoordinates(steps, 120, viewMode);
  steps.slice(1).forEach((step, index) => {
    const rawProgress = Math.max(0, Math.min(1, progress - index));
    const legProgress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    if (legProgress <= 0) return;
    const coordinates = partialArc(legCoordinates[index], legProgress);
    if (coordinates.length < 2) return;
    let head = coordinates[coordinates.length - 1];
    const previous = coordinates[coordinates.length - 2];
    let headPoint = map.project(head);
    const previousLongitude = viewMode === 'globe'
      ? head[0] + ((((previous[0] - head[0]) + 540) % 360) - 180)
      : previous[0];
    const previousPoint = map.project([previousLongitude, previous[1]]);
    const distance = Math.hypot(headPoint.x - previousPoint.x, headPoint.y - previousPoint.y) || 1;
    const unitX = (headPoint.x - previousPoint.x) / distance;
    const unitY = (headPoint.y - previousPoint.y) / distance;
    if (legProgress >= 1) {
      headPoint = { x: headPoint.x - unitX * 14, y: headPoint.y - unitY * 14 };
      const offset = map.unproject([headPoint.x, headPoint.y]);
      head = [((offset.lng + 180) % 360 + 360) % 360 - 180, offset.lat];
      coordinates[coordinates.length - 1] = head;
    }
    const segments = viewMode === 'globe' ? splitAntimeridian(coordinates) : [coordinates];
    lines.push({
      type: 'Feature',
      properties: {},
      geometry: segments.length === 1
        ? { type: 'LineString', coordinates: segments[0] }
        : { type: 'MultiLineString', coordinates: segments }
    });
    arrows.push({ type: 'Feature', properties: { bearing: Math.atan2(unitY, unitX) * 180 / Math.PI }, geometry: { type: 'Point', coordinates: head } });
  });
  return { lines: { type: 'FeatureCollection', features: lines }, arrows: { type: 'FeatureCollection', features: arrows } };
}

function trajectoryDateCollection(steps: TrajectoryStep[], visibleCount: number, viewMode: 'globe' | 'map') {
  if (visibleCount < 2) return emptyCollection();
  const origin = steps[0].place;
  const coordinateBuilder = viewMode === 'globe' ? greatCircleCoordinates : planarCoordinates;
  return { type: 'FeatureCollection', features: steps.slice(1, visibleCount).flatMap(step => {
    if (!(step.label ?? step.start)) return [];
    const arc = coordinateBuilder(origin, step.place, 40);
    return [{ type: 'Feature', properties: { label: step.label ?? step.start }, geometry: { type: 'Point', coordinates: arc[Math.floor(arc.length / 2)] } }];
  }) };
}

function regionFeature(region: { id: string; name: string; polygons: number[][][][] }) {
  return { type: 'Feature', properties: { id: region.id, name: region.name }, geometry: { type: 'MultiPolygon', coordinates: region.polygons } };
}

function cityTrail(geography: GeographyIndex, city: City, fallback: ReturnType<GeographyIndex['lookup']>) {
  const specialAdministrativeRegion: Record<string, string> = { HKG: '香港特别行政区', MAC: '澳门特别行政区' };
  if (city.countryCode in specialAdministrativeRegion) {
    const china = geography.countryByCode('CHN') ?? fallback.country;
    return [china?.continent ?? '亚洲', china?.name ?? '中国', specialAdministrativeRegion[city.countryCode]];
  }
  const country = geography.countryByCode(city.countryCode) ?? fallback.country;
  if (country?.code === 'SGP') return [country.continent, country.name].filter(Boolean) as string[];
  const admin1 = geography.admin1At(country?.code ?? city.countryCode, city.latitude, city.longitude) ??
    geography.admin1NearCoast(country?.code ?? city.countryCode, city.latitude, city.longitude) ??
    fallback.admin1;
  return [country?.continent, country?.name, admin1?.name].filter(Boolean) as string[];
}

interface PlaceSelection { place: Place; x: number; y: number; zoom: number }

export function EarthScene({ points, archivedPlaceIds, nationalityCountryCodes, highlightedPlaces, trajectorySteps, interactionPaused, viewMode, archiveHoverActive, onAdd, onViewArchives, onViewNationalityTrajectory, onMiss, onExplore, onFocus, focusTarget, onFocused, onReady, onHoverLocation }: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const geographyRef = useRef<GeographyIndex | null>(null);
  const [hover, setHover] = useState<{ location: HoverLocation; x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<PlaceSelection | null>(null);
  const [globeVeil, setGlobeVeil] = useState({ x: 0, y: 0, radius: 0 });
  const lastMove = useRef(0);
  const callbacks = useRef({ onAdd, onViewArchives, onViewNationalityTrajectory, onMiss, onExplore, onFocus, onFocused, onReady, onHoverLocation });
  callbacks.current = { onAdd, onViewArchives, onViewNationalityTrajectory, onMiss, onExplore, onFocus, onFocused, onReady, onHoverLocation };
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const autoRotationPaused = useRef(interactionPaused || archiveHoverActive || Boolean(focusTarget));
  autoRotationPaused.current = interactionPaused || archiveHoverActive || Boolean(focusTarget);

  const nearestCity = useCallback((map: any, longitude: number, latitude: number, x: number, y: number) => {
    const candidates = cityIndex.nearest(latLonToVector3(latitude, longitude), 8);
    const threshold = matchMedia('(pointer: coarse)').matches ? 86 : 72;
    let best: { city: City; distance: number } | null = null;
    for (const city of candidates) {
      const screen = map.project([city.longitude, city.latitude]);
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance <= threshold && (!best || distance < best.distance)) best = { city, distance };
    }
    return best?.city ?? null;
  }, []);

  const describe = useCallback((map: any, longitude: number, latitude: number, x: number, y: number): HoverLocation | null => {
    const geography = geographyRef.current;
    if (!geography) return null;
    const level = levelFromZoom(map.getZoom());
    let regions = geography.lookup(latitude, longitude);
    if (!regions.country) return null;
    const position = latLonToVector3(latitude, longitude, EARTH_RADIUS).toArray() as [number, number, number];
    if (level === 'city') {
      const city = nearestCity(map, longitude, latitude, x, y);
      if (city) {
        return { level, label: '城市', title: city.name, trail: cityTrail(geography, city, regions), position, city };
      }
      if (regions.admin1) return { level: 'admin1', label: geographyLevelLabel('admin1', regions.country.code), title: regions.admin1.name, trail: [regions.country.continent, regions.country.name].filter(Boolean) as string[], position };
    }
    if (level === 'admin1' && regions.admin1) return { level, label: geographyLevelLabel(level, regions.country.code), title: regions.admin1.name, trail: [regions.country.continent, regions.country.name].filter(Boolean) as string[], position };
    if (level === 'continent') return { level, label: geographyLevelLabel(level, regions.country.code), title: regions.country.continent ?? '未知大洲', trail: [], position };
    return { level: 'country', label: geographyLevelLabel('country', regions.country.code), title: regions.country.name, trail: [regions.country.continent].filter(Boolean) as string[], position };
  }, [nearestCity]);

  const toPlace = useCallback(async (feature: any, longitude: number, latitude: number): Promise<Place | null> => {
    const properties = feature.properties ?? {};
    const kind = placeKind(String(properties.placeClass ?? properties.class ?? ''));
    if (!kind) return null;
    const name = await simplifiedName(properties);
    if (!name) return null;
    const originalName = typeof properties.originalName === 'string' ? properties.originalName : typeof properties.name === 'string' ? properties.name : name;
    const geography = geographyRef.current;
    let regions = geography?.lookup(latitude, longitude);
    if (geography && regions?.country) {
      await loadAdmin1(geography, regions.country.code).catch(() => []);
      regions = geography.lookup(latitude, longitude);
    }
    const admin1 = kind !== 'country' && geography && regions?.country ? regions.admin1 ??
      geography.admin1NearCoast(regions.country.code, latitude, longitude) : undefined;
    const parents = [regions?.country?.continent, regions?.country?.name, admin1?.name].filter(value => value && value !== name) as string[];
    const rawId = properties.sourceId ?? feature.id ?? `${originalName}-${longitude.toFixed(4)}-${latitude.toFixed(4)}`;
    const countryCode = kind === 'country' ? String(properties.iso_a3 ?? properties.iso_a2 ?? regions?.country?.code ?? '') : regions?.country?.code;
    return { id: `osm-${kind}-${rawId}`, name, originalName: originalName !== name ? originalName : undefined, kind, displayKind: placeKindLabel(kind, countryCode), countryCode, latitude, longitude, parents, source: 'openstreetmap' };
  }, []);

  const completePlaceHierarchy = useCallback(async (place: Place, map: any, x: number, y: number) => {
    if (place.parents.length >= 3 && place.countryCode) return place;
    const geography = geographyRef.current;
    if (!geography) return place;
    const nearest = nearestCity(map, place.longitude, place.latitude, x, y);
    const lookupLatitude = nearest?.name === place.name ? nearest.latitude : place.latitude;
    const lookupLongitude = nearest?.name === place.name ? nearest.longitude : place.longitude;
    const country = geography.lookup(lookupLatitude, lookupLongitude).country ??
      geography.countryByCode(nearest?.countryCode) ??
      geography.countryByCode(place.countryCode);
    if (!country) return place;
    await loadAdmin1(geography, country.code).catch(() => []);
    const admin1 = place.kind === 'country' ? undefined : geography.admin1At(country.code, lookupLatitude, lookupLongitude) ??
      geography.admin1NearCoast(country.code, lookupLatitude, lookupLongitude);
    const parents = [country.continent, country.name, admin1?.name]
      .filter((value): value is string => Boolean(value) && value !== place.name);
    return { ...place, countryCode: country.code, parents };
  }, [nearestCity]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let map: any;
    let markerAnimation = 0;
    let lastMarkerFrame = 0;
    let lastRotationFrame = 0;
    let lastRotationUpdate = 0;
    let userInteracting = false;
    let resumeRotationAt = 0;
    let hoverRegionKey = '';
    Promise.all([fetch(STYLE_URL).then(response => response.json()), loadGeography()]).then(([style, geography]) => {
      if (disposed || !containerRef.current) return;
      geographyRef.current = geography;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: chineseStyle(style),
        center: [-90, 18], zoom: matchMedia('(max-width: 600px)').matches ? 1.18 : 2.02,
        minZoom: 0.55, maxZoom: 11, maxPitch: 0,
        renderWorldCopies: false,
        projection: { type: viewModeRef.current === 'globe' ? 'globe' : 'mercator' },
        canvasContextAttributes: { alpha: true, antialias: true },
        dragRotate: false, pitchWithRotate: false,
        dragPan: { linearity: 0.18, maxSpeed: 900, deceleration: 2500 },
        attributionControl: true
      });
      mapRef.current = map;
      map.on('load', () => {
        if (disposed) return;
        map.setRenderWorldCopies(false);
        map.setProjection({ type: viewModeRef.current === 'globe' ? 'globe' : 'mercator' });
        const firstSymbol = map.getStyle().layers.find((layer: any) => layer.type === 'symbol')?.id;
        map.addSource('archive-land', { type: 'geojson', data: { type: 'FeatureCollection', features: geography.countryFeatures() } });
        map.addLayer({ id: 'archive-land-wash', type: 'fill', source: 'archive-land', paint: { 'fill-color': '#b3a683', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.52, 5, 0.32, 8, 0.12] } }, firstSymbol);
        map.addSource('archive-graticule', { type: 'geojson', data: graticuleCollection() });
        map.addLayer({ id: 'archive-graticule-lines', type: 'line', source: 'archive-graticule', paint: { 'line-color': '#aa884d', 'line-width': 0.68, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.46, 5, 0.25, 8, 0.08] } }, firstSymbol);
        map.addSource('hover-region', { type: 'geojson', data: emptyCollection() });
        map.addLayer({ id: 'hover-region-wash', type: 'fill', source: 'hover-region', paint: { 'fill-color': '#e0c58f', 'fill-opacity': 0.09 } }, firstSymbol);
        map.addLayer({ id: 'hover-region-pencil-shadow', type: 'line', source: 'hover-region', paint: { 'line-color': '#2d2921', 'line-width': 3.2, 'line-opacity': 0.38, 'line-blur': 0.65 } }, firstSymbol);
        map.addLayer({ id: 'hover-region-pencil', type: 'line', source: 'hover-region', paint: { 'line-color': '#dbc18d', 'line-width': 1.15, 'line-opacity': 0.92, 'line-dasharray': [1, 1.4] } }, firstSymbol);
        map.addSource('hover-locality', { type: 'geojson', data: emptyCollection() });
        map.addLayer({ id: 'hover-locality-lens', type: 'circle', source: 'hover-locality', paint: { 'circle-radius': 36, 'circle-color': '#f2d49a', 'circle-opacity': 0.13, 'circle-blur': 0.78 } }, firstSymbol);
        map.addLayer({ id: 'hover-locality-focus', type: 'circle', source: 'hover-locality', paint: { 'circle-radius': 13, 'circle-color': '#f2d49a', 'circle-opacity': 0.11, 'circle-blur': 0.58, 'circle-stroke-width': 0.7, 'circle-stroke-color': '#d8bb83', 'circle-stroke-opacity': 0.42 } }, firstSymbol);
        map.addSource('saved-points', { type: 'geojson', data: emptyCollection() });
        map.addLayer({ id: 'saved-points-halo', type: 'circle', source: 'saved-points', paint: { 'circle-radius': 18, 'circle-color': '#c86445', 'circle-opacity': 0.16, 'circle-blur': 0.62 } });
        map.addLayer({ id: 'saved-points-ring', type: 'circle', source: 'saved-points', paint: { 'circle-radius': 8, 'circle-color': 'rgba(200,100,69,0.08)', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#c86445', 'circle-stroke-opacity': 0.72 } });
        map.addLayer({ id: 'saved-points-core', type: 'circle', source: 'saved-points', paint: { 'circle-radius': 5, 'circle-color': '#c86445', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#f0c8a7' } });
        map.addSource('search-highlights', { type: 'geojson', data: emptyCollection() });
        map.addSource('search-highlight-lines', { type: 'geojson', data: emptyCollection() });
        map.addLayer({ id: 'search-highlight-lines', type: 'line', source: 'search-highlight-lines', paint: { 'line-color': '#c86445', 'line-width': 2, 'line-opacity': 0.72, 'line-dasharray': [1.4, 1.1] } });
        map.addLayer({ id: 'search-highlights-halo', type: 'circle', source: 'search-highlights', paint: { 'circle-radius': 19, 'circle-color': '#c86445', 'circle-opacity': 0.18, 'circle-blur': 0.55 } });
        map.addLayer({ id: 'search-highlights-core', type: 'circle', source: 'search-highlights', paint: { 'circle-radius': 8, 'circle-color': '#f4f1ea', 'circle-stroke-width': 2, 'circle-stroke-color': '#c86445' } });
        map.addSource('trajectory-points', { type: 'geojson', data: emptyCollection() });
        map.addSource('trajectory-lines', { type: 'geojson', data: emptyCollection() });
        map.addSource('trajectory-dates', { type: 'geojson', data: emptyCollection() });
        map.addSource('trajectory-arrows', { type: 'geojson', data: emptyCollection() });
        map.addLayer({ id: 'trajectory-lines', type: 'line', source: 'trajectory-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c86445', 'line-width': 2.2, 'line-opacity': 0.82 } });
        map.addLayer({ id: 'trajectory-points-core', type: 'circle', source: 'trajectory-points', paint: { 'circle-radius': 5, 'circle-color': '#c86445', 'circle-stroke-width': 0 } });
        map.addLayer({ id: 'trajectory-arrowheads', type: 'symbol', source: 'trajectory-arrows', layout: { 'text-field': '➤', 'text-size': 17, 'text-rotate': ['get', 'bearing'], 'text-rotation-alignment': 'viewport', 'text-allow-overlap': true }, paint: { 'text-color': '#984a36', 'text-halo-color': '#f4f1ea', 'text-halo-width': 1 } });
        map.addLayer({ id: 'trajectory-date-labels', type: 'symbol', source: 'trajectory-dates', layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -0.4] }, paint: { 'text-color': '#984a36', 'text-halo-color': '#f4f1ea', 'text-halo-width': 1.2 } });
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animateMarkers = (time: number) => {
          if (disposed) return;
          if (!reducedMotion && !document.hidden && time - lastMarkerFrame > 50 && map.getLayer('saved-points-halo')) {
            lastMarkerFrame = time;
            const phase = (Math.sin(time / 520) + 1) / 2;
            map.setPaintProperty('saved-points-halo', 'circle-radius', 15 + phase * 10);
            map.setPaintProperty('saved-points-halo', 'circle-opacity', 0.19 - phase * 0.1);
          }
          const deltaSeconds = lastRotationFrame ? Math.min((time - lastRotationFrame) / 1000, 0.05) : 0;
          lastRotationFrame = time;
          const zoom = map.getZoom();
          if (viewModeRef.current === 'globe' && !reducedMotion && !document.hidden && !autoRotationPaused.current && !userInteracting && time >= resumeRotationAt && zoom < 6 && deltaSeconds > 0 && time - lastRotationUpdate >= 32) {
            const rotationDelta = lastRotationUpdate ? Math.min((time - lastRotationUpdate) / 1000, 0.08) : deltaSeconds;
            lastRotationUpdate = time;
            const zoomFactor = Math.max(0, Math.min(1, (6 - zoom) / 4));
            const center = map.getCenter();
            map.setCenter([center.lng - 2.2 * zoomFactor * rotationDelta, center.lat]);
          }
          markerAnimation = requestAnimationFrame(animateMarkers);
        };
        markerAnimation = requestAnimationFrame(animateMarkers);
        map.addSource('taiwan-province', { type: 'geojson', data: emptyCollection() });
        map.addLayer({ id: 'taiwan-province-boundary', type: 'line', source: 'taiwan-province', minzoom: 3.2, paint: { 'line-color': '#a99b78', 'line-width': 1, 'line-opacity': 0.58 } });
        const source = map.getSource('saved-points');
        source?.setData({ type: 'FeatureCollection', features: pointsRef.current.map(point => pointFeature(point.place)) });
        void loadAdmin1(geography, 'CHN').then(regions => {
          const taiwan = regions.find((region: any) => region.code === 'CN-TW');
          if (taiwan && mapRef.current) map.getSource('taiwan-province')?.setData({ type: 'Feature', properties: { name: '台湾省' }, geometry: { type: 'MultiPolygon', coordinates: taiwan.polygons } });
        });
        callbacks.current.onReady();
        if (viewModeRef.current === 'map' && !matchMedia('(max-width: 600px)').matches) {
          requestAnimationFrame(() => map.fitBounds([[-180, -78], [180, 82]], { padding: { top: 82, right: 34, bottom: 42, left: 34 }, duration: 650, essential: true }));
        }
        const canvas = map.getCanvas();
        const radius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.375 * Math.pow(2, map.getZoom() - 2.02);
        setGlobeVeil({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, radius });
      });
      map.on('mousemove', (event: any) => {
        const canvas = map.getCanvas();
        const globeRadius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.375 * Math.pow(2, map.getZoom() - 2.02);
        const distanceFromGlobeCenter = Math.hypot(event.point.x - canvas.clientWidth / 2, event.point.y - canvas.clientHeight / 2);
        const isOnGlobe = viewModeRef.current === 'map' || distanceFromGlobeCenter <= globeRadius * 1.015;
        if (!isOnGlobe) {
          setHover(null);
          callbacks.current.onHoverLocation(null);
          clearHoverEffects();
          return;
        }
        if (userInteracting) return;
        if (performance.now() - lastMove.current < 42) return;
        lastMove.current = performance.now();
        const location = describe(map, event.lngLat.lng, event.lngLat.lat, event.point.x, event.point.y);
        setHover(location ? { location, x: event.point.x, y: event.point.y } : null);
        callbacks.current.onHoverLocation(location);
        const regions = geography.lookup(event.lngLat.lat, event.lngLat.lng);
        const level = levelFromZoom(map.getZoom());
        const region = level === 'continent' || level === 'country' ? regions.country : level === 'admin1' ? regions.admin1 ?? regions.country : null;
        const nextRegionKey = region?.id ?? '';
        if (nextRegionKey !== hoverRegionKey) {
          hoverRegionKey = nextRegionKey;
          map.getSource('hover-region')?.setData(region ? regionFeature(region) : emptyCollection());
        }
        if (level === 'admin1' && regions.country && !regions.admin1) void loadAdmin1(geography, regions.country.code);
        if (level === 'city') {
          const label = map.queryRenderedFeatures(event.point).find((feature: any) => feature.sourceLayer === 'place' && ['city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'county', 'suburb'].includes(String(feature.properties?.class ?? '')));
          const coordinates = label?.geometry?.type === 'Point' ? label.geometry.coordinates : location?.city ? [location.city.longitude, location.city.latitude] : [event.lngLat.lng, event.lngLat.lat];
          map.getSource('hover-locality')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } });
        } else map.getSource('hover-locality')?.setData(emptyCollection());
      });
      const clearHoverEffects = () => {
        hoverRegionKey = '';
        map.getSource('hover-region')?.setData(emptyCollection());
        map.getSource('hover-locality')?.setData(emptyCollection());
      };
      const beginInteraction = () => { userInteracting = true; clearHoverEffects(); };
      const endInteraction = () => { userInteracting = false; resumeRotationAt = performance.now() + 2600; lastRotationUpdate = 0; };
      map.on('mousedown', beginInteraction);
      map.on('touchstart', beginInteraction);
      map.on('mouseup', endInteraction);
      map.on('touchend', endInteraction);
      map.on('mouseout', () => { setHover(null); callbacks.current.onHoverLocation(null); clearHoverEffects(); });
      map.on('dragstart', () => { userInteracting = true; setHover(null); callbacks.current.onHoverLocation(null); setSelection(null); clearHoverEffects(); });
      map.on('dragend', endInteraction);
      map.on('zoomstart', () => { userInteracting = true; setHover(null); callbacks.current.onHoverLocation(null); setSelection(null); });
      map.on('zoomend', () => {
        userInteracting = false;
        resumeRotationAt = performance.now() + 2600;
        const canvas = map.getCanvas();
        const radius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.375 * Math.pow(2, map.getZoom() - 2.02);
        setGlobeVeil({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, radius });
      });
      map.on('click', async (event: any) => {
        const savedPointFeature = map.queryRenderedFeatures(event.point, { layers: ['saved-points-core', 'saved-points-ring', 'saved-points-halo'] })
          .find((feature: any) => typeof feature.properties?.id === 'string');
        if (savedPointFeature) {
          const point = pointsRef.current.find(candidate => candidate.place.id === savedPointFeature.properties.id);
          if (point) {
            setSelection({ place: point.place, x: event.point.x, y: event.point.y, zoom: map.getZoom() });
            return;
          }
        }
        const level = levelFromZoom(map.getZoom());
        const geography = geographyRef.current;
        let regions = geography?.lookup(event.lngLat.lat, event.lngLat.lng);
        if (level === 'admin1' && geography && regions?.country && !regions.admin1) {
          await loadAdmin1(geography, regions.country.code).catch(() => []);
          regions = geography.lookup(event.lngLat.lat, event.lngLat.lng);
        }
        if (level === 'country' && regions?.country) {
          const country = regions.country;
          setSelection({
            place: countryPlace(country),
            x: event.point.x,
            y: event.point.y,
            zoom: map.getZoom()
          });
          return;
        }
        if (level === 'admin1' && regions?.country && regions.admin1) {
          const country = regions.country;
          const admin1 = regions.admin1;
          setSelection({
            place: {
              id: `admin1-${admin1.code}`,
              name: admin1.name,
              kind: 'province',
              displayKind: placeKindLabel('province', country.code),
              countryCode: country.code,
              latitude: event.lngLat.lat,
              longitude: event.lngLat.lng,
              parents: [country.continent, country.name].filter(Boolean) as string[],
              source: 'natural-earth'
            },
            x: event.point.x,
            y: event.point.y,
            zoom: map.getZoom()
          });
          return;
        }
        const labelFeature = map.queryRenderedFeatures(event.point).find((feature: any) => feature.sourceLayer === 'place' && placeKind(String(feature.properties?.class ?? '')));
        if (labelFeature) {
          const coordinates = labelFeature.geometry?.type === 'Point' ? labelFeature.geometry.coordinates : [event.lngLat.lng, event.lngLat.lat];
          const place = await toPlace(labelFeature, Number(coordinates[0]), Number(coordinates[1]));
          if (place) {
            const completedPlace = await completePlaceHierarchy(place, map, event.point.x, event.point.y);
            setSelection({ place: completedPlace, x: event.point.x, y: event.point.y, zoom: map.getZoom() });
            return;
          }
        }
        if (level === 'city') {
          if (regions?.country && isCompactCountry(regions.country)) {
            setSelection({ place: countryPlace(regions.country), x: event.point.x, y: event.point.y, zoom: map.getZoom() });
            return;
          }
          callbacks.current.onMiss();
          return;
        }
        if (!geography || !regions?.country) { callbacks.current.onExplore('请点击陆地区域继续探索'); return; }
        void loadAdmin1(geography, regions.country.code);
        const target = { latitude: event.lngLat.lat, longitude: event.lngLat.lng, zoom: nextZoom[level] };
        callbacks.current.onFocus(target);
        callbacks.current.onExplore(`正在进入${level === 'continent' ? regions.country.continent : regions.country.name}`);
      });
      map.on('error', (event: any) => console.warn('Map tile warning', event.error));
    }).catch(cause => { console.error('Vector map initialization failed', cause); setError('矢量地图加载失败，请检查网络连接后刷新'); callbacks.current.onReady(); });
    return () => { disposed = true; cancelAnimationFrame(markerAnimation); mapRef.current = null; map?.remove(); };
  }, [completePlaceHierarchy, describe, nearestCity, toPlace]);

  useEffect(() => {
    const source = mapRef.current?.getSource('saved-points');
    source?.setData({ type: 'FeatureCollection', features: points.map(point => pointFeature(point.place)) });
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded?.()) return;
    setHover(null);
    setSelection(null);
    map.setRenderWorldCopies(false);
    const center = map.getCenter();
    const normalizedLongitude = ((center.lng + 180) % 360 + 360) % 360 - 180;
    map.setCenter([normalizedLongitude, center.lat]);
    map.setProjection({ type: viewMode === 'globe' ? 'globe' : 'mercator' });
    if (viewMode === 'map' && !matchMedia('(max-width: 600px)').matches) {
      map.fitBounds([[-180, -78], [180, 82]], { padding: { top: 82, right: 34, bottom: 42, left: 34 }, duration: 650, essential: true });
    }
  }, [viewMode]);

  useEffect(() => {
    const source = mapRef.current?.getSource('search-highlights');
    source?.setData({ type: 'FeatureCollection', features: highlightedPlaces.map(pointFeature) });
    mapRef.current?.getSource('search-highlight-lines')?.setData(highlightLineFeature(highlightedPlaces));
  }, [highlightedPlaces]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let animationFrame = 0;
    const legCount = Math.max(0, trajectorySteps.length - 1);
    const draw = (progress: number) => {
      const completedLegs = Math.min(legCount, Math.floor(progress + 1e-6));
      const geometry = trajectoryGeometry(map, trajectorySteps, progress, viewMode);
      map.getSource('trajectory-points')?.setData({ type: 'FeatureCollection', features: trajectorySteps.slice(0, completedLegs + 1).map(step => pointFeature(step.place)) });
      map.getSource('trajectory-lines')?.setData(geometry.lines);
      map.getSource('trajectory-dates')?.setData(trajectoryDateCollection(trajectorySteps, completedLegs + 1, viewMode));
      map.getSource('trajectory-arrows')?.setData(geometry.arrows);
    };
    if (trajectorySteps.length === 0) { draw(0); return; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(legCount); return; }
    const startedAt = performance.now();
    const durationPerLeg = 1450;
    const animate = (time: number) => {
      const progress = Math.min(legCount, (time - startedAt) / durationPerLeg);
      draw(progress);
      if (progress < legCount) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [trajectorySteps, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusTarget) return;
    map.easeTo({ center: [focusTarget.longitude, focusTarget.latitude], zoom: focusTarget.zoom, duration: 1050, essential: true });
    map.once('moveend', () => callbacks.current.onFocused());
  }, [focusTarget]);

  return <div className={`vector-earth view-${viewMode}`}>
    <div ref={containerRef} className="map-layer" />
    {viewMode === 'globe' && <div className="globe-edge-veil" style={{ '--veil-x': `${globeVeil.x}px`, '--veil-y': `${globeVeil.y}px`, '--veil-radius': `${globeVeil.radius}px` } as CSSProperties} />}
    {hover && <div className="location-tooltip map-location-tooltip" style={{ left: hover.x, top: hover.y }}>
      <span className="location-level">{hover.location.label}</span>
      <strong>{hover.location.title}</strong>
      {hover.location.trail.length > 0 && <span className="location-trail">{hover.location.trail.join(' · ')}</span>}
    </div>}
    {selection && <div className="place-action-card" style={{ left: selection.x, top: selection.y }}>
      <span>FIELD LOCATION · {selection.place.displayKind ?? placeDisplayLabel(selection.place)}</span>
      <strong>{selection.place.name}</strong>
      {selection.place.parents.length > 0 && <small>{selection.place.parents.join(' · ')}</small>}
      <code>{Math.abs(selection.place.latitude).toFixed(2)}° {selection.place.latitude >= 0 ? 'N' : 'S'} / {Math.abs(selection.place.longitude).toFixed(2)}° {selection.place.longitude >= 0 ? 'E' : 'W'}</code>
      <div>
        <button onClick={() => { callbacks.current.onAdd(selection.place); setSelection(null); }}>建立档案</button>
        {archivedPlaceIds.includes(selection.place.id) ? <button onClick={() => {
          callbacks.current.onViewArchives(selection.place);
          setSelection(null);
        }}>查看档案</button> : <button onClick={() => {
          callbacks.current.onFocus({ latitude: selection.place.latitude, longitude: selection.place.longitude, zoom: Math.min(selection.zoom + 1.7, 9) });
          callbacks.current.onExplore(`继续查看${selection.place.name}`);
          setSelection(null);
        }}>继续深入</button>}
        {selection.place.kind === 'country' && selection.place.countryCode && nationalityCountryCodes.includes(selection.place.countryCode) && <button onClick={() => {
          callbacks.current.onViewNationalityTrajectory(selection.place.countryCode!);
          setSelection(null);
        }}>查看国家田野网络</button>}
      </div>
    </div>}
    {error && <div className="map-error">{error}</div>}
  </div>;
}
