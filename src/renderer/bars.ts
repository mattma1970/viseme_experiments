/**
 * Channel bars: a 2D-canvas meter showing the current value of each of the
 * 15 viseme channels (the "live values" readout in the demo UI).
 */

import { VISEMES } from '../viseme-core/visemes.js';

export interface BarCanvas {
  draw(vals: ArrayLike<number>): void;
}

export function makeChannelBars(canvas: HTMLCanvasElement): BarCanvas {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { draw: () => {} };

  // fixed internal resolution; CSS stretches to fit the panel
  const W = 360;
  const H = 132;
  canvas.width = W;
  canvas.height = H;

  const n = VISEMES.length;
  const bw = W / n;

  const draw = (vals: ArrayLike<number>): void => {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const v = vals[i] ?? 0;
      const bh = Math.max(1, v * (H - 22));
      const x = i * bw + 2;

      // bar
      ctx.fillStyle =
        v > 0.02 ? 'rgba(122, 197, 255, 0.9)' : 'rgba(72, 82, 104, 0.4)';
      ctx.fillRect(x, H - 16 - bh, bw - 4, bh);

      // label (short viseme name)
      ctx.fillStyle = '#5d6579';
      ctx.font = '8px monospace';
      ctx.fillText(VISEMES[i].replace('viseme_', ''), x, H - 5);
    }
  };

  return { draw };
}
