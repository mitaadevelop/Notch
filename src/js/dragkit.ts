// hulpmiddelen voor slepen: een label naast de cursor en automatisch scrollen aan de rand van een lijst
import { el, fromKey } from './util.ts';

const dayShort = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });

// "wo 28 okt"
export const dayLabel = (key: string) => dayShort.format(fromKey(key));

let label: HTMLElement | null = null;

// toont een klein label naast de cursor (bijv. "wo 28 okt · 10:15–11:15") tijdens het slepen
export function showDragLabel(clientX: number, clientY: number, text: string) {
  if (!label) {
    label = el(
      'div',
      'pointer-events-none fixed z-50 rounded-md bg-fg px-2 py-1 text-xs font-medium whitespace-nowrap text-canvas tabular-nums shadow-lg',
    );
    label.id = 'drag-label';
    label.setAttribute('aria-hidden', 'true');
    document.body.append(label);
  }
  label.textContent = text;
  // rechts onder de cursor, maar binnen het venster houden
  const width = label.offsetWidth;
  const height = label.offsetHeight;
  label.style.left = `${Math.max(4, Math.min(clientX + 14, innerWidth - width - 4))}px`;
  label.style.top = `${Math.max(4, Math.min(clientY + 14, innerHeight - height - 4))}px`;
}

export function hideDragLabel() {
  label?.remove();
  label = null;
}

// "45 min", "1 u", "1 u 15 min"
export function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} u` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

const EDGE = 48; // px vanaf de rand waar het scrollen begint
const MAX_SPEED = 24; // px per beeld

// Scrolt `scroller` zolang de cursor bij de boven- of onderrand is; roept `onScroll` aan zodat de sleepactie meebeweegt.
export function createAutoScroll(scroller: HTMLElement, onScroll: () => void) {
  let speed = 0;
  let frame = 0;

  const tick = () => {
    if (!speed) {
      frame = 0;
      return;
    }
    const before = scroller.scrollTop;
    scroller.scrollTop += speed;
    if (scroller.scrollTop !== before) onScroll();
    frame = requestAnimationFrame(tick);
  };

  return {
    update(clientY: number) {
      const rect = scroller.getBoundingClientRect();
      const up = rect.top + EDGE - clientY;
      const down = clientY - (rect.bottom - EDGE);
      const raw = up > 0 ? -up / 3 : down > 0 ? down / 3 : 0;
      speed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, Math.round(raw)));
      if (speed && !frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      speed = 0;
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
