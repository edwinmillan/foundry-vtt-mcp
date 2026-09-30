import { MODULE_ID } from './constants.js';

/**
 * Access to the Calendaria module (https://github.com/Sayshal/Calendaria)
 * through its public API at `CALENDARIA.api`. Everything here goes through
 * that API, whose dates use display years and 1-indexed months and days.
 *
 * Calendaria stores names (calendars, months, moons, weather) as i18n keys,
 * so every name is localized before it is returned.
 */

export const CALENDARIA_MODULE_ID = 'calendaria';

type Failure = { success: false; error: string };

export interface CalendariaDateInput {
  year?: number;
  /** 1-indexed month number, or a month name / abbreviation */
  month?: number | string;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}

interface PublicDate {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

const TIME_TARGETS = ['sunrise', 'midday', 'sunset', 'midnight'] as const;

function fail(error: string): Failure {
  return { success: false, error };
}

function loc(text: unknown): string {
  if (typeof text !== 'string' || !text) return '';
  return (game as any).i18n?.localize?.(text) ?? text;
}

export class CalendariaAccess {
  /** The Calendaria API, or a failure when the module is missing or inactive. */
  private getApi(): { api: any; calendar: any } | Failure {
    const module = (game as any).modules?.get?.(CALENDARIA_MODULE_ID);
    if (!module?.active) {
      return fail('The Calendaria module is not installed or not active in this world');
    }
    const api = (globalThis as any).CALENDARIA?.api;
    if (!api) return fail('Calendaria is active but its API is not ready yet');
    const calendar = api.getActiveCalendar();
    if (!calendar) return fail('Calendaria has no active calendar');
    return { api, calendar };
  }

  private requireWrites(): Failure | null {
    if (game.settings.get(MODULE_ID, 'allowWriteOperations')) return null;
    return fail('Write operations are disabled in the Foundry MCP Bridge settings');
  }

  // ─── Dates ──────────────────────────────────────────────────────────────────

  private months(calendar: any): any[] {
    return calendar.monthsArray ?? [];
  }

  private monthName(calendar: any, month: number): string {
    return loc(this.months(calendar)[month - 1]?.name);
  }

  private daysInMonth(calendar: any, month: number, year: number): number | undefined {
    const yearZero = calendar.years?.yearZero ?? 0;
    const days = calendar.getDaysInMonth?.(month - 1, year - yearZero);
    return Number.isFinite(days) ? days : this.months(calendar)[month - 1]?.days;
  }

  /** Resolve a month number or (localized) name / abbreviation to 1-indexed. */
  private resolveMonth(calendar: any, month: number | string): number {
    const months = this.months(calendar);
    if (typeof month === 'number') {
      if (!Number.isInteger(month) || month < 1 || month > months.length) {
        throw new Error(`Month must be between 1 and ${months.length}`);
      }
      return month;
    }
    const wanted = month.trim().toLowerCase();
    const index = months.findIndex(m =>
      [m.name, m.abbreviation].some(n => n && loc(n).toLowerCase() === wanted)
    );
    if (index === -1) {
      const names = months.map(m => loc(m.name)).join(', ');
      throw new Error(`Unknown month "${month}". Months: ${names}`);
    }
    return index + 1;
  }

  /** Fill a partial date from `base` and validate the day against the month. */
  private resolveDate(calendar: any, input: CalendariaDateInput, base: PublicDate): PublicDate {
    const date: PublicDate = {
      year: input.year ?? base.year,
      month: input.month !== undefined ? this.resolveMonth(calendar, input.month) : base.month,
      day: input.day ?? base.day,
    };
    const days = this.daysInMonth(calendar, date.month, date.year);
    if (days !== undefined && (date.day < 1 || date.day > days)) {
      throw new Error(
        `${this.monthName(calendar, date.month)} ${date.year} has ${days} days (got day ${date.day})`
      );
    }
    if (input.hour !== undefined) date.hour = input.hour;
    if (input.minute !== undefined) date.minute = input.minute;
    return date;
  }

  private today(api: any): PublicDate {
    const now = api.getCurrentDateTime();
    return { year: now.year, month: now.month, day: now.day };
  }

  private formatClock(hours: number | null | undefined, calendar: any): string | null {
    if (typeof hours !== 'number' || !Number.isFinite(hours)) return null;
    const minutesPerHour = calendar.days?.minutesPerHour ?? 60;
    let h = Math.floor(hours);
    let m = Math.round((hours - h) * minutesPerHour);
    if (m >= minutesPerHour) {
      h += 1;
      m = 0;
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private describeDate(calendar: any, date: any): Record<string, unknown> | null {
    if (!date) return null;
    return {
      year: date.year,
      month: date.month,
      monthName: this.monthName(calendar, date.month),
      day: date.day,
    };
  }

  /** The current date and time, as returned by every time-changing action. */
  private describeNow(api: any, calendar: any): Record<string, unknown> {
    const now = api.getCurrentDateTime();
    const weekday = api.getCurrentWeekday();
    return {
      year: now.year,
      month: now.month,
      monthName: this.monthName(calendar, now.month),
      day: now.day,
      weekday: weekday ? loc(weekday.name) : null,
      hour: now.hour,
      minute: now.minute,
      second: now.second,
      formatted: `${api.formatDate(null, 'dateFull')}, ${this.formatClock(
        now.hour + (now.minute ?? 0) / (calendar.days?.minutesPerHour ?? 60),
        calendar
      )}`,
      worldTime: (game as any).time?.worldTime,
    };
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  getStatus(data: { includeWeather?: boolean } = {}): any {
    const ctx = this.getApi();
    if ('success' in ctx) return ctx;
    const { api, calendar } = ctx;
    const now = this.today(api);

    const season = api.getCurrentSeason();
    const festival = api.getCurrentFestival();
    const moons = (api.getAllMoonPhases() ?? [])
      .filter(Boolean)
      .map((m: any) => ({ moon: loc(m.moonName), phase: loc(m.name) }));

    return {
      success: true,
      calendar: { id: calendar.metadata?.id ?? calendar.id ?? null, name: loc(calendar.name) },
      now: this.describeNow(api, calendar),
      season: season ? loc(season.name) : null,
      festival: festival ? loc(festival.name) : null,
      isRestDay: api.isRestDay(),
      moons,
      sunrise: this.formatClock(api.getSunrise(), calendar),
      sunset: this.formatClock(api.getSunset(), calendar),
      isDaytime: api.isDaytime(),
      clockRunning: api.isClockRunning(),
      ...(data.includeWeather === false
        ? {}
        : { weather: this.describeWeather(api, api.getCurrentWeather()) }),
      structure: {
        hoursPerDay: calendar.days?.hoursPerDay ?? 24,
        minutesPerHour: calendar.days?.minutesPerHour ?? 60,
        months: this.months(calendar).map((m: any, i: number) => ({
          number: i + 1,
          name: loc(m.name),
          days: this.daysInMonth(calendar, i + 1, now.year) ?? m.days,
        })),
        weekdays: (calendar.weekdaysArray ?? []).map((d: any) => loc(d.name)),
      },
    };
  }

  // ─── Time ───────────────────────────────────────────────────────────────────

  async changeTime(data: {
    action: 'advance' | 'set' | 'advance-to' | 'start-clock' | 'stop-clock';
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    date?: CalendariaDateInput;
    target?: (typeof TIME_TARGETS)[number];
    cinematic?: boolean;
  }): Promise<any> {
    const ctx = this.getApi();
    if ('success' in ctx) return ctx;
    const { api, calendar } = ctx;
    const blocked = this.requireWrites();
    if (blocked) return blocked;
    if (!api.canModifyTime()) {
      return fail("Calendaria's permission settings do not allow this user to change time");
    }

    const before = (game as any).time?.worldTime;
    const previous = api.formatDate(null, 'dateFull');
    const cinematic = data.cinematic ?? false;

    switch (data.action) {
      case 'advance': {
        const delta = {
          day: data.days ?? 0,
          hour: data.hours ?? 0,
          minute: data.minutes ?? 0,
          second: data.seconds ?? 0,
        };
        if (!Object.values(delta).some(v => v !== 0)) {
          throw new Error('advance needs a non-zero days, hours, minutes or seconds');
        }
        await api.advanceTime(delta, { cinematic });
        break;
      }
      case 'set': {
        if (!data.date) throw new Error('set needs a date');
        const now = api.getCurrentDateTime();
        const date = this.resolveDate(calendar, data.date, now);
        // A new clock time starts on the minute unless seconds are given.
        const timeGiven = data.date.hour !== undefined || data.date.minute !== undefined;
        await api.setDateTime(
          {
            year: date.year,
            month: date.month,
            day: date.day,
            hour: data.date.hour ?? now.hour,
            minute: data.date.minute ?? now.minute,
            second: data.date.second ?? (timeGiven ? 0 : now.second),
          },
          { cinematic }
        );
        break;
      }
      case 'advance-to': {
        if (!data.target || !TIME_TARGETS.includes(data.target)) {
          throw new Error(`advance-to needs a target: ${TIME_TARGETS.join(', ')}`);
        }
        await api.advanceTimeToPreset(data.target, { cinematic });
        break;
      }
      case 'start-clock':
        api.startClock();
        break;
      case 'stop-clock':
        api.stopClock();
        break;
      default:
        throw new Error(`Unknown action "${(data as any).action}"`);
    }

    const after = (game as any).time?.worldTime;
    return {
      success: true,
      action: data.action,
      previous,
      now: this.describeNow(api, calendar),
      elapsedSeconds:
        typeof before === 'number' && typeof after === 'number' ? after - before : null,
      clockRunning: api.isClockRunning(),
    };
  }

  // ─── Notes ──────────────────────────────────────────────────────────────────

  private describeNote(calendar: any, stub: any, withContent = false): any {
    const flags = stub.flagData ?? {};
    const allDay = flags.allDay ?? true;
    const withTime = (d: any) => {
      const described = this.describeDate(calendar, d);
      if (described && !allDay) {
        described.time = this.formatClock((d.hour ?? 0) + (d.minute ?? 0) / 60, calendar);
      }
      return described;
    };
    return {
      id: stub.id,
      name: stub.name,
      start: withTime(flags.startDate),
      end: withTime(flags.endDate),
      allDay,
      recurring: Boolean(flags.conditionTree),
      ...(stub.nextOccurrence
        ? { nextOccurrence: this.describeDate(calendar, stub.nextOccurrence) }
        : {}),
      visibility: flags.visibility ?? 'visible',
      categories: flags.categories ?? [],
      journalId: stub.journalId ?? null,
      ...(withContent ? { content: stub.content ?? '' } : {}),
    };
  }

  /** Find a note by page id or by case-insensitive name. */
  private findNote(api: any, identifier: string): any {
    const byId = api.getNote(identifier);
    if (byId) return byId;
    const wanted = identifier.toLowerCase();
    const matches = (api.getAllNotes() ?? []).filter((n: any) => n.name?.toLowerCase() === wanted);
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} notes are named "${identifier}"; use an id: ${matches
          .map((n: any) => n.id)
          .join(', ')}`
      );
    }
    if (!matches.length) throw new Error(`No Calendaria note found for "${identifier}"`);
    return matches[0];
  }

  async manageNotes(data: {
    action: 'list' | 'search' | 'get' | 'create' | 'update' | 'delete';
    note?: string;
    from?: CalendariaDateInput;
    to?: CalendariaDateInput;
    days?: number;
    query?: string;
    name?: string;
    content?: string;
    startDate?: CalendariaDateInput;
    endDate?: CalendariaDateInput;
    allDay?: boolean;
    visibility?: 'visible' | 'hidden' | 'secret';
    color?: string;
    icon?: string;
    categories?: string[];
  }): Promise<any> {
    const ctx = this.getApi();
    if ('success' in ctx) return ctx;
    const { api, calendar } = ctx;
    const today = this.today(api);

    switch (data.action) {
      case 'list': {
        const from = data.from ? this.resolveDate(calendar, data.from, today) : today;
        const to = data.to
          ? this.resolveDate(calendar, data.to, from)
          : api.addDays(from, data.days ?? 7);
        const notes = api.getNotesInRange(
          { year: from.year, month: from.month, day: from.day },
          { year: to.year, month: to.month, day: to.day },
          { includeOccurrences: true }
        );
        return {
          success: true,
          from: this.describeDate(calendar, from),
          to: this.describeDate(calendar, to),
          notes: notes.map((n: any) => this.describeNote(calendar, n)),
        };
      }
      case 'search': {
        if (!data.query) throw new Error('search needs a query');
        const notes = api.searchNotes(data.query);
        return { success: true, notes: notes.map((n: any) => this.describeNote(calendar, n)) };
      }
      case 'get': {
        if (!data.note) throw new Error('get needs a note (id or name)');
        return {
          success: true,
          note: this.describeNote(calendar, this.findNote(api, data.note), true),
        };
      }
    }

    const blocked = this.requireWrites();
    if (blocked) return blocked;
    if (!api.canManageNotes()) {
      return fail("Calendaria's permission settings do not allow this user to manage notes");
    }

    const timed = (input: CalendariaDateInput | undefined, base: PublicDate) =>
      input ? this.resolveDate(calendar, input, base) : undefined;

    switch (data.action) {
      case 'create': {
        if (!data.name) throw new Error('create needs a name');
        const startDate = timed(data.startDate, today) ?? today;
        const endDate = timed(data.endDate, startDate);
        const page = await api.createNote({
          name: data.name,
          content: data.content ?? '',
          startDate,
          endDate,
          allDay: data.allDay ?? startDate.hour === undefined,
          visibility: data.visibility ?? 'visible',
          ...(data.color ? { color: data.color } : {}),
          ...(data.icon ? { icon: data.icon } : {}),
          categories: data.categories ?? [],
          openSheet: false,
        });
        if (!page) return fail('Calendaria did not create the note');
        return {
          success: true,
          note: {
            id: page.id,
            name: page.name,
            start: this.describeDate(calendar, startDate),
            end: this.describeDate(calendar, endDate),
          },
        };
      }
      case 'update': {
        if (!data.note) throw new Error('update needs a note (id or name)');
        const existing = this.findNote(api, data.note);
        const currentStart = existing.flagData?.startDate ?? today;
        const startDate = timed(data.startDate, currentStart);
        const updates: Record<string, unknown> = {};
        if (data.name !== undefined) updates.name = data.name;
        if (data.content !== undefined) updates.content = data.content;
        if (startDate) updates.startDate = startDate;
        if (data.endDate) {
          updates.endDate = timed(data.endDate, startDate ?? currentStart);
        }
        if (data.allDay !== undefined) updates.allDay = data.allDay;
        if (data.visibility !== undefined) updates.visibility = data.visibility;
        if (data.color !== undefined) updates.color = data.color;
        if (data.icon !== undefined) updates.icon = data.icon;
        if (data.categories !== undefined) updates.categories = data.categories;
        if (!Object.keys(updates).length) throw new Error('Nothing to update');
        const page = await api.updateNote(existing.id, updates);
        if (!page) return fail('Calendaria did not update the note');
        const refreshed = api.getNote(existing.id) ?? existing;
        return { success: true, note: this.describeNote(calendar, refreshed) };
      }
      case 'delete': {
        if (!data.note) throw new Error('delete needs a note (id or name)');
        const existing = this.findNote(api, data.note);
        const deleted = await api.deleteNote(existing.id);
        if (!deleted) return fail(`Calendaria did not delete "${existing.name}"`);
        return { success: true, deleted: { id: existing.id, name: existing.name } };
      }
      default:
        throw new Error(`Unknown action "${(data as any).action}"`);
    }
  }

  // ─── Weather ────────────────────────────────────────────────────────────────

  private describeWeather(api: any, weather: any): any {
    if (!weather) return null;
    const severity = weather.severity;
    return {
      id: weather.id ?? null,
      label: loc(weather.label),
      ...(weather.description ? { description: loc(weather.description) } : {}),
      ...(typeof weather.temperature === 'number'
        ? { temperature: api.formatTemperature(weather.temperature) }
        : {}),
      ...(typeof severity === 'number'
        ? { severity, severityLabel: api.getWeatherSeverityLabel(severity) }
        : {}),
      ...(weather.wind ? { wind: weather.wind } : {}),
      ...(weather.precipitation ? { precipitation: weather.precipitation } : {}),
    };
  }

  /** Resolve a weather preset by id or localized label. */
  private async resolvePreset(api: any, preset: string): Promise<any> {
    const presets: any[] = (await api.getWeatherPresets()) ?? [];
    const wanted = preset.trim().toLowerCase();
    const hit =
      presets.find(p => p.id?.toLowerCase() === wanted) ??
      presets.find(p => loc(p.label).toLowerCase() === wanted);
    if (!hit) {
      throw new Error(`Unknown weather preset "${preset}". Use action "presets" to list them`);
    }
    return hit;
  }

  async manageWeather(data: {
    action: 'get' | 'forecast' | 'presets' | 'set' | 'generate' | 'clear';
    zone?: string;
    days?: number;
    preset?: string;
    temperature?: number;
  }): Promise<any> {
    const ctx = this.getApi();
    if ('success' in ctx) return ctx;
    const { api, calendar } = ctx;
    const zone = api.getActiveZone();
    const zoneInfo = zone ? { id: zone.id, name: loc(zone.name) } : null;

    switch (data.action) {
      case 'get':
        return {
          success: true,
          zone: zoneInfo,
          weather: this.describeWeather(api, api.getCurrentWeather(data.zone)),
        };
      case 'forecast': {
        const yearZero = calendar.years?.yearZero ?? 0;
        const entries: any[] = api.getWeatherForecast({
          days: data.days ?? 7,
          ...(data.zone ? { zoneId: data.zone } : {}),
        });
        return {
          success: true,
          zone: zoneInfo,
          // Forecast entries use Calendaria's internal (0-indexed) date fields.
          forecast: entries.map(e => ({
            date: this.describeDate(calendar, {
              year: e.year + yearZero,
              month: e.month + 1,
              day: e.dayOfMonth + 1,
            }),
            weather: this.describeWeather(api, {
              ...e.preset,
              temperature: e.temperature,
              wind: e.wind,
              precipitation: e.precipitation,
            }),
          })),
        };
      }
      case 'presets': {
        const presets: any[] = (await api.getWeatherPresets()) ?? [];
        return {
          success: true,
          presets: presets.map(p => ({
            id: p.id,
            label: loc(p.label),
            category: p.category ?? null,
          })),
        };
      }
    }

    const blocked = this.requireWrites();
    if (blocked) return blocked;
    const zoneOption = data.zone ? { zoneId: data.zone } : {};

    let weather: any;
    switch (data.action) {
      case 'set': {
        if (!data.preset) throw new Error('set needs a preset (id or name)');
        const preset = await this.resolvePreset(api, data.preset);
        weather = await api.setWeather(preset.id, {
          ...zoneOption,
          ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
        });
        break;
      }
      case 'generate':
        weather = await api.generateWeather(zoneOption);
        break;
      case 'clear':
        await api.clearWeather();
        return { success: true, zone: zoneInfo, weather: null };
      default:
        throw new Error(`Unknown action "${(data as any).action}"`);
    }
    return {
      success: true,
      zone: zoneInfo,
      weather: this.describeWeather(api, api.getCurrentWeather(data.zone) ?? weather),
    };
  }
}
