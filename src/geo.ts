export const EARTH_RADIUS = 2;

export interface Cartesian3 {
  x: number;
  y: number;
  z: number;
}

const degreesToRadians = (degrees: number) => degrees * Math.PI / 180;
const radiansToDegrees = (radians: number) => radians * 180 / Math.PI;

export function latLonToVector3(latitude: number, longitude: number, radius = 1): Cartesian3 {
  const lat = degreesToRadians(latitude);
  const lon = degreesToRadians(longitude);
  const cosLat = Math.cos(lat);
  return {
    x: radius * cosLat * Math.cos(lon),
    y: radius * Math.sin(lat),
    z: -radius * cosLat * Math.sin(lon)
  };
}

export function normalizeVector3(vector: Cartesian3): Cartesian3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function squaredVectorDistance(a: Cartesian3, b: Cartesian3) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

export function vector3ToLatLon(vector: Cartesian3) {
  const unit = normalizeVector3(vector);
  return {
    latitude: radiansToDegrees(Math.asin(Math.max(-1, Math.min(1, unit.y)))),
    longitude: radiansToDegrees(Math.atan2(-unit.z, unit.x))
  };
}

export function isClickGesture(dx: number, dy: number, durationMs: number) {
  return Math.hypot(dx, dy) <= 6 && durationMs <= 450;
}
