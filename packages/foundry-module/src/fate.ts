/**
 * Helpers for the Fate Core Official system (id "fate-core-official").
 *
 * The system keys actor skills, aspects, stunts and tracks by the base64 of
 * each entry's name with padding removed (fcoConstants.tob64 in the system).
 */

export const FATE_SYSTEM_ID = 'fate-core-official';

export const FATE_DEFAULT_LADDER: Record<string, string> = {
  '8': 'Legendary',
  '7': 'Epic',
  '6': 'Fantastic',
  '5': 'Superb',
  '4': 'Great',
  '3': 'Good',
  '2': 'Fair',
  '1': 'Average',
  '0': 'Mediocre',
  '-1': 'Poor',
  '-2': 'Terrible',
};

export function fateKey(name: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(name)) binary += String.fromCharCode(byte);
  return btoa(binary).split('=').join('');
}

/**
 * Find an entry in a name-keyed block: by its computed key first (the way the
 * system does), then by case-insensitive name.
 */
export function findFateEntry(
  block: Record<string, any> | null | undefined,
  name: string
): { key: string; entry: any } | null {
  if (!block) return null;
  const key = fateKey(name);
  if (block[key]) return { key, entry: block[key] };
  const wanted = name.toLowerCase();
  const hit = Object.entries(block).find(([, v]) => v?.name?.toLowerCase() === wanted);
  return hit ? { key: hit[0], entry: hit[1] } : null;
}

/**
 * Update-object entries that delete `${path}.${key}`: the v14 `_del` operator
 * the system itself uses, or the legacy `-=` key on older cores.
 */
export function fateDeletion(path: string, key: string): Record<string, unknown> {
  const del = (globalThis as any)._del;
  return del !== undefined ? { [`${path}.${key}`]: del } : { [`${path}.-=${key}`]: null };
}

export function escapeFateHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
