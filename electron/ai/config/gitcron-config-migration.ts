// electron/ai/config/gitcron-config-migration.ts
//
// Primer arranque sin gitcron.json: se crea con lo que GitCron ya usa, para que lo
// que estaba escondido en ajustes quede escrito (D10, tarea 3.7). Desde la tarea 4.3
// todos los usos leen gitcron.json, así que el archivo creado reproduce la elección
// de cada uno.
//
// Si el archivo ya existe, no se toca: un uso sin entrada ofrece en su pantalla
// escribir lo que la persona tenía elegido (legacy-choice.ts, decisión de Ale del
// 2026-10-01: un botón, nunca solo). Las claves no se mueven: el archivo las
// referencia con `{env:…}` y la resolución las encuentra en el baúl (D5).
//
// Medido el 2026-10-01 de dónde sale cada ajuste:
// - Clave de OpenRouter y de Anthropic: key-store (`openrouter`, `claude`).
// - Agente Temporal: el proveedor activo en el almacenamiento cifrado
//   (`ai.activeProvider`, OpenRouter si no hay nada); el modelo se guarda POR
//   repositorio en su config.json y se queda ahí.
// - Cartografía: `carto-ai.json` en userData (`enabled`, `mode` local u online, `model`).
// - El modelo recordado de la redacción vive sólo en memoria mientras la app está
//   abierta (lib/ai-model-memory.ts): no hay nada guardado que migrar.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GitCronConfig, GitCronProviderConfig } from './gitcron-config';

/**
 * Modelos por omisión de los adaptadores que había antes de gitcron.json
 * (Agente Temporal y Cartografía). Sólo sirven para escribir la elección vieja.
 */
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5';
export const LMSTUDIO_DEFAULT_MODEL = 'local-model';

/**
 * Los proveedores que GitCron usaba fijos antes de gitcron.json. Es el único lugar
 * donde viven sus direcciones: la migración y «usar lo que tenías» los escriben en
 * el archivo, y desde ahí se usan como cualquier otro.
 */
export const LEGACY_PROVIDER_BLOCKS: Readonly<Record<'lmstudio' | 'openrouter' | 'anthropic', GitCronProviderConfig>> = {
  lmstudio: {
    npm: '@ai-sdk/openai-compatible',
    name: 'LM Studio',
    options: { baseURL: 'http://localhost:1234/v1' },
  },
  openrouter: {
    npm: '@ai-sdk/openai-compatible',
    name: 'OpenRouter',
    options: {
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{env:OPENROUTER_API_KEY}',
      // La atribución que mandaban los adaptadores de antes (opcional en OpenRouter).
      headers: { 'HTTP-Referer': 'https://github.com/Al3design/gitcron', 'X-Title': 'GitCron' },
    },
  },
  anthropic: {
    npm: '@ai-sdk/anthropic',
    name: 'Anthropic',
    options: { apiKey: '{env:ANTHROPIC_API_KEY}' },
  },
};

const copyBlock = (id: keyof typeof LEGACY_PROVIDER_BLOCKS): GitCronProviderConfig =>
  JSON.parse(JSON.stringify(LEGACY_PROVIDER_BLOCKS[id]));

export interface MigrationSources {
  hasOpenRouterKey: boolean;
  hasAnthropicKey: boolean;
  /** `ai.activeProvider` del almacenamiento cifrado; `null` si no hay (OpenRouter). */
  temporalProvider: string | null;
  /** `carto-ai.json`; `null` si no existe. */
  cartography: { enabled: boolean; mode: 'local' | 'online'; model?: string } | null;
}

/** La configuración inicial, en el formato de OpenCode (D1), con la elección actual de cada uso. */
export function buildInitialGitCronConfig(sources: MigrationSources): GitCronConfig {
  const config: GitCronConfig = {
    $schema: 'https://opencode.ai/config.json',
    provider: { lmstudio: copyBlock('lmstudio') },
    agent: {},
  };
  const providers = config.provider!;
  const agents = config.agent!;

  const temporalIsAnthropic = sources.temporalProvider === 'claude';
  const cartoOnline = sources.cartography?.mode === 'online';
  if (sources.hasOpenRouterKey || !temporalIsAnthropic || cartoOnline) {
    providers.openrouter = copyBlock('openrouter');
  }
  if (sources.hasAnthropicKey || temporalIsAnthropic) {
    providers.anthropic = copyBlock('anthropic');
  }

  agents['gitcron-temporal'] = {
    description: 'GitCron: Agente Temporal. El modelo elegido en cada repositorio sigue en su configuración.',
    model: temporalIsAnthropic ? `anthropic/${ANTHROPIC_DEFAULT_MODEL}` : `openrouter/${OPENROUTER_DEFAULT_MODEL}`,
  };

  const carto = sources.cartography ?? { enabled: false, mode: 'local' as const };
  const cartoModel = carto.model?.trim();
  agents['gitcron-cartography'] = {
    description: 'GitCron: explicaciones de Cartografía.',
    model: carto.mode === 'online'
      ? `openrouter/${cartoModel || OPENROUTER_DEFAULT_MODEL}`
      : `lmstudio/${cartoModel || LMSTUDIO_DEFAULT_MODEL}`,
    // `disable` es del formato (AgentConfig): Cartografía con la IA apagada sigue apagada.
    ...(carto.enabled ? {} : { disable: true }),
  };

  return config;
}

/**
 * Crea gitcron.json sólo si no existe. Devuelve si lo creó; si ya estaba, no lo lee
 * ni lo toca. La escritura es atómica: temporal en la misma carpeta y renombrar.
 */
export function migrateGitCronConfigIfMissing(options: {
  configPath: string;
  readSources: () => MigrationSources;
}): { created: boolean; path: string } {
  const { configPath } = options;
  if (fs.existsSync(configPath)) return { created: false, path: configPath };
  const config = buildInitialGitCronConfig(options.readSources());
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = path.join(path.dirname(configPath), `.gitcron.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  // Si otro proceso lo creó mientras tanto, gana el suyo.
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(tmp);
    return { created: false, path: configPath };
  }
  fs.renameSync(tmp, configPath);
  return { created: true, path: configPath };
}
