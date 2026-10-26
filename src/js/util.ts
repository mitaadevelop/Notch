// datums zijn 'YYYY-MM-DD' strings en tijden 'HH:MM', zodat tijdzones nergens ongevraagd meespelen
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const pad = (n: number) => String(n).padStart(2, '0');
export const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const fromKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const makeKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-based
export const todayKey = () => keyOf(new Date());

export const addDays = (key: string, n: number) => {
  const date = fromKey(key);
  date.setDate(date.getDate() + n);
  return keyOf(date);
};

export const addMonths = (key: string, n: number) => {
  const date = fromKey(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + n);
  date.setDate(Math.min(day, daysInMonth(date.getFullYear(), date.getMonth())));
  return keyOf(date);
};

export const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

// aantal dagen van a naar b (b - a)
export const diffDays = (a: string, b: string) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

// begin van de week; weekStart: 0 = zondag, 1 = maandag, 6 = zaterdag
export const weekStartOf = (key: string, weekStart = 1) => addDays(key, -((fromKey(key).getDay() - weekStart + 7) % 7));

export function isoWeek(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('nl-NL', options);
export const monthLong = fmt({ month: 'long' });
export const monthShort = fmt({ month: 'short' });
export const weekdayShort = fmt({ weekday: 'short' });
export const weekdayNarrow = fmt({ weekday: 'narrow' });
export const dayHeading = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
export const dayHeadingYear = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const shortDate = fmt({ day: 'numeric', month: 'short', year: 'numeric' });

export const uid = () => crypto.randomUUID();
