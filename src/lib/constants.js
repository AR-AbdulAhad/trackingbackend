export const EDUCATION_TYPES = [
  'STX',
  'HTX',
  'HHX',
  'HF',
  'EUX',
  'EUD',
  'SOSUASSISTENT',
  'SOSUHJAELPER',
  'FRISOER',
  'KOSMETOLOG',
  'PAEDAGOG',
  'PAU',
  'ERNAERINGSASSISTENT',
  'STU',
  'LANDMAND',
];

export const EDUCATION_ALIASES = {
  STX: ['STX'],
  HTX: ['HTX'],
  HHX: ['HHX'],
  HF: ['HF'],
  EUX: ['EUX'],
  EUD: ['EUD'],
  PAU: ['PAU'],
  STU: ['STU'],
  SOSUASSISTENT: ['SOSUASSISTENT', 'SOSU Assistent', 'Sosuassistent', 'sosuassistent'],
  SOSUHJAELPER: ['SOSUHJAELPER', 'SOSU Hjælper', 'Sosuhjælper', 'sosuhjaelper', 'sosuhjælper'],
  FRISOER: ['FRISOER', 'Frisør', 'Frisoer', 'frisør', 'frisoer'],
  KOSMETOLOG: ['KOSMETOLOG', 'Kosmetolog', 'kosmetolog'],
  PAEDAGOG: ['PAEDAGOG', 'Pædagog', 'Paedagog', 'pædagog', 'paedagog'],
  ERNAERINGSASSISTENT: ['ERNAERINGSASSISTENT', 'Ernæringsassistent', 'Ernaeringsassistent', 'ernæringsassistent', 'ernaeringsassistent'],
  LANDMAND: ['LANDMAND', 'Landmand', 'landmand'],
};

export const normalizeEducationType = (val) => {
  if (!val || typeof val !== 'string') return null;

  let clean = val
    .trim()
    .toUpperCase()
    .replace(/Æ/g, 'AE')
    .replace(/Ø/g, 'OE')
    .replace(/Å/g, 'AA')
    .replace(/[\s\-_]/g, '');

  if (clean === 'FRISOR') clean = 'FRISOER';
  if (clean === 'SOSUHJALPER') clean = 'SOSUHJAELPER';
  if (clean === 'PADAGOG') clean = 'PAEDAGOG';
  if (clean === 'ERNARINGSASSISTENT') clean = 'ERNAERINGSASSISTENT';
  if (clean === 'LANDMAEND') clean = 'LANDMAND';

  return EDUCATION_TYPES.includes(clean) ? clean : null;
};

export const PACKAGE_TYPES = [
  'premium',
  'luksus',
  'standard',
  'basic',
];

export const normalizePackageType = (val) => {
  if (!val || typeof val !== 'string') return null;

  const clean = val.trim().toLowerCase().replace(/[\s\-_]+/g, '');

  if (clean.includes('premium')) return 'premium';
  if (clean.includes('luksus')) return 'luksus';
  if (clean.includes('standard')) return 'standard';
  if (clean.includes('basic') || clean.includes('basichue')) return 'basic';

  return null;
};

export const DEFAULT_CONFIGURATOR_STEPS = [
  'KOKARDE',
  'UDDANNELSESBÅND',
  'BRODERI',
  'BETRÆK',
  'SKYGGE',
  'FOER',
  'EKSTRABETRÆK',
  'TILBEHØR',
  'STØRRELSE',
];

export const STEP_ALIASES = {
  KOKARDE: ['KOKARDE'],
  UDDANNELSESBÅND: ['UDDANNELSESBÅND', 'UDDANNELSESBAND', 'BÅND', 'BAND', 'EMBLEM'],
  BRODERI: ['BRODERI'],
  BETRÆK: ['BETRÆK', 'BETRAEK', 'COVER'],
  SKYGGE: ['SKYGGE', 'SHADE'],
  FOER: ['FOER', 'FODER', 'LINING'],
  EKSTRABETRÆK: ['EKSTRABETRÆK', 'EKSTRABETRAEK', 'EXTRA_COVER', 'HUESNOR', 'SNOR'],
  TILBEHØR: ['TILBEHØR', 'TILBEHOER', 'TILBEH', 'ACCESSORIES'],
  STØRRELSE: ['STØRRELSE', 'STOERRELSE', 'SIZE'],
};

export const normalizeStepName = (val) => {
  if (!val || typeof val !== 'string') return '';
  const upper = val.trim().toUpperCase();
  // Exact canonical match first
  if (STEP_ALIASES[upper]) return upper;
  // Then exact alias match only (no substring — "EKSTRABETRÆK".includes("BETRÆK") would wrongly match)
  for (const [canonical, aliases] of Object.entries(STEP_ALIASES)) {
    if (aliases.some(a => upper === a)) {
      return canonical;
    }
  }
  return upper;
};
