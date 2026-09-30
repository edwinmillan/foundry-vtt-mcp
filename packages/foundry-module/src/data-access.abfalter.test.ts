import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

/** Apply a Foundry-style dot-path update object to plain data. */
function applyUpdate(target: any, update: Record<string, any>) {
  for (const [path, value] of Object.entries(update)) {
    const parts = path.split('.');
    let node = target;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts[parts.length - 1]] = structuredClone(value);
  }
}

function makeAbfActor() {
  const stat = (base: number, final: number, mod: number) => ({ base, final, mod });
  const actor: any = {
    id: 'actor-1',
    name: 'Celia',
    type: 'character',
    system: {
      lp: { value: 120, max: 145 },
      fatigue: { value: 6, max: 6 },
      zeon: { value: 300, max: 450 },
      unifiedKi: { value: 0, max: 0 },
      psychicPoint: { value: 0, max: 0 },
      toggles: { unifiedPools: false, monsterChar: false },
      kiPool: { agi: { actual: 10, current: 0 }, dex: { actual: 12, current: 0 } },
      stats: {
        Agility: stat(8, 8, 10),
        Dexterity: stat(10, 10, 15),
        Power: stat(12, 12, 20),
      },
      resistances: { Magic: { final: 75 }, Physical: { final: 50 } },
      combatValues: {
        attack: { base: 60, final: 90 },
        block: { base: 0, final: 15 },
        dodge: { base: 50, final: 70 },
      },
      initiative: { final: 45 },
      mproj: { finalOffensive: 110, finalDefensive: 95 },
      secondaryFields: {
        category: { perceptive: true },
        perceptive: { notice: { base: 40, final: 80 } },
        vigor: { featsofstr: { base: 0, final: -30 } },
      },
      rollRange: { final: 90, doubles: false, limits: 'none' },
      fumleRange: { final: 3 },
      aamField: { base: 0, crit: 0 },
      levelinfo: { experience: 100 },
      info: { race: 'Human' },
      currency: { gold: 5, silver: 0, copper: 0 },
    },
  };
  const longsword = {
    id: 'item-1',
    name: 'Long Sword',
    type: 'weapon',
    system: {
      derived: { baseAtk: 95, baseOpenRollRange: 90, baseFumbleRange: 3 },
      attacks: {
        a: { name: 'Slash', finalAttack: 100, finalBlock: 85, finalDamage: 60, finalAtPen: 1 },
      },
    },
  };
  const tracking = { id: 'item-2', name: 'Tracking Lore', type: 'secondary', system: { base: 5 } };
  actor.items = [longsword, tracking];
  actor.update = vi.fn(async (update: Record<string, any>) => {
    applyUpdate(actor, update);
  });
  actor.updateEmbeddedDocuments = vi.fn(async () => []);
  return actor;
}

function setupFoundry(options: { allowWrites?: boolean; systemId?: string } = {}) {
  const actor = makeAbfActor();
  const actors = Object.assign([actor], {
    get: (id: string) => (id === actor.id ? actor : undefined),
    getName: (name: string) => (name === actor.name ? actor : undefined),
  });
  const settings: Record<string, any> = {
    'foundry-mcp-bridge.allowWriteOperations': options.allowWrites ?? true,
    'abfalter.Corrected_OpenRoll': false,
    'abfalter.Corrected_Fumble': false,
    'abfalter.Corrected_InitiativeRoll': false,
    'abfalter.combatSettings': { resDmgFormula: false },
  };

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'gm', isGM: true },
    system: { id: options.systemId ?? 'abfalter' },
    actors,
    scenes: [],
    settings: {
      get: (scope: string, key: string) => {
        const value = settings[`${scope}.${key}`];
        if (value === undefined) throw new Error(`setting not registered: ${scope}.${key}`);
        return value;
      },
    },
  });

  return { actor, settings, dataAccess: new FoundryDataAccess() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FoundryDataAccess.updateAbfCharacter', () => {
  it('rejects other systems and honours the write setting', async () => {
    const wrong = setupFoundry({ systemId: 'dnd5e' });
    const r1 = await wrong.dataAccess.updateAbfCharacter({ actor: 'Celia', experience: 5 });
    expect(r1.error).toContain('abfalter');

    const readOnly = setupFoundry({ allowWrites: false });
    const r2 = await readOnly.dataAccess.updateAbfCharacter({ actor: 'Celia', experience: 5 });
    expect(r2.error).toContain('Write operations are disabled');
    expect(readOnly.actor.update).not.toHaveBeenCalled();
  });

  it('applies resource deltas and values', async () => {
    const { actor, dataAccess } = setupFoundry();
    const result = await dataAccess.updateAbfCharacter({
      actor: 'Celia',
      resources: { lifePoints: { delta: -40 }, zeon: { value: 250 } },
    });
    expect(actor.system.lp.value).toBe(80);
    expect(actor.system.zeon.value).toBe(250);
    expect(result.applied.resources.lifePoints).toEqual({ from: 120, to: 80, max: 145 });
  });

  it('routes ki to the per-characteristic pools', async () => {
    const { actor, dataAccess } = setupFoundry();
    const result = await dataAccess.updateAbfCharacter({
      actor: 'Celia',
      resources: { ki: { value: 5 } },
      kiPools: [{ characteristic: 'DEX', reserve: 4, accumulated: 8 }],
    });
    expect(result.warnings[0]).toContain('kiPools');
    expect(actor.system.kiPool.dex).toEqual({ actual: 4, current: 8 });
    expect(actor.system.unifiedKi.value).toBe(0);
  });

  it('sets characteristic, secondary and combat bases by name', async () => {
    const { actor, dataAccess } = setupFoundry();
    const result = await dataAccess.updateAbfCharacter({
      actor: 'Celia',
      characteristics: [{ name: 'AGI', base: 9 }],
      secondaries: [
        { name: 'Feats of Strength', base: 30 },
        { name: 'Tracking Lore', base: 20 },
        { name: 'Basket Weaving', base: 10 },
      ],
      combat: { dodge: 80 },
    });
    expect(actor.system.stats.Agility.base).toBe(9);
    expect(actor.system.secondaryFields.vigor.featsofstr.base).toBe(30);
    expect(actor.system.combatValues.dodge.base).toBe(80);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      { _id: 'item-2', 'system.base': 20 },
    ]);
    expect(result.applied.secondaries.map((s: any) => s.name)).toEqual([
      'Feats of Strength',
      'Tracking Lore',
    ]);
    expect(result.warnings).toEqual(['Secondary ability not found: "Basket Weaving"']);
  });

  it('writes creature characteristics to monsterChar', async () => {
    const { actor, dataAccess } = setupFoundry();
    actor.system.toggles.monsterChar = true;
    await dataAccess.updateAbfCharacter({
      actor: 'Celia',
      characteristics: [{ name: 'Strength', base: 14 }],
    });
    expect(actor.system.monsterChar.str.base).toBe(14);
  });
});

describe('FoundryDataAccess.rollAbf', () => {
  let faces: number[];
  let chatCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    faces = [];
    class MockRoll {
      formula: string;
      total = 0;
      constructor(formula: string) {
        this.formula = formula;
      }
      async evaluate() {
        const next = faces.shift();
        if (next === undefined) throw new Error(`unexpected roll ${this.formula}`);
        this.total = next;
        return this;
      }
    }
    chatCreate = vi.fn();
    vi.stubGlobal('Roll', MockRoll);
    vi.stubGlobal('CONFIG', { sounds: { dice: 'dice.wav' } });
    vi.stubGlobal('ChatMessage', {
      getSpeaker: () => ({ alias: 'Celia' }),
      applyMode: vi.fn(),
      create: chatCreate,
    });
  });

  it('rolls a secondary ability with open rolls and difficulty', async () => {
    const { dataAccess } = setupFoundry();
    faces = [93, 40];
    const result = await dataAccess.rollAbf({
      actor: 'Celia',
      rollType: 'secondary',
      target: 'Notice',
      modifier: -10,
      difficulty: 'Very Difficult',
    });
    expect(result).toMatchObject({
      success: true,
      label: 'Notice',
      base: 80,
      dice: [93, 40],
      openRolls: 1,
      total: 80 - 10 + 93 + 40,
      difficulty: 140,
      passed: true,
      difficultyReached: 'Absurd',
    });
    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(chatCreate.mock.calls[0][0].rolls).toHaveLength(2);
  });

  it('rolls a characteristic check on 1d10', async () => {
    const { dataAccess } = setupFoundry();
    faces = [10];
    const result = await dataAccess.rollAbf({
      actor: 'Celia',
      rollType: 'characteristic',
      target: 'POW',
      difficulty: 20,
    });
    expect(result).toMatchObject({ base: 12, total: 24, passed: true, open: 'rolled a 10: +2' });
  });

  it('resolves a weapon attack against a defense', async () => {
    const { dataAccess } = setupFoundry();
    faces = [50];
    const result = await dataAccess.rollAbf({
      actor: 'Celia',
      rollType: 'attack',
      weapon: 'long sword',
      against: 80,
      armor: 3,
    });
    // 100 + 50 = 150 vs 80 → +70; AT 3 - 1 penetration = 2 → 50%.
    expect(result).toMatchObject({
      base: 100,
      total: 150,
      weapon: { name: 'Long Sword', profile: 'Slash', damage: 60, atPen: 1 },
      exchange: { attackerMargin: 70, armor: 2, damagePercent: 50, damageDealt: 30 },
    });
  });

  it('reports a counterattack bonus for a successful defense', async () => {
    const { dataAccess } = setupFoundry();
    faces = [60];
    const result = await dataAccess.rollAbf({ actor: 'Celia', rollType: 'dodge', against: 100 });
    // 70 + 60 = 130 vs 100 → defense wins by 30 → +15.
    expect(result.exchange).toEqual({ attackerMargin: -30, armor: 0, counterattackBonus: 15 });
  });

  it('reports fumbles', async () => {
    const { dataAccess } = setupFoundry();
    faces = [2, 30];
    const result = await dataAccess.rollAbf({
      actor: 'Celia',
      rollType: 'magicProjection',
      target: 'offensive',
    });
    expect(result).toMatchObject({
      label: 'Offensive Magic Projection',
      total: 110 + 2 - 30 - 15,
      fumble: { level: 15, fumbleRoll: 30 },
    });
  });

  it('explains unknown targets', async () => {
    const { dataAccess } = setupFoundry();
    const result = await dataAccess.rollAbf({
      actor: 'Celia',
      rollType: 'resistance',
      target: 'Fire',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Physical, Disease, Poison, Magic, Psychic');
  });
});
