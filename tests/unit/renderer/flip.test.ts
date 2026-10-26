import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { drawWithFlip } from '../../../src/js/flip.ts';

interface Call {
  node: HTMLElement;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  finish: () => void;
}

let calls: Call[];
let rects: Map<string, { left: number; top: number; width?: number; height?: number }>;
let root: HTMLElement;

const rectOf = (name: string) => {
  const r = rects.get(name) ?? { left: 0, top: 0 };
  return { left: r.left, top: r.top, width: r.width ?? 100, height: r.height ?? 20 } as DOMRect;
};

beforeEach(() => {
  calls = [];
  rects = new Map();
  root = document.createElement('div');
  document.body.append(root);
  // jsdom heeft geen Web Animations: een nepversie die bijhoudt wat er geanimeerd wordt
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const animation = { onfinish: null as null | (() => void), oncancel: null } as unknown as Animation;
    calls.push({ node: this, keyframes, options, finish: () => (animation.onfinish as unknown as () => void)?.() });
    return animation;
  } as never;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return rectOf(this.dataset.flip ?? '');
  };
});

afterEach(() => {
  root.remove();
  document.body.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  // @ts-expect-error opruimen van de nepversie
  delete HTMLElement.prototype.animate;
  vi.restoreAllMocks();
});

const chip = (name: string, text = name) => {
  const node = document.createElement('button');
  node.dataset.flip = name;
  node.dataset.okey = name;
  node.id = `id-${name}`;
  node.draggable = true;
  node.textContent = text;
  return node;
};

describe('drawWithFlip', () => {
  test('een verplaatste afspraak schuift van zijn oude naar zijn nieuwe plek', () => {
    root.append(chip('a'));
    rects.set('a', { left: 100, top: 50 });
    drawWithFlip(root, () => {
      root.replaceChildren(chip('a'));
      rects.set('a', { left: 300, top: 80 });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes).toEqual([{ transform: 'translate(-200px, -30px)' }, { transform: 'none' }]);
    expect(calls[0].options.duration).toBe(320);
    expect(calls[0].options.easing).toContain('linear('); // korte verplaatsing: een kleine veer
  });

  test('een lange verplaatsing glijdt rustig zonder veer', () => {
    root.append(chip('a'));
    rects.set('a', { left: 0, top: 0 });
    drawWithFlip(root, () => {
      root.replaceChildren(chip('a'));
      rects.set('a', { left: 600, top: 0 });
    });
    expect(calls[0].options.duration).toBe(240);
    expect(calls[0].options.easing).not.toContain('linear(');
  });

  test('een afspraak die niet verschuift wordt niet geanimeerd', () => {
    root.append(chip('a'));
    rects.set('a', { left: 100, top: 50 });
    drawWithFlip(root, () => root.replaceChildren(chip('a')));
    expect(calls).toEqual([]);
  });

  test('een verschuiving van minder dan een pixel telt niet', () => {
    root.append(chip('a'));
    rects.set('a', { left: 100, top: 50 });
    drawWithFlip(root, () => {
      root.replaceChildren(chip('a'));
      rects.set('a', { left: 100.4, top: 50.3 });
    });
    expect(calls).toEqual([]);
  });

  test('een nieuwe afspraak verschijnt met een pop', () => {
    drawWithFlip(root, () => root.append(chip('nieuw')));
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes[0]).toMatchObject({ opacity: 0 });
    expect(calls[0].keyframes[1]).toMatchObject({ opacity: 1, transform: 'none' });
    expect(calls[0].options.easing).toContain('linear('); // landt met een veer
  });

  test('een verdwenen afspraak laat een niet-klikbare kopie vervagen en ruimt die daarna op', () => {
    root.append(chip('weg', 'Tandarts'));
    rects.set('weg', { left: 40, top: 60, width: 120, height: 24 });
    drawWithFlip(root, () => root.replaceChildren());

    const ghost = document.body.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(ghost).toHaveTextContent('Tandarts');
    expect(ghost.dataset.okey).toBeUndefined(); // telt niet mee als echte afspraak
    expect(ghost.dataset.flip).toBeUndefined();
    expect(ghost.id).toBe('');
    expect(ghost.hasAttribute('draggable')).toBe(false);
    expect(ghost.className).toContain('pointer-events-none');
    expect([ghost.style.left, ghost.style.top, ghost.style.width, ghost.style.height]).toEqual([
      '40px',
      '60px',
      '120px',
      '24px',
    ]);

    expect(calls[0].keyframes[1]).toMatchObject({ opacity: 0, transform: 'scale(0.8)' }); // krimpt weg
    calls[0].finish();
    expect(document.body.contains(ghost)).toBe(false);
  });

  test("de kopie van een verdwenen afspraak neemt ook geneste id's en sleutels weg", () => {
    const parent = chip('p');
    const inner = chip('kind');
    parent.append(inner);
    root.append(parent);
    drawWithFlip(root, () => root.replaceChildren());
    const ghost = document.body.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(ghost.querySelectorAll('[data-okey], [data-flip], [id]')).toHaveLength(0);
  });

  test('zonder animatie (beweging verminderen) wordt alleen getekend', () => {
    root.append(chip('a'));
    const draw = vi.fn(() => root.replaceChildren(chip('b')));
    drawWithFlip(root, draw, false);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  test('zonder Web Animations-ondersteuning wordt er gewoon getekend', () => {
    // @ts-expect-error nepversie weghalen
    delete HTMLElement.prototype.animate;
    const draw = vi.fn();
    drawWithFlip(root, draw);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  test('meerdere afspraken tegelijk: elk glijdt op zijn eigen manier', () => {
    root.append(chip('a'), chip('b'));
    rects.set('a', { left: 0, top: 0 });
    rects.set('b', { left: 0, top: 100 });
    drawWithFlip(root, () => {
      root.replaceChildren(chip('b'), chip('a'));
      rects.set('a', { left: 0, top: 100 });
      rects.set('b', { left: 0, top: 0 });
    });
    const byName = Object.fromEntries(calls.map((c) => [c.node.dataset.flip, c.keyframes[0].transform]));
    expect(byName).toEqual({ a: 'translate(0px, -100px)', b: 'translate(0px, 100px)' });
  });
});
