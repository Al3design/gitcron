const SENSITIVE_KEY = /(authorization|cookie|token|secret|api[_-]?key|password|prompt|reasoning)/i;
const SAFE_REASONING_METADATA_KEYS = new Set(['reasoningVisibility', 'reasoningTokens', 'reasoningEffort']);
const MAX_STRING_LENGTH = 16_384;
const MAX_ARRAY_LENGTH = 1_000;
const MAX_DEPTH = 12;

function sanitizePipelineValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key) && !SAFE_REASONING_METADATA_KEYS.has(key)) return '[REDACTED]';
  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]` : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizePipelineValue(item, '', depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      sanitizePipelineValue(childValue, childKey, depth + 1),
    ]));
  }
  return null;
}

export function stringifyPipelineValue(value: unknown): string {
  return JSON.stringify(sanitizePipelineValue(value));
}
