// electron/ai/config/mcp-export.ts
//
// «Copiar para otra herramienta» de un servidor de mcp.json (tarea 6.2, D12).
//
// Destinos:
// - Claude Code: bloque `mcpServers`, con `type` ("stdio" | "http" | "sse" | "ws")
//   y variables como `${NOMBRE}`.
// - VS Code: bloque `servers` en `.vscode/mcp.json`, con `type` ("stdio" | "http" | "sse")
//   y variables `${env:NOMBRE}`.
// - OpenCode: bloque `mcp` en `opencode.json`, `type: "local"` (con `command` como lista,
//   `environment`, `cwd`) o `remote` (`url`, `headers`), más `enabled: false` y
//   variables `{env:NOMBRE}`.
//
// Reglas de seguridad y formato:
// - Ningún archivo ajeno se escribe; el bloque va al portapapeles desde el proceso principal.
// - Secretos literales en `env` o `headers` NO viajan en la copia ni llegan a la pantalla:
//   se sustituyen por la referencia propuesta (${env:X}, ${X} o {env:X}) y se ofrece guardarlos
//   en el baúl y actualizar mcp.json (D5).
// - La vista previa oculta contraseñas y parámetros de consulta en URLs, aclarando que en
//   el portapapeles se copian completos.
// - Se avisan deprecaciones (type: "sse") e incompatibilidades (envFile en OpenCode), y si
//   un remoto sin tipo asume Streamable HTTP ("http").

import {
  envVarNameFrom,
  isLiteralSecret,
  type SecretNaming,
  type SecretSlot,
} from './literal-secrets';
import { mcpSecretSlots, type McpServer } from './mcp-config';

export type McpExportTarget = 'claude' | 'vscode' | 'opencode';

export interface LiteralSecretDetection {
  key: string;
  location: 'env' | 'headers';
  proposedVar: string;
  value: string;
}

export interface McpExportPlan {
  target: McpExportTarget;
  serverName: string;
  previewText: string;
  clipboardText: string;
  warnings: string[];
  literalSecrets: Array<Omit<LiteralSecretDetection, 'value'>>;
  targetPathHint: string;
}

/** Convierte las referencias de variables al dialecto de cada herramienta. */
export function convertReferencesForTarget(value: unknown, target: McpExportTarget): unknown {
  if (typeof value === 'string') {
    if (target === 'claude') {
      // ${env:VAR} o {env:VAR} -> ${VAR}
      return value.replace(/\$?\{env:([A-Za-z0-9_]+)\}/g, (_, varName) => `\${${varName}}`);
    }
    if (target === 'opencode') {
      // ${env:VAR} -> {env:VAR}
      return value.replace(/\$\{env:([A-Za-z0-9_]+)\}/g, '{env:$1}');
    }
    if (target === 'vscode') {
      // {env:VAR} -> ${env:VAR}
      return value.replace(/(?<!\$)\{env:([A-Za-z0-9_]+)\}/g, '$${env:$1}');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertReferencesForTarget(item, target));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convertReferencesForTarget(v, target)]),
    );
  }
  return value;
}

/**
 * Oculta la contraseña y valores de query params en URLs para la vista previa:
 * - protocol://user:pass@host -> protocol://user:***@host
 * - ?key=secret&foo=bar -> ?key=***&foo=***
 */
export function maskUrlString(raw: string): string {
  let result = raw;
  result = result.replace(/(:\/\/[^/:@\s]+:)([^@\s]+)(@)/g, '$1***$3');
  result = result.replace(/([?&][^&=#\s]+)=([^&#\s]+)/g, '$1=***');
  return result;
}

export function maskUrlsForPreview(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.includes('://') || value.includes('?')) {
      return maskUrlString(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(maskUrlsForPreview);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maskUrlsForPreview(v)]),
    );
  }
  return value;
}

function valueAt(obj: unknown, segments: string[]): unknown {
  let curr = obj;
  for (const seg of segments) {
    if (curr === null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[seg];
  }
  return curr;
}

function chooseName(preferred: string, secret: string, naming?: SecretNaming): string {
  if (!naming) return preferred;
  const holds = (name: string) => naming.taken.get(name) ?? naming.env[name] ?? naming.stored(name);
  for (let n = 1; ; n++) {
    const name = n === 1 ? preferred : `${preferred}_${n}`;
    const current = holds(name);
    if (current === undefined || current === '' || current === secret) return name;
  }
}

/**
 * Detecta valores escritos a mano en `env` y `headers`, proponiendo nombres de variables.
 */
export function detectLiteralSecrets(
  serverName: string,
  server: McpServer,
  naming?: SecretNaming,
): { sanitizedServer: McpServer; literalSecrets: LiteralSecretDetection[] } {
  const sanitized: McpServer = JSON.parse(JSON.stringify(server));
  const literalSecrets: LiteralSecretDetection[] = [];
  const slots: SecretSlot[] = mcpSecretSlots(serverName, server);

  for (const slot of slots) {
    const rawVal = valueAt(server, slot.segments);
    if (isLiteralSecret(rawVal)) {
      const secretStr = rawVal.trim();
      const proposedVar = chooseName(slot.baseName, secretStr, naming);
      if (naming) naming.taken.set(proposedVar, secretStr);

      literalSecrets.push({
        key: slot.segments[slot.segments.length - 1],
        location: slot.segments[0] as 'env' | 'headers',
        proposedVar,
        value: secretStr,
      });

      // Se sustituye por la referencia intermedia ${env:VAR}
      const targetObj = (sanitized as Record<string, unknown>)[slot.segments[0]] as Record<string, string>;
      if (targetObj) {
        targetObj[slot.segments[1]] = `\${env:${proposedVar}}`;
      }
    }
  }

  return { sanitizedServer: sanitized, literalSecrets };
}

export function targetPathHintFor(target: McpExportTarget): string {
  switch (target) {
    case 'claude':
      return '.mcp.json';
    case 'vscode':
      return '.vscode/mcp.json';
    case 'opencode':
      return 'opencode.json';
  }
}

/**
 * Arma la copia de un servidor MCP para otra herramienta conforme a D12.
 */
export function buildMcpExport(options: {
  serverName: string;
  server: McpServer;
  disabled?: boolean;
  target: McpExportTarget;
  naming?: SecretNaming;
}): { exportPlan: McpExportPlan; rawSecrets: LiteralSecretDetection[] } {
  const { serverName, server, disabled = false, target, naming } = options;

  // 1. Detección y sanitización de secretos literales
  const { sanitizedServer, literalSecrets: rawSecrets } = detectLiteralSecrets(serverName, server, naming);

  // 2. Avisos de incompatibilidad / deprecación
  const warnings: string[] = [];
  const declaredType = typeof sanitizedServer.type === 'string' ? sanitizedServer.type.toLowerCase() : undefined;
  const isLocal = typeof sanitizedServer.command === 'string';
  const isRemote = typeof sanitizedServer.url === 'string';

  if (declaredType === 'sse' || (typeof sanitizedServer.url === 'string' && sanitizedServer.url.toLowerCase().includes('/sse'))) {
    warnings.push('type_sse_deprecated');
  }
  if (!declaredType && isRemote) {
    warnings.push('type_default_streamable_http');
  }
  if (target === 'opencode' && sanitizedServer.envFile) {
    warnings.push('opencode_no_envfile');
  }

  // 3. Estructuración según la herramienta de destino
  let exportedServer: Record<string, unknown> = {};

  if (target === 'claude') {
    exportedServer.type = declaredType ?? (isLocal ? 'stdio' : 'http');
    if (isLocal) {
      exportedServer.command = sanitizedServer.command;
      if (Array.isArray(sanitizedServer.args) && sanitizedServer.args.length > 0) {
        exportedServer.args = sanitizedServer.args;
      }
      if (sanitizedServer.env && Object.keys(sanitizedServer.env).length > 0) {
        exportedServer.env = sanitizedServer.env;
      }
      if (sanitizedServer.envFile) {
        exportedServer.envFile = sanitizedServer.envFile;
      }
    }
    if (isRemote) {
      exportedServer.url = sanitizedServer.url;
    }
    if (sanitizedServer.headers && Object.keys(sanitizedServer.headers).length > 0) {
      exportedServer.headers = sanitizedServer.headers;
    }
  } else if (target === 'vscode') {
    exportedServer.type = declaredType ?? (isLocal ? 'stdio' : 'http');
    if (isLocal) {
      exportedServer.command = sanitizedServer.command;
      if (Array.isArray(sanitizedServer.args) && sanitizedServer.args.length > 0) {
        exportedServer.args = sanitizedServer.args;
      }
      if (sanitizedServer.env && Object.keys(sanitizedServer.env).length > 0) {
        exportedServer.env = sanitizedServer.env;
      }
      if (sanitizedServer.envFile) {
        exportedServer.envFile = sanitizedServer.envFile;
      }
      if (sanitizedServer.cwd) {
        exportedServer.cwd = sanitizedServer.cwd;
      }
    }
    if (isRemote) {
      exportedServer.url = sanitizedServer.url;
    }
    if (sanitizedServer.headers && Object.keys(sanitizedServer.headers).length > 0) {
      exportedServer.headers = sanitizedServer.headers;
    }
  } else if (target === 'opencode') {
    if (isLocal) {
      exportedServer.type = 'local';
      exportedServer.command = [
        sanitizedServer.command as string,
        ...(Array.isArray(sanitizedServer.args) ? (sanitizedServer.args as string[]) : []),
      ];
      if (sanitizedServer.env && Object.keys(sanitizedServer.env).length > 0) {
        exportedServer.environment = sanitizedServer.env;
      }
      if (sanitizedServer.cwd) {
        exportedServer.cwd = sanitizedServer.cwd;
      }
    } else if (isRemote) {
      exportedServer.type = 'remote';
      exportedServer.url = sanitizedServer.url;
    }
    if (sanitizedServer.headers && Object.keys(sanitizedServer.headers).length > 0) {
      exportedServer.headers = sanitizedServer.headers;
    }
    if (disabled) {
      exportedServer.enabled = false;
    }
  }

  // 4. Conversión de sintaxis de referencias
  const convertedServer = convertReferencesForTarget(exportedServer, target);

  // 5. Envoltura con la clave de la herramienta
  let wrapped: Record<string, unknown>;
  if (target === 'claude') {
    wrapped = { mcpServers: { [serverName]: convertedServer } };
  } else if (target === 'vscode') {
    wrapped = { servers: { [serverName]: convertedServer } };
  } else {
    wrapped = { mcp: { [serverName]: convertedServer } };
  }

  // 6. Generación del texto del portapapeles y de la vista previa
  const clipboardText = JSON.stringify(wrapped, null, 2) + '\n';
  const previewText = JSON.stringify(maskUrlsForPreview(wrapped), null, 2) + '\n';

  return {
    exportPlan: {
      target,
      serverName,
      previewText,
      clipboardText,
      warnings,
      literalSecrets: rawSecrets.map(({ key, location, proposedVar }) => ({ key, location, proposedVar })),
      targetPathHint: targetPathHintFor(target),
    },
    rawSecrets,
  };
}
