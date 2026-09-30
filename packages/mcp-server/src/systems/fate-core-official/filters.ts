/**
 * Fate Core Official Filter Schemas
 *
 * Fate has no Challenge Rating; the closest power metric is an NPC's peak
 * skill rank on the ladder. Filtering is intentionally lightweight.
 */

import { z } from 'zod';
import { formatRank } from './constants.js';

export const FateFiltersSchema = z.object({
  // Only actors that have this skill (case-insensitive) at a rank above Mediocre
  skill: z.string().optional(),

  // Peak skill rank bounds, e.g. { min: 3 } for Good or better
  peakSkillRank: z
    .union([
      z.number(),
      z.object({
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ])
    .optional(),
});

export type FateFilters = z.infer<typeof FateFiltersSchema>;

export function matchesFateFilters(creature: any, filters: FateFilters): boolean {
  const data = creature?.systemData ?? {};

  if (filters.skill) {
    const wanted = filters.skill.toLowerCase();
    const skills: Array<{ name: string; rank: number }> = data.skills ?? [];
    if (!skills.some(s => s.name.toLowerCase() === wanted && s.rank > 0)) return false;
  }

  if (filters.peakSkillRank !== undefined) {
    const peak = data.peakSkillRank;
    if (typeof peak !== 'number') return false;
    if (typeof filters.peakSkillRank === 'number') {
      if (peak !== filters.peakSkillRank) return false;
    } else {
      const { min, max } = filters.peakSkillRank;
      if (min !== undefined && peak < min) return false;
      if (max !== undefined && peak > max) return false;
    }
  }

  return true;
}

export function describeFateFilters(filters: FateFilters): string {
  const parts: string[] = [];
  if (filters.skill) parts.push(`has ${filters.skill}`);
  if (filters.peakSkillRank !== undefined) {
    if (typeof filters.peakSkillRank === 'number') {
      parts.push(`peak skill ${formatRank(filters.peakSkillRank)}`);
    } else {
      const { min, max } = filters.peakSkillRank;
      if (min !== undefined) parts.push(`peak skill ≥ ${formatRank(min)}`);
      if (max !== undefined) parts.push(`peak skill ≤ ${formatRank(max)}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'no filters';
}
