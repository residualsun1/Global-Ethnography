import * as THREE from 'three';

export const EARTH_RADIUS = 2;

export function latLonToVector3(latitude: number, longitude: number, radius = 1): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * cosLat * Math.sin(lon)
  );
}

export function vector3ToLatLon(vector: THREE.Vector3) {
  const unit = vector.clone().normalize();
  return {
    latitude: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(unit.y, -1, 1))),
    longitude: THREE.MathUtils.radToDeg(Math.atan2(-unit.z, unit.x))
  };
}

export function isClickGesture(dx: number, dy: number, durationMs: number) {
  return Math.hypot(dx, dy) <= 6 && durationMs <= 450;
}
