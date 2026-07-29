import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { EARTH_RADIUS, latLonToVector3 } from './geo';
import type { City, HoverLocation, SavedPoint } from './types';

const vertex = `
uniform float uSize;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize;
}
`;
const fragment = `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(0.30, 0.42, d);
  float halo = (1.0 - smoothstep(0.25, 1.0, d)) * 0.54;
  float alpha = max(core, halo) * uOpacity;
  gl_FragColor = vec4(uColor * (0.7 + core * 0.55), alpha);
}
`;

function MarkerCloud({ cities, opacity = 1, size = 18 }: { cities: City[]; opacity?: number; size?: number }) {
  const geometry = useMemo(() => {
    const positions = cities.flatMap(city => latLonToVector3(city.latitude, city.longitude, EARTH_RADIUS * 1.006).toArray());
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return result;
  }, [cities]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color('#6cff63') }, uOpacity: { value: opacity }, uSize: { value: size } }
  }), [opacity, size]);
  return <points geometry={geometry} material={material} renderOrder={4} />;
}

export function PointMarkers({ points, hoverLocation }: { points: SavedPoint[]; hoverLocation: HoverLocation | null }) {
  const savedCities = useMemo(() => points.map(point => ({
    id: point.place.id,
    name: point.place.name,
    countryCode: point.place.countryCode ?? '',
    latitude: point.place.latitude,
    longitude: point.place.longitude
  })), [points]);
  const hoverCity = hoverLocation?.city ?? null;
  return <>
    <MarkerCloud cities={savedCities} />
    {hoverCity && <MarkerCloud cities={[hoverCity]} opacity={0.48} size={24} />}
    {hoverLocation && <Html position={hoverLocation.position} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="location-tooltip">
        <span className="location-level">{hoverLocation.label}</span>
        <strong>{hoverLocation.title}</strong>
        {hoverLocation.trail.length > 0 && <span className="location-trail">{hoverLocation.trail.join(' · ')}</span>}
      </div>
    </Html>}
  </>;
}
