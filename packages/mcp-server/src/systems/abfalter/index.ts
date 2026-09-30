/**
 * Anima Beyond Fantasy (abfalter) System Module
 *
 * Exports for abfalter support in the Registry Pattern architecture.
 */

export { AbfalterAdapter } from './adapter.js';

export {
  AbfalterFiltersSchema,
  matchesAbfalterFilters,
  describeAbfalterFilters,
} from './filters.js';
export type { AbfalterFilters } from './filters.js';

export {
  SYSTEM_ID,
  ACTOR_TYPES,
  CHARACTERISTICS,
  RESISTANCES,
  SECONDARY_LABELS,
  ITEM_GROUPS,
  FIELD_PATHS,
  secondaryLabel,
  stripHtml,
} from './constants.js';
