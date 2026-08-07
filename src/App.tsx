import { Component, type CSSProperties, type ErrorInfo, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarRange, ChevronRight, Cloud, Download, FileText, Globe2, Image as ImageIcon, Layers3, LocateFixed, LogIn, LogOut, Map as MapIcon, MapPinned, Network, Pause, Play, Plus, RefreshCw, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArchiveBackupError, MAX_ARCHIVE_IMPORT_BYTES, parseArchiveBackup, serializeArchiveBackup } from './archiveBackup';
import { ARCHIVE_IMAGE_ACCEPT, ArchiveMediaError, MAX_MARKDOWN_NOTE_BYTES, normalizeHttpsImageUrl, validateArchiveImageFile } from './archiveMedia';
import { LocalArchiveRepository } from './archiveRepository';
import { ArchiveCloudGateway } from './archiveCloudGateway';
import { ArchiveSyncCoordinator } from './archiveSync';
import { cloudConfig } from './cloudConfig';
import { CloudApiError, SupabaseRestClient, type CloudSession } from './supabaseRestClient';
import { archivePlaceRoute } from './archiveHierarchy';
import { isPublicDemoArchive, PUBLIC_DEMO_ARCHIVES } from './demoArchives';
import { fieldworkForAuthor, fieldworkForNationality } from './fieldworkData';
import { EarthScene } from './EarthScene';
import { cityIndex, cityList, isDistinctAdmin1SearchResult, loadAdmin1, loadGeography, representativePoint } from './geography';
import { latLonToVector3 } from './geo';
import type { ArchiveAuthor, ArchiveConflict, ArchiveImage, ArchiveRepository, EthnographyArchive, EthnographyEdition, FocusTarget, GeoRegion, HoverLocation, MarkdownNote, Place, PlaceHierarchy, PlaceSnapshot, SavedPoint, TrajectoryStep } from './types';

class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('WebGL scene failed', error, info); }
  render() {
    if (this.state.failed) return <div className="fatal"><strong>无法启动 3D 地球</strong><span>请确认浏览器已开启 WebGL 硬件加速，然后刷新页面。</span></div>;
    return this.props.children;
  }
}

type ArchiveModalState =
  | { place: PlaceSnapshot; mode: 'list' | 'form'; archive?: undefined }
  | { place: PlaceSnapshot; mode: 'detail' | 'note' | 'edit'; archive: EthnographyArchive };

interface ArchiveTreeNode {
  label: string;
  children: ArchiveTreeNode[];
  archives: EthnographyArchive[];
}

interface SearchResult {
  id: string;
  name: string;
  trail: string;
  latitude: number;
  longitude: number;
  zoom: number;
  rank: number;
  kind: 'place' | 'archive' | 'author';
  places?: PlaceSnapshot[];
}

function displayDate(value: string | undefined) {
  return value?.trim() || '未记录';
}

function archiveAuthors(archive: Pick<EthnographyArchive, 'contributors' | 'authors'>): ArchiveAuthor[] {
  return archive.contributors.length > 0 ? archive.contributors : archive.authors.map((name, index) => ({ id: `legacy-author-${index}`, name }));
}

function fieldworkLabel(archive: EthnographyArchive) {
  const authors = new Map(archiveAuthors(archive).map(author => [author.id, author.name]));
  return archive.fieldwork.map(leg => {
    const span = [leg.start, leg.end].filter(Boolean).join(' 至 ');
    return archiveAuthors(archive).length > 1 ? `${authors.get(leg.authorId) ?? '作者'}：${span || '未记录'}` : span;
  }).filter(Boolean).join('、') || '未记录';
}

function splitList(value: FormDataEntryValue | null) {
  return [...new Set(String(value ?? '').split(/[,，、]/).map(item => item.trim()).filter(Boolean))];
}

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function imageSource(image: ArchiveImage | undefined) {
  return image?.type === 'local' ? image.dataUrl : image?.url;
}

export function originalEdition(archive: EthnographyArchive): EthnographyEdition {
  return archive.editions?.find(edition => edition.role === 'original') ?? {
    id: 'legacy-original', role: 'original', languageCode: 'und', title: archive.title,
    publisher: archive.publisher, publishedDate: archive.publishedDate, translators: [], bookCover: archive.bookCover, summary: archive.summary
  };
}

export function chineseEdition(archive: EthnographyArchive) {
  return archive.editions?.find(edition => edition.role === 'translation' && edition.languageCode.toLowerCase().startsWith('zh'));
}

function archivesForHover(location: HoverLocation | null, archives: EthnographyArchive[]) {
  if (!location || location.level === 'continent') return [];
  const target = location.title.trim().toLocaleLowerCase('zh-CN');
  return archives.filter(archive => {
    const placeName = archive.place.name.trim().toLocaleLowerCase('zh-CN');
    const locationName = archive.locationName.trim().toLocaleLowerCase('zh-CN');
    if (location.level === 'city') return placeName === target || locationName === target;
    const hierarchy = archive.place.parents.concat(archive.place.name).map(value => value.trim().toLocaleLowerCase('zh-CN'));
    return hierarchy.includes(target);
  }).sort((left, right) => {
    const leftDate = left.fieldwork.map(leg => leg.start).find(Boolean) ?? left.publishedDate ?? left.createdAt;
    const rightDate = right.fieldwork.map(leg => leg.start).find(Boolean) ?? right.publishedDate ?? right.createdAt;
    return leftDate.localeCompare(rightDate);
  });
}

type TimeMode = 'fieldwork' | 'publication' | 'chinesePublication';

function yearFrom(value: string | undefined) {
  const match = value?.match(/(?:18|19|20|21)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

export function archiveMatchesYear(archive: EthnographyArchive, mode: TimeMode, year: number) {
  if (mode === 'publication') return yearFrom(originalEdition(archive).publishedDate) === year;
  if (mode === 'chinesePublication') return yearFrom(chineseEdition(archive)?.publishedDate) === year;
  return archive.fieldwork.some(leg => {
    const start = yearFrom(leg.start);
    const end = yearFrom(leg.end) ?? start;
    return start !== undefined && end !== undefined && start <= year && year <= end;
  });
}

function TimeAtlas({ open, mode, year, minYear, maxYear, count, playing, onMode, onYear, onTogglePlay, onClose, onClear }: {
  open: boolean; mode: TimeMode; year: number; minYear: number; maxYear: number; count: number;
  playing: boolean; onMode: (mode: TimeMode) => void; onYear: (year: number) => void; onTogglePlay: () => void; onClose: () => void; onClear: () => void;
}) {
  return <section className={`time-atlas ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
    <header><div><span className="eyebrow">TEMPORAL ATLAS</span><strong>时间图谱</strong></div><div className="time-header-actions"><button className={`time-play ${playing ? 'is-playing' : ''}`} onClick={onTogglePlay}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? '暂停' : '自动播放'}</button><button className="time-clear" onClick={onClear}>显示全部年代</button><button className="icon-button" onClick={onClose} aria-label="关闭时间图谱"><X size={17} /></button></div></header>
    <div className="time-controls">
      <div className="time-mode" aria-label="时间类型">
        <button className={mode === 'fieldwork' ? 'is-active' : ''} onClick={() => onMode('fieldwork')}>田野时间</button>
        <button className={mode === 'publication' ? 'is-active' : ''} onClick={() => onMode('publication')}>作品首次出版</button>
        <button className={mode === 'chinesePublication' ? 'is-active' : ''} onClick={() => onMode('chinesePublication')}>中文译本</button>
      </div>
      <div className="year-readout"><b>{year}</b><span>{mode === 'fieldwork' ? '该年正在进行的田野工作' : mode === 'publication' ? '该年首次出版的民族志' : '该年出版的中文译本'} · {count} 部档案</span></div>
      <input aria-label="选择年份" type="range" min={minYear} max={maxYear} value={year} onChange={event => onYear(Number(event.currentTarget.value))} />
      <div className="year-limits"><span>{minYear}</span><span>{maxYear}</span></div>
    </div>
  </section>;
}

function ResearchNetworkPanel({ open, archives, onClose, onAuthor, onNationality, onClear }: {
  open: boolean; archives: EthnographyArchive[]; onClose: () => void;
  onAuthor: (author: ArchiveAuthor) => void; onNationality: (countryCode: string) => void; onClear: () => void;
}) {
  const [mode, setMode] = useState<'authors' | 'nationalities'>('authors');
  const authors = useMemo(() => {
    const byName = new Map<string, { author: ArchiveAuthor; places: Set<string>; works: number }>();
    for (const archive of archives) for (const author of archiveAuthors(archive)) {
      const current = byName.get(author.name) ?? { author, places: new Set<string>(), works: 0 };
      current.works += 1;
      for (const leg of archive.fieldwork.filter(item => item.authorId === author.id)) current.places.add(leg.placeId);
      if (!current.author.nationality && author.nationality) current.author = author;
      byName.set(author.name, current);
    }
    return [...byName.values()].sort((a, b) => b.places.size - a.places.size || a.author.name.localeCompare(b.author.name, 'zh-CN'));
  }, [archives]);
  const nationalities = useMemo(() => {
    const byCountry = new Map<string, { code: string; name: string; authors: Set<string>; places: Set<string> }>();
    for (const archive of archives) for (const author of archiveAuthors(archive)) {
      const code = author.nationality?.countryCode;
      if (!code) continue;
      const current = byCountry.get(code) ?? { code, name: author.nationality?.name ?? code, authors: new Set<string>(), places: new Set<string>() };
      current.authors.add(author.name);
      for (const leg of archive.fieldwork.filter(item => item.authorId === author.id)) current.places.add(leg.placeId);
      byCountry.set(code, current);
    }
    return [...byCountry.values()].sort((a, b) => b.places.size - a.places.size || a.name.localeCompare(b.name, 'zh-CN'));
  }, [archives]);
  return <aside className={`research-network-panel ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
    <header><div><span className="eyebrow">RESEARCH NETWORK</span><strong>研究网络</strong></div><button className="icon-button" onClick={onClose} aria-label="关闭研究网络"><X size={17} /></button></header>
    <div className="network-tabs"><button className={mode === 'authors' ? 'is-active' : ''} onClick={() => setMode('authors')}>按研究者</button><button className={mode === 'nationalities' ? 'is-active' : ''} onClick={() => setMode('nationalities')}>按研究者国籍</button></div>
    <div className="network-list">
      {mode === 'authors' ? authors.map(entry => <button key={entry.author.name} onClick={() => onAuthor(entry.author)}><span><strong>{entry.author.name}</strong><small>{entry.author.nationality?.name ?? '国籍未记录'}</small></span><em>{entry.places.size} 地点 · {entry.works} 档案</em><ChevronRight size={14} /></button>) :
        nationalities.map(entry => <button key={entry.code} onClick={() => onNationality(entry.code)}><span><strong>{entry.name}</strong><small>{entry.authors.size} 位研究者</small></span><em>{entry.places.size} 个田野地点</em><ChevronRight size={14} /></button>)}
      {(mode === 'authors' ? authors : nationalities).length === 0 && <p>尚无可构建研究网络的田野资料</p>}
    </div>
    <footer><button onClick={onClear}><RotateCcw size={13} />清除地图网络</button></footer>
  </aside>;
}

function ThemeLayerPanel({ open, tags, selected, onToggle, onClear, onClose }: {
  open: boolean; tags: { key: string; label: string; count: number }[]; selected: string[];
  onToggle: (key: string) => void; onClear: () => void; onClose: () => void;
}) {
  return <aside className={`theme-layer-panel ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
    <header><div><span className="eyebrow">THEMATIC LAYERS</span><strong>主题图层</strong><small>标签会随档案自动扩展</small></div><button className="icon-button" onClick={onClose} aria-label="关闭主题图层"><X size={17} /></button></header>
    <div className="theme-tags">{tags.map(tag => <button key={tag.key} className={selected.includes(tag.key) ? 'is-active' : ''} onClick={() => onToggle(tag.key)}><span>{tag.label}</span><em>{tag.count}</em></button>)}{tags.length === 0 && <p>录入标签后，主题会自动出现在这里。</p>}</div>
    <footer><span>{selected.length > 0 ? `已选择 ${selected.length} 个主题（满足任一标签）` : '当前显示全部主题'}</span><button onClick={onClear}>清除筛选</button></footer>
  </aside>;
}

function HoverArchiveShelf({ location, archives, onOpen, onEnter, onLeave }: {
  location: HoverLocation;
  archives: EthnographyArchive[];
  onOpen: (archive: EthnographyArchive) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const visible = archives.slice(0, 5);
  return <aside className="hover-archive-shelf" onMouseEnter={onEnter} onMouseLeave={onLeave} aria-label={`${location.title}的民族志`}>
    <header><span className="eyebrow">FIELD LIBRARY</span><strong>{location.title}</strong><small>{archives.length} 部民族志 · 按田野与出版时间排列</small></header>
    <div className="hover-book-stack">
      {visible.map((archive, index) => {
        const original = originalEdition(archive);
        const chinese = chineseEdition(archive);
        const source = imageSource(original.bookCover);
        const remaining = index === visible.length - 1 ? archives.length - visible.length : 0;
        return <button key={archive.id} style={{ '--book-index': index } as CSSProperties} onClick={() => onOpen(archive)} aria-label={`打开《${original.title}》`}>
          {source ? <img src={source} alt={original.bookCover?.alt ?? original.title} /> : <span className="book-placeholder"><BookOpen size={20} /><em>{archive.authors.join('、')}</em></span>}
          <span className="hover-book-caption"><b>{original.title}</b>{chinese && chinese.title !== original.title && <small>{chinese.title}</small>}</span>
          {remaining > 0 && <i>+{remaining}</i>}
        </button>;
      })}
    </div>
    <footer>{visible[0] && <><strong>{originalEdition(visible[0]).title}</strong>{chineseEdition(visible[0]) && <b>{chineseEdition(visible[0])?.title}</b>}<span>{visible[0].authors.join('、')} · {displayDate(originalEdition(visible[0]).publishedDate)}</span></>}</footer>
  </aside>;
}

function regionCenter(region: GeoRegion) {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = region.bbox;
  return { latitude: (minLatitude + maxLatitude) / 2, longitude: (minLongitude + maxLongitude) / 2 };
}

function scoreName(name: string, query: string) {
  const normalizedName = name.toLocaleLowerCase('zh-CN');
  const normalizedQuery = query.toLocaleLowerCase('zh-CN');
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  if (normalizedName.includes(normalizedQuery)) return 2;
  return 99;
}

async function searchPlaces(query: string): Promise<SearchResult[]> {
  const keyword = query.trim();
  if (!keyword) return [];
  const geography = await loadGeography();
  const results: SearchResult[] = [];
  for (const city of cityList) {
    const rank = scoreName(city.name, keyword);
    if (rank < 99) {
      const country = geography.countryByCode(city.countryCode);
      results.push({
        id: `city-${city.id}`,
        name: city.name,
        trail: [country?.continent, country?.name].filter(Boolean).join(' / ') || city.countryCode,
        latitude: city.latitude,
        longitude: city.longitude,
        zoom: 7.2,
        rank,
        kind: 'place'
      });
    }
  }
  for (const country of geography.countries()) {
    const rank = scoreName(country.name, keyword);
    if (rank < 99) {
      const center = regionCenter(country);
      results.push({
        id: `country-${country.code}`,
        name: country.name,
        trail: country.continent ?? '国家 / 地区',
        latitude: center.latitude,
        longitude: center.longitude,
        zoom: 4.1,
        rank: rank + 0.2,
        kind: 'place'
      });
    }
  }
  const adminLists = await Promise.allSettled(geography.countries().map(country => loadAdmin1(geography, country.code)));
  for (const list of adminLists) {
    if (list.status !== 'fulfilled') continue;
    for (const region of list.value) {
      const country = geography.countryByCode(region.countryCode);
      if (!isDistinctAdmin1SearchResult(region, country)) continue;
      const rank = scoreName(region.name, keyword);
      if (rank >= 99) continue;
      const center = regionCenter(region);
      results.push({
        id: `admin1-${region.id}`,
        name: region.name,
        trail: [country?.continent, country?.name].filter(Boolean).join(' / ') || region.countryCode || '一级行政区',
        latitude: center.latitude,
        longitude: center.longitude,
        zoom: 5.8,
        rank: rank + 0.1,
        kind: 'place'
      });
    }
  }
  return results
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 18);
}

function searchArchives(query: string, archives: EthnographyArchive[]): SearchResult[] {
  const keyword = query.trim();
  if (!keyword) return [];
  const results: SearchResult[] = [];
  const authorMatches = new Map<string, { rank: number; archives: EthnographyArchive[] }>();
  for (const archive of archives) {
    const editions = archive.editions?.length ? archive.editions : [originalEdition(archive)];
    const titleMatches = editions.map(edition => ({ edition, rank: scoreName(edition.title, keyword) })).sort((a, b) => a.rank - b.rank);
    const titleRank = titleMatches[0]?.rank ?? 99;
    if (titleRank < 99) {
      results.push({
        id: `archive-${archive.id}`,
        name: titleMatches[0].edition.title,
        trail: `${titleMatches[0].edition.role === 'translation' ? '中文译本' : '民族志'} · ${archive.place.parents.concat(archive.place.name).filter(Boolean).join(' / ')}`,
        latitude: archive.place.latitude,
        longitude: archive.place.longitude,
        zoom: archive.place.kind === 'country' ? 4.1 : 6.6,
        rank: titleRank + 0.05,
        kind: 'archive',
        places: [archive.place]
      });
    }
    for (const author of archive.authors) {
      const authorRank = scoreName(author, keyword);
      if (authorRank >= 99) continue;
      const match = authorMatches.get(author) ?? { rank: authorRank, archives: [] };
      match.rank = Math.min(match.rank, authorRank);
      match.archives.push(archive);
      authorMatches.set(author, match);
    }
  }
  for (const [author, match] of authorMatches) {
    const places = [...new Map(match.archives.map(archive => [archive.place.id, archive.place])).values()];
    const latitude = places.reduce((sum, place) => sum + place.latitude, 0) / places.length;
    const longitude = places.reduce((sum, place) => sum + place.longitude, 0) / places.length;
    results.push({
      id: `author-${author}`,
      name: author,
      trail: `作者 · ${match.archives.length} 部民族志 · ${places.length} 个地点`,
      latitude,
      longitude,
      zoom: places.length > 1 ? 1.8 : 5.8,
      rank: match.rank + 0.08,
      kind: 'author',
      places
    });
  }
  return results;
}

function placeSnapshot(place: Place): PlaceSnapshot {
  const [continent, country, admin1] = place.parents;
  const hierarchy: PlaceHierarchy | undefined = continent || country || admin1 ? {
    continent,
    country: country && place.countryCode ? { code: place.countryCode, name: country } : undefined,
    admin1: admin1 ? { name: admin1 } : undefined
  } : undefined;
  return { ...place, continent, hierarchy };
}

function samePlaceHierarchy(a: PlaceSnapshot, b: PlaceSnapshot) {
  return a.continent === b.continent &&
    a.countryCode === b.countryCode &&
    a.parents.join('|') === b.parents.join('|') &&
    a.hierarchy?.country?.code === b.hierarchy?.country?.code &&
    a.hierarchy?.country?.name === b.hierarchy?.country?.name &&
    a.hierarchy?.admin1?.code === b.hierarchy?.admin1?.code &&
    a.hierarchy?.admin1?.name === b.hierarchy?.admin1?.name;
}

function normalizeContributorNationalities(archive: EthnographyArchive, geography: Awaited<ReturnType<typeof loadGeography>>) {
  let changed = false;
  const contributors = archive.contributors.map(contributor => {
    if (!contributor.nationality?.name || contributor.nationality.countryCode) return contributor;
    const country = geography.countries().find(region => region.name === contributor.nationality?.name);
    if (!country) return contributor;
    changed = true;
    return { ...contributor, nationality: { ...contributor.nationality, countryCode: country.code } };
  });
  return { contributors, changed };
}

async function enrichPlaceSnapshot(place: PlaceSnapshot): Promise<PlaceSnapshot> {
  const geography = await loadGeography();
  const nearestCity = cityIndex.nearest(latLonToVector3(place.latitude, place.longitude), 1)[0];
  const useCityCoordinates = nearestCity?.name === place.name;
  const lookupLatitude = useCityCoordinates ? nearestCity.latitude : place.latitude;
  const lookupLongitude = useCityCoordinates ? nearestCity.longitude : place.longitude;
  const coordinateCountry = geography.lookup(lookupLatitude, lookupLongitude).country;
  const country = coordinateCountry ??
    geography.countryByCode(nearestCity?.countryCode) ??
    geography.countryByCode(place.hierarchy?.country?.code) ??
    geography.countryByCode(place.countryCode);
  if (!country) return place;
  await loadAdmin1(geography, country.code).catch(() => []);
  const admin1 = place.kind === 'country' ? undefined : geography.admin1At(country.code, lookupLatitude, lookupLongitude) ??
    geography.admin1NearCoast(country.code, lookupLatitude, lookupLongitude);
  const parents = [country.continent, country.name, admin1?.name]
    .filter((value): value is string => Boolean(value) && value !== place.name);
  const hierarchy: PlaceHierarchy = {
    continent: country.continent,
    country: { code: country.code, name: country.name },
    admin1: admin1 ? { code: admin1.code, name: admin1.name } : undefined
  };
  return { ...place, countryCode: country.code, continent: country.continent, parents, hierarchy };
}

function archiveToPoint(archive: EthnographyArchive): SavedPoint {
  return {
    id: `archive-place-${archive.placeId}`,
    placeId: archive.placeId,
    place: archive.place,
    createdAt: archive.createdAt,
    updatedAt: archive.updatedAt,
    syncStatus: archive.syncStatus
  };
}

function uniqueArchivePoints(archives: EthnographyArchive[]) {
  const byPlace = new Map<string, EthnographyArchive>();
  for (const archive of archives) if (!byPlace.has(archive.placeId)) byPlace.set(archive.placeId, archive);
  return [...byPlace.values()].map(archiveToPoint);
}

function archiveRoute(archive: EthnographyArchive) {
  return archivePlaceRoute(archive.place);
}

function buildArchiveTree(archives: EthnographyArchive[]): ArchiveTreeNode[] {
  const root: ArchiveTreeNode[] = [];
  const ensure = (nodes: ArchiveTreeNode[], label: string) => {
    let node = nodes.find(candidate => candidate.label === label);
    if (!node) {
      node = { label, children: [], archives: [] };
      nodes.push(node);
    }
    return node;
  };

  for (const archive of archives) {
    let nodes = root;
    let current: ArchiveTreeNode | null = null;
    for (const label of archiveRoute(archive)) {
      current = ensure(nodes, label);
      nodes = current.children;
    }
    current?.archives.push(archive);
  }

  const sortTree = (nodes: ArchiveTreeNode[]): ArchiveTreeNode[] => nodes
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    .map(node => ({
      ...node,
      children: sortTree(node.children),
      archives: node.archives.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    }));
  return sortTree(root);
}

function ArchiveTreeItem({ node, onOpen }: { node: ArchiveTreeNode; onOpen: (archive: EthnographyArchive) => void }) {
  return <li>
    <details>
      <summary><ChevronRight size={14} /><span>{node.label}</span></summary>
      {node.children.length > 0 && <ul className="archive-tree">{node.children.map(child => <ArchiveTreeItem key={child.label} node={child} onOpen={onOpen} />)}</ul>}
      {node.archives.length > 0 && <ul className="archive-leaves">
        {node.archives.map(archive => <li key={archive.id}>
          <button onClick={() => onOpen(archive)}>
            <BookOpen size={15} />
            <span><strong>{archive.title}{isPublicDemoArchive(archive) && <em className="demo-label">公开演示</em>}{!isPublicDemoArchive(archive) && archive.visibility === 'public' && <em className="demo-label">已发布</em>}</strong><small>{archive.authors.join('、')} · {archive.publishedDate}{archive.syncStatus === 'pending' ? ' · 待同步' : archive.syncStatus === 'conflict' ? ' · 有冲突' : ''}</small></span>
          </button>
        </li>)}
      </ul>}
    </details>
  </li>;
}

type CloudState = 'local' | 'offline' | 'syncing' | 'synced' | 'error' | 'conflict';

function CloudAccount({ enabled, session, state, onSignIn, onSignOut, onSync }: {
  enabled: boolean;
  session?: CloudSession;
  state: CloudState;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!enabled) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await onSignIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof CloudApiError ? caught.message : '登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };
  const stateLabel = state === 'syncing' ? '同步中' : state === 'synced' ? '已同步' : state === 'conflict' ? '有冲突' : state === 'error' ? '同步失败' : state === 'offline' ? '离线' : '云端';
  return <div className="cloud-account">
    <button className={`top-action-button cloud-account-button is-${state}`} onClick={() => setOpen(value => !value)} aria-expanded={open}><Cloud size={14} />{session ? stateLabel : '登录同步'}</button>
    {open && <div className="cloud-account-popover">
      {session ? <>
        <strong>{session.user.email ?? '已登录编辑者'}</strong>
        <small>私人档案自动同步；发布后才对访客可见。</small>
        <div><button disabled={state === 'syncing'} onClick={() => void onSync()}><RefreshCw size={13} />立即同步</button><button onClick={() => void onSignOut()}><LogOut size={13} />退出</button></div>
      </> : <form onSubmit={event => void submit(event)}>
        <strong>编辑者登录</strong>
        <small>账号由站点管理员在 Supabase 中邀请和授权。</small>
        <input name="email" type="email" required autoComplete="email" placeholder="邮箱" />
        <input name="password" type="password" required autoComplete="current-password" placeholder="密码" />
        {error && <p>{error}</p>}
        <button type="submit" disabled={busy}><LogIn size={13} />{busy ? '登录中' : '登录'}</button>
      </form>}
    </div>}
  </div>;
}

function ArchiveIndexPanel({ open, archives, localArchiveCount, importing, cloudEnabled, session, cloudState, legacyCount, conflicts, onClose, onOpen, onExport, onImport, onClear, onClaim, onSync, onResolveConflict }: {
  open: boolean;
  archives: EthnographyArchive[];
  localArchiveCount: number;
  importing: boolean;
  cloudEnabled: boolean;
  session?: CloudSession;
  cloudState: CloudState;
  legacyCount: number;
  conflicts: ArchiveConflict[];
  onClose: () => void;
  onOpen: (archive: EthnographyArchive) => void;
  onExport: () => void;
  onImport: (file: File, mode: 'merge' | 'replace') => void;
  onClear: () => void;
  onClaim: () => void;
  onSync: () => void;
  onResolveConflict: (archiveId: string, resolution: 'local' | 'remote') => void;
}) {
  const tree = useMemo(() => buildArchiveTree(archives), [archives]);
  return <aside className={`point-panel archive-index-panel ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
    <div className="panel-handle" />
    <header className="panel-header">
      <div><span className="eyebrow">ETHNOGRAPHIC ARCHIVE</span><h2>地点档案</h2></div>
      <button className="icon-button" onClick={onClose} aria-label="关闭地点档案"><X size={19} /></button>
    </header>
    <div className="panel-body">
      {archives.length === 0 ? <div className="empty-state"><MapPinned size={27} /><p>还没有民族志档案</p><span>关闭面板，点击地图上的具体地点，建立第一份阅读档案。</span></div> :
        <ul className="archive-tree archive-tree-root">{tree.map(node => <ArchiveTreeItem key={node.label} node={node} onOpen={onOpen} />)}</ul>}
    </div>
    <footer className="panel-footer archive-data-footer">
      <p>{cloudEnabled
        ? `${localArchiveCount > 0 ? `本机缓存了 ${localArchiveCount} 份私人档案` : '当前没有本机私人档案'} · ${session ? cloudState === 'syncing' ? '正在同步' : cloudState === 'conflict' ? '同步冲突' : cloudState === 'error' ? '同步失败' : '云端已连接' : '登录后可同步'}`
        : localArchiveCount > 0 ? `本机保存了 ${localArchiveCount} 份私人档案` : '当前仅展示随网站发布的只读演示档案'}</p>
      {session && legacyCount > 0 && <button className="claim-local-action" onClick={onClaim}><Cloud size={15} />备份并上传本机 {legacyCount} 份档案</button>}
      {session && <button className="sync-now-action" onClick={onSync} disabled={cloudState === 'syncing'}><RefreshCw size={15} />立即同步</button>}
      {conflicts.length > 0 && <div className="archive-conflicts"><strong>{conflicts.length} 份档案需要选择版本</strong>{conflicts.map(conflict => <div key={conflict.archiveId}><span>{conflict.localArchive?.title ?? conflict.remoteArchive?.title ?? conflict.archiveId}</span><button onClick={() => onResolveConflict(conflict.archiveId, 'local')}>保留本机</button><button onClick={() => onResolveConflict(conflict.archiveId, 'remote')}>保留云端</button></div>)}</div>}
      <div className="archive-data-actions">
        <button onClick={onExport} disabled={localArchiveCount === 0}><Download size={15} />导出私人档案</button>
        <label className={`panel-file-action ${importing ? 'is-disabled' : ''}`}><Upload size={15} />导入并合并<input type="file" accept=".json,application/json" disabled={importing} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onImport(file, 'merge');
        }} /></label>
        {!cloudEnabled && <label className={`panel-file-action panel-file-action-danger ${importing ? 'is-disabled' : ''}`}><RotateCcw size={15} />导入并覆盖<input type="file" accept=".json,application/json" disabled={importing} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onImport(file, 'replace');
        }} /></label>}
      </div>
      {!cloudEnabled && localArchiveCount > 0 && <button className="clear-archives-action" onClick={onClear}><Trash2 size={15} />清空私人档案</button>}
    </footer>
  </aside>;
}

function SearchPanel({ open, query, results, searching, onSelect }: {
  open: boolean;
  query: string;
  results: SearchResult[];
  searching: boolean;
  onSelect: (result: SearchResult) => void;
}) {
  return <section className={`search-panel ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
    <div className="search-results">
      {searching && <p>正在检索地点...</p>}
      {!searching && query.trim() && results.length === 0 && <p>没有找到匹配地点</p>}
      {!searching && results.map(result => <button key={result.id} onClick={() => onSelect(result)}>
        <span><strong>{result.name}</strong><small>{result.trail}</small></span>
        <LocateFixed size={16} />
      </button>)}
    </div>
  </section>;
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ImageInput({ label, uploadLabel, value, onChange, onError }: {
  label: string;
  uploadLabel: string;
  value: ArchiveImage | undefined;
  onChange: (image: ArchiveImage | undefined) => void;
  onError: (message: string) => void;
}) {
  return <div className="image-source">
    <label><span>{label}</span><input type="url" placeholder="https://cdn.jsdelivr.net/..." defaultValue={value?.type === 'url' ? value.url : ''} onBlur={event => {
      const raw = event.currentTarget.value.trim();
      if (!raw) {
        onChange(undefined);
        return;
      }
      try {
        onChange({ type: 'url', url: normalizeHttpsImageUrl(raw) });
      } catch (error) {
        event.currentTarget.value = value?.type === 'url' ? value.url ?? '' : '';
        onError(error instanceof ArchiveMediaError ? error.message : '图片网址无效');
      }
    }} /></label>
    <label className="file-picker"><ImageIcon size={17} /><span>{uploadLabel}</span><input type="file" accept={ARCHIVE_IMAGE_ACCEPT} onChange={event => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      try {
        validateArchiveImageFile(file);
        void readFileAsDataUrl(file).then(dataUrl => onChange({ type: 'local', dataUrl, name: file.name }));
      } catch (error) {
        event.currentTarget.value = '';
        onError(error instanceof ArchiveMediaError ? error.message : '图片无法读取');
      }
    }} /></label>
    {value && <small>已选择：{value.type === 'url' ? value.url : value.name}</small>}
  </div>;
}

function ArchiveForm({ place, archive, onSubmit, onCancel, onError }: {
  place: PlaceSnapshot;
  archive?: EthnographyArchive;
  onSubmit: (archive: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const storedOriginal = archive ? originalEdition(archive) : undefined;
  const storedChinese = archive ? chineseEdition(archive) : undefined;
  const [bookCover, setBookCover] = useState<ArchiveImage | undefined>(storedOriginal?.bookCover ?? archive?.bookCover);
  const [chineseBookCover, setChineseBookCover] = useState<ArchiveImage | undefined>(storedChinese?.bookCover);
  const [authorImage, setAuthorImage] = useState<ArchiveImage | undefined>(archive?.authorImage);
  const [countries, setCountries] = useState<GeoRegion[]>([]);
  useEffect(() => { void loadGeography().then(geography => setCountries(geography.countries())); }, []);
  const [contributors, setContributors] = useState(() => (archive ? archiveAuthors(archive) : []).map(author => {
    const fieldwork = archive?.fieldwork.find(leg => leg.authorId === author.id);
    return { ...author, nationalityName: author.nationality?.name ?? '', nationalityCode: author.nationality?.countryCode ?? '', fieldworkStart: fieldwork?.start ?? '', fieldworkEnd: fieldwork?.end ?? '' };
  }));
  const updateContributor = (id: string, patch: Record<string, string>) => setContributors(current => current.map(author => author.id === id ? { ...author, ...patch } : author));
  const addContributor = () => setContributors(current => [...current, { id: crypto.randomUUID(), name: '', nationalityName: '', nationalityCode: '', fieldworkStart: '', fieldworkEnd: '' }]);
  const [note, setNote] = useState<MarkdownNote | undefined>(archive?.readingNote);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const authors = contributors.filter(author => author.name.trim());
      const originalTitle = String(form.get('title') ?? '').trim();
      const originalPublisher = String(form.get('publisher') ?? '').trim();
      const originalPublishedDate = String(form.get('publishedDate') ?? '').trim();
      const originalSummary = String(form.get('summary') ?? '').trim();
      const chineseTitle = String(form.get('chineseTitle') ?? '').trim();
      const chineseTranslators = splitList(form.get('chineseTranslators'));
      const editions: EthnographyEdition[] = [{
        id: storedOriginal?.id ?? crypto.randomUUID(), role: 'original', languageCode: String(form.get('originalLanguage') ?? '').trim() || 'und',
        title: originalTitle, publisher: originalPublisher || undefined, publishedDate: originalPublishedDate || undefined,
        isbn: String(form.get('originalIsbn') ?? '').trim() || undefined, translators: [], bookCover, summary: originalSummary || undefined
      }];
      if (chineseTitle) editions.push({
        id: storedChinese?.id ?? crypto.randomUUID(), role: 'translation', languageCode: 'zh-CN', title: chineseTitle,
        publisher: String(form.get('chinesePublisher') ?? '').trim() || undefined,
        publishedDate: String(form.get('chinesePublishedDate') ?? '').trim() || undefined,
        isbn: String(form.get('chineseIsbn') ?? '').trim() || undefined, translators: chineseTranslators,
        bookCover: chineseBookCover, summary: String(form.get('chineseSummary') ?? '').trim() || undefined
      });
      await onSubmit({
        ownerId: 'local-demo-user',
        placeId: place.id,
        place,
        title: originalTitle,
        locationName: String(form.get('locationName') ?? '').trim(),
        authors: authors.map(author => author.name.trim()),
        contributors: authors.map(({ id, name, nationalityName, nationalityCode }): ArchiveAuthor => ({ id, name: name.trim(), nationality: nationalityName.trim() ? { name: nationalityName.trim(), countryCode: nationalityCode || undefined } : undefined })),
        fieldwork: authors.flatMap(author => author.fieldworkStart.trim() || author.fieldworkEnd.trim() ? [{ id: crypto.randomUUID(), authorId: author.id, placeId: place.id, place, start: author.fieldworkStart.trim() || undefined, end: author.fieldworkEnd.trim() || undefined }] : []),
        translators: chineseTranslators,
        publishedDate: originalPublishedDate,
        publisher: originalPublisher,
        reader: String(form.get('reader') ?? '').trim(),
        finishedReadingDate: String(form.get('finishedReadingDate') ?? '').trim() || undefined,
        bookCover,
        authorImage,
        summary: originalSummary,
        readingNote: note,
        tags: splitList(form.get('tags')),
        editions
      });
    } finally {
      setSaving(false);
    }
  };

  return <form className="archive-form" onSubmit={event => void submit(event)}>
    <section className="edition-form-section"><header><span className="eyebrow">ORIGINAL EDITION</span><strong>原始版本</strong></header>
    <label><span>原文书名 *</span><input name="title" required autoFocus defaultValue={storedOriginal?.title ?? archive?.title} /></label>
    <div className="form-grid"><label><span>原文语言</span><input name="originalLanguage" placeholder="如 en, fr, ja" defaultValue={storedOriginal?.languageCode === 'und' ? '' : storedOriginal?.languageCode} /></label><label><span>ISBN</span><input name="originalIsbn" defaultValue={storedOriginal?.isbn} /></label></div>
    <ImageInput label="原版封面 URL" uploadLabel="上传原版封面" value={bookCover} onChange={setBookCover} onError={onError} />
    </section>
    <label><span>田野地点 *</span><input name="locationName" required defaultValue={archive?.locationName ?? place.name} /></label>
    <div className="contributor-editor">
      {contributors.map((author, index) => <fieldset key={author.id}>
        <legend>作者 {contributors.length > 1 ? index + 1 : ''}</legend>
        <label><span>作者</span><input value={author.name} onChange={event => updateContributor(author.id, { name: event.currentTarget.value })} placeholder="作者姓名" /></label>
        <label className="nationality-input"><span>作者国籍</span><input value={author.nationalityName} onChange={event => updateContributor(author.id, { nationalityName: event.currentTarget.value, nationalityCode: '' })} placeholder="输入国家名" />
          {author.nationalityName.trim() && !author.nationalityCode && <ul>{countries.filter(country => country.name.includes(author.nationalityName.trim())).slice(0, 6).map(country => <li key={country.code}><button type="button" onClick={() => updateContributor(author.id, { nationalityName: country.name, nationalityCode: country.code })}>{country.name}<small>{country.continent}</small></button></li>)}</ul>}
        </label>
        <div className="form-grid">
          <label><span>田野时间（开始）</span><input value={author.fieldworkStart} onChange={event => updateContributor(author.id, { fieldworkStart: event.currentTarget.value })} placeholder="1978 / 1978-06 / 1978-06-12" /></label>
          <label><span>田野时间（结束）</span><input value={author.fieldworkEnd} onChange={event => updateContributor(author.id, { fieldworkEnd: event.currentTarget.value })} placeholder="1980 / 1980-09 / 1980-09-30" /></label>
        </div>
        {contributors.length > 1 && <button type="button" className="remove-contributor" onClick={() => setContributors(current => current.filter(item => item.id !== author.id))}>移除此作者</button>}
      </fieldset>)}
      <button type="button" className="add-contributor" onClick={addContributor}>添加作者</button>
    </div>
    <ImageInput label="作者图像 URL" uploadLabel="上传本地作者图像" value={authorImage} onChange={setAuthorImage} onError={onError} />
    <div className="form-grid">
      <label><span>首次出版日期</span><input name="publishedDate" placeholder="2003-04-20 / 2003-04 / 2003" defaultValue={storedOriginal?.publishedDate ?? archive?.publishedDate} /></label>
      <label><span>原版出版社</span><input name="publisher" defaultValue={storedOriginal?.publisher ?? archive?.publisher} /></label>
      <label><span>阅读者</span><input name="reader" defaultValue={archive?.reader} /></label>
      <label><span>完成阅读</span><input name="finishedReadingDate" placeholder="2003-04-20 / 2003-04 / 2003" defaultValue={archive?.finishedReadingDate} /></label>
    </div>
    <label><span>原版简介</span><textarea name="summary" rows={5} defaultValue={storedOriginal?.summary ?? archive?.summary} /></label>
    <section className="edition-form-section translation-edition"><header><span className="eyebrow">CHINESE EDITION · OPTIONAL</span><strong>中文译本（选填）</strong></header>
      <label><span>中文书名</span><input name="chineseTitle" defaultValue={storedChinese?.title} placeholder="填写后启用中文版本" /></label>
      <label><span>译者</span><input name="chineseTranslators" placeholder="多位译者请用英文逗号 , 分隔" defaultValue={(storedChinese?.translators ?? archive?.translators ?? []).join(', ')} /></label>
      <div className="form-grid"><label><span>中文出版日期</span><input name="chinesePublishedDate" placeholder="2003-04-20 / 2003-04 / 2003" defaultValue={storedChinese?.publishedDate} /></label><label><span>中文出版社</span><input name="chinesePublisher" defaultValue={storedChinese?.publisher} /></label><label><span>中文 ISBN</span><input name="chineseIsbn" defaultValue={storedChinese?.isbn} /></label></div>
      <ImageInput label="中文版封面 URL" uploadLabel="上传中文版封面" value={chineseBookCover} onChange={setChineseBookCover} onError={onError} />
      <label><span>中文版简介</span><textarea name="chineseSummary" rows={4} defaultValue={storedChinese?.summary} /></label>
    </section>
    <div className="image-source">
      <label className="file-picker"><FileText size={17} /><span>上传 Markdown 阅读札记</span><input type="file" accept=".md,text/markdown,text/plain" onChange={event => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        if (file.size > MAX_MARKDOWN_NOTE_BYTES) {
          event.currentTarget.value = '';
          onError('Markdown 阅读札记不能超过 2 MB');
          return;
        }
        void readFileAsText(file).then(content => setNote({ fileName: file.name, content, uploadedAt: new Date().toISOString() }));
      }} /></label>
      {note && <small>已上传：{note.fileName}</small>}
    </div>
    <label><span>标签</span><input name="tags" placeholder="如 亲属制度, 仪式, 边疆（使用英文逗号分隔）" defaultValue={archive?.tags.join(', ')} /></label>
    <div className="archive-actions">
      <button type="button" onClick={onCancel}>取消</button>
      <button type="submit" disabled={saving}>{saving ? '保存中' : '保存档案'}</button>
    </div>
  </form>;
}

function ArchiveDetail({ archive, readOnly, readOnlyLabel, canPublish, onReadNote, onCreateAnother, onEdit, onRemove, onTrace, onVisibility }: {
  archive: EthnographyArchive;
  readOnly?: boolean;
  readOnlyLabel?: string;
  canPublish?: boolean;
  onReadNote: () => void;
  onCreateAnother: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTrace: (author: ArchiveAuthor) => void;
  onVisibility: () => void;
}) {
  const original = originalEdition(archive);
  const chinese = chineseEdition(archive);
  const [editionRole, setEditionRole] = useState<'original' | 'chinese'>('original');
  const edition = editionRole === 'chinese' && chinese ? chinese : original;
  const coverSource = imageSource(edition.bookCover);
  const contributors = archiveAuthors(archive);
  const authorNationality = contributors.map(author => author.nationality?.name).filter(Boolean).join('、') || '未记录';
  return <article className="archive-detail">
    <header>
      <span className="eyebrow">{archive.place.parents.join(' / ') || archive.place.countryCode || 'FIELD LOCATION'}</span>
      {readOnly && <span className="demo-archive-badge">{readOnlyLabel ?? '公开档案 · 只读'}</span>}
      {!readOnly && archive.syncStatus !== 'local' && <span className="demo-archive-badge">{archive.syncStatus === 'pending' ? '待同步' : archive.syncStatus === 'conflict' ? '同步冲突' : archive.syncStatus === 'error' ? '同步失败' : archive.visibility === 'public' ? '已发布' : '私人草稿'}</span>}
      {chinese && <div className="edition-switch"><button className={editionRole === 'original' ? 'is-active' : ''} onClick={() => setEditionRole('original')}>原始版本</button><button className={editionRole === 'chinese' ? 'is-active' : ''} onClick={() => setEditionRole('chinese')}>中文版本</button></div>}
      <h2>{edition.title}</h2>
      <p>{[archive.authors.join('、'), edition.publisher, edition.publishedDate].filter(Boolean).join(' · ')}</p>
    </header>
    {coverSource && <img className="book-cover-image" src={coverSource} alt={edition.bookCover?.alt ?? `${edition.title}书籍封面`} />}
    <dl>
      <div><dt>田野地点</dt><dd>{archive.locationName}</dd></div>
      <div><dt>作者</dt><dd>{archive.authors.join('、')}</dd></div>
      <div><dt>田野时间</dt><dd>{fieldworkLabel(archive)}</dd></div>
      <div><dt>作者国籍</dt><dd>{authorNationality}</dd></div>
      <div><dt>{edition.role === 'original' ? '首次出版日期' : '中文出版日期'}</dt><dd>{displayDate(edition.publishedDate)}</dd></div>
      <div><dt>出版社</dt><dd>{displayDate(edition.publisher)}</dd></div>
      <div><dt>版本语言</dt><dd>{edition.languageCode || '未记录'}</dd></div>
      <div><dt>ISBN</dt><dd>{displayDate(edition.isbn)}</dd></div>
      <div><dt>完成阅读</dt><dd>{displayDate(archive.finishedReadingDate)}</dd></div>
      <div><dt>阅读者</dt><dd>{archive.reader || '未记录'}</dd></div>
      {edition.translators.length > 0 && <div><dt>翻译者</dt><dd>{edition.translators.join('、')}</dd></div>}
    </dl>
    <section><h3>{edition.role === 'original' ? '原版简介' : '中文版简介'}</h3><p>{edition.summary || '未记录'}</p></section>
    {contributors.some(author => author.nationality?.name) && <section className="trajectory-section"><h3>田野轨迹</h3><div>{contributors.filter(author => author.nationality?.name).map(author => <button key={author.id} onClick={() => onTrace(author)}>查看 {author.name} 的田野轨迹</button>)}</div></section>}
    {archive.readingNote && <button type="button" className="reading-note-card" onClick={onReadNote}>
      <FileText size={20} />
      <span><strong>阅读札记</strong><small>{archive.readingNote.fileName}</small></span>
      <ChevronRight size={17} />
    </button>}
    {archive.tags.length > 0 && <div className="tag-row">{archive.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    {readOnly && <p className="demo-archive-notice">此条目为线上只读内容，不会被本机编辑操作覆盖。</p>}
    <div className="archive-actions">
      <button type="button" onClick={onCreateAnother}><Plus size={16} />继续新增</button>
      {!readOnly && <button type="button" onClick={onEdit}><FileText size={16} />重新编辑</button>}
      {!readOnly && canPublish && <button type="button" onClick={onVisibility}><Cloud size={16} />{archive.visibility === 'public' ? '转为私人草稿' : '发布到线上'}</button>}
      {!readOnly && <button type="button" className="danger-action" onClick={onRemove}><Trash2 size={16} />删除</button>}
    </div>
  </article>;
}

function ArchiveNote({ archive }: { archive: EthnographyArchive }) {
  return <article className="archive-note">
    <header><span className="eyebrow">{archive.readingNote?.fileName}</span><h2>{archive.title}</h2></header>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{archive.readingNote?.content ?? ''}</ReactMarkdown>
  </article>;
}

function ArchiveModal({ state, archives, currentUserId, cloudEnabled, onClose, onCreate, onUpdate, onOpen, onMode, onRemove, onTrace, onVisibility, onError }: {
  state: ArchiveModalState | null;
  archives: EthnographyArchive[];
  currentUserId?: string;
  cloudEnabled: boolean;
  onClose: () => void;
  onCreate: (archive: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => Promise<void>;
  onUpdate: (archive: EthnographyArchive, input: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => Promise<void>;
  onOpen: (archive: EthnographyArchive) => void;
  onMode: (mode: ArchiveModalState['mode']) => void;
  onRemove: (archive: EthnographyArchive) => void;
  onTrace: (author: ArchiveAuthor) => void;
  onVisibility: (archive: EthnographyArchive) => void;
  onError: (message: string) => void;
}) {
  if (!state) return null;
  const placeArchives = archives.filter(archive => archive.placeId === state.place.id);
  const demo = state.mode === 'detail' || state.mode === 'note' ? isPublicDemoArchive(state.archive) : false;
  const remoteOtherOwner = state.mode === 'detail' || state.mode === 'note'
    ? (state.archive.revision ?? 0) > 0 && state.archive.ownerId !== currentUserId
    : false;
  const readOnly = demo || remoteOtherOwner;
  return <div className="archive-modal-shell" role="dialog" aria-modal="true">
    <div className="archive-modal">
      <button className="icon-button archive-close" onClick={onClose} aria-label="关闭民族志档案"><X size={19} /></button>
      {state.mode === 'form' && <>
        <header className="archive-modal-header"><span className="eyebrow">NEW ETHNOGRAPHY</span><h2>新建民族志档案</h2><p>{state.place.parents.concat(state.place.name).filter(Boolean).join(' / ')}</p></header>
        <ArchiveForm place={state.place} onSubmit={onCreate} onCancel={onClose} onError={onError} />
      </>}
      {state.mode === 'edit' && <>
        <header className="archive-modal-header"><span className="eyebrow">EDIT ETHNOGRAPHY</span><h2>重新编辑民族志档案</h2><p>{state.place.parents.concat(state.place.name).filter(Boolean).join(' / ')}</p></header>
        <ArchiveForm place={state.place} archive={state.archive} onSubmit={input => onUpdate(state.archive, input)} onCancel={() => onMode('detail')} onError={onError} />
      </>}
      {state.mode === 'list' && <>
        <header className="archive-modal-header"><span className="eyebrow">PLACE ARCHIVES</span><h2>{state.place.name}</h2><p>{state.place.parents.join(' / ')}</p></header>
        {placeArchives.length === 0 ? <div className="archive-empty"><BookOpen size={30} /><p>这里还没有录入民族志。</p><button onClick={() => onMode('form')}><Plus size={16} />新建此地点档案</button></div> :
          <div className="place-archive-list">
            {placeArchives.map(archive => <button key={archive.id} onClick={() => onOpen(archive)}>
              <span><strong>{archive.title}</strong><small>{archive.authors.join('、')} · {archive.publisher} · {archive.publishedDate}</small></span><LocateFixed size={16} />
            </button>)}
            <button className="add-another" onClick={() => onMode('form')}><Plus size={16} />新增此地点的民族志</button>
          </div>}
      </>}
      {state.mode === 'detail' && <ArchiveDetail archive={state.archive} readOnly={readOnly} readOnlyLabel={demo ? '公开演示 · 只读' : '公开档案 · 只读'} canPublish={cloudEnabled && Boolean(currentUserId) && state.archive.ownerId === currentUserId} onReadNote={() => onMode('note')} onCreateAnother={() => onMode('form')} onEdit={() => onMode('edit')} onRemove={() => onRemove(state.archive)} onTrace={onTrace} onVisibility={() => onVisibility(state.archive)} />}
      {state.mode === 'note' && <ArchiveNote archive={state.archive} />}
    </div>
  </div>;
}

export default function App({ repository: injectedRepository }: { repository?: ArchiveRepository }) {
  const config = useMemo(() => cloudConfig(), []);
  const cloudEnabled = Boolean(config && !injectedRepository);
  const repository = useMemo(() => injectedRepository ?? new LocalArchiveRepository({ syncEnabled: cloudEnabled }), [injectedRepository, cloudEnabled]);
  const localRepository = repository instanceof LocalArchiveRepository ? repository : undefined;
  const cloudClient = useMemo(() => config && cloudEnabled ? new SupabaseRestClient(config) : undefined, [config, cloudEnabled]);
  const cloudGateway = useMemo(() => cloudClient ? new ArchiveCloudGateway(cloudClient) : undefined, [cloudClient]);
  const syncCoordinator = useMemo(() => localRepository && cloudGateway ? new ArchiveSyncCoordinator(localRepository, cloudGateway) : undefined, [localRepository, cloudGateway]);
  const [session, setSession] = useState<CloudSession | undefined>(() => cloudClient?.currentSession());
  const [cloudState, setCloudState] = useState<CloudState>(cloudEnabled ? navigator.onLine ? 'synced' : 'offline' : 'local');
  const [remotePublicArchives, setRemotePublicArchives] = useState<EthnographyArchive[]>([]);
  const [conflicts, setConflicts] = useState<ArchiveConflict[]>([]);
  const [localArchives, setLocalArchives] = useState<EthnographyArchive[]>([]);
  const visibleLocalArchives = useMemo(() => localArchives.filter(archive =>
    !archive.ownerId || archive.ownerId === 'local-demo-user' || archive.ownerId === session?.user.id
  ), [localArchives, session?.user.id]);
  const archives = useMemo(() => {
    const byId = new Map<string, EthnographyArchive>();
    for (const archive of PUBLIC_DEMO_ARCHIVES) byId.set(archive.id, archive);
    for (const archive of remotePublicArchives) byId.set(archive.id, archive);
    for (const archive of visibleLocalArchives) byId.set(archive.id, archive);
    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [remotePublicArchives, visibleLocalArchives]);
  const legacyArchiveCount = useMemo(() => localArchives.filter(archive => !archive.ownerId || archive.ownerId === 'local-demo-user').length, [localArchives]);
  const visibleConflicts = useMemo(() => conflicts.filter(conflict => {
    const ownerId = conflict.localArchive?.ownerId ?? conflict.remoteArchive?.ownerId;
    return Boolean(session && (!ownerId || ownerId === 'local-demo-user' || ownerId === session.user.id));
  }), [conflicts, session]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [highlightedPlaces, setHighlightedPlaces] = useState<PlaceSnapshot[]>([]);
  const [trajectorySteps, setTrajectorySteps] = useState<TrajectoryStep[]>([]);
  const [archiveModal, setArchiveModal] = useState<ArchiveModalState | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [toast, setToast] = useState('');
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<'globe' | 'map'>('globe');
  const [timeOpen, setTimeOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [timeMode, setTimeMode] = useState<TimeMode>('fieldwork');
  const [timeYear, setTimeYear] = useState<number | null>(null);
  const [timePlaying, setTimePlaying] = useState(false);
  const [hoverArchiveLocation, setHoverArchiveLocation] = useState<HoverLocation | null>(null);
  const [importingArchives, setImportingArchives] = useState(false);
  const hoverClearTimer = useRef<number | null>(null);

  const availableYears = useMemo(() => archives.flatMap(archive => [
    yearFrom(originalEdition(archive).publishedDate), yearFrom(chineseEdition(archive)?.publishedDate),
    ...archive.fieldwork.flatMap(leg => [yearFrom(leg.start), yearFrom(leg.end)])
  ]).filter((year): year is number => year !== undefined), [archives]);
  const minYear = availableYears.length > 0 ? Math.min(...availableYears) : 1900;
  const maxYear = availableYears.length > 0 ? Math.max(...availableYears) : new Date().getFullYear();
  const activeYear = Math.min(maxYear, Math.max(minYear, timeYear ?? maxYear));
  const themeTags = useMemo(() => {
    const tags = new Map<string, { key: string; label: string; count: number }>();
    for (const archive of archives) for (const label of archive.tags) {
      const key = normalizeTag(label);
      if (!key) continue;
      const current = tags.get(key) ?? { key, label: label.trim(), count: 0 };
      current.count += 1;
      tags.set(key, current);
    }
    return [...tags.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
  }, [archives]);
  const displayedArchives = useMemo(() => archives.filter(archive => {
    if (timeYear !== null && !archiveMatchesYear(archive, timeMode, activeYear)) return false;
    if (selectedTags.length === 0) return true;
    const archiveTags = new Set(archive.tags.map(normalizeTag));
    return selectedTags.some(tag => archiveTags.has(tag));
  }), [archives, timeMode, timeYear, activeYear, selectedTags]);
  const points = useMemo(() => uniqueArchivePoints(displayedArchives), [displayedArchives]);
  const archivedPlaceIds = useMemo(() => [...new Set(displayedArchives.map(archive => archive.placeId))], [displayedArchives]);
  const nationalityCountryCodes = useMemo(() => [...new Set(displayedArchives.flatMap(archive => archive.fieldwork.flatMap(leg => {
    const author = archive.contributors.find(contributor => contributor.id === leg.authorId);
    return author?.nationality?.countryCode && leg.start ? [author.nationality.countryCode] : [];
  })))], [displayedArchives]);
  const hoverArchives = useMemo(() => archivesForHover(hoverArchiveLocation, displayedArchives), [hoverArchiveLocation, displayedArchives]);
  useEffect(() => {
    if (!timePlaying) return;
    const timer = window.setInterval(() => setTimeYear(current => {
      const year = current ?? minYear;
      if (year >= maxYear) { setTimePlaying(false); return maxYear; }
      return year + 1;
    }), 900);
    return () => window.clearInterval(timer);
  }, [timePlaying, minYear, maxYear]);
  const keepHoverShelf = () => {
    if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = null;
  };
  const clearHoverShelf = (delayed = true) => {
    keepHoverShelf();
    if (!delayed) { setHoverArchiveLocation(null); return; }
    hoverClearTimer.current = window.setTimeout(() => setHoverArchiveLocation(null), 320);
  };
  const handleHoverLocation = (location: HoverLocation | null) => {
    if (!location) { clearHoverShelf(); return; }
    keepHoverShelf();
    if (archivesForHover(location, displayedArchives).length > 0) setHoverArchiveLocation(location);
    else setHoverArchiveLocation(null);
  };
  const refresh = useCallback(async () => {
    const storedArchives = await repository.list();
    const geography = await loadGeography();
    const enrichedArchives = await Promise.all(storedArchives.map(async archive => {
      const place = await enrichPlaceSnapshot(archive.place);
      const nationality = normalizeContributorNationalities(archive, geography);
      if (!samePlaceHierarchy(archive.place, place) || nationality.changed) {
        return { ...archive, place, placeId: place.id, contributors: nationality.contributors };
      }
      return archive;
    }));
    setLocalArchives(enrichedArchives);
    if (localRepository) setConflicts(await localRepository.listConflicts());
  }, [repository, localRepository]);

  const refreshPublicArchives = useCallback(async () => {
    if (!cloudGateway) return;
    setRemotePublicArchives(await cloudGateway.listPublic());
  }, [cloudGateway]);

  const synchronize = useCallback(async () => {
    if (!session || !syncCoordinator || !navigator.onLine) {
      if (cloudEnabled) setCloudState('offline');
      return;
    }
    setCloudState('syncing');
    try {
      const result = await syncCoordinator.synchronize(session.user);
      await Promise.all([refresh(), refreshPublicArchives()]);
      setCloudState(result.conflicts > 0 ? 'conflict' : result.failed > 0 ? 'error' : 'synced');
      if (result.pushed + result.pulled > 0) setToast(`云端同步完成：上传 ${result.pushed}，接收 ${result.pulled}`);
    } catch (error) {
      await refresh().catch(() => undefined);
      setCloudState('error');
      setToast(error instanceof CloudApiError ? error.message : '云端同步失败，本机数据已保留');
    }
  }, [session, syncCoordinator, cloudEnabled, refresh, refreshPublicArchives]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!cloudClient) return;
    return cloudClient.onSessionChange(next => {
      setSession(next);
      setCloudState(next ? navigator.onLine ? 'synced' : 'offline' : 'offline');
    });
  }, [cloudClient]);
  useEffect(() => {
    if (!cloudGateway) return;
    void refreshPublicArchives().catch(() => setCloudState(current => current === 'local' ? current : 'error'));
  }, [cloudGateway, refreshPublicArchives]);
  useEffect(() => { if (session) void synchronize(); }, [session, synchronize]);
  useEffect(() => {
    if (!cloudEnabled) return;
    const onOnline = () => { if (session) void synchronize(); };
    const onOffline = () => setCloudState('offline');
    const onVisibility = () => { if (document.visibilityState === 'visible' && session) void synchronize(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cloudEnabled, session, synchronize]);
  useEffect(() => {
    if (ready) return;
    const fallback = window.setTimeout(() => setReady(true), 6000);
    return () => window.clearTimeout(fallback);
  }, [ready]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2300);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openNewArchive = (place: Place) => {
    setArchiveModal({ place: placeSnapshot(place), mode: 'form' });
  };

  const openPlaceArchives = async (place: Place) => {
    const snapshot = placeSnapshot(place);
    const placeArchives = archives.filter(archive => archive.placeId === snapshot.id);
    if (placeArchives.length === 1) {
      setArchiveModal({ place: placeArchives[0].place, mode: 'detail', archive: placeArchives[0] });
      return;
    }
    setArchiveModal({ place: snapshot, mode: placeArchives.length > 0 ? 'list' : 'form' });
  };

  const createArchive = async (input: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    if (!input.title || !input.locationName) {
      setToast('请补全必填信息');
      return;
    }
    const place = await enrichPlaceSnapshot(input.place);
    const archive = await repository.create({
      ...input,
      ownerId: session?.user.id ?? 'local-demo-user',
      visibility: 'private',
      revision: 0,
      place,
      placeId: place.id
    });
    await refresh();
    setArchiveModal({ place: archive.place, mode: 'detail', archive });
    setToast(session ? '民族志档案已保存，等待同步' : '民族志档案已保存到本机');
    if (session) void synchronize();
  };

  const updateArchive = async (archive: EthnographyArchive, input: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    if (!input.title || !input.locationName) {
      setToast('请补全必填信息');
      return;
    }
    const place = await enrichPlaceSnapshot(input.place);
    const updated = await repository.update(archive.id, {
      ...input,
      ownerId: archive.ownerId,
      visibility: archive.visibility ?? 'private',
      revision: archive.revision,
      place,
      placeId: place.id
    });
    await refresh();
    setArchiveModal({ place: updated.place, mode: 'detail', archive: updated });
    setToast('民族志档案已更新');
    if (session) void synchronize();
  };

  const removeArchive = async (archive: EthnographyArchive) => {
    if (isPublicDemoArchive(archive)) return;
    if (!window.confirm(`确定删除《${archive.title}》吗？`)) return;
    await repository.remove(archive.id);
    await refresh();
    setArchiveModal({ place: archive.place, mode: 'list' });
    if (session) void synchronize();
  };

  const toggleArchiveVisibility = async (archive: EthnographyArchive) => {
    if (!session || archive.ownerId !== session.user.id) return;
    const visibility = archive.visibility === 'public' ? 'private' : 'public';
    const updated = await repository.update(archive.id, { visibility });
    await refresh();
    setArchiveModal({ place: updated.place, mode: 'detail', archive: updated });
    setToast(visibility === 'public' ? '正在发布档案' : '正在转为私人草稿');
    await synchronize();
  };

  const signIn = async (email: string, password: string) => {
    if (!cloudClient) throw new CloudApiError('云端同步尚未配置', 503);
    await cloudClient.signInWithPassword(email.trim(), password);
    setToast('登录成功');
  };

  const signOut = async () => {
    await cloudClient?.signOut();
    setToast('已退出云端账号，本机私人缓存已隐藏');
  };

  const exportArchives = useCallback(async () => {
    if (visibleLocalArchives.length === 0) {
      setToast('当前没有需要导出的私人档案');
      return;
    }
    setToast('正在准备可移植备份');
    const portableArchives = cloudGateway && session
      ? await Promise.all(visibleLocalArchives.map(archive => cloudGateway.media.materializeForBackup(archive)))
      : visibleLocalArchives;
    const content = serializeArchiveBackup(portableArchives.map(archive => ({ ...archive, syncStatus: 'local' as const })));
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ethnographic-archives-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setToast(`已导出 ${visibleLocalArchives.length} 份私人档案`);
  }, [visibleLocalArchives, cloudGateway, session]);

  const claimLocalArchives = async () => {
    if (!session || !localRepository || legacyArchiveCount === 0) return;
    try {
      await exportArchives();
      const count = await localRepository.claimLocalArchives(session.user.id);
      await refresh();
      setToast(`已将 ${count} 份本机档案加入同步队列`);
      await synchronize();
    } catch (error) {
      setToast(error instanceof CloudApiError ? error.message : '本机档案上传准备失败，原数据未改变');
    }
  };

  const resolveConflict = async (archiveId: string, resolution: 'local' | 'remote') => {
    if (!localRepository) return;
    await localRepository.resolveConflict(archiveId, resolution);
    await refresh();
    setToast(resolution === 'local' ? '已选择本机版本，等待重新同步' : '已采用云端版本');
    if (resolution === 'local') await synchronize();
  };

  const importArchives = async (file: File, mode: 'merge' | 'replace') => {
    if (file.size > MAX_ARCHIVE_IMPORT_BYTES) {
      setToast('备份文件超过 20 MB，已停止导入');
      return;
    }
    if (mode === 'replace' && localArchives.length > 0 &&
      !window.confirm(`覆盖导入会先移除本机现有的 ${localArchives.length} 份私人档案。确定继续吗？`)) return;
    setImportingArchives(true);
    try {
      const backup = parseArchiveBackup(await file.text());
      const demoIds = new Set(PUBLIC_DEMO_ARCHIVES.map(archive => archive.id));
      const personalArchives = backup.archives
        .filter(archive => !isPublicDemoArchive(archive) && !demoIds.has(archive.id))
        .map(archive => ({
          ...archive,
          ownerId: session?.user.id ?? 'local-demo-user',
          visibility: 'private' as const,
          revision: 0,
          serverSequence: undefined,
          syncStatus: cloudEnabled ? 'pending' as const : 'local' as const
        }));
      const restoredCount = await repository.restore(personalArchives, mode);
      await refresh();
      setToast(`已${mode === 'merge' ? '合并' : '恢复'} ${restoredCount} 份私人档案`);
      if (session) void synchronize();
    } catch (error) {
      const message = error instanceof ArchiveBackupError ? error.message : '导入失败，请检查备份文件';
      setToast(message);
    } finally {
      setImportingArchives(false);
    }
  };

  const clearArchives = async () => {
    if (localArchives.length === 0) return;
    if (window.confirm('清空前建议下载一份 JSON 备份。现在下载吗？')) await exportArchives();
    if (!window.confirm(`确定清空本机保存的 ${localArchives.length} 份私人档案吗？公开演示档案会保留，此操作无法撤销。`)) return;
    await repository.clear();
    await refresh();
    setPanelOpen(false);
    setArchiveModal(null);
  };

  const openArchive = (archive: EthnographyArchive) => {
    setPanelOpen(false);
    setSearchOpen(false);
    setArchiveModal({ place: archive.place, mode: 'detail', archive });
  };

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchSubmitted(false);
      return;
    }
    setSearchOpen(true);
    setSearchSubmitted(true);
    setSearching(true);
    try {
      const results = [...await searchPlaces(query), ...searchArchives(query, archives)]
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'zh-CN'))
        .slice(0, 18);
      setSearchResults(results);
      if (results.length === 0) setToast('没有找到匹配地点');
    } finally {
      setSearching(false);
    }
  };

  const selectSearchResult = (result: SearchResult) => {
    setHighlightedPlaces(result.kind === 'author' ? result.places ?? [] : []);
    setFocusTarget({ latitude: result.latitude, longitude: result.longitude, zoom: result.zoom });
    setSearchOpen(false);
    setToast(result.kind === 'author' ? `已高亮 ${result.name} 的田野地点` : `正在定位 ${result.name}`);
  };

  const showAuthorTrajectory = async (author: ArchiveAuthor) => {
    const legs = fieldworkForAuthor(archives, author.name);
    if (legs.length === 0) {
      setToast(`${author.name} 尚未录入可排序的田野时间`);
      return;
    }
    const geography = await loadGeography();
    const country = geography.countries().find(region => region.name === author.nationality?.name || region.code === author.nationality?.countryCode);
    const anchor = country ? representativePoint(country) : undefined;
    const origin: PlaceSnapshot[] = country && anchor ? [{
      id: `nationality-${country.code}`,
      name: country.name,
      kind: 'country',
      countryCode: country.code,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      parents: [country.continent].filter(Boolean) as string[],
      continent: country.continent,
      source: 'natural-earth'
    }] : [];
    const places = [...origin, ...legs.map(leg => leg.place)];
    setHighlightedPlaces([]);
    setTrajectorySteps([...origin.map(place => ({ place })), ...legs.map(leg => ({ place: leg.place, start: leg.start }))]);
    setFocusTarget({
      latitude: places.reduce((sum, place) => sum + place.latitude, 0) / places.length,
      longitude: places.reduce((sum, place) => sum + place.longitude, 0) / places.length,
      zoom: places.length > 1 ? 1.8 : 4.2
    });
    setArchiveModal(null);
    setToast(country ? `正在呈现 ${author.name} 的田野轨迹` : `未找到 ${author.nationality?.name} 的国家点位，已呈现田野地点`);
  };

  const showNationalityTrajectory = async (countryCode: string) => {
    const geography = await loadGeography();
    const country = geography.countryByCode(countryCode);
    const entries = fieldworkForNationality(archives, countryCode, country?.name);
    if (!country || entries.length === 0) {
      setToast('该国籍尚未录入带田野开始时间的档案');
      return;
    }
    const anchor = representativePoint(country);
    const origin: PlaceSnapshot = {
      id: `nationality-${country.code}`, name: country.name, kind: 'country', countryCode: country.code,
      latitude: anchor.latitude, longitude: anchor.longitude, parents: [country.continent].filter(Boolean) as string[], continent: country.continent, source: 'natural-earth'
    };
    const places = [origin, ...entries.map(entry => entry.leg.place)];
    setHighlightedPlaces([]);
    setTrajectorySteps([{ place: origin }, ...entries.map(entry => ({ place: entry.leg.place, start: entry.leg.start, label: `${entry.leg.start} · ${entry.author.name}` }))]);
    setFocusTarget({ latitude: places.reduce((sum, place) => sum + place.latitude, 0) / places.length, longitude: places.reduce((sum, place) => sum + place.longitude, 0) / places.length, zoom: 1.8 });
    setToast(`正在呈现 ${country.name} 人类学家的田野网络`);
  };

  const setModalMode = (mode: ArchiveModalState['mode']) => {
    setArchiveModal(current => {
      if (!current) return current;
      if (mode === 'detail' || mode === 'note' || mode === 'edit') {
        if (!current.archive) return current;
        return { place: current.place, mode, archive: current.archive };
      }
      return { place: current.place, mode };
    });
  };

  const modalOpen = Boolean(archiveModal);

  return <main className="app-shell">
    <SceneErrorBoundary><EarthScene points={points} archivedPlaceIds={archivedPlaceIds} nationalityCountryCodes={nationalityCountryCodes} highlightedPlaces={highlightedPlaces} trajectorySteps={trajectorySteps} interactionPaused={modalOpen} viewMode={viewMode} archiveHoverActive={hoverArchives.length > 0} onAdd={place => openNewArchive(place)} onViewArchives={place => void openPlaceArchives(place)} onViewNationalityTrajectory={code => void showNationalityTrajectory(code)} onMiss={() => setToast('附近没有可建档地点，请稍微移动后再试')} onExplore={setToast} onFocus={setFocusTarget} focusTarget={focusTarget} onFocused={() => setFocusTarget(null)} onReady={() => setReady(true)} onHoverLocation={handleHoverLocation} /></SceneErrorBoundary>
    <div className={`loading-screen ${ready ? 'is-hidden' : ''}`}><div className="loading-orbit"><i /></div><span>正在展开世界地图</span></div>
    <div className="brand"><strong>民族志数据档案</strong></div>
    <div className="hint"><span className="mouse-glyph" />悬停查看区域 · 点击地名建立民族志档案</div>
    <div className="search-dock">
      <form onSubmit={event => { event.preventDefault(); void runSearch(); }}>
        <button type="submit" className="search-submit" aria-label="搜索"><Search size={17} /></button>
        <input value={searchQuery} onChange={event => { setSearchQuery(event.currentTarget.value); setSearchOpen(false); setSearchSubmitted(false); }} placeholder="地点、民族志或作者" />
      </form>
    </div>
    <div className="top-actions">
      <div className="view-switch" aria-label="地图视图">
        <button className={viewMode === 'globe' ? 'is-active' : ''} onClick={() => setViewMode('globe')} aria-pressed={viewMode === 'globe'}><Globe2 size={14} />地球</button>
        <button className={viewMode === 'map' ? 'is-active' : ''} onClick={() => setViewMode('map')} aria-pressed={viewMode === 'map'}><MapIcon size={14} />平面</button>
      </div>
      <button className={`top-action-button ${timeOpen || timeYear !== null ? 'is-active' : ''}`} onClick={() => { setTimeOpen(open => !open); setNetworkOpen(false); setThemeOpen(false); if (timeYear === null) setTimeYear(minYear); }}><CalendarRange size={14} />时间图谱</button>
      <button className={`top-action-button ${networkOpen || trajectorySteps.length > 0 ? 'is-active' : ''}`} onClick={() => { setNetworkOpen(open => !open); setTimeOpen(false); setThemeOpen(false); }}><Network size={14} />研究网络</button>
      <button className={`top-action-button ${themeOpen || selectedTags.length > 0 ? 'is-active' : ''}`} onClick={() => { setThemeOpen(open => !open); setTimeOpen(false); setNetworkOpen(false); }}><Layers3 size={14} />主题图层</button>
      <button className="garden-button" onClick={() => { setPanelOpen(true); setSearchOpen(false); }} aria-label="打开地点档案"><MapPinned size={14} />地点档案</button>
      <CloudAccount enabled={cloudEnabled} session={session} state={cloudState} onSignIn={signIn} onSignOut={signOut} onSync={synchronize} />
    </div>
    <SearchPanel open={searchOpen && searchSubmitted} query={searchQuery} results={searchResults} searching={searching} onSelect={selectSearchResult} />
    <ArchiveIndexPanel open={panelOpen} archives={archives} localArchiveCount={visibleLocalArchives.length} importing={importingArchives} cloudEnabled={cloudEnabled} session={session} cloudState={cloudState} legacyCount={legacyArchiveCount} conflicts={visibleConflicts} onClose={() => setPanelOpen(false)} onOpen={openArchive} onExport={() => void exportArchives().catch(error => setToast(error instanceof CloudApiError ? error.message : '备份导出失败'))} onImport={(file, mode) => void importArchives(file, mode)} onClear={() => void clearArchives()} onClaim={() => void claimLocalArchives()} onSync={() => void synchronize()} onResolveConflict={(archiveId, resolution) => void resolveConflict(archiveId, resolution)} />
    <TimeAtlas open={timeOpen} mode={timeMode} year={activeYear} minYear={minYear} maxYear={maxYear} count={displayedArchives.length} playing={timePlaying} onMode={mode => { setTimeMode(mode); setTimeYear(activeYear); setTimePlaying(false); }} onYear={year => { setTimeYear(year); setTimePlaying(false); }} onTogglePlay={() => { if (activeYear >= maxYear) setTimeYear(minYear); setTimePlaying(value => !value); }} onClose={() => { setTimeOpen(false); setTimePlaying(false); }} onClear={() => { setTimeYear(null); setTimePlaying(false); setTimeOpen(false); }} />
    <ResearchNetworkPanel open={networkOpen} archives={archives} onClose={() => setNetworkOpen(false)} onAuthor={author => { setViewMode('map'); setNetworkOpen(false); void showAuthorTrajectory(author); }} onNationality={code => { setViewMode('map'); setNetworkOpen(false); void showNationalityTrajectory(code); }} onClear={() => { setTrajectorySteps([]); setHighlightedPlaces([]); setToast('已清除研究网络'); }} />
    <ThemeLayerPanel open={themeOpen} tags={themeTags} selected={selectedTags} onToggle={key => setSelectedTags(current => current.includes(key) ? current.filter(tag => tag !== key) : [...current, key])} onClear={() => setSelectedTags([])} onClose={() => setThemeOpen(false)} />
    {hoverArchiveLocation && hoverArchives.length > 0 && !modalOpen && <HoverArchiveShelf location={hoverArchiveLocation} archives={hoverArchives} onOpen={archive => { clearHoverShelf(false); openArchive(archive); }} onEnter={keepHoverShelf} onLeave={() => clearHoverShelf()} />}
    <div className={`scrim ${modalOpen ? 'is-visible' : ''}`} onClick={() => setArchiveModal(null)} />
    <ArchiveModal state={archiveModal} archives={archives} currentUserId={session?.user.id} cloudEnabled={cloudEnabled} onClose={() => setArchiveModal(null)} onCreate={createArchive} onUpdate={updateArchive} onOpen={openArchive} onMode={setModalMode} onRemove={archive => void removeArchive(archive)} onTrace={author => void showAuthorTrajectory(author)} onVisibility={archive => void toggleArchiveVisibility(archive)} onError={setToast} />
    <div className={`toast ${toast ? 'is-visible' : ''}`} role="status">{toast}</div>
  </main>;
}
