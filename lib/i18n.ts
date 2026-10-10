/**
 * GitCron i18n — lightweight translation system.
 *
 * Strategy: flat dictionary keys. ES is the source of truth (default);
 * EN falls back to ES if a key is missing.
 *
 * Usage:
 *   const t = useT();
 *   t('toolbar.openRepo')                          → "Abrir repositorio"
 *   t('errors.pullAuthRequired', { user: 'foo' })  → "Pull fallido para foo..."
 */

import * as sdd from './i18n/sdd';
import * as graph from './i18n/graph';
import * as ajustes from './i18n/ajustes';
import * as cartografia from './i18n/cartografia';
import * as comunes from './i18n/comunes';

export type Lang = 'es' | 'en' | 'zh';

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'es', label: 'Español', flag: '🇦🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
];

type Dict = Record<string, string>;

const es: Dict = {
  ...comunes.es,
  ...sdd.es,
  ...graph.es,
  ...ajustes.es,
  ...cartografia.es,
};

const en: Dict = {
  ...comunes.en,
  ...sdd.en,
  ...graph.en,
  ...ajustes.en,
  ...cartografia.en,
};

const zh: Dict = {
  ...comunes.zh,
  ...sdd.zh,
  ...graph.zh,
  ...ajustes.zh,
  ...cartografia.zh,
};

const dicts: Record<Lang, Dict> = { es, en, zh };

export function translate(key: string, lang: Lang = 'es', vars?: Record<string, string | number>): string {
  // Look up in target language, fall back to ES, fall back to the key itself
  let str = dicts[lang][key] ?? dicts.es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
  }
  return str;
}
