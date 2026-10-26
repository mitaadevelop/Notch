import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DURATION, EASE, enterView, initDialogOrigin, play, reduceMotion, staggerIn } from '../../../src/js/motion.ts';

interface Call {
  node: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}
let calls: Call[];
let reduced: boolean;

beforeEach(() => {
  calls = [];
  reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce') }));
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ node: this, keyframes, options });
    return { finished: Promise.resolve() } as unknown as Animation;
  } as never;
  document.body.replaceChildren();
});
afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error nepversie opruimen
  delete Element.prototype.animate;
});

describe('reduceMotion en play', () => {
  test('volgt de systeeminstelling, en is veilig zonder matchMedia', () => {
    expect(reduceMotion()).toBe(false);
    reduced = true;
    expect(reduceMotion()).toBe(true);
    vi.stubGlobal('matchMedia', undefined);
    expect(reduceMotion()).toBe(false);
  });

  test('play animeert, tenzij minder beweging gevraagd is of animate ontbreekt', async () => {
    const node = document.createElement('div');
    await play(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 10 });
    expect(calls).toHaveLength(1);
    reduced = true;
    await play(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 10 });
    expect(calls).toHaveLength(1);
    reduced = false;
    // @ts-expect-error zonder Web Animations
    delete Element.prototype.animate;
    await expect(play(node, [], {})).resolves.toBeUndefined();
  });

  test('een onderbroken animatie is geen fout', async () => {
    Element.prototype.animate = (() => ({ finished: Promise.reject(new DOMException('afgebroken')) })) as never;
    await expect(play(document.createElement('div'), [], {})).resolves.toBeUndefined();
  });

  test('de veer is een linear()-curve en de duren lopen op', () => {
    expect(EASE.spring.startsWith('linear(')).toBe(true);
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThan(DURATION.slow);
  });
});

describe('staggerIn', () => {
  const chips = (n: number) => {
    const root = document.createElement('div');
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.dataset.okey = String(i);
      root.append(c);
    }
    document.body.append(root);
    return root;
  };

  test('elke afspraak komt iets later binnen dan de vorige, met vulling vooraf', () => {
    staggerIn(chips(4));
    expect(calls.map((c) => c.options.delay)).toEqual([0, 14, 28, 42]);
    expect(calls.every((c) => c.options.fill === 'backwards')).toBe(true);
  });

  test('de totale vertraging blijft begrensd, ook bij veel afspraken', () => {
    staggerIn(chips(200));
    expect(calls).toHaveLength(48);
    expect(Math.max(...calls.map((c) => c.options.delay as number))).toBeLessThan(700);
  });

  test('niets bij minder beweging, en een lege weergave geeft geen fout', () => {
    reduced = true;
    staggerIn(chips(3));
    expect(calls).toEqual([]);
    reduced = false;
    expect(() => staggerIn(chips(0))).not.toThrow();
  });
});

describe('enterView', () => {
  test.each([
    [{ direction: 1 }, 'translateX(16px)'],
    [{ direction: -1 }, 'translateX(-16px)'],
    [{ zoom: 1 }, 'scale(1.035)'],
    [{ zoom: -1 }, 'scale(0.965)'],
    [{}, 'translateY(6px)'],
  ])('%j begint op %s', (opts, from) => {
    void enterView(document.createElement('div'), opts);
    expect(calls[0].keyframes[0]).toMatchObject({ opacity: 0, transform: from });
    expect(calls[0].keyframes[1]).toMatchObject({ opacity: 1, transform: 'none' });
  });
});

describe('initDialogOrigin', () => {
  test('een dialoog die na een klik opent groeit vanuit die plek, anders vanuit het midden', async () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 300 }) as DOMRect;
    initDialogOrigin();
    window.dispatchEvent(new MouseEvent('pointerdown', { clientX: 150, clientY: 80 }));
    dialog.setAttribute('open', '');
    await new Promise((r) => setTimeout(r, 0));
    expect(dialog.style.transformOrigin).toBe('50px 30px');

    dialog.removeAttribute('open');
    await new Promise((r) => setTimeout(r, 0));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000); // lang geleden geklikt: dus met het toetsenbord geopend
    dialog.setAttribute('open', '');
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    expect(dialog.style.transformOrigin).toBe('');
  });
});
