import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createAutoScroll, dayLabel, durationLabel, hideDragLabel, showDragLabel } from '../../../src/js/dragkit.ts';

afterEach(() => {
  hideDragLabel();
  vi.useRealTimers();
});

describe('sleeplabel', () => {
  test('toont één label met de tekst en verplaatst het mee', () => {
    showDragLabel(100, 200, 'wo 28 okt · 10:00–11:00');
    const label = document.getElementById('drag-label')!;
    expect(label).toHaveTextContent('wo 28 okt · 10:00–11:00');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(label.style.left).toBe('114px');
    expect(label.style.top).toBe('214px');

    showDragLabel(300, 50, 'tekst');
    expect(document.querySelectorAll('#drag-label')).toHaveLength(1);
    expect(label).toHaveTextContent('tekst');
    expect(label.style.left).toBe('314px');
  });

  test('blijft binnen het venster, ook in de hoeken', () => {
    showDragLabel(innerWidth + 500, innerHeight + 500, 'x');
    const label = document.getElementById('drag-label')!;
    expect(parseFloat(label.style.left)).toBeLessThanOrEqual(innerWidth);
    expect(parseFloat(label.style.top)).toBeLessThanOrEqual(innerHeight);
    showDragLabel(-100, -100, 'x');
    expect(parseFloat(label.style.left)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(label.style.top)).toBeGreaterThanOrEqual(4);
  });

  test('verbergen haalt het uit de pagina en is veilig als er geen is', () => {
    hideDragLabel();
    showDragLabel(1, 1, 'x');
    hideDragLabel();
    hideDragLabel();
    expect(document.getElementById('drag-label')).toBeNull();
  });
});

describe('opmaak', () => {
  test.each([
    [0, '0 min'],
    [15, '15 min'],
    [60, '1 u'],
    [75, '1 u 15 min'],
    [150, '2 u 30 min'],
  ])('%i minuten -> %s', (minutes, text) => {
    expect(durationLabel(minutes)).toBe(text);
  });

  test('dayLabel is kort Nederlands', () => {
    expect(dayLabel('2026-10-28')).toBe('wo 28 okt');
    expect(dayLabel('2026-01-01')).toBe('do 1 jan');
  });
});

describe('automatisch scrollen', () => {
  let scroller: HTMLElement;
  let onScroll: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    scroller = document.createElement('div');
    scroller.getBoundingClientRect = () =>
      ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400 }) as DOMRect;
    // jsdom scrolt niet echt: een gewone eigenschap volstaat
    let top = 1000;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => (top = Math.max(0, v)),
    });
    onScroll = vi.fn<() => void>();
  });

  test('onderaan scrollt omlaag en meldt elke stap', () => {
    const auto = createAutoScroll(scroller, onScroll);
    auto.update(495);
    vi.advanceTimersByTime(16 * 5);
    expect(scroller.scrollTop).toBeGreaterThan(1000);
    expect(onScroll.mock.calls.length).toBeGreaterThanOrEqual(4);
    auto.stop();
  });

  test('bovenaan scrollt omhoog, en sneller naarmate de cursor dichter bij de rand komt', () => {
    const slow = createAutoScroll(scroller, onScroll);
    slow.update(110);
    vi.advanceTimersByTime(16 * 3);
    const slowDistance = 1000 - scroller.scrollTop;
    slow.stop();

    (scroller as unknown as { scrollTop: number }).scrollTop = 1000;
    const fast = createAutoScroll(scroller, onScroll);
    fast.update(90);
    vi.advanceTimersByTime(16 * 3);
    const fastDistance = 1000 - scroller.scrollTop;
    fast.stop();
    expect(slowDistance).toBeGreaterThan(0);
    expect(fastDistance).toBeGreaterThan(slowDistance);
  });

  test('in het midden gebeurt er niets', () => {
    const auto = createAutoScroll(scroller, onScroll);
    auto.update(300);
    vi.advanceTimersByTime(16 * 10);
    expect(scroller.scrollTop).toBe(1000);
    expect(onScroll).not.toHaveBeenCalled();
  });

  test('stoppen houdt het scrollen meteen op', () => {
    const auto = createAutoScroll(scroller, onScroll);
    auto.update(499);
    vi.advanceTimersByTime(16 * 2);
    auto.stop();
    const stopped = scroller.scrollTop;
    vi.advanceTimersByTime(16 * 10);
    expect(scroller.scrollTop).toBe(stopped);
  });

  test('de snelheid heeft een maximum', () => {
    const auto = createAutoScroll(scroller, onScroll);
    auto.update(100000);
    vi.advanceTimersByTime(16);
    expect(scroller.scrollTop - 1000).toBeLessThanOrEqual(24);
    auto.stop();
  });

  test('aan het einde van de lijst (geen verandering) wordt er niet doorgemeld', () => {
    Object.defineProperty(scroller, 'scrollTop', { get: () => 0, set: () => {} });
    const auto = createAutoScroll(scroller, onScroll);
    auto.update(105);
    vi.advanceTimersByTime(16 * 5);
    expect(onScroll).not.toHaveBeenCalled();
    auto.stop();
  });
});
