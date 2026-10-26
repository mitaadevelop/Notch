// Tijdzones die je kunt kiezen, en de klok in een andere tijdzone (extra tijdkolommen in dag- en weekweergave)
export const TIMEZONES: [string, string][] = [
  ['', 'Zwevend (lokale tijd)'],
  ['Europe/Amsterdam', 'Amsterdam'],
  ['Europe/London', 'Londen'],
  ['Europe/Paris', 'Parijs'],
  ['Europe/Berlin', 'Berlijn'],
  ['Europe/Madrid', 'Madrid'],
  ['Europe/Rome', 'Rome'],
  ['Europe/Athens', 'Athene'],
  ['Europe/Moscow', 'Moskou'],
  ['Atlantic/Reykjavik', 'Reykjavik'],
  ['America/New_York', 'New York'],
  ['America/Chicago', 'Chicago'],
  ['America/Denver', 'Denver'],
  ['America/Los_Angeles', 'Los Angeles'],
  ['America/Toronto', 'Toronto'],
  ['America/Mexico_City', 'Mexico-Stad'],
  ['America/Sao_Paulo', 'São Paulo'],
  ['Africa/Cairo', 'Caïro'],
  ['Africa/Lagos', 'Lagos'],
  ['Africa/Johannesburg', 'Johannesburg'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Kolkata', 'Mumbai / Delhi'],
  ['Asia/Bangkok', 'Bangkok'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Hong_Kong', 'Hongkong'],
  ['Asia/Shanghai', 'Shanghai'],
  ['Asia/Tokyo', 'Tokio'],
  ['Asia/Seoul', 'Seoul'],
  ['Australia/Sydney', 'Sydney'],
  ['Pacific/Auckland', 'Auckland'],
  ['UTC', 'UTC'],
];

export const zoneName = (id: string) =>
  TIMEZONES.find(([zone]) => zone === id)?.[1] ?? id.split('/').pop()!.replace(/_/g, ' ');

// bestaat deze tijdzone? (Intl kent de lijst van het systeem)
export function validZone(id: unknown): id is string {
  if (typeof id !== 'string' || !id || id.length > 60) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** De klok in `zone` op het moment dat het lokaal `hour`:00 is op `day` (YYYY-MM-DD); met het dagverschil (-1, 0, +1). */
export function clockIn(zone: string, day: string, hour: number): { time: string; dayShift: number } {
  const [y, m, d] = day.split('-').map(Number);
  const local = new Date(y, m - 1, d, hour, 0, 0, 0);
  const parts = Object.fromEntries(
    formatter(zone)
      .formatToParts(local)
      .map((p) => [p.type, p.value]),
  );
  const shift = Number(parts.day) - d;
  // over een maandgrens (31 -> 1) is het verschil groot; teken is het enige dat telt
  const dayShift = shift === 0 ? 0 : Math.abs(shift) > 15 ? (shift > 0 ? -1 : 1) : Math.sign(shift);
  return { time: `${parts.hour}:${parts.minute}`, dayShift };
}
