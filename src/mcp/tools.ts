// De MCP-server: welke tools Claude te zien krijgt en wat ze doen (het echte werk gebeurt in de draaiende app)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export type CallApp = (tool: string, args: unknown) => Promise<unknown>;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'gebruik YYYY-MM-DD')
  .describe("Date as YYYY-MM-DD in the user's local time");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'gebruik HH:MM')
  .describe('Time as 24-hour HH:MM in local time');

const repeat = z
  .object({
    frequency: z.enum(['daily', 'weekdays', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(99).optional().describe('Every N days/weeks/months/years; default 1'),
    until: date.optional().describe('Last date of the series; omit to repeat forever'),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .optional()
      .describe('Only for weekly: days of the week, 0 = Sunday … 6 = Saturday'),
  })
  .describe('Recurrence rule');

const eventFields = {
  title: z.string().min(1).max(500),
  date,
  end_date: date.optional().describe('Last day for multi-day events; default: same as date'),
  start_time: time.optional().describe('Omit (together with end_time) for an all-day event'),
  end_time: time.optional().describe('Default: one hour after start_time'),
  calendar: z
    .string()
    .max(200)
    .optional()
    .describe("Name or id of one of the user's own calendars; default: the first one"),
  location: z.string().max(500).optional(),
  notes: z.string().max(10_000).optional(),
  invitees: z
    .array(z.string().max(200))
    .max(50)
    .optional()
    .describe('Names or e-mail addresses (nothing is sent to them)'),
  repeat: repeat.optional(),
  alert_minutes_before: z
    .number()
    .int()
    .min(0)
    .max(40_320)
    .optional()
    .describe('Notification this many minutes before; 0 = at the start'),
  task: z.boolean().optional().describe('true makes it a to-do with a checkbox instead of a regular event'),
};

const scope = z
  .enum(['all', 'only', 'following'])
  .optional()
  .describe(
    'For recurring events: "all" (default) the whole series, "only" just the occurrence given by occurrence_date, "following" that occurrence and all later ones',
  );

export const INSTRUCTIONS = `You manage the user's personal calendar in the "Agenda" app, which is running on their computer.
- Start with get_context: it tells you today's date, the calendars and what is coming up.
- Dates and times are local to the user (no time zones). Use YYYY-MM-DD and HH:MM.
- Calendars marked read_only (Google, iCloud, links) cannot be changed; you can read them.
- Changes are applied immediately in the app and the user can undo them there, but still: for deleting or changing many events at once, or when the request is ambiguous, ask the user first.
- Event ids are stable. For a recurring event, pass occurrence_date together with the id to point at one occurrence.
- Never invent events; if you are unsure what the user means, search first.`;

// geeft het resultaat van een tool terug als tekst; een fout wordt een "tool-fout" die Claude kan lezen en uitleggen
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const failure = (error: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
});

export function buildServer(call: CallApp, version = '0.0.0') {
  const server = new McpServer({ name: 'agenda', version }, { instructions: INSTRUCTIONS });
  const run = (tool: string) => async (args: unknown) => {
    try {
      return text(await call(tool, args));
    } catch (error) {
      return failure(error);
    }
  };

  server.registerTool(
    'get_context',
    {
      title: 'Agenda overview',
      description:
        "Current date and time, the user's calendars (with ids, whether they are read-only and how many events they hold), the week start and the next upcoming events. Call this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    run('get_context'),
  );

  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description:
        'All events (recurring events expanded into occurrences) between two dates, inclusive, sorted by time. Range is limited to 366 days.',
      inputSchema: {
        from: date,
        to: date,
        calendar: z.string().optional().describe('Only this calendar (name or id)'),
        include_holidays: z.boolean().optional().describe('Include public holidays; default false'),
        limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
      },
      annotations: { readOnlyHint: true },
    },
    run('list_events'),
  );

  server.registerTool(
    'search_events',
    {
      title: 'Search events',
      description: 'Find events by text in the title, location, notes or invitees. Optionally limited to a date range.',
      inputSchema: {
        query: z.string().min(1).max(200),
        from: date.optional(),
        to: date.optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 25'),
      },
      annotations: { readOnlyHint: true },
    },
    run('search_events'),
  );

  server.registerTool(
    'get_event',
    {
      title: 'Get one event',
      description: 'Full details of one event by id (use occurrence_date for one occurrence of a recurring event).',
      inputSchema: { id: z.string().min(1), occurrence_date: date.optional() },
      annotations: { readOnlyHint: true },
    },
    run('get_event'),
  );

  server.registerTool(
    'find_free_time',
    {
      title: 'Find free time',
      description:
        'Free slots of at least a given length between two dates, based on events with a time in all visible calendars. All-day events do not count as busy.',
      inputSchema: {
        from: date,
        to: date,
        duration_minutes: z.number().int().min(5).max(1440),
        day_start: time.optional().describe('Earliest start per day; default 09:00'),
        day_end: time.optional().describe('Latest end per day; default 18:00'),
        include_weekends: z.boolean().optional().describe('Default false'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 20'),
      },
      annotations: { readOnlyHint: true },
    },
    run('find_free_time'),
  );

  server.registerTool(
    'create_events',
    {
      title: 'Create events',
      description:
        'Create one or more events in one step (one undo for the user). Without start_time the event lasts all day. Returns the created events with their ids.',
      inputSchema: { events: z.array(z.object(eventFields)).min(1).max(50) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    run('create_events'),
  );

  server.registerTool(
    'update_event',
    {
      title: 'Change an event',
      description:
        'Change fields of an existing event; fields you leave out stay as they are. Set repeat to null to stop repeating. For events in read-only calendars this fails.',
      inputSchema: {
        id: z.string().min(1),
        occurrence_date: date.optional().describe('Which occurrence of a recurring event (its original date)'),
        scope,
        ...Object.fromEntries(
          Object.entries({ ...eventFields, repeat: repeat.nullable().optional() }).map(([key, schema]) => [
            key,
            (schema as z.ZodType).optional(),
          ]),
        ),
        all_day: z.boolean().optional().describe('true makes it an all-day event (removes the times)'),
        done: z
          .boolean()
          .optional()
          .describe('For a task: true ticks it off, false reopens it (for the given occurrence of a recurring task)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    run('update_event'),
  );

  server.registerTool(
    'delete_event',
    {
      title: 'Delete an event',
      description: 'Delete an event. For recurring events choose the scope; by default the whole series is deleted.',
      inputSchema: { id: z.string().min(1), occurrence_date: date.optional(), scope },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    run('delete_event'),
  );

  return server;
}
