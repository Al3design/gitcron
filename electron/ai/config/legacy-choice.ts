// electron/ai/config/legacy-choice.ts
//
// «Usar lo que tenías» (tarea 4.3; decisión de Ale del 2026-10-01). Cuando un uso no
// tiene modelo en gitcron.json pero la persona tenía una elección en los ajustes de
// antes —Cartografía en carto-ai.json, el proveedor del Agente Temporal, el modelo
// elegido en el selector de LM Studio de la redacción o del análisis—, la pantalla lo
// ofrece con un botón. Al apretarlo se escribe la entrada del uso (y el proveedor, si
// el archivo no lo declara) en el gitcron.json global. Nada se escribe ni se manda solo.

import { getDefaultConfigPath, type GitCronProviderConfig, type LoadedGitCronConfig } from './gitcron-config';
import { updateGitCronConfigValue, type ConfigWriteResult } from './gitcron-config-writer';
import {
  ANTHROPIC_DEFAULT_MODEL,
  LEGACY_PROVIDER_BLOCKS,
  LMSTUDIO_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
  type MigrationSources,
} from './gitcron-config-migration';
import type { TextUse } from './resolve-model-for';

export interface LegacyOffer {
  use: TextUse;
  /** Lo que se escribe en `agent.<uso>.model`. */
  modelRef: string;
  providerId: keyof typeof LEGACY_PROVIDER_BLOCKS;
  /** El nombre del proveedor y el modelo, para el botón. */
  label: string;
  /** Si el archivo no declara el proveedor, se agrega este bloque. */
  addsProvider: GitCronProviderConfig | null;
  /** El archivo donde se escribe (el global, D2). */
  file: string;
}

/** Lo que había antes, más el modelo elegido en la pantalla del uso si tiene selector. */
export interface LegacyChoiceSources extends MigrationSources {
  screenModel?: string | null;
}

const SAFE_MODEL = /^[A-Za-z0-9._:/@-]+$/;

/** La elección vieja de un uso como `<proveedor>/<modelo>`, o nada si no había. */
function legacyRef(use: TextUse, sources: LegacyChoiceSources): { providerId: LegacyOffer['providerId']; modelId: string } | null {
  switch (use) {
    case 'gitcron-commit':
    case 'gitcron-openspec-analysis': {
      // Las dos pantallas tienen el selector de LM Studio: lo elegido ahí.
      const model = sources.screenModel?.trim();
      return model ? { providerId: 'lmstudio', modelId: model } : null;
    }
    case 'gitcron-cartography': {
      const carto = sources.cartography;
      if (!carto) return null;
      const model = carto.model?.trim();
      return carto.mode === 'online'
        ? { providerId: 'openrouter', modelId: model || OPENROUTER_DEFAULT_MODEL }
        : { providerId: 'lmstudio', modelId: model || LMSTUDIO_DEFAULT_MODEL };
    }
    case 'gitcron-temporal':
      return sources.temporalProvider === 'claude'
        ? { providerId: 'anthropic', modelId: ANTHROPIC_DEFAULT_MODEL }
        : { providerId: 'openrouter', modelId: OPENROUTER_DEFAULT_MODEL };
    case 'gitcron-assist':
      return null;
  }
}

/**
 * Qué ofrecer para un uso sin modelo, o `null` si el uso ya tiene modelo, está
 * apagado o no había nada elegido.
 */
export function legacyOfferFor(
  use: TextUse,
  loaded: LoadedGitCronConfig,
  sources: LegacyChoiceSources,
  globalPath: string = getDefaultConfigPath(),
): LegacyOffer | null {
  const config = loaded.config ?? {};
  const entry = config.agent?.[use];
  if (entry?.disable === true) return null;
  if (typeof entry?.model === 'string' && entry.model.trim()) return null;
  if (typeof config.model === 'string' && config.model.trim()) return null;
  const ref = legacyRef(use, sources);
  if (!ref || !SAFE_MODEL.test(ref.modelId)) return null;
  const declared = config.provider?.[ref.providerId];
  const block = LEGACY_PROVIDER_BLOCKS[ref.providerId];
  return {
    use,
    modelRef: `${ref.providerId}/${ref.modelId}`,
    providerId: ref.providerId,
    label: `${declared?.name || block.name} · ${ref.modelId}`,
    addsProvider: declared ? null : JSON.parse(JSON.stringify(block)),
    file: globalPath,
  };
}

/** Escribe la oferta: el proveedor si falta y después el modelo del uso, cada uno puntual. */
export function adoptLegacyOffer(offer: LegacyOffer): ConfigWriteResult {
  if (offer.addsProvider) {
    const written = updateGitCronConfigValue({
      filePath: offer.file,
      segments: ['provider', offer.providerId],
      value: offer.addsProvider,
    });
    if (!written.ok) return written;
  }
  return updateGitCronConfigValue({ filePath: offer.file, segments: ['agent', offer.use, 'model'], value: offer.modelRef });
}
