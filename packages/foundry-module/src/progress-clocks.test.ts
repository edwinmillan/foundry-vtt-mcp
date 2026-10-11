import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressClocksAccess } from './progress-clocks.js';

/**
 * A stand-in for `window.clockDatabase`: a Map of entries in display order.
 * Like the module, addClock/delete/move fire a settings write without
 * returning it, so the change lands a tick later; update awaits its write.
 */
class FakeClockDatabase extends Map<string, any> {
  get contents(): any[] {
    return [...this.values()];
  }

  private replace(entries: any[]): void {
    this.clear();
    for (const e of entries) this.set(e.id, e);
  }

  addClock = vi.fn((data: any) => {
    setTimeout(() =>
      this.set(data.id, { type: 'clock', value: 0, max: 4, private: false, ...data })
    );
  });

  delete = vi.fn((id: string): boolean => {
    setTimeout(() => Map.prototype.delete.call(this, id));
    return true;
  });

  move = vi.fn((id: string, idx: number) => {
    setTimeout(() => {
      const entries = this.contents.filter(c => c.id !== id);
      entries.splice(idx, 0, this.get(id));
      this.replace(entries);
    });
  });

  update = vi.fn(async (data: any) => {
    const existing = this.get(data.id);
    const merged = { ...existing, ...data };
    const min = merged.type === 'points' ? -99 : 0;
    merged.value = Math.min(Math.max(merged.value, min), merged.max);
    this.set(data.id, merged);
  });
}

function setup(
  options: { active?: boolean; allowWrites?: boolean; trackers?: boolean; noDb?: boolean } = {}
) {
  const db = new FakeClockDatabase();
  for (const entry of [
    { id: 'c1', name: 'The Ritual', type: 'clock', value: 2, max: 6, private: false },
    { id: 'p1', name: 'Victory Points', type: 'points', value: 3, max: 99, private: false },
    {
      id: 'c2',
      name: 'Guards Alerted',
      type: 'clock',
      value: 3,
      max: 4,
      private: true,
      colorId: 'red',
    },
  ]) {
    db.set(entry.id, entry);
  }

  if (!options.noDb) vi.stubGlobal('clockDatabase', db);
  let nextId = 0;
  vi.stubGlobal('foundry', { utils: { randomID: () => `new${++nextId}` } });
  vi.stubGlobal('game', {
    modules: {
      get: (id: string) =>
        id === 'global-progress-clocks' ? { active: options.active ?? true } : undefined,
    },
    settings: {
      get: (scope: string, key: string) => {
        if (scope === 'foundry-mcp-bridge' && key === 'allowWriteOperations') {
          return options.allowWrites ?? true;
        }
        if (scope === 'global-progress-clocks' && key === 'clockColors') {
          return [{ id: 'red', name: 'Danger', color: '#ff0000' }];
        }
        if (scope === 'global-progress-clocks' && key === 'enabledTypes') {
          return { clocks: true, points: true, trackers: options.trackers ?? false };
        }
        throw new Error(`setting not registered: ${scope}.${key}`);
      },
    },
  });
  const access = new ProgressClocksAccess();
  access.waitTimeoutMs = 200;
  return { db, access };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProgressClocksAccess gating', () => {
  it('reports when the module is not active', async () => {
    const { access } = setup({ active: false });
    expect(access.listClocks().error).toContain('not installed or not active');
    expect((await access.manageClocks({ action: 'delete', clock: 'c1' })).success).toBe(false);
  });

  it('reports when the database is missing', () => {
    const { access } = setup({ noDb: true });
    expect(access.listClocks().error).toContain('not ready');
  });

  it('blocks writes when write operations are disabled', async () => {
    const { access, db } = setup({ allowWrites: false });
    const result = await access.manageClocks({ action: 'tick', clock: 'c1' });
    expect(result.error).toContain('Write operations are disabled');
    expect(db.update).not.toHaveBeenCalled();
    // Reading still works.
    expect(access.listClocks().success).toBe(true);
  });
});

describe('ProgressClocksAccess.listClocks', () => {
  it('describes every entry in order, with colors and enabled types', () => {
    const { access } = setup();
    const result = access.listClocks();
    expect(result.count).toBe(3);
    expect(result.entries[0]).toEqual({
      id: 'c1',
      name: 'The Ritual',
      type: 'clock',
      value: 2,
      max: 6,
      complete: false,
      private: false,
      color: null,
      position: 1,
    });
    // Points have no completion.
    expect(result.entries[1]).not.toHaveProperty('complete');
    expect(result.entries[2]).toMatchObject({
      private: true,
      color: { id: 'red', name: 'Danger', hex: '#ff0000' },
      position: 3,
    });
    expect(result.colors).toEqual([{ id: 'red', name: 'Danger', hex: '#ff0000' }]);
    expect(result.enabledTypes).toEqual({ clock: true, points: true, tracker: false });
  });

  it('filters by type', () => {
    const { access } = setup();
    const result = access.listClocks({ type: 'points' });
    expect(result.entries.map((e: any) => e.id)).toEqual(['p1']);
  });
});

describe('ProgressClocksAccess.manageClocks', () => {
  it('creates a clock and waits for it to be saved', async () => {
    const { access, db } = setup();
    const result = await access.manageClocks({
      action: 'create',
      name: 'Reinforcements',
      max: 8,
      color: 'danger',
    });
    expect(db.addClock).toHaveBeenCalledWith({
      id: 'new1',
      name: 'Reinforcements',
      type: 'clock',
      max: 8,
      value: 0,
      private: false,
      colorId: 'red',
    });
    expect(result.entry).toMatchObject({ id: 'new1', max: 8, position: 4 });
    expect(result).not.toHaveProperty('warning');
  });

  it('gives points a max of 99 and warns when a type is disabled', async () => {
    const { access, db } = setup();
    await access.manageClocks({ action: 'create', name: 'VP', type: 'points', value: -5 });
    expect(db.addClock.mock.calls[0][0]).toMatchObject({ max: 99, value: -5 });

    const tracker = await access.manageClocks({
      action: 'create',
      name: 'Stress',
      type: 'tracker',
    });
    expect(tracker.warning).toContain('"trackers" type is disabled');
  });

  it('enforces the module size limits', async () => {
    const { access, db } = setup();
    await expect(
      access.manageClocks({ action: 'create', name: 'Big', type: 'tracker', max: 13 })
    ).rejects.toThrow('from 1 to 12');
    await expect(access.manageClocks({ action: 'create', name: 'Huge', max: 129 })).rejects.toThrow(
      'from 1 to 128'
    );
    await expect(access.manageClocks({ action: 'update', clock: 'p1', max: 10 })).rejects.toThrow(
      'fixed max of 99'
    );
    expect(db.addClock).not.toHaveBeenCalled();
  });

  it('rejects unknown colors with the configured list', async () => {
    const { access } = setup();
    await expect(
      access.manageClocks({ action: 'create', name: 'X', color: 'teal' })
    ).rejects.toThrow('Colors: "Danger"');
  });

  it('ticks by name, case-insensitively, and reports completion', async () => {
    const { access, db } = setup();
    const result = await access.manageClocks({ action: 'tick', clock: 'guards alerted' });
    expect(db.update).toHaveBeenCalledWith({ id: 'c2', value: 4 });
    expect(result.previous).toBe(3);
    expect(result.entry).toMatchObject({ value: 4, complete: true });
    expect(result).not.toHaveProperty('note');
  });

  it('stops ticks at the limits and says so', async () => {
    const { access, db } = setup();
    const up = await access.manageClocks({ action: 'tick', clock: 'c1', amount: 10 });
    expect(db.update).toHaveBeenLastCalledWith({ id: 'c1', value: 6 });
    expect(up.note).toContain('Stopped at 6');

    await access.manageClocks({ action: 'tick', clock: 'p1', amount: -10 });
    expect(db.update).toHaveBeenLastCalledWith({ id: 'p1', value: -7 });
  });

  it('updates fields and reports before and after', async () => {
    const { access, db } = setup();
    const result = await access.manageClocks({
      action: 'update',
      clock: 'Guards Alerted',
      name: 'Alarm',
      private: false,
      color: 'default',
    });
    expect(db.update).toHaveBeenCalledWith({
      id: 'c2',
      name: 'Alarm',
      private: false,
      colorId: null,
    });
    expect(result.before).toMatchObject({ name: 'Guards Alerted', private: true });
    expect(result.entry).toMatchObject({ name: 'Alarm', private: false, color: null });
  });

  it('rejects an update with nothing to change', async () => {
    const { access } = setup();
    await expect(access.manageClocks({ action: 'update', clock: 'c1' })).rejects.toThrow(
      'at least one of'
    );
  });

  it('deletes and waits for the removal', async () => {
    const { access, db } = setup();
    const result = await access.manageClocks({ action: 'delete', clock: 'The Ritual' });
    expect(db.delete).toHaveBeenCalledWith('c1');
    expect(result.deleted).toMatchObject({ id: 'c1', name: 'The Ritual' });
    expect(db.has('c1')).toBe(false);
  });

  it('moves an entry to a 1-indexed position', async () => {
    const { access, db } = setup();
    const result = await access.manageClocks({ action: 'move', clock: 'c2', position: 1 });
    expect(db.move).toHaveBeenCalledWith('c2', 0);
    expect(result.order.map((o: any) => o.id)).toEqual(['c2', 'c1', 'p1']);
    await expect(access.manageClocks({ action: 'move', clock: 'c2', position: 4 })).rejects.toThrow(
      'from 1 to 3'
    );
  });

  it('names the entries when a clock is not found, and asks for an id on duplicates', async () => {
    const { access, db } = setup();
    await expect(access.manageClocks({ action: 'tick', clock: 'Nope' })).rejects.toThrow(
      '"The Ritual"'
    );
    db.set('c3', { id: 'c3', name: 'the ritual', type: 'clock', value: 0, max: 4 });
    await expect(access.manageClocks({ action: 'tick', clock: 'The Ritual' })).rejects.toThrow(
      'use an id: c1, c3'
    );
  });

  it('times out when the module never saves', async () => {
    const { access, db } = setup();
    db.addClock.mockImplementation(() => undefined);
    await expect(access.manageClocks({ action: 'create', name: 'Lost' })).rejects.toThrow(
      'Timed out'
    );
  });
});
