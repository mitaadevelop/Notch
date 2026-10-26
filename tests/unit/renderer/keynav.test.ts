import { describe, expect, test } from 'vitest';
import { nearestInDirection } from '../../../src/js/keynav.ts';
import type { Box } from '../../../src/js/keynav.ts';

const box = (left: number, top: number, w = 100, h = 20): Box => ({ left, top, right: left + w, bottom: top + h });

describe('nearestInDirection', () => {
  // een raster: drie dagen naast elkaar, in twee rijen
  const grid = [
    { key: 'a1', box: box(0, 0) },
    { key: 'a2', box: box(150, 0) },
    { key: 'a3', box: box(300, 0) },
    { key: 'b1', box: box(0, 100) },
    { key: 'b2', box: box(150, 100) },
  ];
  const others = (self: string) => grid.filter((c) => c.key !== self);

  test('rechts en links nemen de buurman op dezelfde rij', () => {
    expect(nearestInDirection(grid[0].box, others('a1'), 'right')).toBe('a2');
    expect(nearestInDirection(grid[1].box, others('a2'), 'right')).toBe('a3');
    expect(nearestInDirection(grid[1].box, others('a2'), 'left')).toBe('a1');
  });

  test('omhoog en omlaag nemen de afspraak in dezelfde kolom', () => {
    expect(nearestInDirection(grid[1].box, others('a2'), 'down')).toBe('b2');
    expect(nearestInDirection(grid[4].box, others('b2'), 'up')).toBe('a2');
  });

  test('liever dezelfde rij dan een diagonale buur die dichterbij lijkt', () => {
    const items = [
      { key: 'zelfde-rij-ver', box: box(200, 0) },
      { key: 'andere-rij-dichtbij', box: box(110, 80) },
    ];
    expect(nearestInDirection(box(0, 0), items, 'right')).toBe('zelfde-rij-ver');
  });

  test('geeft null als er niets in die richting ligt', () => {
    expect(nearestInDirection(grid[0].box, others('a1'), 'left')).toBeNull();
    expect(nearestInDirection(grid[0].box, others('a1'), 'up')).toBeNull();
    expect(nearestInDirection(grid[2].box, others('a3'), 'right')).toBeNull();
  });

  test('zonder kandidaten of op dezelfde plek gebeurt er niets', () => {
    expect(nearestInDirection(box(0, 0), [], 'down')).toBeNull();
    expect(nearestInDirection(box(0, 0), [{ key: 'zelf', box: box(0, 0) }], 'down')).toBeNull();
  });

  test('gestapelde afspraken in één dag: omlaag gaat naar de volgende', () => {
    const stack = [
      { key: 'x1', box: box(0, 0) },
      { key: 'x2', box: box(0, 24) },
      { key: 'x3', box: box(0, 48) },
    ];
    expect(nearestInDirection(stack[0].box, stack.slice(1), 'down')).toBe('x2');
    expect(nearestInDirection(stack[2].box, stack.slice(0, 2), 'up')).toBe('x2');
  });
});
