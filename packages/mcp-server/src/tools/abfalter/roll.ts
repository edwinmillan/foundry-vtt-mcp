import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';

export interface AbfRollToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const ROLL_TYPES = [
  'characteristic',
  'resistance',
  'secondary',
  'attack',
  'block',
  'dodge',
  'initiative',
  'magicProjection',
  'psychicProjection',
  'psychicPotential',
  'value',
] as const;

const NEEDS_TARGET = new Set(['characteristic', 'resistance', 'secondary']);
const COMBAT = new Set(['attack', 'block', 'dodge']);

const rollSchema = z
  .object({
    actor: z.string().min(1),
    rollType: z.enum(ROLL_TYPES),
    target: z.string().min(1).optional(),
    weapon: z.string().min(1).optional(),
    profile: z.string().min(1).optional(),
    value: z.number().int().optional(),
    modifier: z.number().int().optional(),
    difficulty: z.union([z.number().int(), z.string().min(1)]).optional(),
    against: z.number().int().optional(),
    armor: z.number().int().min(0).optional(),
    damage: z.number().int().min(0).optional(),
    description: z.string().optional(),
    gmOnly: z.boolean().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (NEEDS_TARGET.has(d.rollType) && !d.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: `target is required for rollType "${d.rollType}"`,
      });
    }
    if (d.rollType === 'value' && d.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'value is required for rollType "value"',
      });
    }
    if ((d.weapon || d.against !== undefined) && !COMBAT.has(d.rollType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [d.weapon ? 'weapon' : 'against'],
        message: 'weapon and against only apply to attack, block and dodge rolls',
      });
    }
  });

/**
 * Anima Beyond Fantasy (abfalter) roll tool: open d100 rolls with fumbles,
 * characteristic d10 checks, and resistance checks, posted to chat.
 */
export class AbfRollTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: AbfRollToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'AbfRollTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'abf-roll',
        description:
          '[Anima Beyond Fantasy (abfalter) only] Roll for an actor right now, as the GM, and ' +
          'post it to chat, using the system rules: 1d100 open rolls (roll again and add at the ' +
          'open range, 90+ by default) and fumbles for secondary abilities, attack, block, dodge, ' +
          'initiative, magic/psychic projection and psychic potential; 1d10 characteristic ' +
          "checks (a 1 is -3, a 10 is +2); and 1d100 resistance checks. The world's abfalter " +
          'open-roll and fumble settings are respected. With a difficulty it reports pass/fail; ' +
          'secondary rolls also report the highest difficulty reached (Routine 20 … Zen 440). ' +
          'For attack/block/dodge, pass the opposing total as "against" (plus the defender\'s ' +
          'armor type) to resolve the exchange: damage percentage and damage dealt, or the ' +
          'counterattack bonus. To ask a player to roll their own character, use ' +
          'request-player-rolls.',
        inputSchema: {
          type: 'object',
          properties: {
            actor: { type: 'string', description: 'Actor name, Foundry id, or token id' },
            rollType: {
              type: 'string',
              enum: [...ROLL_TYPES],
              description:
                'What to roll. "value" rolls an open 1d100 + value for anything else (e.g. a ' +
                'summoning ability).',
            },
            target: {
              type: 'string',
              description:
                'characteristic: e.g. "Agility" or "DEX"; resistance: PhR, DR, PsnR, MR, PsyR ' +
                '(or Physical, Disease…); secondary: e.g. "Notice", "Feats of Strength"; ' +
                'magic/psychic projection: "offensive" (default) or "defensive"; value: a label',
            },
            weapon: {
              type: 'string',
              description:
                'attack/block/dodge with this weapon: uses its profile totals, damage, AT ' +
                'penetration, and roll ranges',
            },
            profile: {
              type: 'string',
              description: 'Weapon profile name, when the weapon has several',
            },
            value: { type: 'integer', description: 'Base value for rollType "value"' },
            modifier: {
              type: 'integer',
              description:
                'Situational modifier added to the base, e.g. -30 or +15 per fatigue spent',
            },
            difficulty: {
              type: ['integer', 'string'],
              description:
                'Target number, or a difficulty name: Routine, Easy, Medium, Difficult, Very ' +
                'Difficult, Absurd, Almost Impossible, Impossible, Inhuman, Zen',
            },
            against: {
              type: 'integer',
              description:
                "attack: the defender's block/dodge total; block/dodge: the attacker's total",
            },
            armor: {
              type: 'integer',
              minimum: 0,
              description: "Defender's armor type (AT) against the attack's damage type",
            },
            damage: {
              type: 'integer',
              minimum: 0,
              description: "Attack base damage (defaults to the weapon profile's damage)",
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
          required: ['actor', 'rollType'],
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

    this.logger.info('Rolling for Anima actor', {
      actor: parsed.data.actor,
      rollType: parsed.data.rollType,
      target: parsed.data.target,
    });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.rollAbf', parsed.data);
    } catch (error) {
      this.logger.error('Failed to roll for Anima actor', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
