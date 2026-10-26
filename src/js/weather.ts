// Het weer per dag: ophalen via main (Open-Meteo), onthouden, en een klein blokje bij de dagen in de weergaven
import type { DayWeather } from '../shared/types.ts';
import { data, hooks } from './state.ts';
import * as store from './store.ts';
import { $, el } from './util.ts';

const STALE_MS = 30 * 60_000;

// WMO-weercode -> icoon en omschrijving
export function describeWeather(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'helder' };
  if (code <= 2) return { icon: '🌤️', label: 'half bewolkt' };
  if (code === 3) return { icon: '☁️', label: 'bewolkt' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'mist' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'motregen' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'regen' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: 'sneeuw' };
  if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'buien' };
  if (code === 85 || code === 86) return { icon: '🌨️', label: 'sneeuwbuien' };
  if (code >= 95) return { icon: '⛈️', label: 'onweer' };
  return { icon: '☁️', label: 'wisselend' };
}

let days = new Map<string, DayWeather>();
let loadedFor = '';
let loadedAt = 0;
let loading: Promise<void> | null = null;

const placeKey = () => (data.settings.weather ? `${data.settings.weather.lat},${data.settings.weather.lon}` : '');

export const weatherFor = (date: string) => (placeKey() ? days.get(date) : undefined);

/** Haalt de voorspelling op als die ontbreekt of verouderd is (of `force`). Fouten maken het weer stil niet zichtbaar. */
export function loadWeather(force = false, now = Date.now()): Promise<void> {
  const place = data.settings.weather;
  if (!place) {
    if (days.size) {
      days = new Map();
      hooks.render();
    }
    loadedFor = '';
    return Promise.resolve();
  }
  if (!force && loadedFor === placeKey() && now - loadedAt < STALE_MS) return Promise.resolve();
  if (loading) return loading;
  const key = placeKey();
  loading = window.agenda
    .getForecast(place.lat, place.lon)
    .then((list) => {
      if (placeKey() !== key) return; // intussen een andere plaats gekozen
      days = new Map(list.map((d) => [d.date, d]));
      loadedFor = key;
      loadedAt = now;
      hooks.render();
    })
    .catch(() => {
      // geen internet of de dienst ligt eruit: de agenda werkt gewoon zonder weer
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Een klein blokje (icoon en temperaturen) voor een dag, of null als er geen weer is. */
export function weatherBadge(date: string, className = ''): HTMLElement | null {
  const w = weatherFor(date);
  if (!w) return null;
  const { icon, label } = describeWeather(w.code);
  const badge = el('span', `shrink-0 text-[10px] whitespace-nowrap text-muted tabular-nums ${className}`);
  badge.append(`${icon} ${w.max}°`);
  badge.title = `${label}, ${w.max}° / ${w.min}°, ${w.rain}% kans op neerslag`;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', `Weer: ${label}, ${w.max} graden, ${w.rain} procent kans op neerslag`);
  return badge;
}

// --- voorkeuren ---

const f = {
  city: $<HTMLInputElement>('s-wx-city'),
  search: $<HTMLButtonElement>('s-wx-search'),
  off: $<HTMLButtonElement>('s-wx-off'),
  status: $('s-wx-status'),
};

export function showWeatherSettings() {
  const place = data.settings.weather;
  f.city.value = place?.city ?? '';
  f.status.textContent = place ? `Weer voor ${place.city}.` : 'Het weer staat uit.';
}

export function initWeather() {
  const search = async () => {
    const name = f.city.value.trim();
    if (name.length < 2) {
      f.status.textContent = 'Typ de naam van een plaats.';
      return;
    }
    f.search.disabled = true;
    f.status.textContent = 'Zoeken…';
    try {
      const place = await window.agenda.geocode(name);
      store.updateSettings({ weather: place });
      f.city.value = place.city;
      f.status.textContent = `Weer voor ${place.city}.`;
      void loadWeather(true);
    } catch (error) {
      f.status.textContent = (error instanceof Error ? error.message : String(error)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
    } finally {
      f.search.disabled = false;
    }
  };
  f.search.addEventListener('click', () => void search());
  f.city.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void search();
    }
  });
  f.off.addEventListener('click', () => {
    store.updateSettings({ weather: null });
    showWeatherSettings();
    void loadWeather();
  });
}
