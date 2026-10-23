import { describe, expect, it } from 'vitest';
import { paletteFromPixels } from '../use-image-palette';

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

describe('paletteFromPixels', () => {
  it('descarta el fondo oscuro aunque sea lo que más hay', () => {
    const data = [
      ...Array.from({ length: 50 }, () => px(20, 22, 30)).flat(),
      ...px(200, 80, 220),
      ...px(205, 85, 215),
    ];
    const colors = paletteFromPixels(data);
    expect(colors).toHaveLength(1);
    expect(colors[0]).toMatch(/^hsl\(29\d, \d+%, 66%\)$/);
  });

  it('descarta los grises: se camuflan con la captura', () => {
    const data = [...px(160, 160, 160), ...px(90, 94, 110), ...px(80, 200, 120)];
    const colors = paletteFromPixels(data);
    expect(colors).toHaveLength(1);
    expect(colors[0]).toMatch(/^hsl\(14\d, /);
  });

  it('aviva los tonos apagados y respeta el máximo', () => {
    const many = Array.from({ length: 12 }, (_, i) => px(40 + i * 18, 120, 255 - i * 18)).flat();
    const colors = paletteFromPixels([...px(255, 0, 0, 0), ...many], 4);
    expect(colors).toHaveLength(4);
    for (const c of colors) expect(Number(c.match(/, (\d+)%, 66%/)?.[1])).toBeGreaterThanOrEqual(65);
  });
});
