/**
 * Fate Core Official constants and helpers.
 *
 * Fate Core Official (system id `fate-core-official`) stores skills, aspects,
 * stunts and tracks as objects keyed by the base64 of each entry's name, with
 * no padding (see fcoConstants.tob64 in the system source).
 */

export const SYSTEM_ID = 'fate-core-official';

/** Actor types defined by the system (characters and NPCs share one type). */
export const ACTOR_TYPES = {
  CHARACTER: 'fate-core-official',
  THING: 'Thing',
} as const;

export const ITEM_TYPES = {
  EXTRA: 'Extra',
} as const;

export const FIELD_PATHS = {
  FATE_POINTS: 'system.details.fatePoints',
  SKILLS: 'system.skills',
  ASPECTS: 'system.aspects',
  STUNTS: 'system.stunts',
  TRACKS: 'system.tracks',
  DESCRIPTION: 'system.details.description.value',
  BIOGRAPHY: 'system.details.biography.value',
  PRONOUNS: 'system.details.pronouns.value',
} as const;

/**
 * The default Fate ladder. Worlds can override it via the system's `ladder`
 * setting; the module reports the live ladder where it matters (rolls).
 */
export const DEFAULT_LADDER: Record<number, string> = {
  8: 'Legendary',
  7: 'Epic',
  6: 'Fantastic',
  5: 'Superb',
  4: 'Great',
  3: 'Good',
  2: 'Fair',
  1: 'Average',
  0: 'Mediocre',
  [-1]: 'Poor',
  [-2]: 'Terrible',
};

export function ladderLabel(rank: number): string {
  if (DEFAULT_LADDER[rank]) return DEFAULT_LADDER[rank];
  return rank > 8 ? 'Beyond Legendary' : 'Beyond Terrible';
}

/** Format a rank the way Fate players say it, e.g. "Great (+4)". */
export function formatRank(rank: number): string {
  return `${ladderLabel(rank)} (${rank >= 0 ? '+' : ''}${rank})`;
}

/** The key the system uses for a named skill/aspect/stunt/track. */
export function fateKey(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64').split('=').join('');
}

/**
 * A track is a consequence-style track when it carries an aspect (the system
 * stores "No"/"no" or a localized string for tracks without one).
 */
export function trackHasAspect(track: any): boolean {
  return (
    track?.aspect !== null &&
    typeof track?.aspect === 'object' &&
    (track.aspect.when_marked === true || track.aspect.as_name === true)
  );
}

export function stripHtml(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
