// hooks/use-image-palette.ts
//
// Los colores más vivos de una imagen, para que el efecto de píxeles use los de la captura que se
// está sacando (Alejandro, carto-05e). Se achica la imagen a 24×15, se agrupan los colores
// parecidos y se eligen los que más se ven entre los que no son casi negros ni casi grises: una
// captura de una app oscura tiene mucho fondo, y esos cuadraditos no se verían.

import { useEffect, useState } from 'react';

const SAMPLE_W = 24;
const SAMPLE_H = 15;
const MAX_COLORS = 6;

/** Saca la paleta de los píxeles RGBA de una imagen ya achicada. Pura: se prueba sin lienzo. */
export function paletteFromPixels(data: Uint8ClampedArray | number[], maxColors = MAX_COLORS): string[] {
  const buckets = new Map<string, { r: number; g: number; b: number; n: number; score: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510;
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (lightness < 0.22) continue; // fondo oscuro: no se vería
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    bucket.score += 1 + saturation * 3;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxColors)
    .map(({ r, g, b, n }) => `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
}

/** Paleta de la imagen (`data:` o URL); `undefined` mientras carga o si no hay imagen. */
export function useImagePalette(src: string | undefined): string[] | undefined {
  const [entry, setEntry] = useState<{ src: string; colors: string[] } | null>(null);

  useEffect(() => {
    if (!src || typeof document === 'undefined') return;
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
      const colors = paletteFromPixels(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
      setEntry({ src, colors });
    };
    img.onerror = () => {
      // Sin paleta: el efecto usa los colores de la IA, como en el resto de los cuadros.
      if (active) setEntry({ src, colors: [] });
    };
    img.src = src;
    return () => {
      active = false;
    };
  }, [src]);

  if (!src || !entry || entry.src !== src || entry.colors.length < 2) return undefined;
  return entry.colors;
}
