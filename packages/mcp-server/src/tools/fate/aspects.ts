import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';

export interface FateAspectToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const aspectsSchema = z
  .object({
    action: z.enum(['list', 'add', 'update', 'remove', 'clear']),
    scope: z.enum(['scene', 'game']).optional(),
    scene: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    newName: z.string().min(1).optional(),
    freeInvokes: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (['add', 'update', 'remove'].includes(d.action) && !d.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `name is required for ${d.action}` });
    }
    if (d.action === 'clear' && !d.scope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scope ("scene" or "game") is required for clear',
      });
    }
  });

/**
 * Fate Core Official situation/game aspect tool. Situation aspects live on a
 * scene (Fate Utilities' "situation_aspects" flag); game aspects are
 * world-wide (the system's "gameAspects" setting). Both carry free invokes.
 */
export class FateAspectTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: FateAspectToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'FateAspectTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'fate-manage-aspects',
        description:
          '[Fate Core Official only] Manage situation aspects (on a scene) and game aspects ' +
          '(world-wide), as shown in Fate Utilities. list: show them with free invokes. add: ' +
          'create one (e.g. after a successful create an advantage, with freeInvokes 1 or 2 on ' +
          'success with style). update: rename, set free invokes, or edit notes (spend a free ' +
          'invoke by lowering freeInvokes). remove: delete one. clear: delete all in a scope. ' +
          'Aspects on characters (and consequences) are edited with fate-update-character.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'add', 'update', 'remove', 'clear'],
            },
            scope: {
              type: 'string',
              enum: ['scene', 'game'],
              description:
                'scene = situation aspects on a scene (default for add/update/remove); game = ' +
                'world-wide game aspects. list without a scope returns both.',
            },
            scene: {
              type: 'string',
              description:
                'Scene name or id for scene scope. Defaults to the scene the GM is viewing.',
            },
            name: { type: 'string', description: 'Aspect text, e.g. "On Fire"' },
            newName: { type: 'string', description: 'New aspect text (update only)' },
            freeInvokes: {
              type: 'integer',
              minimum: 0,
              description: 'Number of free invokes on the aspect',
            },
            notes: { type: 'string', description: 'Notes (game aspects only)' },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleManageAspects(args: unknown) {
    const parsed = aspectsSchema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { success: false, error: `Invalid arguments: ${detail}` };
    }

    this.logger.info('Managing Fate aspects', {
      action: parsed.data.action,
      scope: parsed.data.scope,
    });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.manageFateAspects', parsed.data);
    } catch (error) {
      this.logger.error('Failed to manage Fate aspects', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
