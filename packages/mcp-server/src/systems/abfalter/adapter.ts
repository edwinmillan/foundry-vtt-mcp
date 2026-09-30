/**
 * Anima Beyond Fantasy (abfalter) System Adapter
 *
 * Character-focused SystemAdapter for the abfalter system
 * (github.com/Lumenita/abfalter): characteristics, resistances, combat
 * values, life points and fatigue, secondary abilities, and the magic, psychic
 * and ki blocks. Creature indexing is not supported; an actor's level stands
 * in as its power level.
 */

import type { SystemAdapter, SystemMetadata, SystemCreatureIndex } from '../types.js';
import {
  AbfalterFiltersSchema,
  describeAbfalterFilters,
  matchesAbfalterFilters,
} from './filters.js';
import {
  CHARACTERISTICS,
  FIELD_PATHS,
  ITEM_GROUPS,
  RESISTANCES,
  SYSTEM_ID,
  secondaryLabel,
  stripHtml,
} from './constants.js';

const DESCRIPTION_MAX_CHARS = 300;

/** Per-characteristic ki pools (Intelligence and Perception have none). */
const KI_POOLS = ['agi', 'con', 'dex', 'str', 'pow', 'wp'];

function truncate(text: string, max = DESCRIPTION_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pool(block: any): { value: number; max: number } | undefined {
  if (!block || typeof block !== 'object') return undefined;
  return { value: num(block.value) ?? 0, max: num(block.max) ?? 0 };
}

/** Ki summary: one unified pool, or a pool per characteristic. */
function kiSummary(system: any): any {
  if (system.toggles?.unifiedPools) {
    const ki = system.unifiedKi ?? {};
    if (!num(ki.max)) return undefined;
    return {
      unified: true,
      reserve: num(ki.value) ?? 0,
      max: ki.max,
      accumulated: num(ki.current) ?? 0,
    };
  }
  const pools: Record<string, any> = {};
  for (const key of KI_POOLS) {
    const p = system.kiPool?.[key];
    if (!num(p?.poolTot)) continue;
    pools[key.toUpperCase()] = {
      reserve: num(p.actual) ?? 0,
      max: p.poolTot,
      accumulated: num(p.current) ?? 0,
      accumulation: num(p.accumTot) ?? 0,
    };
  }
  return Object.keys(pools).length > 0 ? { unified: false, pools } : undefined;
}

function summarizeItem(item: any): any {
  const s = item.system ?? {};
  const out: any = { name: item.name };
  switch (item.type) {
    case 'weapon':
    case 'armor':
      if (s.equipped) out.equipped = true;
      if (s.quality) out.quality = s.quality;
      break;
    case 'advantage':
      if (s.cost) out.cost = s.cost;
      break;
    case 'class':
      if (num(s.main?.levels) !== undefined) out.levels = s.main.levels;
      break;
    case 'spell':
      if (s.path) out.path = s.path;
      if (s.level) out.level = s.level;
      if (s.type) out.type = s.type;
      break;
    case 'spellPath':
    case 'kiTechnique':
    case 'psychicMatrix':
    case 'incarnation':
      if (s.level) out.level = s.level;
      break;
    case 'martialArt':
      if (s.degree) out.degree = s.degree;
      break;
    case 'monsterPower': {
      const short = stripHtml(s.shortDesc);
      if (short) out.summary = truncate(short, 120);
      break;
    }
    case 'secondary':
      out.base = s.base ?? 0;
      break;
    case 'inventory':
    case 'ammo':
      if (s.quantity && s.quantity !== 1) out.quantity = s.quantity;
      break;
  }
  return out;
}

export class AbfalterAdapter implements SystemAdapter {
  getMetadata(): SystemMetadata {
    return {
      id: SYSTEM_ID,
      name: SYSTEM_ID,
      displayName: 'Anima Beyond Fantasy (abfalter)',
      version: '1.0.0',
      description:
        'Support for Anima Beyond Fantasy via the abfalter system: characteristics, ' +
        'resistances, combat values, life points, secondary abilities, and magic, psychic ' +
        'and ki abilities.',
      supportedFeatures: {
        creatureIndex: false,
        characterStats: true,
        spellcasting: true,
        powerLevel: true, // level
      },
    };
  }

  canHandle(systemId: string): boolean {
    return systemId.toLowerCase() === SYSTEM_ID;
  }

  extractCreatureData(
    _doc: any,
    _pack: any
  ): { creature: SystemCreatureIndex; errors: number } | null {
    throw new Error('Anima Beyond Fantasy (abfalter) does not support the enhanced creature index');
  }

  getFilterSchema() {
    return AbfalterFiltersSchema;
  }

  matchesFilters(creature: SystemCreatureIndex, filters: Record<string, any>): boolean {
    const validated = AbfalterFiltersSchema.safeParse(filters);
    if (!validated.success) return false;
    return matchesAbfalterFilters(creature, validated.data);
  }

  getDataPaths(): Record<string, string | null> {
    return {
      level: FIELD_PATHS.LEVEL,
      lifePoints: FIELD_PATHS.LIFE_POINTS,
      fatigue: FIELD_PATHS.FATIGUE,
      zeon: FIELD_PATHS.ZEON,
      ki: FIELD_PATHS.KI,
      psychicPoints: FIELD_PATHS.PSYCHIC_POINTS,
      characteristics: FIELD_PATHS.CHARACTERISTICS,
      resistances: FIELD_PATHS.RESISTANCES,
      combat: FIELD_PATHS.COMBAT,
      initiative: FIELD_PATHS.INITIATIVE,
      secondaries: FIELD_PATHS.SECONDARIES,
      race: FIELD_PATHS.RACE,
      biography: FIELD_PATHS.BIOGRAPHY,
      hitPoints: FIELD_PATHS.LIFE_POINTS,
      abilities: FIELD_PATHS.CHARACTERISTICS,
      saves: FIELD_PATHS.RESISTANCES,

      // D&D5e / PF2e paths that do not exist in Anima
      challengeRating: null,
      creatureType: null,
      alignment: null,
      armorClass: null,
      spells: null,
    };
  }

  formatCreatureForList(creature: SystemCreatureIndex): any {
    const formatted: any = {
      id: creature.id,
      name: creature.name,
      type: creature.type,
      pack: { id: creature.packName, label: creature.packLabel },
    };
    const level = creature.systemData?.level;
    if (typeof level === 'number') formatted.stats = { level };
    if (creature.img) formatted.hasImage = true;
    return formatted;
  }

  formatCreatureForDetails(creature: SystemCreatureIndex): any {
    const formatted = this.formatCreatureForList(creature);
    formatted.detailedStats = creature.systemData;
    if (creature.img) formatted.img = creature.img;
    return formatted;
  }

  describeFilters(filters: Record<string, any>): string {
    const validated = AbfalterFiltersSchema.safeParse(filters);
    if (!validated.success) return 'invalid filters';
    return describeAbfalterFilters(validated.data);
  }

  getPowerLevel(creature: SystemCreatureIndex): number | undefined {
    return num(creature.systemData?.level);
  }

  extractBasicInfo(actorData: any): any {
    const system = actorData.system ?? {};
    const basicInfo: any = {};

    const level = num(system.levelinfo?.level);
    if (level !== undefined) basicInfo.level = level;
    if (system.levelinfo?.classString) basicInfo.class = system.levelinfo.classString;
    if (system.info?.race) basicInfo.race = system.info.race;

    const lp = pool(system.lp);
    if (lp) basicInfo.lifePoints = { current: lp.value, max: lp.max };
    const fatigue = pool(system.fatigue);
    if (fatigue) basicInfo.fatigue = { current: fatigue.value, max: fatigue.max };

    return basicInfo;
  }

  extractCharacterStats(actorData: any): any {
    const system = actorData.system ?? {};
    const stats: any = { name: actorData.name, type: actorData.type };

    const level = num(system.levelinfo?.level);
    if (level !== undefined) stats.level = level;
    if (system.levelinfo?.classString) stats.class = system.levelinfo.classString;
    const presence = num(system.levelinfo?.presence);
    if (presence !== undefined) stats.presence = presence;
    if (system.levelinfo?.experience) stats.experience = system.levelinfo.experience;

    const info = system.info ?? {};
    const details: any = {};
    for (const field of ['race', 'gender', 'age', 'size']) {
      if (info[field] !== undefined && info[field] !== '') details[field] = info[field];
    }
    if (info.gnosis) details.gnosis = info.gnosis;
    if (info.destiny) details.destinyPoints = info.destiny;
    if (Object.keys(details).length > 0) stats.details = details;

    stats.characteristics = {};
    for (const { key, short } of CHARACTERISTICS) {
      const stat = system.stats?.[key];
      if (!stat) continue;
      stats.characteristics[key] = { short, value: stat.final ?? stat.base, mod: stat.mod ?? 0 };
    }

    stats.resistances = {};
    for (const { key, short } of RESISTANCES) {
      const final = num(system.resistances?.[key]?.final);
      if (final !== undefined) stats.resistances[short] = final;
    }

    const combat: any = {};
    for (const field of ['attack', 'block', 'dodge'] as const) {
      const final = num(system.combatValues?.[field]?.final);
      if (final !== undefined) combat[field] = final;
    }
    const initiative = num(system.initiative?.final);
    if (initiative !== undefined) combat.initiative = initiative;
    const wearArmor = num(system.armor?.wearArmor?.final);
    if (wearArmor !== undefined) combat.wearArmor = wearArmor;
    const aam = num(system.aamField?.final);
    if (aam) combat.allActionModifier = aam;
    const actions = num(system.info?.actionNumber);
    if (actions !== undefined) combat.actionsPerTurn = actions;
    const movement = num(system.movement?.final);
    if (movement !== undefined) combat.movementValue = movement;
    const openRange = num(system.rollRange?.final);
    if (openRange !== undefined && openRange !== 90) combat.openRollRange = openRange;
    const fumbleRange = num(system.fumleRange?.final);
    if (fumbleRange !== undefined && fumbleRange !== 3) combat.fumbleRange = fumbleRange;
    stats.combat = combat;

    const resources: any = {};
    const lp = pool(system.lp);
    if (lp) resources.lifePoints = lp;
    const fatigue = pool(system.fatigue);
    if (fatigue) resources.fatigue = fatigue;
    const shield = pool(system.shield);
    if (shield?.max) resources.shield = shield;
    const mentalHealth = pool(system.mentalHealth);
    if (mentalHealth?.max) resources.mentalHealth = mentalHealth;
    stats.resources = resources;

    const zeon = pool(system.zeon);
    const mproj = system.mproj ?? {};
    if (zeon?.max || num(mproj.finalOffensive)) {
      const magic: any = {};
      if (zeon) magic.zeon = zeon;
      magic.projection = { offensive: mproj.finalOffensive, defensive: mproj.finalDefensive };
      if (num(system.maccu?.finalFull) !== undefined) magic.accumulation = system.maccu.finalFull;
      if (num(system.mregen?.final) !== undefined) magic.regeneration = system.mregen.final;
      if (num(system.mlevel?.final) !== undefined) magic.magicLevel = system.mlevel.final;
      stats.magic = magic;
    }

    if (num(system.ppoint?.final)) {
      const pp = pool(system.psychicPoint);
      stats.psychic = {
        potential: system.ppotential?.final,
        projection: { offensive: system.pproj?.finalOff, defensive: system.pproj?.finalDef },
        // max is what is left after points spent on matrices and potential
        freePsychicPoints: { value: pp?.value ?? 0, max: pp?.max ?? 0 },
        totalPsychicPoints: system.ppoint.final,
      };
    }

    const ki = kiSummary(system);
    const mk = num(system.mk?.final);
    if (ki || mk) {
      stats.ki = { ...(mk ? { martialKnowledge: mk } : {}), ...(ki ?? {}) };
    }

    const secondaries: Record<string, number> = {};
    for (const [category, abilities] of Object.entries(system.secondaryFields ?? {})) {
      if (category === 'category' || !abilities || typeof abilities !== 'object') continue;
      for (const [key, entry] of Object.entries(abilities as Record<string, any>)) {
        const developed = ['base', 'spec', 'classBonus', 'bonus', 'natural', 'nat'].some(field =>
          num(entry?.[field])
        );
        if (developed && num(entry.final) !== undefined)
          secondaries[secondaryLabel(key)] = entry.final;
      }
    }
    stats.secondaries = secondaries;

    const items: any[] = actorData.items ?? [];
    for (const [group, types] of Object.entries(ITEM_GROUPS)) {
      const matching = items.filter(i => types.includes(i?.type));
      if (matching.length === 0) continue;
      if (group === 'advantages') {
        const advantages = matching.filter(i => i.system?.type !== 'disadvantage');
        const disadvantages = matching.filter(i => i.system?.type === 'disadvantage');
        if (advantages.length > 0) stats.advantages = advantages.map(summarizeItem);
        if (disadvantages.length > 0) stats.disadvantages = disadvantages.map(summarizeItem);
      } else {
        stats[group] = matching.map(summarizeItem);
      }
    }

    const currency = system.currency ?? {};
    if (currency.gold || currency.silver || currency.copper) {
      stats.currency = {
        gold: currency.gold ?? 0,
        silver: currency.silver ?? 0,
        copper: currency.copper ?? 0,
      };
    }

    const bio = stripHtml(info.bio);
    if (bio) stats.biography = truncate(bio);

    return stats;
  }

  describeActorSchema(): string {
    return [
      '=== abfalter (Anima Beyond Fantasy) Actor Schema Reference ===',
      '',
      'ACTOR TYPES: character (PCs, NPCs and creatures alike)',
      'ITEM TYPES: weapon, armor, ammo, inventory, currency, class, advantage (system.type',
      '  "advantage" or "disadvantage"), secondary (custom secondary ability), elan,',
      '  proficiency, backgroundInfo, spell, spellPath, zeonMaint, incarnation, invocation,',
      '  discipline, psychicMatrix, mentalPattern, maintPower, kiAbility, kiTechnique,',
      '  arsMagnus, martialArt, kiSealCreature, monsterPower',
      '',
      'LEVEL comes from class items (system.main.levels), not from a field on the actor.',
      '',
      'DATA LAYOUT (system.*) — edit the base values; the system derives the .final totals:',
      '  stats.<Agility|Constitution|Strength|Dexterity|Perception|Intelligence|Power|Willpower>',
      '    { base, spec, temp }  →  final, mod',
      '  (creature sheets with toggles.monsterChar use monsterChar.<agi|con|…>.base instead)',
      '  combatValues.<attack|block|dodge>: { base, special, temp, bonus }  →  final',
      '  secondaryFields.<category>.<ability>: { base, spec, temp, bonus, … }  →  final',
      '  resistances.<Physical|Disease|Poison|Magic|Psychic>: { mod, bonus }  →  final',
      '  lp, fatigue, zeon, unifiedKi, psychicPoint, shield, mentalHealth: { value, max }',
      '  kiPool.<agi|con|dex|str|pow|wp>: { actual (reserve), current (accumulated), … }',
      '  aamField: { base, crit, … } all-action modifier; levelinfo.experience; currency',
      '',
      'Prefer abf-update-character over raw updates: it finds secondary abilities by name,',
      'handles creature characteristics, and reports the recomputed totals.',
    ].join('\n');
  }
}
