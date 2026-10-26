// Laat afspraken bij een wijziging naar hun nieuwe plek glijden (FLIP): meet vóór het tekenen, teken, en animeer van oud naar nieuw.
// Nieuwe afspraken verschijnen met een zachte pop, verwijderde vervagen. Anders dan View Transitions blijft de pagina
// tijdens de animatie gewoon bedienbaar: klikken en slepen gaan er niet door verloren.

import { DURATION, EASE } from './motion.ts';

const MOVE_MS = 240;
// korte verplaatsingen krijgen een kleine veer (een zachte "landing"), lange glijden rustig
const SPRING_UNDER_PX = 220;

interface Before {
  rect: DOMRect;
  copy: HTMLElement;
}

const named = (root: ParentNode) => root.querySelectorAll<HTMLElement>('[data-flip]');

// Voert `draw` uit en animeert de afspraken in `root` van hun oude naar hun nieuwe plek.
export function drawWithFlip(root: HTMLElement, draw: () => void, animate = true) {
  if (!animate || typeof root.animate !== 'function') return draw();

  const before = new Map<string, Before>();
  for (const node of named(root))
    before.set(node.dataset.flip!, { rect: node.getBoundingClientRect(), copy: ghostOf(node) });

  draw();

  const seen = new Set<string>();
  for (const node of named(root)) {
    const name = node.dataset.flip!;
    seen.add(name);
    const old = before.get(name);
    if (!old) {
      node.animate(
        [
          { opacity: 0, transform: 'scale(0.9)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: DURATION.slow, easing: EASE.spring },
      );
      continue;
    }
    const now = node.getBoundingClientRect();
    const dx = old.rect.left - now.left;
    const dy = old.rect.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const short = Math.hypot(dx, dy) < SPRING_UNDER_PX;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: short ? DURATION.slow : MOVE_MS,
      easing: short ? EASE.spring : EASE.out,
    });
  }

  // verdwenen afspraken: een kopie op de oude plek die vervaagt
  for (const [name, { rect, copy }] of before) {
    if (seen.has(name)) continue;
    copy.style.left = `${rect.left}px`;
    copy.style.top = `${rect.top}px`;
    copy.style.width = `${rect.width}px`;
    copy.style.height = `${rect.height}px`;
    document.body.append(copy);
    const fade = copy.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.8)' },
      ],
      { duration: DURATION.fast, easing: EASE.in, fill: 'forwards' },
    );
    fade.onfinish = () => copy.remove();
    fade.oncancel = () => copy.remove();
  }
}

// een niet-klikbare, onzichtbare-voor-hulpmiddelen kopie voor de verdwijn-animatie
function ghostOf(node: HTMLElement): HTMLElement {
  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('[data-okey], [data-flip], [id]')]) {
    delete el.dataset.okey;
    delete el.dataset.flip;
    el.removeAttribute('id');
  }
  copy.className += ' pointer-events-none fixed z-40 m-0';
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('draggable');
  copy.style.transform = '';
  return copy;
}
