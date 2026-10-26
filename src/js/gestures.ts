// trackpad-gebaren: horizontaal vegen en knijpen (dat laat Chromium als ctrl+wheel binnenkomen)

// Eén veeg = één stap. Een veeg levert tientallen wheel-events op (ook nog na het loslaten, het "uitrollen"),
// dus na een stap blijft het vergrendeld tot het een moment stil is geweest.
export function createSwipeDetector(onSwipe: (direction: 1 | -1) => void, { threshold = 80, quietMs = 150 } = {}) {
  let sum = 0;
  let locked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    // geeft true als dit event bij een horizontale veeg hoort (dan hoeft de pagina er niet mee te scrollen)
    handle(deltaX: number, deltaY: number) {
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        sum = 0;
        locked = false;
      }, quietMs);
      if (locked) return true;
      sum += deltaX;
      if (Math.abs(sum) >= threshold) {
        locked = true;
        onSwipe(sum > 0 ? 1 : -1);
        sum = 0;
      }
      return true;
    },
  };
}

// Knijpen levert veel kleine ctrl+wheel-events; verzamel ze tot het volgende beeld en geef de totale factor door.
export function createZoomAccumulator(apply: (factor: number, clientY: number) => void) {
  let factor = 1;
  let y = 0;
  let frame = 0;
  return {
    add(deltaY: number, clientY: number) {
      factor *= Math.exp(-deltaY * 0.01);
      y = clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const total = factor;
        factor = 1;
        apply(total, y);
      });
    },
  };
}
