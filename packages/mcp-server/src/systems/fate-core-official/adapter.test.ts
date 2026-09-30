/**
 * Fate Core Official adapter tests. Fixtures mirror the system's data model
 * (FateCoreOfficialModels.js): name-keyed maps under base64 keys.
 */

import { describe, it, expect } from 'vitest';
import { FateCoreOfficialAdapter } from './adapter.js';
import { fateKey, formatRank, trackHasAspect } from './constants.js';
import { matchesFateFilters, describeFateFilters } from './filters.js';

const k = fateKey;

const cynere: any = {
  name: 'Cynere',
  type: 'fate-core-official',
  system: {
    details: {
      description: { value: '<p>A mercenary <em>swordswoman</em>.</p>' },
      pronouns: { value: 'she/her' },
      fatePoints: { current: 2, refresh: 3, boosts: 1 },
    },
    aspects: {
      [k('High Concept')]: { name: 'High Concept', value: 'Infamous Girl with Sword' },
      [k('Trouble')]: { name: 'Trouble', value: 'Tempted by Shiny Things' },
      [k('Other')]: { name: 'Other', value: '' },
    },
    skills: {
      [k('Fight')]: { name: 'Fight', rank: 4 },
      [k('Athletics')]: { name: 'Athletics', rank: 3 },
      [k('Burglary')]: { name: 'Burglary', rank: 3 },
      [k('Lore')]: { name: 'Lore', rank: 0 },
      [k('Secret')]: { name: 'Secret', rank: 2, hidden: true },
    },
    stunts: {
      [k('Master Swordswoman')]: {
        name: 'Master Swordswoman',
        linked_skill: 'Fight',
        bonus: 2,
        refresh_cost: 1,
        attack: true,
        caa: true,
        overcome: false,
        defend: false,
        description: '<p>+2 to create advantages with Fight when dueling.</p>',
      },
    },
    tracks: {
      [k('Physical Stress')]: {
        name: 'Physical Stress',
        category: 'Combat',
        enabled: true,
        box_values: [true, false, false],
        aspect: 'No',
      },
      [k('Mild Consequence')]: {
        name: 'Mild Consequence',
        category: 'Combat',
        enabled: true,
        harm_can_absorb: 2,
        box_values: [true],
        recovery_type: 'Sticky',
        aspect: { name: 'Bruised Ribs', when_marked: true, as_name: false },
      },
      [k('Moderate Consequence')]: {
        name: 'Moderate Consequence',
        enabled: true,
        harm_can_absorb: 4,
        box_values: [false],
        aspect: { name: '', when_marked: true, as_name: false },
      },
      [k('Disabled Track')]: { name: 'Disabled Track', enabled: false, box_values: [false] },
    },
  },
  items: [
    { name: 'Sword of Sorrow', type: 'Extra', system: { active: true } },
    { name: 'Old Map', type: 'Extra', system: { active: false } },
  ],
};

describe('FateCoreOfficialAdapter metadata', () => {
  const adapter = new FateCoreOfficialAdapter();

  it('identifies the system', () => {
    expect(adapter.getMetadata().id).toBe('fate-core-official');
    expect(adapter.canHandle('fate-core-official')).toBe(true);
    expect(adapter.canHandle('Fate-Core-Official')).toBe(true);
    expect(adapter.canHandle('fate')).toBe(false);
    expect(adapter.getMetadata().supportedFeatures.creatureIndex).toBe(false);
  });

  it('points at Fate data paths and nulls the D&D ones', () => {
    const paths = adapter.getDataPaths();
    expect(paths.fatePoints).toBe('system.details.fatePoints');
    expect(paths.challengeRating).toBeNull();
    expect(paths.hitPoints).toBeNull();
  });
});

describe('FateCoreOfficialAdapter.extractCharacterStats', () => {
  const stats = new FateCoreOfficialAdapter().extractCharacterStats(cynere);

  it('reports fate points', () => {
    expect(stats.fatePoints).toEqual({ current: 2, refresh: 3, boosts: 1 });
  });

  it('lists aspects with their text', () => {
    expect(stats.aspects).toContainEqual({
      name: 'High Concept',
      value: 'Infamous Girl with Sword',
    });
    expect(stats.aspects).toHaveLength(3);
  });

  it('sorts ranked skills by rank then name, with ladder labels', () => {
    expect(stats.skills).toEqual([
      { name: 'Fight', rank: 4, ladder: 'Great (+4)' },
      { name: 'Athletics', rank: 3, ladder: 'Good (+3)' },
      { name: 'Burglary', rank: 3, ladder: 'Good (+3)' },
    ]);
    expect(stats.mediocreSkills).toEqual(['Lore']);
    expect(stats.peakSkillRank).toBe(4);
  });

  it('summarises stunts without HTML', () => {
    expect(stats.stunts).toEqual([
      {
        name: 'Master Swordswoman',
        linkedSkill: 'Fight',
        bonus: 2,
        actions: ['create an advantage', 'attack'],
        description: '+2 to create advantages with Fight when dueling.',
      },
    ]);
  });

  it('separates stress from consequences and skips disabled tracks', () => {
    expect(stats.stress).toEqual([
      { name: 'Physical Stress', category: 'Combat', boxes: 3, marked: [1] },
    ]);
    expect(stats.consequences).toEqual([
      {
        name: 'Mild Consequence',
        category: 'Combat',
        boxes: 1,
        marked: [1],
        absorbs: 2,
        aspect: 'Bruised Ribs',
        taken: true,
        recovery: 'Sticky',
      },
      {
        name: 'Moderate Consequence',
        boxes: 1,
        marked: [],
        absorbs: 4,
        aspect: '',
        taken: false,
      },
    ]);
  });

  it('lists extras and a plain-text description', () => {
    expect(stats.extras).toEqual([
      { name: 'Sword of Sorrow', active: true },
      { name: 'Old Map', active: false },
    ]);
    expect(stats.description).toBe('A mercenary swordswoman .');
  });

  it('handles Thing actors', () => {
    const thing = new FateCoreOfficialAdapter().extractCharacterStats({
      name: 'Chest',
      type: 'Thing',
      system: { container: { isContainer: true, locked: true } },
    });
    expect(thing.thing).toEqual({ isContainer: true, locked: true, movable: true });
    expect(thing.skills).toBeUndefined();
  });

  it('survives an empty actor', () => {
    const empty = new FateCoreOfficialAdapter().extractCharacterStats({
      name: 'Blank',
      type: 'fate-core-official',
      system: {},
    });
    expect(empty.skills).toEqual([]);
    expect(empty.fatePoints).toEqual({ current: 0, refresh: null, boosts: 0 });
  });
});

describe('FateCoreOfficialAdapter.extractBasicInfo', () => {
  it('surfaces high concept, trouble, pronouns and fate points', () => {
    expect(new FateCoreOfficialAdapter().extractBasicInfo(cynere)).toEqual({
      highConcept: 'Infamous Girl with Sword',
      trouble: 'Tempted by Shiny Things',
      pronouns: 'she/her',
      fatePoints: { current: 2, refresh: 3 },
    });
  });
});

describe('Fate helpers', () => {
  it('computes keys the way fcoConstants.tob64 does (UTF-8, no padding)', () => {
    expect(fateKey('Fight')).toBe('RmlnaHQ');
    expect(fateKey('Überzeugen')).toBe('w5xiZXJ6ZXVnZW4');
  });

  it('formats ladder ranks', () => {
    expect(formatRank(2)).toBe('Fair (+2)');
    expect(formatRank(-1)).toBe('Poor (-1)');
    expect(formatRank(10)).toBe('Beyond Legendary (+10)');
  });

  it('detects consequence tracks', () => {
    expect(trackHasAspect({ aspect: 'No' })).toBe(false);
    expect(trackHasAspect({ aspect: { name: '', when_marked: true } })).toBe(true);
    expect(trackHasAspect({ aspect: { name: 'x', as_name: true } })).toBe(true);
  });
});

describe('Fate filters', () => {
  const creature = {
    systemData: {
      peakSkillRank: 4,
      skills: [
        { name: 'Fight', rank: 4 },
        { name: 'Lore', rank: 0 },
      ],
    },
  };

  it('matches skill and peak rank', () => {
    expect(matchesFateFilters(creature, { skill: 'fight' })).toBe(true);
    expect(matchesFateFilters(creature, { skill: 'Lore' })).toBe(false);
    expect(matchesFateFilters(creature, { peakSkillRank: { min: 3 } })).toBe(true);
    expect(matchesFateFilters(creature, { peakSkillRank: { max: 3 } })).toBe(false);
  });

  it('describes filters', () => {
    expect(describeFateFilters({ skill: 'Fight', peakSkillRank: { min: 3 } })).toBe(
      'has Fight, peak skill ≥ Good (+3)'
    );
    expect(describeFateFilters({})).toBe('no filters');
  });
});
