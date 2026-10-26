// Gedeelde bewegingsregels: één set curves en duren, zodat alles in de app even "zwaar" aanvoelt,
// en één plek die rekening houdt met "minder beweging" in de systeeminstellingen.
export const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const EASE = {
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)', // snel weg, zacht aankomen
  in: 'cubic-bezier(0.4, 0, 1, 1)', // zacht weg, snel eruit
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  // een veer met een klein doorschot (CSS linear()); browsers zonder ondersteuning vallen terug op `out`
  spring: 'linear(0, 0.18 4%, 0.52 9%, 0.84 15%, 1.04 22%, 1.07 27%, 1.04 33%, 0.99 42%, 0.98 50%, 1.0 62%, 1 100%)',
} as const;

export const DURATION = { fast: 150, base: 220, slow: 320 } as const;

// speelt een animatie af tenzij de gebruiker minder beweging wil; geeft altijd iets terug waar je op kunt wachten
export function play(node: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (reduceMotion() || typeof node.animate !== 'function') return Promise.resolve();
  const animation = node.animate(keyframes, options);
  return animation.finished.then(
    () => undefined,
    () => undefined, // onderbroken door een nieuwe animatie: geen fout
  );
}

// Afspraken één voor één laten binnenkomen na een andere dag, week of weergave; de totale duur blijft kort.
export function staggerIn(root: ParentNode, selector = '[data-okey]', maxItems = 48) {
  if (reduceMotion()) return;
  const nodes = [...root.querySelectorAll<HTMLElement>(selector)].slice(0, maxItems);
  const step = Math.min(14, 280 / Math.max(nodes.length, 1));
  nodes.forEach((node, i) => {
    node.animate?.(
      [
        { opacity: 0, transform: 'translateY(5px) scale(0.97)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: DURATION.base, delay: i * step, easing: EASE.out, fill: 'backwards' },
    );
  });
}

// een weergave zoomt in (naar een kleinere eenheid) of uit (naar een grotere); direction schuift opzij
export function enterView(node: Element, { direction = 0, zoom = 0 } = {}) {
  const from = direction
    ? `translateX(${direction * 16}px)`
    : zoom > 0
      ? 'scale(1.035)'
      : zoom < 0
        ? 'scale(0.965)'
        : 'translateY(6px)';
  return play(
    node,
    [
      { opacity: 0, transform: from },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: DURATION.base,
      easing: EASE.out,
    },
  );
}

// Zet de oorsprong van een dialoog op de plek waar de gebruiker net klikte, zodat hij daaruit lijkt te groeien.
export function initDialogOrigin() {
  let last: { x: number; y: number; t: number } | null = null;
  addEventListener(
    'pointerdown',
    (e) => {
      last = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    true,
  );
  const watcher = new MutationObserver((records) => {
    for (const record of records) {
      const dialog = record.target as HTMLDialogElement;
      if (!dialog.open) continue;
      if (last && Date.now() - last.t < 1500) {
        const rect = dialog.getBoundingClientRect();
        const x = Math.min(Math.max(last.x - rect.left, 0), rect.width);
        const y = Math.min(Math.max(last.y - rect.top, 0), rect.height);
        dialog.style.transformOrigin = `${x}px ${y}px`;
      } else dialog.style.transformOrigin = '';
    }
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    watcher.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
}
