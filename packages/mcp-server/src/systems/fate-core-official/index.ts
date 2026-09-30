/**
 * Fate Core Official System Module
 *
 * Exports for Fate Core Official support in the Registry Pattern architecture.
 */

export { FateCoreOfficialAdapter } from './adapter.js';

export { FateFiltersSchema, matchesFateFilters, describeFateFilters } from './filters.js';
export type { FateFilters } from './filters.js';

export {
  SYSTEM_ID,
  ACTOR_TYPES,
  ITEM_TYPES,
  FIELD_PATHS,
  DEFAULT_LADDER,
  ladderLabel,
  formatRank,
  fateKey,
  trackHasAspect,
  stripHtml,
} from './constants.js';
