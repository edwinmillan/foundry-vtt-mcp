/**
 * Anima Beyond Fantasy (abfalter) filter schemas.
 *
 * Level is Anima's power metric; filtering is intentionally lightweight.
 */

import { z } from 'zod';

export const AbfalterFiltersSchema = z.object({
  level: z
    .union([
      z.number(),
      z.object({
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ])
    .optional(),
  // Only actors with this supernatural ability developed
  hasZeon: z.boolean().optional(),
  hasKi: z.boolean().optional(),
  hasPsychic: z.boolean().optional(),
});

export type AbfalterFilters = z.infer<typeof AbfalterFiltersSchema>;

export function matchesAbfalterFilters(creature: any, filters: AbfalterFilters): boolean {
  const data = creature?.systemData ?? {};

  if (filters.level !== undefined) {
    const level = data.level;
    if (typeof level !== 'number') return false;
    if (typeof filters.level === 'number') {
      if (level !== filters.level) return false;
    } else {
      const { min, max } = filters.level;
      if (min !== undefined && level < min) return false;
      if (max !== undefined && level > max) return false;
    }
  }

  for (const flag of ['hasZeon', 'hasKi', 'hasPsychic'] as const) {
    if (filters[flag] !== undefined && !!data[flag] !== filters[flag]) return false;
  }

  return true;
}

export function describeAbfalterFilters(filters: AbfalterFilters): string {
  const parts: string[] = [];
  if (filters.level !== undefined) {
    if (typeof filters.level === 'number') {
      parts.push(`level ${filters.level}`);
    } else {
      const { min, max } = filters.level;
      if (min !== undefined) parts.push(`level ≥ ${min}`);
      if (max !== undefined) parts.push(`level ≤ ${max}`);
    }
  }
  if (filters.hasZeon !== undefined) parts.push(filters.hasZeon ? 'uses magic' : 'no magic');
  if (filters.hasKi !== undefined) parts.push(filters.hasKi ? 'uses ki' : 'no ki');
  if (filters.hasPsychic !== undefined) {
    parts.push(filters.hasPsychic ? 'has psychic powers' : 'no psychic powers');
  }
  return parts.length > 0 ? parts.join(', ') : 'no filters';
}
