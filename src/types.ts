export interface City {
  id: string;
  name: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  populationRank?: number;
}

export type SyncStatus = 'local' | 'synced' | 'pending' | 'error';

export type PlaceKind = 'country' | 'province' | 'island' | 'district' | 'county' | 'city' | 'town' | 'village';

export interface Place {
  id: string;
  name: string;
  originalName?: string;
  kind: PlaceKind;
  displayKind?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  parents: string[];
  source: 'natural-earth' | 'openstreetmap';
}

export interface SavedPoint {
  id: string;
  placeId: string;
  place: Place;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface ArchiveImage {
  type: 'url' | 'local';
  url?: string;
  dataUrl?: string;
  name?: string;
  alt?: string;
}

export interface MarkdownNote {
  fileName: string;
  content: string;
  uploadedAt: string;
}

export interface EthnographyEdition {
  id: string;
  role: 'original' | 'translation';
  languageCode: string;
  title: string;
  publisher?: string;
  publishedDate?: string;
  isbn?: string;
  translators: string[];
  bookCover?: ArchiveImage;
  summary?: string;
}

export interface PlaceSnapshot extends Place {
  continent?: string;
  hierarchy?: PlaceHierarchy;
}

export interface PlaceHierarchy {
  continent?: string;
  country?: {
    code: string;
    name: string;
  };
  admin1?: {
    code?: string;
    name: string;
  };
}

export interface ArchiveAuthor {
  id: string;
  name: string;
  nationality?: {
    countryCode?: string;
    name: string;
  };
}

export interface FieldworkLeg {
  id: string;
  authorId: string;
  placeId: string;
  place: PlaceSnapshot;
  start?: string;
  end?: string;
}

export interface TrajectoryStep {
  place: PlaceSnapshot;
  start?: string;
  label?: string;
}

export interface EthnographyArchive {
  id: string;
  ownerId?: string;
  placeId: string;
  place: PlaceSnapshot;
  title: string;
  locationName: string;
  authors: string[];
  contributors: ArchiveAuthor[];
  fieldwork: FieldworkLeg[];
  translators: string[];
  publishedDate: string;
  publisher: string;
  reader: string;
  finishedReadingDate?: string;
  bookCover?: ArchiveImage;
  authorImage?: ArchiveImage;
  summary: string;
  readingNote?: MarkdownNote;
  tags: string[];
  editions?: EthnographyEdition[];
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface PointRepository {
  list(): Promise<SavedPoint[]>;
  create(place: Place): Promise<SavedPoint>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ArchiveRepository {
  list(): Promise<EthnographyArchive[]>;
  listByPlace(placeId: string): Promise<EthnographyArchive[]>;
  create(input: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>): Promise<EthnographyArchive>;
  update(id: string, input: Partial<Omit<EthnographyArchive, 'id' | 'createdAt'>>): Promise<EthnographyArchive>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type GeographyLevel = 'continent' | 'country' | 'admin1' | 'city';

export interface GeoRegion {
  id: string;
  name: string;
  code: string;
  countryCode?: string;
  continent?: string;
  bbox: [number, number, number, number];
  polygons: number[][][][];
}

export interface RegionMatch {
  country?: GeoRegion;
  admin1?: GeoRegion;
}

export interface HoverLocation {
  level: GeographyLevel;
  label: string;
  title: string;
  trail: string[];
  position: [number, number, number];
  city?: City;
}

export interface FocusTarget {
  latitude: number;
  longitude: number;
  zoom: number;
}
