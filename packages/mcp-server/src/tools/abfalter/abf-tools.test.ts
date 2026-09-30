/**
 * Anima Beyond Fantasy (abfalter) tool tests — schema validation and
 * forwarding to the Foundry bridge queries.
 */

import { describe, it, expect, vi } from 'vitest';
import { AbfUpdateCharacterTools } from './update-character.js';
import { AbfRollTools } from './roll.js';

function makeDeps() {
  const query = vi.fn(async () => ({ success: true }));
  const logger: any = { info: vi.fn(), error: vi.fn(), child: () => logger };
  return { foundryClient: { query } as any, logger, query };
}

describe('abf-update-character', () => {
  it('forwards an update to updateAbfCharacter', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new AbfUpdateCharacterTools({ foundryClient, logger });
    const args = {
      actor: 'Celia',
      resources: { lifePoints: { delta: -40 }, zeon: { value: 250 } },
      characteristics: [{ name: 'AGI', base: 9 }],
      secondaries: [{ name: 'Notice', base: 50 }],
      combat: { dodge: 80 },
      info: { race: 'Sylvain', gnosis: 5 },
    };

    expect(await tools.handleUpdateCharacter(args)).toEqual({ success: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateAbfCharacter', args);
  });

  it('rejects an empty update', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new AbfUpdateCharacterTools({ foundryClient, logger });
    const result: any = await tools.handleUpdateCharacter({ actor: 'Celia', combat: {} });
    expect(result.error).toContain('Nothing to update');
    expect(query).not.toHaveBeenCalled();
  });

  it('requires exactly one of value or delta and rejects unknown resources', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new AbfUpdateCharacterTools({ foundryClient, logger });
    const both: any = await tools.handleUpdateCharacter({
      actor: 'Celia',
      resources: { lifePoints: { value: 10, delta: -5 } },
    });
    expect(both.error).toContain('resources.lifePoints');
    const unknown: any = await tools.handleUpdateCharacter({
      actor: 'Celia',
      resources: { mana: { value: 10 } },
    });
    expect(unknown.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('advertises the tool', () => {
    const { foundryClient, logger } = makeDeps();
    const [def] = new AbfUpdateCharacterTools({ foundryClient, logger }).getToolDefinitions();
    expect(def.name).toBe('abf-update-character');
    expect(def.inputSchema.required).toEqual(['actor']);
  });
});

describe('abf-roll', () => {
  it('forwards to rollAbf', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new AbfRollTools({ foundryClient, logger });
    const args = {
      actor: 'Celia',
      rollType: 'attack' as const,
      weapon: 'Long Sword',
      against: 120,
      armor: 2,
      gmOnly: true,
    };
    await tools.handleRoll(args);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollAbf', args);
  });

  it('accepts a named difficulty', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new AbfRollTools({ foundryClient, logger });
    await tools.handleRoll({
      actor: 'Celia',
      rollType: 'secondary',
      target: 'Notice',
      difficulty: 'Difficult',
    });
    expect(query).toHaveBeenCalled();
  });

  it('validates targets, values, and combat-only options', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new AbfRollTools({ foundryClient, logger });
    const noTarget: any = await tools.handleRoll({ actor: 'Celia', rollType: 'secondary' });
    expect(noTarget.error).toContain('target is required');
    const noValue: any = await tools.handleRoll({ actor: 'Celia', rollType: 'value' });
    expect(noValue.error).toContain('value is required');
    const weaponOnSkill: any = await tools.handleRoll({
      actor: 'Celia',
      rollType: 'secondary',
      target: 'Notice',
      weapon: 'Long Sword',
    });
    expect(weaponOnSkill.error).toContain('only apply to attack');
    expect(query).not.toHaveBeenCalled();
  });
});
