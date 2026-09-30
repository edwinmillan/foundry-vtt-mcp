import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';

export interface FateUpdateCharacterToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const LADDER_MIN = -2;
const LADDER_MAX = 12;

const stuntSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    linkedSkill: z.string().optional(),
    bonus: z.number().int().optional(),
    refreshCost: z.number().int().optional(),
    actions: z.array(z.enum(['overcome', 'create_advantage', 'attack', 'defend'])).optional(),
  })
  .strict();

const trackSchema = z
  .object({
    name: z.string().min(1),
    mark: z.array(z.number().int().min(1)).optional(),
    unmark: z.array(z.number().int().min(1)).optional(),
    clear: z.boolean().optional(),
    aspect: z.string().optional(),
  })
  .strict();

const updateCharacterSchema = z
  .object({
    actor: z.string().min(1),
    aspects: z.array(z.object({ name: z.string().min(1), value: z.string() }).strict()).optional(),
    skills: z
      .array(
        z
          .object({
            name: z.string().min(1),
            rank: z.number().int().min(LADDER_MIN).max(LADDER_MAX),
          })
          .strict()
      )
      .optional(),
    addStunts: z.array(stuntSchema).optional(),
    removeStunts: z.array(z.string().min(1)).optional(),
    tracks: z.array(trackSchema).optional(),
    fatePoints: z
      .object({
        current: z.number().int().min(0).optional(),
        refresh: z.number().int().min(0).optional(),
        boosts: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    description: z.string().optional(),
    biography: z.string().optional(),
  })
  .strict();

export type FateUpdateCharacterArgs = z.infer<typeof updateCharacterSchema>;

/**
 * Fate Core Official character-update tool. Edits aspects, skill ranks,
 * stunts, stress/consequence tracks, and fate points on an existing actor.
 */
export class FateUpdateCharacterTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: FateUpdateCharacterToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'FateUpdateCharacterTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'fate-update-character',
        description:
          '[Fate Core Official only] Update a Fate character or NPC: set aspect text, set skill ' +
          'ranks on the ladder (adding skills the actor lacks), add or remove stunts, mark or ' +
          'clear stress boxes, write or clear consequences, and set fate points / refresh / ' +
          'boosts. Only the fields you provide change. USE THIS after creating an actor (with ' +
          'manage-actors or create-actor-from-compendium) to build it out, and during play to ' +
          'track stress, consequences, and fate point spends. Read the current sheet with ' +
          'get-character first to see exact aspect, skill, and track names.',
        inputSchema: {
          type: 'object',
          properties: {
            actor: {
              type: 'string',
              description: 'Actor name, Foundry id, or token id',
            },
            aspects: {
              type: 'array',
              description:
                'Set aspect text by aspect slot name (e.g. "High Concept", "Trouble"). A slot the ' +
                'actor lacks is added. Use an empty value to blank a slot.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Aspect slot name, e.g. "High Concept"' },
                  value: { type: 'string', description: 'The aspect text' },
                },
                required: ['name', 'value'],
                additionalProperties: false,
              },
            },
            skills: {
              type: 'array',
              description:
                'Set skill ranks on the Fate ladder: -2 Terrible, -1 Poor, 0 Mediocre, 1 Average, ' +
                '2 Fair, 3 Good, 4 Great, 5 Superb, 6 Fantastic, 7 Epic, 8 Legendary. A skill the ' +
                'actor lacks is added.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Skill name, e.g. "Fight"' },
                  rank: { type: 'integer', minimum: LADDER_MIN, maximum: LADDER_MAX },
                },
                required: ['name', 'rank'],
                additionalProperties: false,
              },
            },
            addStunts: {
              type: 'array',
              description: 'Stunts to add (or replace, when one with the same name exists).',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string', description: 'What the stunt does' },
                  linkedSkill: {
                    type: 'string',
                    description: 'Skill the stunt modifies, if any',
                  },
                  bonus: { type: 'integer', description: 'Roll bonus, usually 2' },
                  refreshCost: { type: 'integer', description: 'Refresh cost, usually 1' },
                  actions: {
                    type: 'array',
                    description: 'Actions the bonus applies to',
                    items: {
                      type: 'string',
                      enum: ['overcome', 'create_advantage', 'attack', 'defend'],
                    },
                  },
                },
                required: ['name'],
                additionalProperties: false,
              },
            },
            removeStunts: {
              type: 'array',
              description: 'Names of stunts to remove',
              items: { type: 'string' },
            },
            tracks: {
              type: 'array',
              description:
                'Stress and consequence changes. Box numbers are 1-based. For a consequence, set ' +
                'aspect to the consequence text (e.g. "Broken Arm"); an empty aspect with ' +
                'clear: true recovers it.',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Track name, e.g. "Physical Stress" or "Mild Consequence"',
                  },
                  mark: {
                    type: 'array',
                    items: { type: 'integer', minimum: 1 },
                    description: 'Box numbers to check',
                  },
                  unmark: {
                    type: 'array',
                    items: { type: 'integer', minimum: 1 },
                    description: 'Box numbers to uncheck',
                  },
                  clear: {
                    type: 'boolean',
                    description: 'Uncheck every box (and clear the aspect text)',
                  },
                  aspect: {
                    type: 'string',
                    description: 'Consequence aspect text (consequence tracks only)',
                  },
                },
                required: ['name'],
                additionalProperties: false,
              },
            },
            fatePoints: {
              type: 'object',
              description: 'Fate point pool changes',
              properties: {
                current: { type: 'integer', minimum: 0 },
                refresh: { type: 'integer', minimum: 0 },
                boosts: { type: 'integer', minimum: 0 },
              },
              additionalProperties: false,
            },
            description: {
              type: 'string',
              description: 'Replace the description text (HTML allowed)',
            },
            biography: {
              type: 'string',
              description: 'Replace the biography text (HTML allowed)',
            },
          },
          required: ['actor'],
        },
      },
    ];
  }

  async handleUpdateCharacter(args: unknown) {
    const parsed = updateCharacterSchema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { success: false, error: `Invalid arguments: ${detail}` };
    }

    const data = parsed.data;
    const hasChange =
      !!data.aspects?.length ||
      !!data.skills?.length ||
      !!data.addStunts?.length ||
      !!data.removeStunts?.length ||
      !!data.tracks?.length ||
      (data.fatePoints !== undefined && Object.keys(data.fatePoints).length > 0) ||
      data.description !== undefined ||
      data.biography !== undefined;
    if (!hasChange) {
      return {
        success: false,
        error:
          'Nothing to update: provide aspects, skills, addStunts, removeStunts, tracks, ' +
          'fatePoints, description and/or biography.',
      };
    }

    this.logger.info('Updating Fate character', { actor: data.actor });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.updateFateCharacter', data);
    } catch (error) {
      this.logger.error('Failed to update Fate character', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
