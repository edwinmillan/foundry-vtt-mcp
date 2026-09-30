/**
 * Fate Core Official tool tests — schema validation and forwarding to the
 * Foundry bridge queries.
 */

import { describe, it, expect, vi } from 'vitest';
import { FateUpdateCharacterTools } from './update-character.js';
import { FateRollTools } from './roll.js';
import { FateAspectTools } from './aspects.js';

function makeDeps() {
  const query = vi.fn(async () => ({ success: true }));
  const logger: any = { info: vi.fn(), error: vi.fn(), child: () => logger };
  return { foundryClient: { query } as any, logger, query };
}

describe('fate-update-character', () => {
  it('forwards a full update to updateFateCharacter', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateUpdateCharacterTools({ foundryClient, logger });
    const args = {
      actor: 'Cynere',
      aspects: [{ name: 'Trouble', value: 'Tempted by Shiny Things' }],
      skills: [{ name: 'Fight', rank: 4 }],
      addStunts: [{ name: 'Riposte', linkedSkill: 'Fight', bonus: 2, actions: ['defend'] }],
      tracks: [{ name: 'Mild Consequence', aspect: 'Bruised Ribs', mark: [1] }],
      fatePoints: { current: 2 },
    };

    expect(await tools.handleUpdateCharacter(args)).toEqual({ success: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateFateCharacter', args);
  });

  it('rejects an empty update', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateUpdateCharacterTools({ foundryClient, logger });
    const result: any = await tools.handleUpdateCharacter({ actor: 'Cynere', fatePoints: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Nothing to update');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects ranks off the ladder and unknown fields', async () => {
    const { foundryClient, logger } = makeDeps();
    const tools = new FateUpdateCharacterTools({ foundryClient, logger });
    const offLadder: any = await tools.handleUpdateCharacter({
      actor: 'Cynere',
      skills: [{ name: 'Fight', rank: 20 }],
    });
    expect(offLadder.error).toContain('skills.0.rank');
    const unknown: any = await tools.handleUpdateCharacter({ actor: 'Cynere', hp: 3 });
    expect(unknown.success).toBe(false);
  });

  it('advertises the tool', () => {
    const { foundryClient, logger } = makeDeps();
    const [def] = new FateUpdateCharacterTools({ foundryClient, logger }).getToolDefinitions();
    expect(def.name).toBe('fate-update-character');
    expect(def.inputSchema.required).toEqual(['actor']);
  });
});

describe('fate-roll', () => {
  it('forwards to rollFateSkill', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateRollTools({ foundryClient, logger });
    const args = { actor: 'Cynere', skill: 'Fight', modifier: 2, difficulty: 3, gmOnly: true };
    await tools.handleRoll(args);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollFateSkill', args);
  });

  it('accepts a stunt without a skill', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateRollTools({ foundryClient, logger });
    await tools.handleRoll({ actor: 'Cynere', stunt: 'Master Swordswoman' });
    expect(query).toHaveBeenCalled();
  });

  it('requires a skill or stunt', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateRollTools({ foundryClient, logger });
    const result: any = await tools.handleRoll({ actor: 'Cynere' });
    expect(result.error).toContain('skill and/or a stunt');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('fate-manage-aspects', () => {
  it('forwards to manageFateAspects', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateAspectTools({ foundryClient, logger });
    const args = { action: 'add' as const, name: 'On Fire', freeInvokes: 1 };
    await tools.handleManageAspects(args);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageFateAspects', args);
  });

  it('allows list without a name', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateAspectTools({ foundryClient, logger });
    await tools.handleManageAspects({ action: 'list' });
    expect(query).toHaveBeenCalled();
  });

  it('requires a name for add/update/remove and a scope for clear', async () => {
    const { foundryClient, logger, query } = makeDeps();
    const tools = new FateAspectTools({ foundryClient, logger });
    const add: any = await tools.handleManageAspects({ action: 'add' });
    expect(add.error).toContain('name is required');
    const clear: any = await tools.handleManageAspects({ action: 'clear' });
    expect(clear.error).toContain('scope');
    expect(query).not.toHaveBeenCalled();
  });
});
