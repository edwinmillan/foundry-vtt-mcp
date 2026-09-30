/**
 * Helpers for Anima Beyond Fantasy via the abfalter system (id "abfalter",
 * github.com/Lumenita/abfalter).
 *
 * The roll logic mirrors the system's own dice roller (module/diceroller.js)
 * and combat tracker (module/combat.js), including its "corrected" (core
 * rules) settings. Dice are injected so the rules can be unit-tested.
 */

export const ABF_SYSTEM_ID = 'abfalter';

/** system.stats keys; `aliases` are matched case-insensitively. */
export const ABF_CHARACTERISTICS: Array<{ key: string; aliases: string[] }> = [
  { key: 'Agility', aliases: ['agi', 'agility'] },
  { key: 'Constitution', aliases: ['con', 'constitution'] },
  { key: 'Strength', aliases: ['str', 'strength'] },
  { key: 'Dexterity', aliases: ['dex', 'dexterity'] },
  { key: 'Perception', aliases: ['per', 'perception'] },
  { key: 'Intelligence', aliases: ['int', 'intelligence'] },
  { key: 'Power', aliases: ['pow', 'power'] },
  { key: 'Willpower', aliases: ['wp', 'wil', 'will', 'willpower'] },
];

/** system.resistances keys. */
export const ABF_RESISTANCES: Array<{ key: string; aliases: string[] }> = [
  { key: 'Physical', aliases: ['phr', 'physical', 'physical resistance'] },
  { key: 'Disease', aliases: ['dr', 'disease', 'disease resistance'] },
  { key: 'Poison', aliases: ['psnr', 'poison', 'poison resistance'] },
  { key: 'Magic', aliases: ['mr', 'magic', 'magic resistance'] },
  { key: 'Psychic', aliases: ['psyr', 'pr', 'psychic', 'psychic resistance'] },
];

/**
 * Display names for secondary abilities whose system.secondaryFields key is
 * abbreviated. Keys not listed here are displayed capitalized.
 */
export const ABF_SECONDARY_LABELS: Record<string, string> = {
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

/** Resource name → system path of a { value, max } pool. */
export const ABF_RESOURCE_PATHS: Record<string, string> = {
  lifePoints: 'lp',
  fatigue: 'fatigue',
  zeon: 'zeon',
  ki: 'unifiedKi',
  psychicPoints: 'psychicPoint',
  shield: 'shield',
  mentalHealth: 'mentalHealth',
};

/** Editable system.info fields. */
export const ABF_INFO_FIELDS = [
  'race',
  'gender',
  'age',
  'height',
  'weight',
  'size',
  'appearance',
  'notesOne',
  'notesTwo',
  'destiny',
  'gnosis',
];

export type AbfRollType =
  | 'characteristic'
  | 'resistance'
  | 'secondary'
  | 'attack'
  | 'block'
  | 'dodge'
  | 'initiative'
  | 'magicProjection'
  | 'psychicProjection'
  | 'psychicPotential'
  | 'value';

/** Anima's difficulty ladder for secondary-ability checks. */
export const ABF_DIFFICULTIES: Array<{ name: string; value: number }> = [
  { name: 'Routine', value: 20 },
  { name: 'Easy', value: 40 },
  { name: 'Medium', value: 80 },
  { name: 'Difficult', value: 120 },
  { name: 'Very Difficult', value: 140 },
  { name: 'Absurd', value: 180 },
  { name: 'Almost Impossible', value: 240 },
  { name: 'Impossible', value: 280 },
  { name: 'Inhuman', value: 320 },
  { name: 'Zen', value: 440 },
];

export function normalizeAbfName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function secondaryLabel(key: string): string {
  return ABF_SECONDARY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function findAliased(
  list: Array<{ key: string; aliases: string[] }>,
  name: string
): string | undefined {
  const wanted = normalizeAbfName(name);
  return list.find(e => e.aliases.some(a => normalizeAbfName(a) === wanted))?.key;
}

export function findCharacteristic(name: string): string | undefined {
  return findAliased(ABF_CHARACTERISTICS, name);
}

export function findResistance(name: string): string | undefined {
  return findAliased(ABF_RESISTANCES, name);
}

/**
 * Find a built-in secondary ability in system.secondaryFields by key or
 * display name ("Feats of Strength", "featsofstr", "Notice").
 */
export function findSecondary(
  secondaryFields: Record<string, any> | null | undefined,
  name: string
): { category: string; key: string; entry: any } | null {
  if (!secondaryFields) return null;
  const wanted = normalizeAbfName(name);
  for (const [category, abilities] of Object.entries(secondaryFields)) {
    if (category === 'category' || !abilities || typeof abilities !== 'object') continue;
    for (const [key, entry] of Object.entries(abilities as Record<string, any>)) {
      if (normalizeAbfName(key) === wanted || normalizeAbfName(secondaryLabel(key)) === wanted) {
        return { category, key, entry };
      }
    }
  }
  return null;
}

/** Parse a difficulty given as a number or a ladder name ("Very Difficult"). */
export function parseDifficulty(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const wanted = normalizeAbfName(value);
  const named = ABF_DIFFICULTIES.find(d => normalizeAbfName(d.name) === wanted);
  if (named) return named.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/** The highest difficulty on the ladder a total reaches, or null below Routine. */
export function difficultyReached(total: number): string | null {
  let reached: string | null = null;
  for (const d of ABF_DIFFICULTIES) if (total >= d.value) reached = d.name;
  return reached;
}

export interface AbfRollSettings {
  /** system.rollRange.final (default 90) */
  openRange: number;
  /** system.fumleRange.final (default 3) */
  fumbleRange: number;
  /** system.rollRange.doubles: 11, 22 … 88 also open */
  doubles: boolean;
  /** system.rollRange.limits: none | single | double | triple | unlucky */
  limits: string;
  /** abfalter setting Corrected_OpenRoll: core rules, each open roll needs range + 1 */
  correctedOpenRoll: boolean;
  /** abfalter setting Corrected_Fumble: the fumble roll does not subtract the fumble level */
  correctedFumble: boolean;
}

export interface AbfOpenRollResult {
  /** Every d100 rolled, in order (the fumble roll included). */
  dice: number[];
  total: number;
  openRolls: number;
  /** level: the fumble level (or initiative penalty); roll: the fumble d100 */
  fumble?: { level: number; roll?: number };
}

const DOUBLES = [11, 22, 33, 44, 55, 66, 77, 88];
const OPEN_LIMITS: Record<string, number> = { single: 1, double: 2, triple: 3 };

/**
 * A d100 open roll the way the abfalter system resolves one: a result at or
 * above the open range rolls again and adds, and a result at or below the
 * fumble range is a fumble (a second d100 is subtracted, plus 15 per point
 * under the fumble range unless the corrected-fumble setting is on).
 *
 * The system asks the player to click for each follow-up roll; here they are
 * all resolved at once.
 */
export async function abfOpenRoll(
  base: number,
  settings: AbfRollSettings,
  d100: () => Promise<number>
): Promise<AbfOpenRollResult> {
  const first = await d100();
  const dice = [first];
  let total = base + first;

  if (first <= settings.fumbleRange) {
    const level = 15 * (settings.fumbleRange - first);
    const roll = await d100();
    dice.push(roll);
    total -= roll + (settings.correctedFumble ? 0 : level);
    return { dice, total, openRolls: 0, fumble: { level, roll } };
  }

  if (settings.limits === 'unlucky') return { dice, total, openRolls: 0 };

  const isDouble = (n: number) => settings.doubles && DOUBLES.includes(n);
  const maxOpenRolls = OPEN_LIMITS[settings.limits] ?? Infinity;
  let openRange = settings.openRange;
  let previous = first;
  let explode = first >= openRange || isDouble(first);
  if (first > openRange) openRange = first;
  if (settings.correctedOpenRoll) openRange = settings.openRange;

  let openRolls = 0;
  while (explode && openRolls < maxOpenRolls) {
    const roll = await d100();
    dice.push(roll);
    total += roll;
    openRolls++;

    if (settings.correctedOpenRoll) {
      // Core rules: each further open roll needs one more than the last range.
      openRange += 1;
      explode = roll >= openRange || isDouble(roll);
    } else if (roll === 100) {
      explode = true;
      openRange = 100;
    } else if (isDouble(roll) && roll > previous) {
      explode = true;
      if (roll > openRange) openRange = roll;
    } else if (roll > openRange) {
      explode = true;
      openRange = roll;
    } else {
      explode = false;
    }
    previous = roll;
  }

  return { dice, total, openRolls };
}

/**
 * Initiative as the abfalter combat tracker rolls it: 1d100 + initiative, a
 * flat -125/-100/-75 on a fumble, and open rolls only when the system's
 * Corrected_InitiativeRoll setting is on.
 */
export async function abfInitiativeRoll(
  base: number,
  settings: AbfRollSettings & { openInitiative: boolean },
  d100: () => Promise<number>
): Promise<AbfOpenRollResult> {
  const first = await d100();
  if (first <= settings.fumbleRange) {
    const penalty = first === 1 ? 125 : first === 2 ? 100 : 75;
    return {
      dice: [first],
      total: base + first - penalty,
      openRolls: 0,
      fumble: { level: penalty },
    };
  }
  if (!settings.openInitiative) return { dice: [first], total: base + first, openRolls: 0 };
  let rolled = false;
  return abfOpenRoll(base, settings, async () => {
    if (!rolled) {
      rolled = true;
      return first;
    }
    return d100();
  });
}

/**
 * A characteristic check: 1d10 + characteristic, where a 1 counts as -3 more
 * and a 10 as +2 more.
 */
export function abfCharacteristicTotal(
  base: number,
  die: number
): { total: number; fumble: boolean; open: boolean } {
  if (die === 1) return { total: base + die - 3, fumble: true, open: false };
  if (die === 10) return { total: base + die + 2, fumble: false, open: true };
  return { total: base + die, fumble: false, open: false };
}

/**
 * Damage percentage for an attack that beats a defense by `diff`, from the
 * system's combat resolution (calculateDamagePercentage), or the core/Exxet
 * formula when the system's "resDmgFormula" combat setting is on.
 */
export function abfDamagePercent(diff: number, armor: number, coreFormula = false): number {
  if (diff <= 0) return 0;
  if (coreFormula) return Math.max(0, Math.floor((diff - 20 - 10 * armor) / 10) * 10);
  if (armor === 0) {
    if (diff < 30) return 0;
    if (diff < 40) return 10;
    if (diff < 50) return 30;
    if (diff < 60) return 50;
    return (Math.floor((diff - 60) / 10) + 6) * 10;
  }
  if (armor === 1) {
    if (diff < 30) return 0;
    if (diff < 40) return 10;
    if (diff < 50) return 20;
    if (diff < 60) return 40;
    return (Math.floor((diff - 60) / 10) + 5) * 10;
  }
  const start = armor * 10;
  if (diff <= start) return 0;
  return Math.floor((diff - start) / 10) * 10;
}

export function escapeAbfHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
