import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';

export interface FateRollToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const rollSchema = z
  .object({
    actor: z.string().min(1),
    skill: z.string().min(1).optional(),
    stunt: z.string().min(1).optional(),
    modifier: z.number().int().optional(),
    difficulty: z.number().int().optional(),
    action: z.enum(['overcome', 'create_advantage', 'attack', 'defend']).optional(),
    description: z.string().optional(),
    gmOnly: z.boolean().optional(),
  })
  .strict()
  .refine(d => d.skill !== undefined || d.stunt !== undefined, {
    message: 'Provide a skill and/or a stunt to roll',
  });

/**
 * Fate Core Official roll tool. Rolls 4dF + skill rank (+ stunt bonus and
 * modifier) for an actor, posts it to chat, and reports the outcome.
 */
export class FateRollTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: FateRollToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'FateRollTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'fate-roll',
        description:
          '[Fate Core Official only] Roll 4dF + skill rank for an actor right now, as the GM, and ' +
          'post it to chat. Optionally apply a stunt (adds its bonus; uses its linked skill if no ' +
          'skill is given) and a flat modifier (e.g. +2 per invoked aspect). With a difficulty, ' +
          'reports shifts and the outcome: fail, tie, success, or success with style. Use this for ' +
          'NPC rolls and quick checks; to ask a player to roll their own character, use ' +
          'request-player-rolls with rollType "skill".',
        inputSchema: {
          type: 'object',
          properties: {
            actor: { type: 'string', description: 'Actor name, Foundry id, or token id' },
            skill: { type: 'string', description: 'Skill to roll, e.g. "Notice"' },
            stunt: { type: 'string', description: 'Stunt to apply, e.g. "Hard Boiled"' },
            modifier: {
              type: 'integer',
              description: 'Flat modifier, e.g. 2 for one invoked aspect',
            },
            difficulty: {
              type: 'integer',
              description:
                'Passive opposition on the ladder (e.g. 2 for Fair) to compute shifts and outcome',
            },
            action: {
              type: 'string',
              enum: ['overcome', 'create_advantage', 'attack', 'defend'],
              description: 'The Fate action being taken, shown on the chat card',
            },
            description: {
              type: 'string',
              description: 'What the roll is for, shown on the chat card',
            },
            gmOnly: {
              type: 'boolean',
              description: 'Whisper the roll to GMs only (for hidden NPC rolls)',
            },
          },
          required: ['actor'],
        },
      },
    ];
  }

  async handleRoll(args: unknown) {
    const parsed = rollSchema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { success: false, error: `Invalid arguments: ${detail}` };
    }

    this.logger.info('Rolling Fate skill', {
      actor: parsed.data.actor,
      skill: parsed.data.skill,
      stunt: parsed.data.stunt,
    });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.rollFateSkill', parsed.data);
    } catch (error) {
      this.logger.error('Failed to roll Fate skill', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
