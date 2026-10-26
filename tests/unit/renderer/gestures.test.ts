import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSwipeDetector, createZoomAccumulator } from '../../../src/js/gestures.ts';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
});
afterEach(() => vi.useRealTimers());

describe('veeg-detectie', () => {
  test('een veeg die ver genoeg gaat geeft één stap, en daarna blijft het vergrendeld tot het stil is', () => {
    const onSwipe = vi.fn();
    const swipe = createSwipeDetector(onSwipe);
    // een echte veeg: veel events, ook tijdens het uitrollen
    for (let i = 0; i < 40; i++) {
      swipe.handle(12, 1);
      vi.advanceTimersByTime(16);
    }
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  test('na een korte stilte werkt de volgende veeg weer, ook in de andere richting', () => {
    const onSwipe = vi.fn();
    const swipe = createSwipeDetector(onSwipe);
    swipe.handle(100, 0);
    vi.advanceTimersByTime(200);
    swipe.handle(-100, 0);
    expect(onSwipe.mock.calls).toEqual([[1], [-1]]);
  });

  test('een kleine beweging onder de drempel doet niets en vervalt na een stilte', () => {
    const onSwipe = vi.fn();
    const swipe = createSwipeDetector(onSwipe, { threshold: 80 });
    swipe.handle(30, 0);
    swipe.handle(30, 0);
    vi.advanceTimersByTime(300);
    swipe.handle(30, 0); // begint opnieuw bij nul
    expect(onSwipe).not.toHaveBeenCalled();
    swipe.handle(60, 0);
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  test('verticaal scrollen telt niet mee en wordt niet geclaimd', () => {
    const onSwipe = vi.fn();
    const swipe = createSwipeDetector(onSwipe);
    expect(swipe.handle(5, 120)).toBe(false);
    expect(swipe.handle(120, 120)).toBe(false); // diagonaal: verticaal wint bij gelijkspel
    expect(onSwipe).not.toHaveBeenCalled();
  });

  test('horizontaal wordt wel geclaimd, ook tijdens de vergrendeling', () => {
    const swipe = createSwipeDetector(() => {});
    expect(swipe.handle(100, 0)).toBe(true);
    expect(swipe.handle(10, 0)).toBe(true);
  });

  test('een veeg die in tegengestelde richtingen schommelt, telt per saldo', () => {
    const onSwipe = vi.fn();
    const swipe = createSwipeDetector(onSwipe, { threshold: 80 });
    swipe.handle(50, 0);
    swipe.handle(-40, 0);
    swipe.handle(50, 0);
    expect(onSwipe).not.toHaveBeenCalled(); // netto 60
    swipe.handle(30, 0);
    expect(onSwipe).toHaveBeenCalledWith(1);
  });
});

describe('knijpen', () => {
  test('verzamelt events tot het volgende beeld en geeft één totale factor door', () => {
    const apply = vi.fn();
    const pinch = createZoomAccumulator(apply);
    pinch.add(-10, 300); // uitzoomen is positief, inzoomen negatief
    pinch.add(-10, 310);
    pinch.add(-10, 320);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(apply).toHaveBeenCalledTimes(1);
    const [factor, y] = apply.mock.calls[0];
    expect(factor).toBeCloseTo(Math.exp(0.3), 5);
    expect(y).toBe(320);
  });

  test('uitzoomen geeft een factor onder de één, en elk beeld begint opnieuw', () => {
    const apply = vi.fn();
    const pinch = createZoomAccumulator(apply);
    pinch.add(50, 100);
    vi.advanceTimersByTime(20);
    pinch.add(-50, 200);
    vi.advanceTimersByTime(20);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0][0]).toBeLessThan(1);
    expect(apply.mock.calls[1][0]).toBeGreaterThan(1);
  });
});
