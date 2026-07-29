import * as THREE from 'three';
import { latLonToVector3 } from './geo';
import type { City } from './types';

interface CityNode { city: City; point: THREE.Vector3; axis: 0 | 1 | 2; left?: CityNode; right?: CityNode }

const valueAt = (v: THREE.Vector3, axis: number) => axis === 0 ? v.x : axis === 1 ? v.y : v.z;

function build(items: Array<{ city: City; point: THREE.Vector3 }>, depth = 0): CityNode | undefined {
  if (!items.length) return undefined;
  const axis = (depth % 3) as 0 | 1 | 2;
  items.sort((a, b) => valueAt(a.point, axis) - valueAt(b.point, axis));
  const middle = Math.floor(items.length / 2);
  return { ...items[middle], axis, left: build(items.slice(0, middle), depth + 1), right: build(items.slice(middle + 1), depth + 1) };
}

export class CityIndex {
  private readonly root?: CityNode;
  constructor(cities: City[]) { this.root = build(cities.map(city => ({ city, point: latLonToVector3(city.latitude, city.longitude) }))); }

  nearest(target: THREE.Vector3, count = 8): City[] {
    const query = target.clone().normalize();
    const best: Array<{ distance: number; city: City }> = [];
    const visit = (node?: CityNode) => {
      if (!node) return;
      const distance = node.point.distanceToSquared(query);
      best.push({ distance, city: node.city });
      best.sort((a, b) => a.distance - b.distance);
      if (best.length > count) best.pop();
      const delta = valueAt(query, node.axis) - valueAt(node.point, node.axis);
      const near = delta < 0 ? node.left : node.right;
      const far = delta < 0 ? node.right : node.left;
      visit(near);
      if (best.length < count || delta * delta < best[best.length - 1].distance) visit(far);
    };
    visit(this.root);
    return best.map(item => item.city);
  }
}
