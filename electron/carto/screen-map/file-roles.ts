// electron/carto/screen-map/file-roles.ts
//
// Determina el rol de un archivo dentro de una pantalla en categorías
// comprensibles para alguien que no programa (tarea 1.4, mapear-pantallas-y-su-codigo).
// El rol 'screen' lo asigna el detector que reconoce la entrada, no esta función.

import type { ScreenFileRole } from '../../../types/screen-map';

export function roleOf(filePath: string): ScreenFileRole {
  const p = filePath.replace(/\\/g, '/');

  // .css / .scss → style
  if (p.endsWith('.css') || p.endsWith('.scss')) {
    return 'style';
  }

  // dentro de i18n/ o locales/, o .json de textos → text
  if (/(?:^|\/)(?:i18n|locales)\//.test(p) || p.endsWith('.json')) {
    return 'text';
  }

  // dentro de db/, store, *-store.ts, models/, schema → data
  if (
    /(?:^|\/)(?:db|models|schema|store)\//.test(p) ||
    /(?:^|\/)[^/]*store[^/]*\.(?:ts|js|tsx|jsx)$/i.test(p) ||
    /(?:^|\/)(?:db|models|schema)\.[a-z]+$/i.test(p)
  ) {
    return 'data';
  }

  // dentro de lib/, hooks/, utils/, services/ → logic
  if (/(?:^|\/)(?:lib|hooks|utils|services)\//.test(p)) {
    return 'logic';
  }

  // .tsx / .jsx → component
  if (p.endsWith('.tsx') || p.endsWith('.jsx')) {
    return 'component';
  }

  return 'other';
}
