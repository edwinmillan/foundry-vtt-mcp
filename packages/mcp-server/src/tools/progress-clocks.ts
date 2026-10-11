import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface ProgressClocksToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const TYPES = ['clock', 'points', 'tracker'] as const;

const listSchema = z.object({ type: z.enum(TYPES).optional() }).strict();

const manageSchema = z
  .object({
    action: z.enum(['create', 'update', 'tick', 'delete', 'move']),
    clock: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.enum(TYPES).optional(),
    value: z.number().int().optional(),
    max: z.number().int().min(1).optional(),
    amount: z.number().int().optional(),
    private: z.boolean().optional(),
    color: z.string().min(1).nullable().optional(),
    position: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.action !== 'create' && !d.clock) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `clock (id or name) is required for ${d.action}`,
      });
    }
    if (d.action === 'create' && !d.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'name is required for create' });
    }
    if (d.action === 'tick' && d.amount === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be non-zero' });
    }
    if (d.action === 'move' && d.position === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'position is required for move' });
    }
  });

const requires = (description: string) =>
  `[Requires the Global Progress Clocks module] ${description}`;

/**
 * Tools for the Global Progress Clocks module (Blades in the Dark style clocks,
 * victory points and trackers shown to the whole table). They work in any game
 * system; the Foundry side reports an error when the module isn't active.
 */
export class ProgressClocksTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: ProgressClocksToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'ProgressClocksTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'progress-clocks-list',
        description: requires(
          'List the progress clocks, points counters and trackers on the table, in display ' +
            'order: name, id, type, value / max, whether a clock or tracker is complete, and ' +
            'whether it is private (GM only). Also lists the configured clock colors and which ' +
            'entry types are enabled.'
        ),
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: [...TYPES],
              description: 'Only list entries of this type',
            },
          },
        },
      },
      {
        name: 'progress-clocks-manage',
        description: requires(
          'Manage progress clocks, points and trackers shown to everyone at the table. ' +
            'create: add a clock (segmented circle, max 1-128, default 4), points (a counter ' +
            'from -99 to 99, e.g. victory points) or tracker (a row of 1-12 boxes). ' +
            'update: rename, set value or max, make private/public, or recolor. ' +
            'tick: add (or with a negative amount, remove) segments or points; values stop at ' +
            'the limits. delete: remove an entry. move: reorder an entry. Entries are ' +
            'referenced by id or name.'
        ),
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'update', 'tick', 'delete', 'move'],
            },
            clock: {
              type: 'string',
              description: 'update/tick/delete/move: entry id or name',
            },
            name: { type: 'string', description: 'create/update: entry name' },
            type: {
              type: 'string',
              enum: [...TYPES],
              description: 'create: entry type (default clock)',
            },
            value: {
              type: 'integer',
              description: 'create/update: current value (create default 0)',
            },
            max: {
              type: 'integer',
              minimum: 1,
              description:
                'create/update: segments for a clock (1-128) or boxes for a tracker (1-12); ' +
                'points are fixed at 99',
            },
            amount: {
              type: 'integer',
              description: 'tick: segments or points to add; negative to remove (default 1)',
            },
            private: {
              type: 'boolean',
              description: 'create/update: hide from players (default false)',
            },
            color: {
              type: ['string', 'null'],
              description:
                'create/update: a configured clock color by id or name; null or "default" ' +
                'for the default color',
            },
            position: {
              type: 'integer',
              minimum: 1,
              description: 'move: new position, 1 = first in the list',
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  private async forward(
    schema: z.ZodTypeAny,
    method: string,
    args: unknown,
    what: string
  ): Promise<any> {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { success: false, error: `Invalid arguments: ${detail}` };
    }

    this.logger.info(`Progress clocks: ${what}`, { action: parsed.data.action });
    try {
      return await this.foundryClient.query(`foundry-mcp-bridge.${method}`, parsed.data);
    } catch (error) {
      this.logger.error(`Progress clocks: failed to ${what}`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  handleList(args: unknown) {
    return this.forward(listSchema, 'listProgressClocks', args, 'list');
  }

  handleManage(args: unknown) {
    return this.forward(manageSchema, 'manageProgressClocks', args, 'manage');
  }
}
