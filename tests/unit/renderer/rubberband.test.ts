import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { boxOf, initRubberBand, intersects } from '../../../src/js/rubberband.ts';

describe('boxOf en intersects', () => {
  test('een kader kan in elke richting getrokken worden', () => {
    expect(boxOf(10, 20, 50, 80)).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
    expect(boxOf(50, 80, 10, 20)).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
  });

  test('raken telt niet, overlappen wel', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(intersects(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
    expect(intersects(a, { left: 9, top: 9, right: 20, bottom: 20 })).toBe(true);
    expect(intersects(a, { left: 2, top: 2, right: 3, bottom: 3 })).toBe(true);
    expect(intersects(a, { left: 0, top: 11, right: 10, bottom: 20 })).toBe(false);
  });
});

describe('initRubberBand', () => {
  let root: HTMLElement;
  const rects = new Map<string, DOMRect>();
  const onSelect = vi.fn();
  const onStart = vi.fn();
  const onEnd = vi.fn();
  let canStart: (e: PointerEvent) => boolean | 'exclusive';

  const rect = (left: number, top: number, w = 100, h = 20) =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;
  const fire = (target: EventTarget, type: string, x: number, y: number, extra: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    root = document.createElement('div');
    root.innerHTML = '<div id="cell"></div><button data-okey="a">A</button><button data-okey="b">B</button>';
    document.body.append(root);
    rects.set('a', rect(100, 100));
    rects.set('b', rect(100, 200));
    for (const node of root.querySelectorAll<HTMLElement>('[data-okey]')) {
      node.getBoundingClientRect = () => rects.get(node.dataset.okey!)!;
    }
    canStart = () => true;
    initRubberBand(root, { canStart: (e) => canStart(e), onSelect, onStart, onEnd });
  });
  afterEach(() => {
    fire(window, 'pointerup', 0, 0);
    document.body.replaceChildren();
  });

  const cell = () => root.querySelector('#cell')!;

  test('een kleine beweging is nog een klik: geen kader en geen selectie', () => {
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointermove', 52, 52);
    fire(window, 'pointerup', 52, 52);
    expect(onStart).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  test('slepen tekent een kader en selecteert de afspraken die erin vallen', () => {
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointermove', 150, 130);
    expect(onStart).toHaveBeenCalledTimes(1);
    const frame = document.body.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual([
      '50px',
      '50px',
      '100px',
      '80px',
    ]);
    expect(onSelect).toHaveBeenLastCalledWith(['a'], false);
    fire(window, 'pointermove', 150, 230);
    expect(onSelect).toHaveBeenLastCalledWith(['a', 'b'], false);
    fire(window, 'pointermove', 60, 60); // weer kleiner: b valt eruit
    expect(onSelect).toHaveBeenLastCalledWith([], false);
  });

  test('loslaten ruimt het kader op en meldt het einde; de klik erna wordt tegengehouden', () => {
    const clicks = vi.fn();
    root.addEventListener('click', clicks);
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointermove', 150, 130);
    fire(window, 'pointerup', 150, 130);
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(root.classList.contains('select-none')).toBe(false);
    cell().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).not.toHaveBeenCalled();
  });

  test('een gewone klik zonder slepen blijft doorkomen', async () => {
    const clicks = vi.fn();
    root.addEventListener('click', clicks);
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointerup', 50, 50);
    cell().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  test('met ⌘ (of Ctrl) meldt het kader standaard dat het opgeteld moet worden; ⇧ alleen niet', () => {
    fire(cell(), 'pointerdown', 50, 50, { button: 0, shiftKey: true });
    fire(window, 'pointermove', 150, 130);
    expect(onSelect).toHaveBeenLastCalledWith(['a'], false);
    fire(window, 'pointerup', 150, 130);
    fire(cell(), 'pointerdown', 50, 50, { button: 0, metaKey: true });
    fire(window, 'pointermove', 150, 130);
    expect(onSelect).toHaveBeenLastCalledWith(['a'], true);
    fire(window, 'pointerup', 150, 130);
    fire(cell(), 'pointerdown', 50, 50, { button: 0, ctrlKey: true });
    fire(window, 'pointermove', 150, 130);
    expect(onSelect).toHaveBeenLastCalledWith(['a'], true);
  });

  test('de aanroeper kan zelf bepalen wat "aanvullen" is', () => {
    fire(window, 'pointerup', 0, 0);
    document.body.replaceChildren();
    root = document.createElement('div');
    root.innerHTML = '<div id="cell"></div><button data-okey="a">A</button>';
    document.body.append(root);
    const only = root.querySelector<HTMLElement>('[data-okey]')!;
    only.getBoundingClientRect = () => rect(100, 100);
    initRubberBand(root, { canStart: () => true, onSelect, isAdditive: (e) => e.altKey });
    fire(root.querySelector('#cell')!, 'pointerdown', 50, 50, { button: 0, altKey: true });
    fire(window, 'pointermove', 150, 130);
    expect(onSelect).toHaveBeenLastCalledWith(['a'], true);
  });

  test('alleen de linkermuisknop, en alleen als canStart het toestaat', () => {
    fire(cell(), 'pointerdown', 50, 50, { button: 2 });
    fire(window, 'pointermove', 150, 130);
    expect(onStart).not.toHaveBeenCalled();
    canStart = () => false;
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointermove', 150, 130);
    expect(onStart).not.toHaveBeenCalled();
  });

  test('"exclusive" houdt het pointerdown van andere handlers (nieuwe afspraak slepen) tegen', () => {
    const other = vi.fn();
    cell().addEventListener('pointerdown', other);
    canStart = () => 'exclusive';
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    expect(other).not.toHaveBeenCalled();
    canStart = () => true;
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointerup', 50, 50);
    expect(other).toHaveBeenCalledTimes(1);
  });

  test('na het loslaten volgt de selectie de muis niet meer', () => {
    fire(cell(), 'pointerdown', 50, 50, { button: 0 });
    fire(window, 'pointermove', 150, 130);
    fire(window, 'pointerup', 150, 130);
    onSelect.mockClear();
    fire(window, 'pointermove', 400, 400);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
