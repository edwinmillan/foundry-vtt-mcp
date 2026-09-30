/**
 * Anima Beyond Fantasy (abfalter) constants and helpers.
 *
 * The abfalter system (github.com/Lumenita/abfalter) has a single "character"
 * actor type for PCs, NPCs, and creatures. Totals such as characteristic
 * finals, combat values, and secondary abilities are derived by the system
 * (system.*.final) and arrive already computed in the actor data.
 */

export const SYSTEM_ID = 'abfalter';

export const ACTOR_TYPES = {
  CHARACTER: 'character',
} as const;

/** system.stats keys with their sheet abbreviations. */
export const CHARACTERISTICS: Array<{ key: string; short: string }> = [
  { key: 'Agility', short: 'AGI' },
  { key: 'Constitution', short: 'CON' },
  { key: 'Strength', short: 'STR' },
  { key: 'Dexterity', short: 'DEX' },
  { key: 'Perception', short: 'PER' },
  { key: 'Intelligence', short: 'INT' },
  { key: 'Power', short: 'POW' },
  { key: 'Willpower', short: 'WP' },
];

/** system.resistances keys with their sheet abbreviations. */
export const RESISTANCES: Array<{ key: string; short: string }> = [
  { key: 'Physical', short: 'PhR' },
  { key: 'Disease', short: 'DR' },
  { key: 'Poison', short: 'PsnR' },
  { key: 'Magic', short: 'MR' },
  { key: 'Psychic', short: 'PsyR' },
];

/** Display names for secondary abilities whose system key is abbreviated. */
export const SECONDARY_LABELS: Record<string, string> = {
  featsofstr: 'Feats of Strength',
  withstpain: 'Withstand Pain',
  kidetection: 'Ki Detection',
  kiconceal: 'Ki Concealment',
  magicappr: 'Magic Appraisal',
  herballore: 'Herbal Lore',
  traplore: 'Trap Lore',
  slofhand: 'Sleight of Hand',
  ritualcalig: 'Ritual Calligraphy',
  toymaking: 'Toymaking',
  technomagic: 'Technomagic',
};

export function secondaryLabel(key: string): string {
  return SECONDARY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Item types grouped the way get-character reports them. */
export const ITEM_GROUPS: Record<string, string[]> = {
  weapons: ['weapon'],
  armor: ['armor'],
  ammo: ['ammo'],
  inventory: ['inventory'],
  classes: ['class'],
  advantages: ['advantage'],
  customSecondaries: ['secondary'],
  background: ['elan', 'proficiency', 'backgroundInfo'],
  spells: ['spell', 'spellPath', 'zeonMaint'],
  summoning: ['incarnation', 'invocation'],
  psychic: ['discipline', 'psychicMatrix', 'mentalPattern', 'maintPower'],
  ki: ['kiAbility', 'kiTechnique', 'arsMagnus', 'martialArt', 'kiSealCreature'],
  creaturePowers: ['monsterPower'],
};

export const FIELD_PATHS = {
  LIFE_POINTS: 'system.lp',
  FATIGUE: 'system.fatigue',
  ZEON: 'system.zeon',
  KI: 'system.unifiedKi',
  PSYCHIC_POINTS: 'system.psychicPoint',
  CHARACTERISTICS: 'system.stats',
  RESISTANCES: 'system.resistances',
  COMBAT: 'system.combatValues',
  INITIATIVE: 'system.initiative',
  SECONDARIES: 'system.secondaryFields',
  LEVEL: 'system.levelinfo.level',
  RACE: 'system.info.race',
  BIOGRAPHY: 'system.info.bio',
} as const;

export function stripHtml(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
