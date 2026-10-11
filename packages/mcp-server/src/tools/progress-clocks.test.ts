/**
 * Global Progress Clocks tool tests — schema validation and forwarding to the
 * Foundry bridge queries.
 */

import { describe, it, expect, vi } from 'vitest';
import { ProgressClocksTools } from './progress-clocks.js';

function makeTools() {
  const query = vi.fn(async () => ({ success: true }));
  const logger: any = { info: vi.fn(), error: vi.fn(), child: () => logger };
  return { tools: new ProgressClocksTools({ foundryClient: { query } as any, logger }), query };
}

describe('ProgressClocksTools', () => {
  it('advertises two tools', () => {
    const { tools } = makeTools();
    expect(tools.getToolDefinitions().map(d => d.name)).toEqual([
      'progress-clocks-list',
      'progress-clocks-manage',
    ]);
  });

  it('forwards list with and without a type filter', async () => {
    const { tools, query } = makeTools();
    await tools.handleList(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listProgressClocks', {});
    await tools.handleList({ type: 'points' });
    expect(query).toHaveBeenLastCalledWith('foundry-mcp-bridge.listProgressClocks', {
      type: 'points',
    });
    expect((await tools.handleList({ type: 'dial' })).success).toBe(false);
  });

  it('requires the fields each action needs', async () => {
    const { tools, query } = makeTools();
    expect((await tools.handleManage({ action: 'create' })).error).toContain('name is required');
    expect((await tools.handleManage({ action: 'tick' })).error).toContain('clock (id or name)');
    expect((await tools.handleManage({ action: 'tick', clock: 'x', amount: 0 })).error).toContain(
      'non-zero'
    );
    expect((await tools.handleManage({ action: 'move', clock: 'x' })).error).toContain(
      'position is required'
    );
    expect((await tools.handleManage({ action: 'create', name: 'x', bogus: 1 })).success).toBe(
      false
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('forwards valid changes, including a null color', async () => {
    const { tools, query } = makeTools();
    const create = { action: 'create', name: 'The Ritual', type: 'clock', max: 6 };
    await tools.handleManage(create);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageProgressClocks', create);

    const update = { action: 'update', clock: 'The Ritual', color: null };
    await tools.handleManage(update);
    expect(query).toHaveBeenLastCalledWith('foundry-mcp-bridge.manageProgressClocks', update);
  });

  it('returns bridge errors instead of throwing', async () => {
    const { tools, query } = makeTools();
    query.mockRejectedValueOnce(new Error('Failed to manage progress clocks: boom'));
    const result: any = await tools.handleManage({ action: 'delete', clock: 'c1' });
    expect(result).toEqual({ success: false, error: 'Failed to manage progress clocks: boom' });
  });
});
