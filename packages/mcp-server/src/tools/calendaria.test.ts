/**
 * Calendaria tool tests — schema validation and forwarding to the Foundry
 * bridge queries.
 */

import { describe, it, expect, vi } from 'vitest';
import { CalendariaTools } from './calendaria.js';

function makeTools() {
  const query = vi.fn(async () => ({ success: true }));
  const logger: any = { info: vi.fn(), error: vi.fn(), child: () => logger };
  return { tools: new CalendariaTools({ foundryClient: { query } as any, logger }), query };
}

describe('CalendariaTools', () => {
  it('advertises four tools', () => {
    const { tools } = makeTools();
    expect(tools.getToolDefinitions().map(d => d.name)).toEqual([
      'calendaria-get-date',
      'calendaria-change-time',
      'calendaria-manage-notes',
      'calendaria-manage-weather',
    ]);
  });

  it('forwards get-date with no arguments', async () => {
    const { tools, query } = makeTools();
    expect(await tools.handleGetDate(undefined)).toEqual({ success: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCalendariaStatus', {});
  });

  it('forwards a set with a month name', async () => {
    const { tools, query } = makeTools();
    const args = { action: 'set', date: { month: 'Ches', day: 1, hour: 9 } };
    await tools.handleChangeTime(args);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.changeCalendariaTime', args);
  });

  it('rejects incomplete time changes', async () => {
    const { tools, query } = makeTools();
    const noDelta: any = await tools.handleChangeTime({ action: 'advance' });
    expect(noDelta.error).toContain('non-zero');
    const noTarget: any = await tools.handleChangeTime({ action: 'advance-to' });
    expect(noTarget.error).toContain('target is required');
    const badTarget: any = await tools.handleChangeTime({ action: 'advance-to', target: 'dusk' });
    expect(badTarget.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the fields each note action needs', async () => {
    const { tools, query } = makeTools();
    expect((await tools.handleManageNotes({ action: 'delete' })).error).toContain(
      'note (id or name)'
    );
    expect((await tools.handleManageNotes({ action: 'create' })).error).toContain(
      'name is required'
    );
    expect((await tools.handleManageNotes({ action: 'list', bogus: 1 })).success).toBe(false);
    expect(query).not.toHaveBeenCalled();

    const create = { action: 'create', name: 'Tax Day', startDate: { month: 2, day: 1 } };
    await tools.handleManageNotes(create);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageCalendariaNotes', create);
  });

  it('forwards weather changes and requires a preset for set', async () => {
    const { tools, query } = makeTools();
    expect((await tools.handleManageWeather({ action: 'set' })).error).toContain(
      'preset is required'
    );
    await tools.handleManageWeather({ action: 'set', preset: 'rain', temperature: 12 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageCalendariaWeather', {
      action: 'set',
      preset: 'rain',
      temperature: 12,
    });
  });

  it('returns bridge errors instead of throwing', async () => {
    const { tools, query } = makeTools();
    query.mockRejectedValueOnce(new Error('Foundry not connected'));
    expect(await tools.handleGetDate({})).toEqual({
      success: false,
      error: 'Foundry not connected',
    });
  });
});
