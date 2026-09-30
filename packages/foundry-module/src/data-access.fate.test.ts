import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';
import { fateKey } from './fate.js';

/** Apply a Foundry-style dot-path update object to plain data. */
function applyUpdate(target: any, update: Record<string, any>, del: unknown) {
  for (const [path, value] of Object.entries(update)) {
    const parts = path.split('.');
    let node = target;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    const last = parts[parts.length - 1];
    if (value === del) delete node[last];
    else node[last] = structuredClone(value);
  }
}

function makeFateActor() {
  const k = fateKey;
  const actor: any = {
    id: 'actor-1',
    name: 'Cynere',
    type: 'fate-core-official',
    system: {
      details: { fatePoints: { current: 3, refresh: 3, boosts: 0 } },
      aspects: {
        [k('High Concept')]: { name: 'High Concept', value: 'Infamous Girl with Sword' },
        [k('Trouble')]: { name: 'Trouble', value: '' },
      },
      skills: {
        [k('Fight')]: { name: 'Fight', rank: 4 },
        [k('Athletics')]: { name: 'Athletics', rank: 3 },
        [k('Physique')]: { name: 'Physique', rank: 0 },
      },
      stunts: {
        [k('Master Swordswoman')]: {
          name: 'Master Swordswoman',
          linked_skill: 'Fight',
          bonus: 2,
          attack: true,
        },
      },
      tracks: {
        [k('Physical Stress')]: {
          name: 'Physical Stress',
          box_values: [false, false, false],
          aspect: 'No',
        },
        [k('Mild Consequence')]: {
          name: 'Mild Consequence',
          box_values: [false],
          harm_can_absorb: 2,
          aspect: { name: '', when_marked: true, as_name: false },
        },
      },
    },
  };
  actor.update = vi.fn(async (update: Record<string, any>) => {
    applyUpdate(actor, update, (globalThis as any)._del);
  });
  actor.setupTracks = vi.fn((_skills: any, tracks: any) => tracks);
  return actor;
}

function setupFoundry(options: { allowWrites?: boolean; systemId?: string } = {}) {
  const actor = makeFateActor();
  const actors = Object.assign([actor], {
    get: (id: string) => (id === actor.id ? actor : undefined),
    getName: (name: string) => (name === actor.name ? actor : undefined),
  });

  const flags: Record<string, any> = {
    situation_aspects: [{ name: 'Crumbling Bridge', free_invokes: 1 }],
  };
  const scene: any = {
    id: 'scene-1',
    name: 'The Bridge',
    getFlag: (_scope: string, key: string) => flags[key],
    setFlag: vi.fn(async (_scope: string, key: string, value: any) => {
      flags[key] = value;
    }),
  };
  const scenes = Object.assign([scene], { viewed: scene, active: scene, contents: [scene] });

  const settings: Record<string, any> = {
    'foundry-mcp-bridge.allowWriteOperations': options.allowWrites ?? true,
    'fate-core-official.gameAspects': [{ name: 'The Empire Crumbles', free_invokes: 0, notes: '' }],
  };
  const socketEmit = vi.fn();

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('_del', Symbol('delete'));
  vi.stubGlobal('foundry', { utils: { deepClone: (v: any) => structuredClone(v) } });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'gm', isGM: true },
    system: { id: options.systemId ?? 'fate-core-official' },
    actors,
    scenes,
    socket: { emit: socketEmit },
    settings: {
      get: (scope: string, key: string) => {
        const value = settings[`${scope}.${key}`];
        if (value === undefined) throw new Error(`setting not registered: ${scope}.${key}`);
        return value;
      },
      set: vi.fn(async (scope: string, key: string, value: any) => {
        settings[`${scope}.${key}`] = value;
      }),
    },
  });

  return { actor, scene, flags, settings, socketEmit, dataAccess: new FoundryDataAccess() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FoundryDataAccess.updateFateCharacter', () => {
  it('rejects other systems', async () => {
    const { dataAccess } = setupFoundry({ systemId: 'dnd5e' });
    const result = await dataAccess.updateFateCharacter({ actor: 'Cynere', skills: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Fate Core Official');
  });

  it('honours the write-operations setting', async () => {
    const { dataAccess, actor } = setupFoundry({ allowWrites: false });
    const result = await dataAccess.updateFateCharacter({
      actor: 'Cynere',
      fatePoints: { current: 1 },
    });
    expect(result.success).toBe(false);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('sets aspects and skills by name, adding missing ones under base64 keys', async () => {
    const { dataAccess, actor } = setupFoundry();
    const result = await dataAccess.updateFateCharacter({
      actor: 'Cynere',
      aspects: [
        { name: 'trouble', value: 'Tempted by Shiny Things' },
        { name: 'Relationship', value: 'Owes Landon a Favor' },
      ],
      skills: [
        { name: 'Fight', rank: 5 },
        { name: 'Burglary', rank: 2 },
      ],
    });

    expect(result.success).toBe(true);
    const sys = actor.system;
    expect(sys.aspects[fateKey('Trouble')].value).toBe('Tempted by Shiny Things');
    expect(sys.aspects[fateKey('Relationship')]).toMatchObject({
      name: 'Relationship',
      value: 'Owes Landon a Favor',
    });
    expect(sys.skills[fateKey('Fight')].rank).toBe(5);
    expect(sys.skills[fateKey('Burglary')]).toMatchObject({ name: 'Burglary', rank: 2 });
    expect(result.applied.skills[0]).toEqual({ name: 'Fight', from: 4, to: 5 });
    expect(actor.setupTracks).toHaveBeenCalled();
  });

  it('adds and removes stunts', async () => {
    const { dataAccess, actor } = setupFoundry();
    await dataAccess.updateFateCharacter({
      actor: 'Cynere',
      removeStunts: ['master swordswoman'],
      addStunts: [
        {
          name: 'Acrobatic Escape',
          linkedSkill: 'Athletics',
          bonus: 2,
          actions: ['overcome', 'defend'],
          description: '+2 to escape by leaping',
        },
      ],
    });

    const stunts = actor.system.stunts;
    expect(stunts[fateKey('Master Swordswoman')]).toBeUndefined();
    expect(stunts[fateKey('Acrobatic Escape')]).toMatchObject({
      linked_skill: 'Athletics',
      bonus: 2,
      overcome: true,
      defend: true,
      attack: false,
      caa: false,
      refresh_cost: 1,
    });
  });

  it('marks stress boxes and writes consequences', async () => {
    const { dataAccess, actor } = setupFoundry();
    const result = await dataAccess.updateFateCharacter({
      actor: 'Cynere',
      tracks: [
        { name: 'Physical Stress', mark: [2, 7] },
        { name: 'Mild Consequence', mark: [1], aspect: 'Bruised Ribs' },
      ],
    });

    const tracks = actor.system.tracks;
    expect(tracks[fateKey('Physical Stress')].box_values).toEqual([false, true, false]);
    expect(tracks[fateKey('Mild Consequence')].box_values).toEqual([true]);
    expect(tracks[fateKey('Mild Consequence')].aspect.name).toBe('Bruised Ribs');
    expect(result.warnings.join(' ')).toContain('ignored box number(s) 7');
  });

  it('clears a consequence', async () => {
    const { dataAccess, actor } = setupFoundry();
    const key = fateKey('Mild Consequence');
    actor.system.tracks[key].box_values = [true];
    actor.system.tracks[key].aspect.name = 'Bruised Ribs';

    await dataAccess.updateFateCharacter({
      actor: 'Cynere',
      tracks: [{ name: 'Mild Consequence', clear: true }],
    });

    expect(actor.system.tracks[key].box_values).toEqual([false]);
    expect(actor.system.tracks[key].aspect.name).toBe('');
  });

  it('sets fate points', async () => {
    const { dataAccess, actor } = setupFoundry();
    const result = await dataAccess.updateFateCharacter({
      actor: 'Cynere',
      fatePoints: { current: 2 },
    });
    expect(actor.system.details.fatePoints.current).toBe(2);
    expect(result.applied.fatePoints.current).toEqual({ from: 3, to: 2 });
  });
});

describe('FoundryDataAccess.rollFateSkill', () => {
  beforeEach(() => {
    class MockRoll {
      formula: string;
      dice: any[] = [];
      total = 0;
      result = '';
      toMessage = vi.fn();
      constructor(formula: string) {
        this.formula = formula;
      }
      async evaluate() {
        const faces = [1, 1, 0, -1];
        this.dice = [{ options: {}, results: faces.map(result => ({ result })) }];
        const mods = this.formula
          .replace('4dF', '')
          .replace(/\s+/g, '')
          .match(/[+-]\d+/g);
        this.total = faces.reduce((a, b) => a + b, 0) + (mods ?? []).reduce((a, m) => a + +m, 0);
        return this;
      }
    }
    vi.stubGlobal('Roll', MockRoll);
    vi.stubGlobal('ChatMessage', { getSpeaker: () => ({}) });
  });

  it('rolls skill + stunt + modifier and reports the outcome', async () => {
    const { dataAccess } = setupFoundry();
    const result = await dataAccess.rollFateSkill({
      actor: 'Cynere',
      stunt: 'Master Swordswoman',
      modifier: 2,
      difficulty: 4,
    });

    expect(result).toMatchObject({
      success: true,
      skill: 'Fight',
      rank: 4,
      stunt: 'Master Swordswoman',
      stuntBonus: 2,
      formula: '4dF + 4 + 2 + 2',
      dice: '+ + 0 -',
      diceTotal: 1,
      total: 9,
      shifts: 5,
      outcome: 'success with style',
    });
  });

  it('rolls an unknown skill at Mediocre with a warning', async () => {
    const { dataAccess } = setupFoundry();
    const result = await dataAccess.rollFateSkill({ actor: 'Cynere', skill: 'Lore' });
    expect(result.rank).toBe(0);
    expect(result.warnings[0]).toContain('Mediocre');
  });
});

describe('FoundryDataAccess.manageFateAspects', () => {
  it('lists scene and game aspects', async () => {
    const { dataAccess } = setupFoundry();
    const result = await dataAccess.manageFateAspects({ action: 'list' });
    expect(result.scene.aspects).toEqual([{ name: 'Crumbling Bridge', freeInvokes: 1 }]);
    expect(result.gameAspects).toEqual([{ name: 'The Empire Crumbles', freeInvokes: 0 }]);
  });

  it('adds a situation aspect and refreshes Fate Utilities', async () => {
    const { dataAccess, flags, socketEmit } = setupFoundry();
    const result = await dataAccess.manageFateAspects({
      action: 'add',
      name: 'Blinding Smoke',
      freeInvokes: 2,
    });
    expect(result.success).toBe(true);
    expect(flags.situation_aspects).toContainEqual({ name: 'Blinding Smoke', free_invokes: 2 });
    expect(socketEmit).toHaveBeenCalledWith('system.fate-core-official', { render: true });
  });

  it('spends a free invoke on a game aspect', async () => {
    const { dataAccess, settings } = setupFoundry();
    await dataAccess.manageFateAspects({
      action: 'update',
      scope: 'game',
      name: 'the empire crumbles',
      freeInvokes: 1,
    });
    expect(settings['fate-core-official.gameAspects'][0].free_invokes).toBe(1);
  });

  it('refuses writes when disabled but still lists', async () => {
    const { dataAccess } = setupFoundry({ allowWrites: false });
    const add = await dataAccess.manageFateAspects({ action: 'remove', name: 'Crumbling Bridge' });
    expect(add.success).toBe(false);
    const list = await dataAccess.manageFateAspects({ action: 'list', scope: 'scene' });
    expect(list.success).toBe(true);
  });
});
