import type { PlaceSnapshot } from './types';

export function archivePlaceRoute(place: PlaceSnapshot) {
  const canonicalParents = place.hierarchy ? [
    place.hierarchy.continent,
    place.hierarchy.country?.name,
    place.hierarchy.admin1?.name
  ].filter(Boolean) as string[] : place.parents.length > 0 ? place.parents :
    [place.continent, place.countryCode].filter(Boolean) as string[];

  return [...canonicalParents, place.name]
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}
