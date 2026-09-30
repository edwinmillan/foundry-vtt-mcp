/**
 * Fate Core Official System Adapter
 *
 * Character-focused SystemAdapter for the Fate Core Official system
 * (github.com/Sk1mble/fate-core-official): aspects, skills on the Fate ladder,
 * stunts, stress/consequence tracks, and fate points. Fate has no Challenge
 * Rating, so creature indexing is not supported; an actor's peak skill rank
 * stands in as its power level.
 */

import type { SystemAdapter, SystemMetadata, SystemCreatureIndex } from '../types.js';
import { FateFiltersSchema, matchesFateFilters, describeFateFilters } from './filters.js';
import {
  ACTOR_TYPES,
  FIELD_PATHS,
  ITEM_TYPES,
  SYSTEM_ID,
  formatRank,
  stripHtml,
  trackHasAspect,
} from './constants.js';

const DESCRIPTION_MAX_CHARS = 300;

function truncate(text: string, max = DESCRIPTION_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function values(block: unknown): any[] {
  return block && typeof block === 'object' ? Object.values(block as Record<string, any>) : [];
}

export class FateCoreOfficialAdapter implements SystemAdapter {
  getMetadata(): SystemMetadata {
    return {
      id: SYSTEM_ID,
      name: SYSTEM_ID,
      displayName: 'Fate Core Official',
      version: '1.0.0',
      description:
        'Support for Fate Core / Fate Condensed / Fate Accelerated via the Fate Core Official ' +
        'system: aspects, skills on the Fate ladder, stunts, stress and consequence tracks, ' +
        'and fate points.',
      supportedFeatures: {
        creatureIndex: false,
        characterStats: true,
        spellcasting: false,
        powerLevel: true, // peak skill rank
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
    throw new Error('Fate Core Official does not support the enhanced creature index');
  }

  getFilterSchema() {
    return FateFiltersSchema;
  }

  matchesFilters(creature: SystemCreatureIndex, filters: Record<string, any>): boolean {
    const validated = FateFiltersSchema.safeParse(filters);
    if (!validated.success) return false;
    return matchesFateFilters(creature, validated.data);
  }

  getDataPaths(): Record<string, string | null> {
    return {
      fatePoints: FIELD_PATHS.FATE_POINTS,
      skills: FIELD_PATHS.SKILLS,
      aspects: FIELD_PATHS.ASPECTS,
      stunts: FIELD_PATHS.STUNTS,
      tracks: FIELD_PATHS.TRACKS,
      description: FIELD_PATHS.DESCRIPTION,
      biography: FIELD_PATHS.BIOGRAPHY,

      // D&D5e / PF2e paths that do not exist in Fate
      challengeRating: null,
      level: null,
      creatureType: null,
      size: null,
      alignment: null,
      hitPoints: null,
      armorClass: null,
      abilities: null,
      saves: null,
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
    const peak = creature.systemData?.peakSkillRank;
    if (typeof peak === 'number') formatted.stats = { peakSkill: formatRank(peak) };
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
    const validated = FateFiltersSchema.safeParse(filters);
    if (!validated.success) return 'invalid filters';
    return describeFateFilters(validated.data);
  }

  getPowerLevel(creature: SystemCreatureIndex): number | undefined {
    const peak = creature.systemData?.peakSkillRank;
    return typeof peak === 'number' ? peak : undefined;
  }

  extractBasicInfo(actorData: any): any {
    const details = actorData.system?.details ?? {};
    const basicInfo: any = {};

    const aspects = values(actorData.system?.aspects);
    const highConcept = aspects.find(a => /high concept/i.test(a?.name ?? ''))?.value;
    const trouble = aspects.find(a => /trouble/i.test(a?.name ?? ''))?.value;
    if (highConcept) basicInfo.highConcept = highConcept;
    if (trouble) basicInfo.trouble = trouble;

    if (details.pronouns?.value) basicInfo.pronouns = details.pronouns.value;
    const fp = details.fatePoints;
    if (fp) basicInfo.fatePoints = { current: fp.current ?? 0, refresh: fp.refresh ?? null };

    return basicInfo;
  }

  extractCharacterStats(actorData: any): any {
    const system = actorData.system ?? {};
    const stats: any = { name: actorData.name, type: actorData.type };

    if (actorData.type === ACTOR_TYPES.THING) {
      const container = system.container ?? {};
      stats.thing = {
        isContainer: !!container.isContainer,
        locked: !!container.locked,
        movable: container.movable !== false,
      };
      return stats;
    }

    const fp = system.details?.fatePoints ?? {};
    stats.fatePoints = {
      current: fp.current ?? 0,
      refresh: fp.refresh ?? null,
      boosts: fp.boosts ?? 0,
    };

    stats.aspects = values(system.aspects)
      .filter(a => a?.name)
      .map(a => ({ name: a.name, value: a.value ?? '' }));

    const skills = values(system.skills).filter(s => s?.name && !s.hidden);
    stats.skills = skills
      .filter(s => (s.rank ?? 0) !== 0)
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
      .map(s => ({ name: s.name, rank: s.rank, ladder: formatRank(s.rank) }));
    const mediocre = skills
      .filter(s => (s.rank ?? 0) === 0)
      .map(s => s.name)
      .sort();
    if (mediocre.length > 0) stats.mediocreSkills = mediocre;
    if (stats.skills.length > 0) stats.peakSkillRank = stats.skills[0].rank;

    stats.stunts = values(system.stunts)
      .filter(st => st?.name)
      .map(st => {
        const actions = ['overcome', 'caa', 'attack', 'defend'].filter(k => st[k] === true);
        const stunt: any = { name: st.name };
        if (st.linked_skill && st.linked_skill !== 'None') stunt.linkedSkill = st.linked_skill;
        if (st.bonus) stunt.bonus = st.bonus;
        if (actions.length > 0) {
          stunt.actions = actions.map(a => (a === 'caa' ? 'create an advantage' : a));
        }
        if (st.refresh_cost !== undefined && st.refresh_cost !== 1) {
          stunt.refreshCost = st.refresh_cost;
        }
        const description = stripHtml(st.description);
        if (description) stunt.description = truncate(description);
        return stunt;
      });

    const stress: any[] = [];
    const consequences: any[] = [];
    const otherTracks: any[] = [];
    for (const track of values(system.tracks)) {
      if (!track?.name || track.enabled === false) continue;
      const boxValues: boolean[] = Array.isArray(track.box_values) ? track.box_values : [];
      const summary: any = { name: track.name };
      if (track.category) summary.category = track.category;
      if (boxValues.length > 0) {
        summary.boxes = boxValues.length;
        summary.marked = boxValues
          .map((checked, i) => (checked ? i + 1 : null))
          .filter((i): i is number => i !== null);
      }

      if (trackHasAspect(track)) {
        if (track.harm_can_absorb) summary.absorbs = track.harm_can_absorb;
        const text = track.aspect?.name ?? '';
        summary.aspect = text;
        summary.taken = text !== '' || (summary.marked?.length ?? 0) > 0;
        if (track.recovery_type) summary.recovery = track.recovery_type;
        consequences.push(summary);
      } else if (boxValues.length > 0) {
        stress.push(summary);
      } else {
        const notes = stripHtml(track.notes);
        if (notes) summary.notes = truncate(notes);
        otherTracks.push(summary);
      }
    }
    stats.stress = stress;
    stats.consequences = consequences;
    if (otherTracks.length > 0) stats.otherTracks = otherTracks;

    const extras = (actorData.items ?? []).filter((i: any) => i?.type === ITEM_TYPES.EXTRA);
    if (extras.length > 0) {
      stats.extras = extras.map((e: any) => ({
        name: e.name,
        active: e.system?.active !== false,
      }));
    }

    const description = stripHtml(system.details?.description?.value);
    if (description) stats.description = truncate(description);

    return stats;
  }

  describeActorSchema(): string {
    return [
      '=== fate-core-official Actor Schema Reference ===',
      '',
      'ACTOR TYPES: fate-core-official (PCs and NPCs), Thing (objects/containers)',
      'ITEM TYPES: Extra',
      '',
      'CREATING A CHARACTER OR NPC:',
      '  Create with type "fate-core-official" and NO system data. The system then fills in',
      "  the world's default skills (at Mediocre), aspect slots, stress/consequence tracks,",
      '  and refresh. Any aspects passed at creation are overwritten by those defaults.',
      '  Then use fate-update-character to set aspects, skill ranks, stunts, and fate points.',
      '',
      'DATA LAYOUT (system.*) — maps keyed by base64(name) with no padding:',
      '  skills.<key>:  { name, rank, description, ... }   rank on the ladder, -2..8',
      '  aspects.<key>: { name: "High Concept", value: "Wizard Private Eye", ... }',
      '  stunts.<key>:  { name, description, linked_skill, bonus, refresh_cost, overcome, caa, attack, defend }',
      '  tracks.<key>:  { name, category, boxes, box_values: [bool], aspect: "No" | { name, when_marked, as_name } }',
      '  details.fatePoints: { current, refresh, boosts }',
      '',
      'Prefer fate-update-character over raw updates: it computes the keys and keeps',
      'box_values in sync with each track.',
    ].join('\n');
  }
}
