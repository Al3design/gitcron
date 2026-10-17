// electron/carto/screen-capture/content-key.ts
//
// Clave de contenido para invalidar capturas cuando cambian los archivos de una pantalla (decisión 11).

import { createHash } from 'node:crypto';
import type { ScreenEntry } from '../../../types/screen-map';

export async function screenContentKey(
  screen: ScreenEntry,
  stat: (rel: string) => Promise<{ size: number; mtimeMs: number } | null>,
): Promise<string> {
  const validFiles = screen.files.filter((f) => f.provenance !== 'unknown');
  const uniquePaths = Array.from(new Set(validFiles.map((f) => f.path))).sort();

  const lines: string[] = [];
  for (const relPath of uniquePaths) {
    const info = await stat(relPath);
    if (info !== null) {
      lines.push(`${relPath}:${info.size}:${info.mtimeMs}`);
    } else {
      lines.push(`${relPath}:-`);
    }
  }

  const payload = lines.join('\n');
  return createHash('sha1').update(payload).digest('hex');
}
