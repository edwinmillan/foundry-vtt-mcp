/**
 * AbfalterAdapter tests — get-character extraction from derived abfalter data.
 */

import { describe, it, expect } from 'vitest';
import { AbfalterAdapter } from './adapter.js';

function makeActor(overrides: Record<string, any> = {}) {
  return {
    name: 'Celia',
    type: 'character',
    system: {
      levelinfo: { level: 3, classString: 'Warlock 3', presence: 45, experience: 20 },
      info: { race: 'Sylvain', gender: 'F', age: '', gnosis: 0, destiny: 1, actionNumber: 2 },
      lp: { value: 80, max: 145 },
      fatigue: { value: 6, max: 6 },
      shield: { value: 0, max: 0 },
      mentalHealth: { value: 0, max: 0 },
      zeon: { value: 300, max: 450 },
      mproj: { finalOffensive: 110, finalDefensive: 95 },
      maccu: { finalFull: 50 },
      mregen: { final: 30 },
      mlevel: { final: 40 },
      ppoint: { final: 0 },
      mk: { final: 0 },
      toggles: { unifiedPools: false },
      kiPool: {
        agi: { poolTot: 0 },
        dex: { poolTot: 12, actual: 10, current: 2, accumTot: 2 },
      },
      stats: {
        Agility: { base: 8, final: 8, mod: 10 },
        Power: { base: 12, final: 13, mod: 25 },
      },
      resistances: { Physical: { final: 50 }, Magic: { final: 75 } },
      combatValues: {
        attack: { final: 90 },
        block: { final: 15 },
        dodge: { final: 70 },
      },
      initiative: { final: 45 },
      armor: { wearArmor: { final: 10 } },
      aamField: { final: -20 },
      movement: { final: 8 },
      rollRange: { final: 90 },
      fumleRange: { final: 3 },
      secondaryFields: {
        category: { perceptive: true },
        perceptive: { notice: { base: 40, final: 80 }, search: { base: 0, final: -30 } },
        vigor: { featsofstr: { base: 0, classBonus: 10, final: 20 } },
      },
      currency: { gold: 5, silver: 2, copper: 0 },
      ...overrides,
    },
    items: [
      { name: 'Long Sword', type: 'weapon', system: { equipped: true, quality: 5 } },
      { name: 'Gift', type: 'advantage', system: { type: 'advantage', cost: 2 } },
      { name: 'Exclusive Weapon', type: 'advantage', system: { type: 'disadvantage', cost: 1 } },
      { name: 'Fire', type: 'spellPath', system: { level: 40 } },
      { name: 'Flame Blast', type: 'spell', system: { path: 'Fire', level: 10, type: 'Attack' } },
    ],
  };
}

describe('AbfalterAdapter', () => {
  const adapter = new AbfalterAdapter();

  it('handles the abfalter system id', () => {
    expect(adapter.canHandle('abfalter')).toBe(true);
    expect(adapter.canHandle('fate-core-official')).toBe(false);
  });

  it('extracts basic info', () => {
    expect(adapter.extractBasicInfo(makeActor())).toEqual({
      level: 3,
      class: 'Warlock 3',
      race: 'Sylvain',
      lifePoints: { current: 80, max: 145 },
      fatigue: { current: 6, max: 6 },
    });
  });

  it('extracts characteristics, resistances and combat', () => {
    const stats = adapter.extractCharacterStats(makeActor());
    expect(stats.characteristics.Power).toEqual({ short: 'POW', value: 13, mod: 25 });
    expect(stats.resistances).toEqual({ PhR: 50, MR: 75 });
    expect(stats.combat).toEqual({
      attack: 90,
      block: 15,
      dodge: 70,
      initiative: 45,
      wearArmor: 10,
      allActionModifier: -20,
      actionsPerTurn: 2,
      movementValue: 8,
    });
    expect(stats.resources).toEqual({
      lifePoints: { value: 80, max: 145 },
      fatigue: { value: 6, max: 6 },
    });
  });

  it('reports developed secondaries only', () => {
    const stats = adapter.extractCharacterStats(makeActor());
    expect(stats.secondaries).toEqual({ Notice: 80, 'Feats of Strength': 20 });
  });

  it('reports magic, ki pools, and skips psychic when undeveloped', () => {
    const stats = adapter.extractCharacterStats(makeActor());
    expect(stats.magic).toEqual({
      zeon: { value: 300, max: 450 },
      projection: { offensive: 110, defensive: 95 },
      accumulation: 50,
      regeneration: 30,
      magicLevel: 40,
    });
    expect(stats.ki).toEqual({
      unified: false,
      pools: { DEX: { reserve: 10, max: 12, accumulated: 2, accumulation: 2 } },
    });
    expect(stats.psychic).toBeUndefined();
  });

  it('reports a unified ki pool', () => {
    const stats = adapter.extractCharacterStats(
      makeActor({
        toggles: { unifiedPools: true },
        unifiedKi: { value: 30, max: 60, current: 5 },
        mk: { final: 40 },
      })
    );
    expect(stats.ki).toEqual({
      martialKnowledge: 40,
      unified: true,
      reserve: 30,
      max: 60,
      accumulated: 5,
    });
  });

  it('groups items', () => {
    const stats = adapter.extractCharacterStats(makeActor());
    expect(stats.weapons).toEqual([{ name: 'Long Sword', equipped: true, quality: 5 }]);
    expect(stats.advantages).toEqual([{ name: 'Gift', cost: 2 }]);
    expect(stats.disadvantages).toEqual([{ name: 'Exclusive Weapon', cost: 1 }]);
    expect(stats.spells).toEqual([
      { name: 'Fire', level: 40 },
      { name: 'Flame Blast', path: 'Fire', level: 10, type: 'Attack' },
    ]);
    expect(stats.currency).toEqual({ gold: 5, silver: 2, copper: 0 });
  });

  it('filters by level', () => {
    const creature: any = { systemData: { level: 3, hasZeon: true } };
    expect(adapter.matchesFilters(creature, { level: { min: 2 } })).toBe(true);
    expect(adapter.matchesFilters(creature, { level: 4 })).toBe(false);
    expect(adapter.matchesFilters(creature, { hasZeon: true })).toBe(true);
    expect(adapter.describeFilters({ level: { min: 2, max: 5 } })).toBe('level ≥ 2, level ≤ 5');
  });
});
