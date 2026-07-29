import type { GeographyLevel, Place, PlaceKind } from './types';

type AdminTier = 'adm0' | 'adm1' | 'adm2' | 'adm3' | 'adm4';

type CountryAdminTerms = Partial<Record<AdminTier, string>>;

const genericTerms: Record<AdminTier, string> = {
  adm0: '国家 / 地区',
  adm1: '一级行政区',
  adm2: '二级行政区',
  adm3: '三级行政区',
  adm4: '基层行政区'
};

const countryTerms: Record<string, CountryAdminTerms> = {
  CHN: { adm0: '国家', adm1: '省级行政区', adm2: '地级行政区', adm3: '县级行政区', adm4: '乡级行政区' },
  USA: { adm0: '国家', adm1: '州 / 特区 / 属地', adm2: '县 / 郡 / 堂区', adm3: '市镇 / 镇区' },
  CAN: { adm0: '国家', adm1: '省 / 地区', adm2: '县 / 区域自治体', adm3: '市镇' },
  AUS: { adm0: '国家', adm1: '州 / 领地', adm2: '地方政府区域', adm3: '市镇 / 地方辖区' },
  IND: { adm0: '国家', adm1: '邦 / 中央直辖区', adm2: '县', adm3: '乡 / 街区' },
  JPN: { adm0: '国家', adm1: '都道府县', adm2: '市 / 区 / 町 / 村' },
  KOR: { adm0: '国家', adm1: '道 / 广域市 / 特别市', adm2: '市 / 郡 / 区' },
  GBR: { adm0: '国家', adm1: '构成国 / 省级地区', adm2: '郡 / 单一管理区 / 区', adm3: '市镇 / 教区' },
  FRA: { adm0: '国家', adm1: '大区 / 海外领地', adm2: '省', adm3: '区 / 市镇' },
  DEU: { adm0: '国家', adm1: '州', adm2: '行政区 / 县', adm3: '市镇' },
  RUS: { adm0: '国家', adm1: '联邦主体', adm2: '区 / 市辖区' },
  BRA: { adm0: '国家', adm1: '州 / 联邦区', adm2: '市镇' },
  MEX: { adm0: '国家', adm1: '州 / 联邦实体', adm2: '市镇' },
  ARG: { adm0: '国家', adm1: '省 / 自治市', adm2: '县 / 区' },
  ESP: { adm0: '国家', adm1: '自治区 / 自治市', adm2: '省', adm3: '市镇' },
  ITA: { adm0: '国家', adm1: '大区', adm2: '省 / 都会市', adm3: '市镇' },
  NLD: { adm0: '国家', adm1: '省 / 国家 / 特别市', adm2: '市镇' },
  BEL: { adm0: '国家', adm1: '大区 / 社群', adm2: '省', adm3: '市镇' },
  CHE: { adm0: '国家', adm1: '州', adm2: '区', adm3: '市镇' },
  AUT: { adm0: '国家', adm1: '州', adm2: '县 / 法定市', adm3: '市镇' },
  SWE: { adm0: '国家', adm1: '省 / 大区', adm2: '市镇' },
  NOR: { adm0: '国家', adm1: '郡', adm2: '市镇' },
  FIN: { adm0: '国家', adm1: '区', adm2: '市镇' },
  DNK: { adm0: '国家', adm1: '大区', adm2: '市镇' },
  POL: { adm0: '国家', adm1: '省', adm2: '县', adm3: '乡' },
  TUR: { adm0: '国家', adm1: '省', adm2: '县 / 区' },
  IDN: { adm0: '国家', adm1: '省 / 特区', adm2: '县 / 市', adm3: '区' },
  THA: { adm0: '国家', adm1: '府 / 特别行政区', adm2: '县', adm3: '乡' },
  VNM: { adm0: '国家', adm1: '省 / 直辖市', adm2: '县 / 郡 / 市', adm3: '社 / 坊 / 市镇' },
  PHL: { adm0: '国家', adm1: '大区', adm2: '省 / 独立市', adm3: '市 / 自治市' },
  MYS: { adm0: '国家', adm1: '州 / 联邦直辖区', adm2: '县', adm3: '巫金 / 地方辖区' },
  NZL: { adm0: '国家', adm1: '大区 / 特别岛屿管理区', adm2: '地方辖区' },
  ZAF: { adm0: '国家', adm1: '省', adm2: '区自治市', adm3: '地方自治市' },
  NGA: { adm0: '国家', adm1: '州 / 首都区', adm2: '地方政府区' },
  EGY: { adm0: '国家', adm1: '省', adm2: '区 / 县' },
  ETH: { adm0: '国家', adm1: '州 / 行政区', adm2: '专区', adm3: '县' },
  KEN: { adm0: '国家', adm1: '郡', adm2: '分郡' },
  MAR: { adm0: '国家', adm1: '大区', adm2: '省 / 专区' },
  SAU: { adm0: '国家', adm1: '省 / 大区', adm2: '省辖区' },
  IRN: { adm0: '国家', adm1: '省', adm2: '县', adm3: '区' },
  IRQ: { adm0: '国家', adm1: '省 / 大区', adm2: '区' },
  PAK: { adm0: '国家', adm1: '省 / 自治地区 / 首都区', adm2: '县' },
  BGD: { adm0: '国家', adm1: '专区', adm2: '县', adm3: '乌帕齐拉' },
  NPL: { adm0: '国家', adm1: '省', adm2: '县 / 地方单位' },
  PER: { adm0: '国家', adm1: '大区 / 省级市', adm2: '省', adm3: '区' },
  COL: { adm0: '国家', adm1: '省 / 首都区', adm2: '市镇' },
  CHL: { adm0: '国家', adm1: '大区', adm2: '省', adm3: '市镇' }
};

const placeKindTerms: Record<PlaceKind, string> = {
  country: '国家 / 地区',
  province: '一级行政区',
  island: '岛屿',
  district: '城区 / 街区',
  county: '二级行政区',
  city: '城市',
  town: '城镇',
  village: '村庄'
};

export function administrativeTerm(countryCode: string | undefined, tier: AdminTier) {
  if (!countryCode) return genericTerms[tier];
  return countryTerms[countryCode]?.[tier] ?? genericTerms[tier];
}

export function geographyLevelLabel(level: GeographyLevel, countryCode?: string) {
  if (level === 'continent') return '大洲 / 地理区域';
  if (level === 'country') return administrativeTerm(countryCode, 'adm0');
  if (level === 'admin1') return administrativeTerm(countryCode, 'adm1');
  return '地点';
}

export function placeKindLabel(kind: PlaceKind, countryCode?: string) {
  if (kind === 'country') return administrativeTerm(countryCode, 'adm0');
  if (kind === 'province') return administrativeTerm(countryCode, 'adm1');
  if (countryCode === 'CHN' && (kind === 'county' || kind === 'district')) return administrativeTerm(countryCode, 'adm3');
  if (kind === 'county') return administrativeTerm(countryCode, 'adm2');
  return placeKindTerms[kind];
}

export function placeDisplayLabel(place: Pick<Place, 'kind' | 'countryCode'>) {
  return placeKindLabel(place.kind, place.countryCode);
}
