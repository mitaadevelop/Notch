// Het weer per dag via Open-Meteo (gratis, zonder sleutel). Draait in main: de pagina heeft geen netwerktoegang.
// Er gaat alleen een plaatsnaam (zoeken) of een lengte- en breedtegraad (voorspelling) naar buiten.
import type { DayWeather, GeoPlace } from './shared/types.ts';
import { request } from './net.ts';

export const GEO_BASE = 'https://geocoding-api.open-meteo.com';
export const FORECAST_BASE = 'https://api.open-meteo.com';

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function validCoordinates(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    Number.isFinite(lat + lon)
  );
}

async function getJson(url: URL): Promise<unknown> {
  const { status, text } = await request(url, { headers: { Accept: 'application/json' } });
  if (status === 429) throw new Error('Te veel verzoeken aan de weerdienst; probeer het later opnieuw.');
  if (status < 200 || status >= 300) throw new Error(`De weerdienst gaf een fout (${status}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('De weerdienst gaf een onleesbaar antwoord.');
  }
}

/** Zoekt een plaats op naam; geeft de beste treffer. */
export async function geocode(name: unknown, base = GEO_BASE): Promise<GeoPlace> {
  const query = typeof name === 'string' ? name.trim() : '';
  if (query.length < 2 || query.length > 100) throw new Error('Typ de naam van een plaats (minstens twee letters).');
  const url = new URL('/v1/search', base);
  url.search = new URLSearchParams({ name: query, count: '1', language: 'nl', format: 'json' }).toString();
  const body = (await getJson(url)) as { results?: Record<string, unknown>[] };
  const hit = Array.isArray(body?.results) ? body.results[0] : undefined;
  const lat = num(hit?.latitude);
  const lon = num(hit?.longitude);
  if (!hit || lat === null || lon === null || !validCoordinates(lat, lon))
    throw new Error(`Geen plaats gevonden met de naam “${query}”.`);
  const label = [hit.name, hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : '', hit.country]
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join(', ');
  return { city: label.slice(0, 120), lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
}

/** De voorspelling voor de komende dagen. */
export async function fetchForecast(lat: unknown, lon: unknown, base = FORECAST_BASE): Promise<DayWeather[]> {
  if (!validCoordinates(lat, lon)) throw new Error('Ongeldige locatie.');
  const url = new URL('/v1/forecast', base);
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '14',
  }).toString();
  const body = (await getJson(url)) as { daily?: Record<string, unknown[]> };
  const daily = body?.daily;
  const dates = Array.isArray(daily?.time) ? daily.time : [];
  const days: DayWeather[] = [];
  dates.forEach((date, i) => {
    const max = num(daily?.temperature_2m_max?.[i]);
    const min = num(daily?.temperature_2m_min?.[i]);
    const code = num(daily?.weather_code?.[i]);
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || max === null || min === null || code === null)
      return;
    days.push({
      date,
      code: Math.round(code),
      max: Math.round(max),
      min: Math.round(min),
      rain: Math.min(100, Math.max(0, Math.round(num(daily?.precipitation_probability_max?.[i]) ?? 0))),
    });
  });
  if (!days.length) throw new Error('De weerdienst gaf geen voorspelling terug.');
  return days;
}
