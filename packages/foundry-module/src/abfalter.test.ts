import { describe, expect, it } from 'vitest';
import {
  type AbfRollSettings,
  abfCharacteristicTotal,
  abfDamagePercent,
  abfInitiativeRoll,
  abfOpenRoll,
  difficultyReached,
  findCharacteristic,
  findResistance,
  findSecondary,
  parseDifficulty,
} from './abfalter.js';

const defaults: AbfRollSettings = {
  openRange: 90,
  fumbleRange: 3,
  doubles: false,
  limits: 'none',
  correctedOpenRoll: false,
  correctedFumble: false,
};

/** A d100 that returns the given faces in order. */
function dice(...faces: number[]) {
  const queue = [...faces];
  return async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('rolled more dice than expected');
    return next;
  };
}

describe('abfOpenRoll', () => {
  it('adds a plain roll to the base', async () => {
    expect(await abfOpenRoll(100, defaults, dice(55))).toEqual({
      dice: [55],
      total: 155,
      openRolls: 0,
    });
  });

  it('keeps rolling while each roll beats the last (house rule)', async () => {
    // 92 opens; 95 beats 92 and opens again; 93 does not beat 95.
    const result = await abfOpenRoll(50, defaults, dice(92, 95, 93));
    expect(result).toEqual({ dice: [92, 95, 93], total: 50 + 92 + 95 + 93, openRolls: 2 });
  });

  it('raises the open range by one per roll with the corrected setting', async () => {
    const settings = { ...defaults, correctedOpenRoll: true };
    // 95 opens (≥90), 91 opens (≥91), 91 stops (<92).
    const result = await abfOpenRoll(0, settings, dice(95, 91, 91));
    expect(result.openRolls).toBe(2);
    expect(result.total).toBe(277);
  });

  it('respects open-roll limits and the unlucky flag', async () => {
    const single = await abfOpenRoll(0, { ...defaults, limits: 'single' }, dice(95, 99));
    expect(single).toMatchObject({ dice: [95, 99], openRolls: 1 });
    const unlucky = await abfOpenRoll(0, { ...defaults, limits: 'unlucky' }, dice(99));
    expect(unlucky).toMatchObject({ dice: [99], openRolls: 0 });
  });

  it('opens on doubles when the actor has that ability', async () => {
    const result = await abfOpenRoll(0, { ...defaults, doubles: true }, dice(44, 20));
    expect(result).toMatchObject({ dice: [44, 20], openRolls: 1, total: 64 });
  });

  it('subtracts the fumble roll and fumble level', async () => {
    // Rolled 1 with fumble range 3: level 30, then 40 is subtracted.
    const result = await abfOpenRoll(100, defaults, dice(1, 40));
    expect(result).toEqual({
      dice: [1, 40],
      total: 100 + 1 - 40 - 30,
      openRolls: 0,
      fumble: { level: 30, roll: 40 },
    });
    const corrected = await abfOpenRoll(100, { ...defaults, correctedFumble: true }, dice(1, 40));
    expect(corrected.total).toBe(61);
  });
});

describe('abfInitiativeRoll', () => {
  it('applies the flat fumble penalty', async () => {
    const result = await abfInitiativeRoll(50, { ...defaults, openInitiative: false }, dice(2));
    expect(result).toMatchObject({ total: 50 + 2 - 100, fumble: { level: 100 } });
  });

  it('only opens with the corrected-initiative setting', async () => {
    const closed = await abfInitiativeRoll(0, { ...defaults, openInitiative: false }, dice(97));
    expect(closed.total).toBe(97);
    const open = await abfInitiativeRoll(0, { ...defaults, openInitiative: true }, dice(97, 10));
    expect(open).toMatchObject({ dice: [97, 10], total: 107, openRolls: 1 });
  });
});

describe('abfCharacteristicTotal', () => {
  it('treats 1 as -3 and 10 as +2', () => {
    expect(abfCharacteristicTotal(8, 1)).toEqual({ total: 6, fumble: true, open: false });
    expect(abfCharacteristicTotal(8, 10)).toEqual({ total: 20, fumble: false, open: true });
    expect(abfCharacteristicTotal(8, 5).total).toBe(13);
  });
});

describe('abfDamagePercent', () => {
  it('follows the system combat table', () => {
    expect(abfDamagePercent(25, 0)).toBe(0);
    expect(abfDamagePercent(45, 0)).toBe(30);
    expect(abfDamagePercent(75, 0)).toBe(70);
    expect(abfDamagePercent(55, 1)).toBe(40);
    expect(abfDamagePercent(75, 3)).toBe(40);
    expect(abfDamagePercent(-10, 0)).toBe(0);
  });

  it('supports the core formula', () => {
    expect(abfDamagePercent(75, 3, true)).toBe(20);
    expect(abfDamagePercent(25, 2, true)).toBe(0);
  });
});

describe('name lookups', () => {
  it('finds characteristics and resistances by name or abbreviation', () => {
    expect(findCharacteristic('DEX')).toBe('Dexterity');
    expect(findCharacteristic('willpower')).toBe('Willpower');
    expect(findResistance('MR')).toBe('Magic');
    expect(findResistance('physical resistance')).toBe('Physical');
    expect(findCharacteristic('luck')).toBeUndefined();
  });

  it('finds secondary abilities by key or display name', () => {
    const fields = {
      category: { vigor: true },
      vigor: { featsofstr: { final: 40 } },
      perceptive: { notice: { final: 85 } },
    };
    expect(findSecondary(fields, 'Feats of Strength')).toMatchObject({
      category: 'vigor',
      key: 'featsofstr',
    });
    expect(findSecondary(fields, 'notice')?.entry.final).toBe(85);
    expect(findSecondary(fields, 'vigor')).toBeNull();
  });

  it('parses and reports difficulties', () => {
    expect(parseDifficulty('Very Difficult')).toBe(140);
    expect(parseDifficulty('120')).toBe(120);
    expect(parseDifficulty(95)).toBe(95);
    expect(parseDifficulty('hard')).toBeUndefined();
    expect(difficultyReached(145)).toBe('Very Difficult');
    expect(difficultyReached(10)).toBeNull();
  });
});
