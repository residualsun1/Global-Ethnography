import type { Place, TrajectoryStep } from './types';

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

export function partialArc(coordinates: number[][], progress: number) {
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
