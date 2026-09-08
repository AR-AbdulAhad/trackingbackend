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
