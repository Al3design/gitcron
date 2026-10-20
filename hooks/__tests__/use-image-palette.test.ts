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
    expect(colors[0]).toMatch(/^rgb\(20\d, 8\d, 21\d\)$/);
  });

  it('prefiere los colores vivos a los grises de la misma cantidad', () => {
    const data = [...px(160, 160, 160), ...px(160, 160, 160), ...px(80, 200, 120), ...px(82, 198, 122)];
    const colors = paletteFromPixels(data);
    expect(colors[0]).toMatch(/^rgb\(8\d, 19\d|^rgb\(8\d, 20\d/);
  });

  it('ignora los píxeles transparentes y respeta el máximo', () => {
    const many = Array.from({ length: 12 }, (_, i) => px(40 + i * 18, 120, 255 - i * 18)).flat();
    expect(paletteFromPixels([...px(255, 0, 0, 0), ...many], 4)).toHaveLength(4);
  });
});
