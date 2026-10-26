// pijltjesbesturing door de afspraken: welke afspraak ligt het dichtst bij, in de gevraagde richting?
export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const center = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

// Kiest uit `candidates` de afspraak die het best bij de richting past: vooral in die richting dichtbij, en liefst op
// dezelfde rij of kolom (de afwijking zijwaarts telt dubbel). Geeft null als er niets in die richting ligt.
export function nearestInDirection(from: Box, candidates: { key: string; box: Box }[], direction: Direction) {
  const origin = center(from);
  let best: { key: string; score: number } | null = null;
  for (const { key, box } of candidates) {
    const c = center(box);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const horizontal = direction === 'left' || direction === 'right';
    const along = horizontal ? (direction === 'right' ? dx : -dx) : direction === 'down' ? dy : -dy;
    if (along <= 1) continue; // niet in die richting (of dezelfde plek)
    const across = Math.abs(horizontal ? dy : dx);
    const score = along + 2 * across;
    if (!best || score < best.score) best = { key, score };
  }
  return best?.key ?? null;
}
