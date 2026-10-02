// electron/ai/config/gitcron-config-validate.ts
//
// Advertencias de gitcron.json contra la copia empaquetada del esquema de OpenCode
// (D4, tarea 3.5). Nunca es un error: lo desconocido se advierte y se respeta, no se
// borra ni bloquea el uso (requisito «Los parámetros nuevos se toman sin cambiar
// GitCron»). OpenCode, al leer, también es tolerante.
//
// No hay validador de JSON Schema en el repo que entienda draft 2020-12 (medido en
// la tarea 1.4), así que se comparan las claves de cada nivel que GitCron usa con las
// listas de propiedades del esquema, y los tipos de los campos que GitCron consume.

import schema from './opencode-config.schema.json';
import type { GitCronConfig } from './gitcron-config';

export type ConfigWarningKind =
  /** Una clave que el esquema no declara en un nivel que no admite claves libres. */
  | 'unknown-key'
  /** Un campo que GitCron consume con otro tipo que el del esquema. */
  | 'wrong-type'
  /**
   * `temperature` de un modelo con un número: en el formato es un sí/no («admite
   * temperatura»). GitCron lo sigue usando, pero OpenCode lo lee distinto.
   */
  | 'model-temperature-number'
  /**
   * Un bloque `mcp` dentro de gitcron.json: lo lee sólo OpenCode. Los servidores MCP
   * de GitCron van en mcp.json, con la notación `mcpServers` (D12).
   */
  | 'mcp-in-gitcron';

export interface ConfigWarning {
  kind: ConfigWarningKind;
  /** Ruta por segmentos (los ids de modelo llevan puntos y barras). */
  segments: string[];
  /** Tipo esperado, para `wrong-type`. */
  expected?: 'string' | 'number' | 'boolean' | 'object';
  /** De qué archivo sale el valor advertido, si se sabe. */
  file?: string;
}

const defs = (schema as any).$defs ?? {};
const propsOf = (node: any): Set<string> => new Set(Object.keys(node?.properties ?? {}));

const TOP_KEYS = propsOf(defs.Config);
const PROVIDER_KEYS = propsOf(defs.ProviderConfig);
const MODEL_NODE = defs.ProviderConfig?.properties?.models?.additionalProperties;
const MODEL_KEYS = propsOf(MODEL_NODE);
const LIMIT_KEYS = propsOf(MODEL_NODE?.properties?.limit);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function typeMatches(value: unknown, expected: NonNullable<ConfigWarning['expected']>): boolean {
  return expected === 'object' ? isObject(value) : typeof value === expected;
}

/**
 * Las advertencias de la configuración ya mezclada. `originOf` dice de qué archivo
 * sale cada ruta (global o del repositorio) para poder nombrarlo.
 */
export function validateGitCronConfig(
  config: GitCronConfig,
  originOf?: (segments: readonly string[]) => string | undefined,
): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  const warn = (warning: Omit<ConfigWarning, 'file'>) => {
    const file = originOf?.(warning.segments);
    warnings.push(file ? { ...warning, file } : warning);
  };
  const checkKeys = (node: Record<string, unknown>, allowed: Set<string>, prefix: string[]) => {
    for (const key of Object.keys(node)) {
      if (!allowed.has(key)) warn({ kind: 'unknown-key', segments: [...prefix, key] });
    }
  };
  const checkType = (value: unknown, expected: NonNullable<ConfigWarning['expected']>, segments: string[]) => {
    if (value !== undefined && !typeMatches(value, expected)) warn({ kind: 'wrong-type', segments, expected });
  };

  checkKeys(config, TOP_KEYS, []);
  if (config.mcp !== undefined) warn({ kind: 'mcp-in-gitcron', segments: ['mcp'] });
  checkType(config.model, 'string', ['model']);
  checkType(config.small_model, 'string', ['small_model']);

  for (const [providerId, provider] of Object.entries(config.provider ?? {})) {
    const base = ['provider', providerId];
    if (!isObject(provider)) {
      warn({ kind: 'wrong-type', segments: base, expected: 'object' });
      continue;
    }
    checkKeys(provider, PROVIDER_KEYS, base);
    // `options` es abierto en el esquema: sus claves desconocidas son los parámetros
    // abiertos de D4 y viajan al pedido. Sólo se miran los tipos que GitCron usa.
    const options = provider.options;
    checkType(options, 'object', [...base, 'options']);
    if (isObject(options)) {
      checkType(options.baseURL, 'string', [...base, 'options', 'baseURL']);
      checkType(options.apiKey, 'string', [...base, 'options', 'apiKey']);
      checkType(options.headers, 'object', [...base, 'options', 'headers']);
    }
    for (const [modelId, model] of Object.entries((provider.models ?? {}) as Record<string, unknown>)) {
      const modelBase = [...base, 'models', modelId];
      if (!isObject(model)) {
        warn({ kind: 'wrong-type', segments: modelBase, expected: 'object' });
        continue;
      }
      checkKeys(model, MODEL_KEYS, modelBase);
      if (typeof model.temperature === 'number') {
        warn({ kind: 'model-temperature-number', segments: [...modelBase, 'temperature'] });
      } else {
        checkType(model.temperature, 'boolean', [...modelBase, 'temperature']);
      }
      checkType(model.options, 'object', [...modelBase, 'options']);
      checkType(model.headers, 'object', [...modelBase, 'headers']);
      checkType(model.variants, 'object', [...modelBase, 'variants']);
      if (isObject(model.limit)) {
        checkKeys(model.limit, LIMIT_KEYS, [...modelBase, 'limit']);
        checkType(model.limit.context, 'number', [...modelBase, 'limit', 'context']);
        checkType(model.limit.output, 'number', [...modelBase, 'limit', 'output']);
      } else {
        checkType(model.limit, 'object', [...modelBase, 'limit']);
      }
    }
  }

  // `agent.<uso>` admite claves libres en el esquema; se miran los tipos que GitCron usa.
  for (const [use, agent] of Object.entries(config.agent ?? {})) {
    const base = ['agent', use];
    if (!isObject(agent)) {
      warn({ kind: 'wrong-type', segments: base, expected: 'object' });
      continue;
    }
    checkType(agent.model, 'string', [...base, 'model']);
    checkType(agent.variant, 'string', [...base, 'variant']);
    checkType(agent.temperature, 'number', [...base, 'temperature']);
    checkType(agent.options, 'object', [...base, 'options']);
  }

  return warnings;
}
