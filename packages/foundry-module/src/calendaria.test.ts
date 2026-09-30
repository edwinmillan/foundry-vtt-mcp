import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendariaAccess } from './calendaria.js';

const I18N: Record<string, string> = {
  'CAL.Name': 'Harptos',
  'CAL.Hammer': 'Hammer',
  'CAL.Alturiak': 'Alturiak',
  'CAL.Ches': 'Ches',
  'CAL.Moon': 'Selûne',
  'CAL.Full': 'Full Moon',
  'CAL.Winter': 'Winter',
  'CAL.Clear': 'Clear',
  'CAL.Rain': 'Rain',
};

/** A stand-in for CALENDARIA.api using its public (1-indexed) date conventions. */
function makeApi() {
  const state = { year: 1492, month: 1, day: 10, hour: 8, minute: 30, second: 15 };
  const months = [
    { name: 'CAL.Hammer', abbreviation: 'Ham', days: 30 },
    { name: 'CAL.Alturiak', abbreviation: 'Alt', days: 30 },
    { name: 'CAL.Ches', abbreviation: 'Che', days: 30 },
  ];
  const calendar = {
    name: 'CAL.Name',
    metadata: { id: 'harptos' },
    years: { yearZero: 0 },
    days: { hoursPerDay: 24, minutesPerHour: 60 },
    monthsArray: months,
    weekdaysArray: [{ name: 'First-day' }, { name: 'Second-day' }],
    getDaysInMonth: (m: number) => months[m].days,
  };
  const notes = [
    {
      id: 'n1',
      name: 'Council Meeting',
      content: '<p>Bring the ledger</p>',
      journalId: 'j1',
      flagData: {
        startDate: { year: 1492, month: 1, day: 12, hour: 18, minute: 0 },
        endDate: null,
        allDay: false,
        visibility: 'secret',
        categories: [],
      },
    },
  ];
  const presets = [
    { id: 'clear', label: 'CAL.Clear', category: 'standard' },
    { id: 'rain', label: 'CAL.Rain', category: 'standard' },
  ];
  const api = {
    getActiveCalendar: vi.fn(() => calendar),
    getCurrentDateTime: vi.fn(() => ({ ...state })),
    getCurrentWeekday: vi.fn(() => ({ name: 'Second-day' })),
    formatDate: vi.fn(() => `${state.day} ${I18N[months[state.month - 1].name]} ${state.year}`),
    getCurrentSeason: vi.fn(() => ({ name: 'CAL.Winter' })),
    getCurrentFestival: vi.fn(() => null),
    isRestDay: vi.fn(() => false),
    getAllMoonPhases: vi.fn(() => [{ moonName: 'CAL.Moon', name: 'CAL.Full' }, null]),
    getSunrise: vi.fn(() => 6.5),
    getSunset: vi.fn(() => 18.25),
    isDaytime: vi.fn(() => true),
    isClockRunning: vi.fn(() => false),
    canModifyTime: vi.fn(() => true),
    canManageNotes: vi.fn(() => true),
    advanceTime: vi.fn(async () => undefined),
    setDateTime: vi.fn(async (c: any) => Object.assign(state, c)),
    advanceTimeToPreset: vi.fn(async () => undefined),
    startClock: vi.fn(),
    stopClock: vi.fn(),
    addDays: vi.fn((d: any, n: number) => ({ ...d, day: d.day + n })),
    getNotesInRange: vi.fn(() => notes),
    searchNotes: vi.fn(() => notes),
    getNote: vi.fn((id: string) => notes.find(n => n.id === id) ?? null),
    getAllNotes: vi.fn(() => notes),
    createNote: vi.fn(async (o: any) => ({ id: 'n2', name: o.name })),
    updateNote: vi.fn(async (id: string) => ({ id })),
    deleteNote: vi.fn(async () => true),
    getCurrentWeather: vi.fn(() => ({
      id: 'clear',
      label: 'CAL.Clear',
      temperature: 21,
      severity: 1,
    })),
    formatTemperature: vi.fn((c: number) => `${c}°C`),
    getWeatherSeverityLabel: vi.fn(() => 'Mild'),
    getWeatherForecast: vi.fn(() => [
      { year: 1492, month: 0, dayOfMonth: 10, preset: presets[1], temperature: 9 },
    ]),
    getWeatherPresets: vi.fn(async () => presets),
    getActiveZone: vi.fn(() => ({ id: 'temperate', name: 'Temperate' })),
    setWeather: vi.fn(async () => ({ id: 'rain', label: 'CAL.Rain' })),
    generateWeather: vi.fn(async () => ({ id: 'rain', label: 'CAL.Rain' })),
    clearWeather: vi.fn(async () => undefined),
  };
  return { api, state, notes };
}

function setup(options: { active?: boolean; allowWrites?: boolean } = {}) {
  const { api, state, notes } = makeApi();
  vi.stubGlobal('CALENDARIA', { api });
  vi.stubGlobal('game', {
    modules: {
      get: (id: string) => (id === 'calendaria' ? { active: options.active ?? true } : undefined),
    },
    i18n: { localize: (key: string) => I18N[key] ?? key },
    time: { worldTime: 1000 },
    settings: {
      get: (scope: string, key: string) => {
        if (scope === 'foundry-mcp-bridge' && key === 'allowWriteOperations') {
          return options.allowWrites ?? true;
        }
        throw new Error(`setting not registered: ${scope}.${key}`);
      },
    },
  });
  return { api, state, notes, access: new CalendariaAccess() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CalendariaAccess gating', () => {
  it('reports when Calendaria is not active', () => {
    const { access } = setup({ active: false });
    const result = access.getStatus();
    expect(result.success).toBe(false);
    expect(result.error).toContain('not installed or not active');
  });

  it('honours the write-operations setting', async () => {
    const { access, api } = setup({ allowWrites: false });
    const result = await access.changeTime({ action: 'advance', hours: 1 });
    expect(result.success).toBe(false);
    expect(api.advanceTime).not.toHaveBeenCalled();
    const weather = await access.manageWeather({ action: 'set', preset: 'rain' });
    expect(weather.success).toBe(false);
    // Reads still work.
    expect((await access.manageWeather({ action: 'get' })).success).toBe(true);
  });
});

describe('CalendariaAccess.getStatus', () => {
  it('localizes names and reports calendar structure', () => {
    const { access } = setup();
    const result = access.getStatus();
    expect(result).toMatchObject({
      success: true,
      calendar: { id: 'harptos', name: 'Harptos' },
      now: { year: 1492, month: 1, monthName: 'Hammer', day: 10, weekday: 'Second-day' },
      season: 'Winter',
      moons: [{ moon: 'Selûne', phase: 'Full Moon' }],
      sunrise: '06:30',
      sunset: '18:15',
      weather: { label: 'Clear', temperature: '21°C', severityLabel: 'Mild' },
    });
    expect(result.now.formatted).toBe('10 Hammer 1492, 08:30');
    expect(result.structure.months[2]).toEqual({ number: 3, name: 'Ches', days: 30 });
  });
});

describe('CalendariaAccess.changeTime', () => {
  it('advances by a delta', async () => {
    const { access, api } = setup();
    await access.changeTime({ action: 'advance', days: 1, hours: 8 });
    expect(api.advanceTime).toHaveBeenCalledWith(
      { day: 1, hour: 8, minute: 0, second: 0 },
      { cinematic: false }
    );
  });

  it('sets a date by month name, keeping the current time of day', async () => {
    const { access, api } = setup();
    const result = await access.changeTime({ action: 'set', date: { month: 'ches', day: 1 } });
    expect(api.setDateTime).toHaveBeenCalledWith(
      { year: 1492, month: 3, day: 1, hour: 8, minute: 30, second: 15 },
      { cinematic: false }
    );
    expect(result.now.monthName).toBe('Ches');
  });

  it('zeroes seconds when a new time is given', async () => {
    const { access, api } = setup();
    await access.changeTime({ action: 'set', date: { hour: 20 } });
    expect(api.setDateTime).toHaveBeenCalledWith(
      expect.objectContaining({ hour: 20, minute: 30, second: 0 }),
      expect.anything()
    );
  });

  it('rejects unknown months and out-of-range days', async () => {
    const { access, api } = setup();
    await expect(
      access.changeTime({ action: 'set', date: { month: 'Flamerule' } })
    ).rejects.toThrow('Months: Hammer, Alturiak, Ches');
    await expect(access.changeTime({ action: 'set', date: { day: 31 } })).rejects.toThrow(
      'Hammer 1492 has 30 days'
    );
    expect(api.setDateTime).not.toHaveBeenCalled();
  });

  it('advances to a time of day', async () => {
    const { access, api } = setup();
    await access.changeTime({ action: 'advance-to', target: 'sunset', cinematic: true });
    expect(api.advanceTimeToPreset).toHaveBeenCalledWith('sunset', { cinematic: true });
  });

  it("respects Calendaria's own time permission", async () => {
    const { access, api } = setup();
    api.canModifyTime.mockReturnValue(false);
    const result = await access.changeTime({ action: 'start-clock' });
    expect(result.success).toBe(false);
    expect(api.startClock).not.toHaveBeenCalled();
  });
});

describe('CalendariaAccess.manageNotes', () => {
  it('lists today plus 7 days by default', async () => {
    const { access, api } = setup();
    const result = await access.manageNotes({ action: 'list' });
    expect(api.getNotesInRange).toHaveBeenCalledWith(
      { year: 1492, month: 1, day: 10 },
      { year: 1492, month: 1, day: 17 },
      { includeOccurrences: true }
    );
    expect(result.notes[0]).toMatchObject({
      id: 'n1',
      name: 'Council Meeting',
      start: { monthName: 'Hammer', day: 12, time: '18:00' },
      allDay: false,
      visibility: 'secret',
    });
    expect(result.notes[0].content).toBeUndefined();
  });

  it('gets a note by name with its content', async () => {
    const { access } = setup();
    const result = await access.manageNotes({ action: 'get', note: 'council meeting' });
    expect(result.note.content).toBe('<p>Bring the ledger</p>');
  });

  it('creates a note without opening its sheet', async () => {
    const { access, api } = setup();
    const result = await access.manageNotes({
      action: 'create',
      name: 'Tax Day',
      startDate: { month: 2, day: 1 },
      visibility: 'hidden',
    });
    expect(api.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Tax Day',
        startDate: { year: 1492, month: 2, day: 1 },
        allDay: true,
        visibility: 'hidden',
        openSheet: false,
      })
    );
    expect(result.note.id).toBe('n2');
  });

  it('updates and deletes by id', async () => {
    const { access, api } = setup();
    await access.manageNotes({ action: 'update', note: 'n1', startDate: { day: 14 } });
    expect(api.updateNote).toHaveBeenCalledWith('n1', {
      startDate: { year: 1492, month: 1, day: 14 },
    });
    const deleted = await access.manageNotes({ action: 'delete', note: 'n1' });
    expect(deleted.deleted).toEqual({ id: 'n1', name: 'Council Meeting' });
  });

  it('does not write when writes are disabled', async () => {
    const { access, api } = setup({ allowWrites: false });
    const result = await access.manageNotes({ action: 'delete', note: 'n1' });
    expect(result.success).toBe(false);
    expect(api.deleteNote).not.toHaveBeenCalled();
  });
});

describe('CalendariaAccess.manageWeather', () => {
  it('converts forecast dates from internal indexes', async () => {
    const { access } = setup();
    const result = await access.manageWeather({ action: 'forecast', days: 1 });
    expect(result.forecast[0]).toEqual({
      date: { year: 1492, month: 1, monthName: 'Hammer', day: 11 },
      weather: { id: 'rain', label: 'Rain', temperature: '9°C' },
    });
  });

  it('sets weather by localized preset name', async () => {
    const { access, api } = setup();
    await access.manageWeather({ action: 'set', preset: 'Rain', temperature: 12 });
    expect(api.setWeather).toHaveBeenCalledWith('rain', { temperature: 12 });
  });

  it('rejects unknown presets', async () => {
    const { access } = setup();
    await expect(access.manageWeather({ action: 'set', preset: 'Meteors' })).rejects.toThrow(
      'Unknown weather preset'
    );
  });
});
