import { randomUUID } from 'node:crypto';
import type { SpeculativeBranch } from '../../types/temporal-agent';

type BranchType = SpeculativeBranch['type'];
type RawBranch = Record<string, unknown>;

const IMPROVEMENT_TYPES = new Set(['mejora', 'improvement', 'mejora de código', 'mejora_codigo']);
const BREAKTHROUGH_TYPES = new Set(['innovacion', 'innovación', 'breakthrough', 'descubrimiento', 'discovery']);
const TREND_TYPES = new Set(['tendencia', 'trend', 'evolucion', 'evolución', 'evolution']);

export function cleanJsonString(str: string): string {
  return str.replace(/,\s*([\]}])/g, '$1');
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find((candidate) => candidate != null && String(candidate).length > 0);
  return value == null ? undefined : String(value);
}

function normalizeMessage(b: RawBranch): string {
  return (
    firstString(
      b.message,
      b.mensaje,
      b.name,
      b.nombre,
      b.title,
      b.titulo,
      b.branchName,
      b.nombreRama,
      b.nombre_rama,
    ) ?? 'Speculative Branch'
  ).slice(0, 100);
}

function normalizeRationale(b: RawBranch): string {
  return firstString(
    b.rationale,
    b.justificacion,
    b.explicacion,
    b.justificación,
    b.explicación,
    b.razon,
    b.razón,
  ) ?? '';
}

function normalizeDescription(b: RawBranch): string | null {
  const description = firstString(
    b.description,
    b.descripcion,
    b.descripción,
    b.detalle,
    b.detail,
  )?.trim();
  return description ? description : null;
}

function normalizeBranchType(value: unknown): BranchType {
  if (typeof value !== 'string') return 'improvement';
  const type = value.toLowerCase().trim();
  if (IMPROVEMENT_TYPES.has(type)) return 'improvement';
  if (BREAKTHROUGH_TYPES.has(type)) return 'breakthrough';
  if (TREND_TYPES.has(type)) return 'trend';
  return 'improvement';
}

function normalizeConfidence(value: unknown): number {
  let confidence = value;
  if (typeof confidence === 'string') {
    confidence = confidence.endsWith('%')
      ? parseFloat(confidence) / 100
      : parseFloat(confidence);
  }
  if (typeof confidence !== 'number' || isNaN(confidence)) return 0.5;
  return Math.max(0, Math.min(1, confidence));
}

export function normalizeBranch(raw: unknown): SpeculativeBranch | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as RawBranch;
  const sourceId = firstString(b.id, b.id_especulativa) ?? null;
  const reasoning = firstString(
    b.reasoning,
    b.razonamiento,
    b.explicacion_detallada,
    b.explicación_detallada,
    b.pensamiento,
  );
  const agentPrompt = firstString(
    b.agentPrompt,
    b.promptAgente,
    b.prompt_agente,
    b.instrucciones,
    b.instruccionesAgente,
  );

  return {
    id: randomUUID(),
    sourceId,
    message: normalizeMessage(b),
    description: normalizeDescription(b),
    rationale: normalizeRationale(b),
    type: normalizeBranchType(b.type ?? b.tipo),
    confidence: normalizeConfidence(b.confidence ?? b.confianza),
    reasoning,
    agentPrompt,
    predictionIndex: b.predictionIndex != null ? Number(b.predictionIndex) : undefined,
  };
}

function validJsonCandidate(candidate: string): string | null {
  try {
    JSON.parse(cleanJsonString(candidate));
    return candidate;
  } catch {
    return null;
  }
}

function extractFromCodeBlocks(text: string): string | null {
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const candidate = validJsonCandidate(match[1].trim());
    if (candidate) return candidate;
  }
  return null;
}

function extractKnownObjectShape(text: string): string | null {
  const match = text.match(/\{[\s\S]*(?:"branches"|"ramas"|"ideas"|"predictions")\s*:\s*\[[\s\S]*\][\s\S]*\}/i);
  return match ? validJsonCandidate(match[0]) : null;
}

function extractDelimited(text: string, open: string, close: string): string | null {
  const first = text.indexOf(open);
  const last = text.lastIndexOf(close);
  if (first === -1 || last === -1 || last <= first) return null;
  return validJsonCandidate(text.slice(first, last + 1));
}

function extractBalanced(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '{' && char !== '[') continue;

    const closingChar = char === '{' ? '}' : ']';
    let depth = 1;
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === char) depth++;
      else if (text[j] === closingChar) depth--;

      if (depth === 0) {
        const candidate = validJsonCandidate(text.slice(i, j + 1));
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  return (
    validJsonCandidate(trimmed) ??
    extractFromCodeBlocks(text) ??
    extractKnownObjectShape(text) ??
    extractDelimited(text, '{', '}') ??
    extractDelimited(text, '[', ']') ??
    extractBalanced(text)
  );
}

/**
 * Las ramas de la respuesta del Agente Temporal. La skill pide sólo JSON; se lee a
 * la defensiva y una salida mala da cero ramas. Acepta `branches` o `ramas`, o el
 * arreglo suelto.
 */
export function parseBranches(text: string): SpeculativeBranch[] {
  const jsonStr = extractJson(text);
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(cleanJsonString(jsonStr)) as unknown;
    let rawBranches: unknown[] = [];
    if (Array.isArray(parsed)) rawBranches = parsed;
    else if (parsed && Array.isArray((parsed as { branches?: unknown }).branches)) rawBranches = (parsed as { branches: unknown[] }).branches;
    else if (parsed && Array.isArray((parsed as { ramas?: unknown }).ramas)) rawBranches = (parsed as { ramas: unknown[] }).ramas;
    const valid: SpeculativeBranch[] = [];
    for (const raw of rawBranches) {
      const branch = normalizeBranch(raw);
      if (branch) valid.push(branch);
    }
    return valid;
  } catch {
    return [];
  }
}
