// electron/ai/config/literal-secrets.ts
//
// Valores escritos a mano en un archivo ajeno que importamos: la clave o una
// cabecera de un proveedor de opencode.json, el `env` o las `headers` de un
// servidor MCP de Cursor, LM Studio u OpenCode (tarea 6.1). No se copian: el
// plan pone en su lugar la referencia a una variable, al aplicar el valor va al
// baúl con ese nombre (D5) y el archivo de GitCron recibe sólo la referencia.
// El valor no viaja en el plan: se relee del archivo de origen al aplicar.

/** `{env:X}` (OpenCode, gitcron.json) o `${env:X}` (notación `mcpServers`, D12). */
export type ReferenceStyle = 'opencode' | 'mcp';

const ENV_REFERENCE = /^\$?\{env:([A-Za-z0-9_]+)\}$/;
const FILE_REFERENCE = /^\{file:[^}]+\}$/;

/** Un texto que no es una referencia `{env:}`, `${env:}` ni `{file:}`: el valor mismo. */
export function isLiteralSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed !== '' && !ENV_REFERENCE.test(trimmed) && !FILE_REFERENCE.test(trimmed);
}

/** El nombre de la variable si el valor es una referencia `{env:X}` o `${env:X}`. */
export function referenceName(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().match(ENV_REFERENCE)?.[1] : undefined;
}

/** Un nombre de variable válido para el baúl a partir de un id o una cabecera. */
export function envVarNameFrom(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
  return (/^[A-Z_]/.test(clean) ? clean : `ENV_${clean}`).slice(0, 120);
}

/** Un lugar del bloque que puede traer un secreto, y el nombre que se le propone. */
export interface SecretSlot {
  segments: string[];
  baseName: string;
}

export interface SecretNaming {
  /** El valor guardado en el baúl con ese nombre, si lo hay. */
  stored: (name: string) => string | undefined;
  /** Las variables del sistema: le ganan al baúl al resolver (D5). */
  env: NodeJS.ProcessEnv;
  /** Los nombres ya repartidos en este plan, con su valor. */
  taken: Map<string, string>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function valueAt(value: unknown, segments: string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setAt(value: Record<string, unknown>, segments: string[], next: unknown): void {
  let current = value;
  for (const segment of segments.slice(0, -1)) current = current[segment] as Record<string, unknown>;
  current[segments[segments.length - 1]] = next;
}

/**
 * El nombre con que se guarda `secret`: el preferido si nadie lo usa o ya tiene
 * ese mismo valor; si no, con sufijo. Así importar nunca pisa una variable del
 * baúl ni queda tapado por una del sistema con otro valor.
 */
function chooseName(preferred: string, secret: string, naming: SecretNaming): string {
  const holds = (name: string) => naming.taken.get(name) ?? naming.env[name] ?? naming.stored(name);
  for (let n = 1; ; n++) {
    const name = n === 1 ? preferred : `${preferred}_${n}`;
    const current = holds(name);
    if (current === undefined || current === '' || current === secret) return name;
  }
}

/**
 * El bloque con cada valor escrito a mano reemplazado por una referencia, y los
 * nombres de esas variables (`fromFile`): se guardan en el baúl al aplicar. Si
 * el bloque de destino ya referencia una variable en ese lugar, se reusa su nombre.
 */
export function replaceLiteralSecrets(
  raw: unknown,
  slots: SecretSlot[],
  current: unknown,
  style: ReferenceStyle,
  naming: SecretNaming,
): { value: unknown; fromFile: string[] } {
  const literal = slots.filter((slot) => isLiteralSecret(valueAt(raw, slot.segments)));
  if (literal.length === 0 || !isObject(raw)) return { value: raw, fromFile: [] };
  const value = structuredClone(raw);
  const fromFile: string[] = [];
  for (const slot of literal) {
    const secret = (valueAt(raw, slot.segments) as string).trim();
    const preferred = referenceName(valueAt(current, slot.segments)) ?? slot.baseName;
    const name = chooseName(preferred, secret, naming);
    naming.taken.set(name, secret);
    setAt(value, slot.segments, style === 'mcp' ? `\${env:${name}}` : `{env:${name}}`);
    fromFile.push(name);
  }
  return { value, fromFile };
}

/** Al aplicar: cada valor escrito a mano del origen con el nombre que le dio el plan. */
export function literalSecretsToSave(
  raw: unknown,
  planned: unknown,
  slots: SecretSlot[],
): Array<{ name: string; value: string }> {
  const secrets: Array<{ name: string; value: string }> = [];
  for (const slot of slots) {
    const secret = valueAt(raw, slot.segments);
    const name = referenceName(valueAt(planned, slot.segments));
    if (isLiteralSecret(secret) && name) secrets.push({ name, value: secret.trim() });
  }
  return secrets;
}
