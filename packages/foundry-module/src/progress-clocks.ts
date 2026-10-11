import { MODULE_ID } from './constants.js';

/**
 * Access to the Global Progress Clocks module
 * (https://github.com/CarlosFdez/global-progress-clocks) through its scripting
 * interface, `window.clockDatabase`: a Collection of entries kept in the
 * world setting `global-progress-clocks.activeClocks`, in display order.
 *
 * Entries are clocks (segmented, Blades in the Dark style), points (a counter,
 * e.g. PF2e victory points) or trackers (a row of boxes). The module's
 * `addClock`, `delete` and `move` don't return their settings write, so changes
 * wait until the database reflects them before replying.
 */

export const PROGRESS_CLOCKS_MODULE_ID = 'global-progress-clocks';

export type ClockType = 'clock' | 'points' | 'tracker';

const CLOCK_TYPES: ClockType[] = ['clock', 'points', 'tracker'];

/** The module's size limits (`ClockDatabase#verifyClockData`); points are fixed at 99. */
const MAX_SIZE: Record<ClockType, number> = { clock: 128, points: 99, tracker: 12 };

/** Keys of the module's `enabledTypes` setting. */
const ENABLED_KEY: Record<ClockType, string> = {
  clock: 'clocks',
  points: 'points',
  tracker: 'trackers',
};

type Failure = { success: false; error: string };

function fail(error: string): Failure {
  return { success: false, error };
}

function minValue(type: ClockType): number {
  return type === 'points' ? -MAX_SIZE.points : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface ManageClocksInput {
  action: 'create' | 'update' | 'tick' | 'delete' | 'move';
  clock?: string;
  name?: string;
  type?: ClockType;
  value?: number;
  max?: number;
  amount?: number;
  private?: boolean;
  color?: string | null;
  position?: number;
}

export class ProgressClocksAccess {
  /** How long to wait for a settings write to show up in the database. */
  waitTimeoutMs = 5000;

  /** The clock database, or a failure when the module is missing or inactive. */
  private getDb(): { db: any } | Failure {
    const module = (game as any).modules?.get?.(PROGRESS_CLOCKS_MODULE_ID);
    if (!module?.active) {
      return fail('The Global Progress Clocks module is not installed or not active in this world');
    }
    const db = (globalThis as any).clockDatabase;
    if (!db) return fail('Global Progress Clocks is active but its clock database is not ready');
    return { db };
  }

  private requireWrites(): Failure | null {
    if (game.settings.get(MODULE_ID, 'allowWriteOperations')) return null;
    return fail('Write operations are disabled in the Foundry MCP Bridge settings');
  }

  private setting(key: string, fallback: unknown): any {
    try {
      return game.settings.get(PROGRESS_CLOCKS_MODULE_ID as any, key as any) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private colors(): Array<{ id: string; name: string; color: string }> {
    const colors = this.setting('clockColors', []);
    return Array.isArray(colors) ? colors : [];
  }

  private enabledTypes(): Record<ClockType, boolean> {
    const enabled = this.setting('enabledTypes', {});
    // Matches the module's defaults: clocks and points on, trackers off.
    return {
      clock: enabled.clocks ?? true,
      points: enabled.points ?? true,
      tracker: enabled.trackers ?? false,
    };
  }

  private describe(entry: any, index: number): Record<string, unknown> {
    const type: ClockType = CLOCK_TYPES.includes(entry.type) ? entry.type : 'clock';
    const color = this.colors().find(c => c.id === entry.colorId);
    return {
      id: entry.id,
      name: entry.name,
      type,
      value: entry.value,
      max: entry.max,
      ...(type === 'points' ? {} : { complete: entry.value >= entry.max }),
      private: Boolean(entry.private),
      color: color ? { id: color.id, name: color.name, hex: color.color } : null,
      position: index + 1,
    };
  }

  private describeById(db: any, id: string): Record<string, unknown> | null {
    const index = db.contents.findIndex((c: any) => c.id === id);
    return index === -1 ? null : this.describe(db.contents[index], index);
  }

  /** Find an entry by id, or by name (case-insensitive) when the name is unique. */
  private resolve(db: any, ref: string): any {
    const byId = db.get(ref);
    if (byId) return byId;
    const wanted = ref.trim().toLowerCase();
    const matches = db.contents.filter((c: any) => c.name?.trim().toLowerCase() === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const ids = matches.map((c: any) => c.id).join(', ');
      throw new Error(`Several entries are named "${ref}"; use an id: ${ids}`);
    }
    const names = db.contents.map((c: any) => `"${c.name}"`).join(', ') || 'none';
    throw new Error(`No clock, points or tracker named "${ref}". Entries: ${names}`);
  }

  /** Resolve a color id or name; null or "default" clears it. */
  private resolveColor(color: string | null): string | null {
    if (color === null || color.trim().toLowerCase() === 'default') return null;
    const wanted = color.trim().toLowerCase();
    const colors = this.colors();
    const match = colors.find(c => c.id === color || c.name?.trim().toLowerCase() === wanted);
    if (match) return match.id;
    const names = colors.map(c => `"${c.name}"`).join(', ');
    throw new Error(
      names
        ? `Unknown color "${color}". Colors: ${names}`
        : `Unknown color "${color}"; no clock colors are configured in Global Progress Clocks`
    );
  }

  private checkMax(type: ClockType, max: number): void {
    if (!Number.isInteger(max) || max < 1 || max > MAX_SIZE[type]) {
      throw new Error(`A ${type}'s max must be a whole number from 1 to ${MAX_SIZE[type]}`);
    }
  }

  /** Wait until the database (refreshed by the setting's onChange) satisfies `ready`. */
  private async waitFor(ready: () => boolean): Promise<void> {
    const deadline = Date.now() + this.waitTimeoutMs;
    while (!ready()) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for Global Progress Clocks to save the change');
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  // ─── Reading ────────────────────────────────────────────────────────────────

  listClocks(data: { type?: ClockType } = {}): any {
    const ctx = this.getDb();
    if ('success' in ctx) return ctx;
    const { db } = ctx;

    const entries = db.contents
      .map((c: any, i: number) => this.describe(c, i))
      .filter((c: any) => !data.type || c.type === data.type);
    return {
      success: true,
      count: entries.length,
      entries,
      colors: this.colors().map(c => ({ id: c.id, name: c.name, hex: c.color })),
      enabledTypes: this.enabledTypes(),
    };
  }

  // ─── Writing ────────────────────────────────────────────────────────────────

  async manageClocks(data: ManageClocksInput): Promise<any> {
    const ctx = this.getDb();
    if ('success' in ctx) return ctx;
    const { db } = ctx;
    const blocked = this.requireWrites();
    if (blocked) return blocked;

    switch (data.action) {
      case 'create':
        return this.create(db, data);
      case 'update':
        return this.update(db, data);
      case 'tick':
        return this.tick(db, data);
      case 'delete':
        return this.remove(db, data);
      case 'move':
        return this.move(db, data);
      default:
        throw new Error(`Unknown action "${(data as any).action}"`);
    }
  }

  private requireClock(db: any, data: ManageClocksInput): any {
    if (!data.clock) throw new Error(`clock (id or name) is required for ${data.action}`);
    return this.resolve(db, data.clock);
  }

  private async create(db: any, data: ManageClocksInput): Promise<any> {
    if (!data.name) throw new Error('name is required for create');
    const type = data.type ?? 'clock';
    // Points have no real maximum; the module always gives them 99.
    const max = type === 'points' ? MAX_SIZE.points : (data.max ?? 4);
    this.checkMax(type, max);

    const id = foundry.utils.randomID();
    const entry: Record<string, unknown> = {
      id,
      name: data.name,
      type,
      max,
      value: clamp(data.value ?? 0, minValue(type), max),
      private: data.private ?? false,
    };
    if (data.color !== undefined) entry.colorId = this.resolveColor(data.color);

    db.addClock(entry);
    await this.waitFor(() => db.has(id));

    const enabled = this.enabledTypes()[type];
    return {
      success: true,
      action: 'create',
      entry: this.describeById(db, id),
      ...(enabled
        ? {}
        : {
            warning:
              `The "${ENABLED_KEY[type]}" type is disabled in Global Progress Clocks' settings, ` +
              'so this entry is saved but not shown until it is enabled',
          }),
    };
  }

  private async update(db: any, data: ManageClocksInput): Promise<any> {
    const existing = this.requireClock(db, data);
    const type: ClockType = existing.type ?? 'clock';
    const changes: Record<string, unknown> = { id: existing.id };

    if (data.name !== undefined) changes.name = data.name;
    if (data.private !== undefined) changes.private = data.private;
    if (data.color !== undefined) changes.colorId = this.resolveColor(data.color);
    if (data.max !== undefined) {
      if (type === 'points') throw new Error('Points have a fixed max of 99');
      this.checkMax(type, data.max);
      changes.max = data.max;
    }
    if (data.value !== undefined) changes.value = data.value;
    if (Object.keys(changes).length === 1) {
      throw new Error('update needs at least one of name, value, max, private or color');
    }

    const before = this.describeById(db, existing.id);
    await db.update(changes);
    return {
      success: true,
      action: 'update',
      before,
      entry: this.describeById(db, existing.id),
    };
  }

  private async tick(db: any, data: ManageClocksInput): Promise<any> {
    const existing = this.requireClock(db, data);
    const amount = data.amount ?? 1;
    if (!Number.isInteger(amount) || amount === 0) {
      throw new Error('amount must be a non-zero whole number');
    }
    const type: ClockType = existing.type ?? 'clock';
    const previous = existing.value ?? 0;
    const value = clamp(previous + amount, minValue(type), existing.max);

    await db.update({ id: existing.id, value });
    const entry = this.describeById(db, existing.id);
    return {
      success: true,
      action: 'tick',
      previous,
      entry,
      ...(value - previous !== amount
        ? {
            note: `Stopped at ${value}: ${type} values range from ${minValue(type)} to ${existing.max}`,
          }
        : {}),
    };
  }

  private async remove(db: any, data: ManageClocksInput): Promise<any> {
    const existing = this.requireClock(db, data);
    const before = this.describeById(db, existing.id);
    db.delete(existing.id);
    await this.waitFor(() => !db.has(existing.id));
    return { success: true, action: 'delete', deleted: before };
  }

  private async move(db: any, data: ManageClocksInput): Promise<any> {
    const existing = this.requireClock(db, data);
    const count = db.contents.length;
    const position = data.position;
    if (position === undefined || !Number.isInteger(position) || position < 1 || position > count) {
      throw new Error(`position must be a whole number from 1 to ${count}`);
    }
    const index = position - 1;
    if (db.contents[index]?.id !== existing.id) {
      db.move(existing.id, index);
      await this.waitFor(() => db.contents[index]?.id === existing.id);
    }
    return {
      success: true,
      action: 'move',
      order: db.contents.map((c: any, i: number) => ({ position: i + 1, id: c.id, name: c.name })),
    };
  }
}
