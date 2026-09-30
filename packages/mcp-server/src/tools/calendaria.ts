import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface CalendariaToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const dateSchema = z
  .object({
    year: z.number().int().optional(),
    month: z.union([z.number().int().min(1), z.string().min(1)]).optional(),
    day: z.number().int().min(1).optional(),
    hour: z.number().int().min(0).optional(),
    minute: z.number().int().min(0).optional(),
    second: z.number().int().min(0).optional(),
  })
  .strict();

const statusSchema = z.object({ includeWeather: z.boolean().optional() }).strict();

const timeSchema = z
  .object({
    action: z.enum(['advance', 'set', 'advance-to', 'start-clock', 'stop-clock']),
    days: z.number().int().optional(),
    hours: z.number().int().optional(),
    minutes: z.number().int().optional(),
    seconds: z.number().int().optional(),
    date: dateSchema.optional(),
    target: z.enum(['sunrise', 'midday', 'sunset', 'midnight']).optional(),
    cinematic: z.boolean().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.action === 'advance' && ![d.days, d.hours, d.minutes, d.seconds].some(v => v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'advance needs a non-zero days, hours, minutes or seconds',
      });
    }
    if (d.action === 'set' && !d.date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'date is required for set' });
    }
    if (d.action === 'advance-to' && !d.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'target is required for advance-to' });
    }
  });

const notesSchema = z
  .object({
    action: z.enum(['list', 'search', 'get', 'create', 'update', 'delete']),
    note: z.string().min(1).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    days: z.number().int().min(0).optional(),
    query: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    content: z.string().optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    allDay: z.boolean().optional(),
    visibility: z.enum(['visible', 'hidden', 'secret']).optional(),
    color: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
    categories: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (['get', 'update', 'delete'].includes(d.action) && !d.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `note (id or name) is required for ${d.action}`,
      });
    }
    if (d.action === 'create' && !d.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'name is required for create' });
    }
    if (d.action === 'search' && !d.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'query is required for search' });
    }
  });

const weatherSchema = z
  .object({
    action: z.enum(['get', 'forecast', 'presets', 'set', 'generate', 'clear']),
    zone: z.string().min(1).optional(),
    days: z.number().int().min(1).optional(),
    preset: z.string().min(1).optional(),
    temperature: z.number().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.action === 'set' && !d.preset) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'preset is required for set' });
    }
  });

const dateJsonSchema = (description: string) => ({
  type: 'object',
  description,
  properties: {
    year: { type: 'integer', description: 'Display year (as shown on the calendar)' },
    month: {
      type: ['integer', 'string'],
      description: 'Month number (1 = first month) or month name',
    },
    day: { type: 'integer', minimum: 1, description: 'Day of the month (1-indexed)' },
    hour: { type: 'integer', minimum: 0 },
    minute: { type: 'integer', minimum: 0 },
    second: { type: 'integer', minimum: 0 },
  },
});

const requires = (description: string) => `[Requires the Calendaria module] ${description}`;

/**
 * Tools for the Calendaria module (calendar, clock, calendar notes, weather).
 * They work in any game system; the Foundry side reports an error when
 * Calendaria isn't active in the world.
 */
export class CalendariaTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: CalendariaToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'CalendariaTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'calendaria-get-date',
        description: requires(
          'Get the in-world date and time from Calendaria: date, weekday, time of day, ' +
            'season, festival, moon phases, sunrise/sunset, whether the real-time clock is ' +
            'running, current weather, and the calendar structure (month names and lengths, ' +
            'weekdays). Call this before changing time or dating notes in a custom calendar.'
        ),
        inputSchema: {
          type: 'object',
          properties: {
            includeWeather: {
              type: 'boolean',
              description: 'Include the current weather (default true)',
            },
          },
        },
      },
      {
        name: 'calendaria-change-time',
        description: requires(
          'Change the in-world time with Calendaria. advance: move forward (or back, with ' +
            'negative values) by days/hours/minutes/seconds, e.g. after a long rest or travel. ' +
            'set: jump to a date and/or time; omitted parts keep their current value. ' +
            'advance-to: move forward to the next sunrise, midday, sunset or midnight. ' +
            'start-clock / stop-clock: run or pause the real-time clock. cinematic plays ' +
            "Calendaria's time-skip animation for everyone at the table."
        ),
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['advance', 'set', 'advance-to', 'start-clock', 'stop-clock'],
            },
            days: { type: 'integer', description: 'advance: days' },
            hours: { type: 'integer', description: 'advance: hours' },
            minutes: { type: 'integer', description: 'advance: minutes' },
            seconds: { type: 'integer', description: 'advance: seconds' },
            date: dateJsonSchema('set: target date/time; omitted fields keep the current value'),
            target: {
              type: 'string',
              enum: ['sunrise', 'midday', 'sunset', 'midnight'],
              description: 'advance-to: time of day to move to',
            },
            cinematic: {
              type: 'boolean',
              description: 'Play the cinematic time-skip overlay (default false)',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'calendaria-manage-notes',
        description: requires(
          'Manage Calendaria calendar notes (events, appointments, deadlines, festivals). ' +
            'list: notes between two dates (default: today plus the next 7 days), including ' +
            'recurring notes. search: find notes by text. get: one note with its content. ' +
            'create: add a note on a date (defaults to today; all-day unless a time is given). ' +
            'update: change a note. delete: remove a note. Notes are referenced by id or exact ' +
            'name. Recurrence rules are edited in the Calendaria UI.'
        ),
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'search', 'get', 'create', 'update', 'delete'],
            },
            note: { type: 'string', description: 'get/update/delete: note id or exact name' },
            from: dateJsonSchema('list: start of range (default today)'),
            to: dateJsonSchema('list: end of range'),
            days: {
              type: 'integer',
              minimum: 0,
              description: 'list: days after "from" to include when "to" is omitted (default 7)',
            },
            query: { type: 'string', description: 'search: text to find in names and content' },
            name: { type: 'string', description: 'create/update: note title' },
            content: { type: 'string', description: 'create/update: note body (HTML allowed)' },
            startDate: dateJsonSchema(
              'create/update: start date; omitted fields default to today (create) or the ' +
                'current start (update)'
            ),
            endDate: dateJsonSchema('create/update: end date for multi-day notes'),
            allDay: { type: 'boolean', description: 'create/update: all-day note' },
            visibility: {
              type: 'string',
              enum: ['visible', 'hidden', 'secret'],
              description:
                'visible: everyone; hidden: GM and author; secret: GM only (default visible)',
            },
            color: { type: 'string', description: 'Hex color, e.g. "#4a90e2"' },
            icon: { type: 'string', description: 'Font Awesome class, e.g. "fas fa-skull"' },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Calendaria note preset ids',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'calendaria-manage-weather',
        description: requires(
          'Manage weather with Calendaria. get: current weather (temperature, wind, ' +
            'precipitation, severity). forecast: the coming days. presets: list weather types. ' +
            'set: set the weather to a preset by id or name, optionally with a temperature. ' +
            "generate: roll new weather from the zone's climate and season. clear: remove it."
        ),
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['get', 'forecast', 'presets', 'set', 'generate', 'clear'],
            },
            zone: {
              type: 'string',
              description: "Climate zone id (default: the active scene's zone)",
            },
            days: { type: 'integer', minimum: 1, description: 'forecast: days (default 7)' },
            preset: { type: 'string', description: 'set: weather preset id or name, e.g. "rain"' },
            temperature: {
              type: 'number',
              description: 'set: temperature in degrees Celsius',
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

    this.logger.info(`Calendaria: ${what}`, { action: parsed.data.action });
    try {
      return await this.foundryClient.query(`foundry-mcp-bridge.${method}`, parsed.data);
    } catch (error) {
      this.logger.error(`Calendaria: failed to ${what}`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  handleGetDate(args: unknown) {
    return this.forward(statusSchema, 'getCalendariaStatus', args, 'get date');
  }

  handleChangeTime(args: unknown) {
    return this.forward(timeSchema, 'changeCalendariaTime', args, 'change time');
  }

  handleManageNotes(args: unknown) {
    return this.forward(notesSchema, 'manageCalendariaNotes', args, 'manage notes');
  }

  handleManageWeather(args: unknown) {
    return this.forward(weatherSchema, 'manageCalendariaWeather', args, 'manage weather');
  }
}
