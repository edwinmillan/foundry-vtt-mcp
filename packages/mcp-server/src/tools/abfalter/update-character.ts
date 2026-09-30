import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';

export interface AbfUpdateCharacterToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const RESOURCES = [
  'lifePoints',
  'fatigue',
  'zeon',
  'ki',
  'psychicPoints',
  'shield',
  'mentalHealth',
] as const;

const INFO_FIELDS = [
  'race',
  'gender',
  'age',
  'height',
  'weight',
  'size',
  'appearance',
  'notesOne',
  'notesTwo',
] as const;

const resourceChangeSchema = z
  .object({
    value: z.number().int().optional(),
    delta: z.number().int().optional(),
  })
  .strict()
  .refine(r => (r.value === undefined) !== (r.delta === undefined), {
    message: 'Provide exactly one of value or delta',
  });

const namedBaseSchema = z.object({ name: z.string().min(1), base: z.number().int() }).strict();

const updateCharacterSchema = z
  .object({
    actor: z.string().min(1),
    resources: z
      .object(Object.fromEntries(RESOURCES.map(r => [r, resourceChangeSchema.optional()])))
      .strict()
      .optional(),
    kiPools: z
      .array(
        z
          .object({
            characteristic: z.string().min(1),
            reserve: z.number().int().min(0).optional(),
            accumulated: z.number().int().min(0).optional(),
          })
          .strict()
      )
      .optional(),
    characteristics: z.array(namedBaseSchema).optional(),
    secondaries: z.array(namedBaseSchema).optional(),
    combat: z
      .object({
        attack: z.number().int().optional(),
        block: z.number().int().optional(),
        dodge: z.number().int().optional(),
        wearArmor: z.number().int().optional(),
      })
      .strict()
      .optional(),
    allActionModifier: z
      .object({ base: z.number().int().optional(), critical: z.number().int().optional() })
      .strict()
      .optional(),
    experience: z.number().int().min(0).optional(),
    info: z
      .object({
        ...Object.fromEntries(INFO_FIELDS.map(f => [f, z.string().optional()])),
        destiny: z.number().int().min(0).optional(),
        gnosis: z.number().int().optional(),
      })
      .strict()
      .optional(),
    currency: z
      .object({
        gold: z.number().int().min(0).optional(),
        silver: z.number().int().min(0).optional(),
        copper: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    biography: z.string().optional(),
  })
  .strict();

export type AbfUpdateCharacterArgs = z.infer<typeof updateCharacterSchema>;

const resourceChangeJson = {
  type: 'object',
  properties: {
    value: { type: 'integer', description: 'Set the current value' },
    delta: {
      type: 'integer',
      description: 'Add to (or, negative, subtract from) the current value',
    },
  },
  additionalProperties: false,
};

const namedBaseJson = (example: string) => ({
  type: 'object',
  properties: {
    name: { type: 'string', description: `Name, e.g. "${example}"` },
    base: { type: 'integer', description: 'The new base value' },
  },
  required: ['name', 'base'],
  additionalProperties: false,
});

/**
 * Anima Beyond Fantasy (abfalter) character-update tool. Tracks resources
 * during play and edits the base values the system derives totals from.
 */
export class AbfUpdateCharacterTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: AbfUpdateCharacterToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'AbfUpdateCharacterTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'abf-update-character',
        description:
          '[Anima Beyond Fantasy (abfalter) only] Update an Anima character or creature. During ' +
          'play: set or adjust life points, fatigue, zeon, ki, psychic points, shield and mental ' +
          'health (delta: -40 deals 40 damage), per-characteristic ki pools, and the all-action ' +
          'modifier (e.g. -40 from a critical). Building: set characteristic, secondary ability, ' +
          'and attack/block/dodge/wear-armor base values (the system recomputes the totals, which ' +
          'are reported back), experience, info fields, currency, and biography. Only the fields ' +
          'you provide change. Read the sheet with get-character first. Level comes from class ' +
          'items; add or change items with manage-actors.',
        inputSchema: {
          type: 'object',
          properties: {
            actor: { type: 'string', description: 'Actor name, Foundry id, or token id' },
            resources: {
              type: 'object',
              description:
                'Current resource values; each takes value (set) or delta (adjust). "ki" is the ' +
                'unified ki reserve; actors with per-characteristic pools use kiPools instead.',
              properties: Object.fromEntries(RESOURCES.map(r => [r, resourceChangeJson])),
              additionalProperties: false,
            },
            kiPools: {
              type: 'array',
              description: 'Per-characteristic ki pools (not used with unified pools)',
              items: {
                type: 'object',
                properties: {
                  characteristic: {
                    type: 'string',
                    description: 'AGI, CON, DEX, STR, POW or WP',
                  },
                  reserve: { type: 'integer', minimum: 0, description: 'Ki in reserve' },
                  accumulated: {
                    type: 'integer',
                    minimum: 0,
                    description: 'Ki accumulated this fight',
                  },
                },
                required: ['characteristic'],
                additionalProperties: false,
              },
            },
            characteristics: {
              type: 'array',
              description:
                'Characteristic base values (1-20), e.g. Agility, DEX, Willpower. Creature ' +
                'sheets update their creature characteristic instead.',
              items: namedBaseJson('Dexterity'),
            },
            secondaries: {
              type: 'array',
              description:
                'Secondary ability base values (points invested), by name, e.g. "Notice" or ' +
                '"Feats of Strength". Custom secondary abilities are matched by item name.',
              items: namedBaseJson('Notice'),
            },
            combat: {
              type: 'object',
              description: 'Base attack, block, dodge and wear armor (points invested)',
              properties: {
                attack: { type: 'integer' },
                block: { type: 'integer' },
                dodge: { type: 'integer' },
                wearArmor: { type: 'integer' },
              },
              additionalProperties: false,
            },
            allActionModifier: {
              type: 'object',
              description:
                'All-action modifier: base for general penalties/bonuses, critical for ' +
                'penalties from critical hits',
              properties: { base: { type: 'integer' }, critical: { type: 'integer' } },
              additionalProperties: false,
            },
            experience: { type: 'integer', minimum: 0, description: 'Experience points' },
            info: {
              type: 'object',
              description: 'Character details; destiny is destiny points, gnosis the gnosis',
              properties: {
                ...Object.fromEntries(INFO_FIELDS.map(f => [f, { type: 'string' }])),
                destiny: { type: 'integer', minimum: 0 },
                gnosis: { type: 'integer' },
              },
              additionalProperties: false,
            },
            currency: {
              type: 'object',
              properties: {
                gold: { type: 'integer', minimum: 0 },
                silver: { type: 'integer', minimum: 0 },
                copper: { type: 'integer', minimum: 0 },
              },
              additionalProperties: false,
            },
            biography: { type: 'string', description: 'Replace the biography (HTML allowed)' },
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
    const nonEmpty = (o: object | undefined) => o !== undefined && Object.keys(o).length > 0;
    const hasChange =
      nonEmpty(data.resources) ||
      !!data.kiPools?.length ||
      !!data.characteristics?.length ||
      !!data.secondaries?.length ||
      nonEmpty(data.combat) ||
      nonEmpty(data.allActionModifier) ||
      data.experience !== undefined ||
      nonEmpty(data.info) ||
      nonEmpty(data.currency) ||
      data.biography !== undefined;
    if (!hasChange) {
      return {
        success: false,
        error:
          'Nothing to update: provide resources, kiPools, characteristics, secondaries, combat, ' +
          'allActionModifier, experience, info, currency and/or biography.',
      };
    }

    this.logger.info('Updating Anima character', { actor: data.actor });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.updateAbfCharacter', data);
    } catch (error) {
      this.logger.error('Failed to update Anima character', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
