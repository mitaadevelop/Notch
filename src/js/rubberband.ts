// Met ⇧ ingedrukt een kader trekken om meerdere afspraken tegelijk te selecteren. Zonder ⇧ maakt slepen op een lege plek
// een nieuwe (meerdaagse) afspraak. ⇧⌘ erbij telt het kader op bij de huidige selectie.
const THRESHOLD = 5; // pas vanaf zoveel pixels is het een kader, anders blijft het een gewone klik

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxOf = (x1: number, y1: number, x2: number, y2: number): Box => ({
  left: Math.min(x1, x2),
  top: Math.min(y1, y2),
  right: Math.max(x1, x2),
  bottom: Math.max(y1, y2),
});

export const intersects = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export interface RubberBandDeps {
  /** mag een kader hier beginnen? (de plek is leeg, ⇧ is ingedrukt); 'exclusive' houdt andere sleep-acties tegen */
  canStart(event: PointerEvent): boolean | 'exclusive';
  /** telt dit kader op bij de bestaande selectie? */
  isAdditive?(event: PointerEvent): boolean;
  /** de sleutels (data-okey) van de afspraken in het kader */
  onSelect(keys: string[], additive: boolean): void;
  /** het kader begint / is klaar (om het tekenen vast te houden) */
  onStart?(): void;
  onEnd?(): void;
}

export function initRubberBand(root: HTMLElement, deps: RubberBandDeps) {
  root.addEventListener(
    'pointerdown',
    (down) => {
      const claim = down.button === 0 && deps.canStart(down);
      if (!claim) return;
      if (claim === 'exclusive') down.stopPropagation(); // anders begint het slepen ook een nieuwe afspraak
      const startX = down.clientX;
      const startY = down.clientY;
      const additive = deps.isAdditive?.(down) ?? (down.metaKey || down.ctrlKey);
      let box: HTMLElement | null = null;

      const move = (e: PointerEvent) => {
        if (!box) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
          box = document.createElement('div');
          box.className = 'pointer-events-none fixed z-30 rounded-sm border border-accent bg-accent/10';
          box.setAttribute('aria-hidden', 'true');
          document.body.append(box);
          root.classList.add('select-none');
          getSelection()?.removeAllRanges();
          deps.onStart?.();
        }
        const area = boxOf(startX, startY, e.clientX, e.clientY);
        Object.assign(box.style, {
          left: `${area.left}px`,
          top: `${area.top}px`,
          width: `${area.right - area.left}px`,
          height: `${area.bottom - area.top}px`,
        });
        const keys: string[] = [];
        for (const node of root.querySelectorAll<HTMLElement>('[data-okey]')) {
          if (intersects(area, node.getBoundingClientRect())) keys.push(node.dataset.okey!);
        }
        deps.onSelect(keys, additive);
      };

      const stop = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', stop);
        removeEventListener('pointercancel', stop);
        if (!box) return;
        box.remove();
        root.classList.remove('select-none');
        // het klikken na het loslaten zou anders de dag kiezen en de selectie weer wissen
        root.addEventListener('click', swallow, true);
        setTimeout(() => root.removeEventListener('click', swallow, true));
        deps.onEnd?.();
      };
      const swallow = (click: Event) => click.stopPropagation();

      addEventListener('pointermove', move);
      addEventListener('pointerup', stop);
      addEventListener('pointercancel', stop);
    },
    true,
  );
}
