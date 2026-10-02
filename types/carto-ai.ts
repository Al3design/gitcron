// types/carto-ai.ts
//
// Cartografía — Fase 4. Contrato de la CAPA DE PROVEEDOR DE IA, compartido entre
// el proceso main (donde se arma y dispara la petición) y el renderer (que sólo
// consume texto ya generado). Tipos planos, serializables por IPC, SIN secretos:
// ninguna API key aparece acá, ni entra ni sale por estas formas.
//
// La IA de Cartografía REUTILIZA la infra multi-proveedor del Temporal Agent
// (electron/ai/*): el vault cifrado `key-store`, el `fetchWithTimeout` y la regla
// de CSP en lockstep. No duplica esa infra; suma un proveedor LOCAL ('lmstudio',
// API compatible OpenAI en localhost:1234, sin key) junto al online ('openrouter',
// ya existente y ya en el CSP). La IA NUNCA se dispara sola: todo entra por una
// acción explícita del usuario y está apagada por defecto.

import type { CartoImpact, CartoNode } from '../lib/carto-types';

/**
 * Proveedor concreto que atiende explain/ask. Alineado con el vocabulario de
 * proveedores del Temporal Agent (`openrouter` se reutiliza tal cual). `lmstudio`
 * es el proveedor LOCAL nuevo: servidor compatible OpenAI en localhost, sin key.
 */
export type CartoAIProviderId = 'lmstudio' | 'openrouter';

/** Familia del proveedor: local (en tu máquina) u online (un tercero por red). */
export type CartoAIMode = 'local' | 'online';

/**
 * Preferencias de la IA de Cartografía. NO es secreto: vive en un JSON plano de
 * `userData` (no en el vault cifrado, que es sólo para keys). Opt-in y apagado
 * por defecto — ver {@link DEFAULT_CARTO_AI_SETTINGS}.
 */
export interface CartoAISettings {
  /** Master switch. `false` por defecto: sin esto, la vista jamás llama a la IA. */
  enabled: boolean;
  /** Qué familia usar cuando está habilitada. */
  mode: CartoAIMode;
  /**
   * Override de modelo, opcional. Para `local` es el nombre del modelo cargado en
   * LM Studio (vacío = el que LM Studio tenga activo). Para `online` es un id de
   * modelo de OpenRouter (vacío = el default del adapter).
   */
  model?: string;
}

/** Default conservador: IA apagada, y si se prende arranca en LOCAL (sin red). */
export const DEFAULT_CARTO_AI_SETTINGS: CartoAISettings = {
  enabled: false,
  mode: 'local',
  model: '',
};

/**
 * Referencia mínima a un nodo del grafo que la IA va a explicar. Es un subconjunto
 * de {@link import('../lib/carto-types').CartoNode} — sólo lo que sirve de anclaje,
 * sin ids opacos del motor. Mantenerlo plano evita mandar más contexto del necesario.
 */
export interface CartoAINodeRef {
  name: string;
  kind: string;
  /** Ruta relativa POSIX del archivo del símbolo. */
  filePath: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
}

/**
 * Contexto ESTRUCTURAL verificado que acompaña a un explain/ask. Sale del grafo
 * CodeGraph (lib/carto-types), no de la imaginación del modelo: son las mismas
 * relaciones reales que el panel ya muestra. Pasarlo como grounding ata la
 * respuesta a hechos del repo en vez de dejar al modelo inventar aristas.
 */
export interface CartoAIContext {
  /** Idioma de la respuesta esperado (ES/EN/ZH). */
  lang?: string;
  /** Archivo focal (cuando la pregunta es sobre un archivo, no un símbolo). */
  filePath?: string;
  /** Archivos que el foco importa ("importa a"). */
  imports?: string[];
  /** Archivos que importan al foco ("es usado por"). */
  usedBy?: string[];
  /** Resumen del radio de impacto, ya agregado por el motor. */
  impact?: { fileCount: number; symbolCount: number; sampleFiles?: string[] };
  // ── Fase 5: grounding a nivel SÍMBOLO (para explicar un nodo) ──
  /** Código del nodo, ya RECORTADO en main (nunca el archivo/repo entero). */
  source?: string;
  /** Quién llama/usa al nodo, en forma legible `name — filePath`. */
  callers?: string[];
  /** Qué llama/usa el nodo, en forma legible `name — filePath`. */
  callees?: string[];
  // ── Fase 6: grounding RECUPERADO por una pregunta libre (no por un archivo) ──
  /**
   * Símbolos relevantes a la pregunta, recuperados estructuralmente del grafo
   * (búsqueda por nombre + vecinos por relación). Es un contexto CHICO y verificado:
   * nunca el repo entero, sólo los nodos que tocan la pregunta.
   */
  retrieved?: {
    /** Símbolos recuperados, en forma mínima (nombre, clase, archivo, firma). */
    symbols?: { name: string; kind: string; filePath: string; signature?: string }[];
    /** Relaciones entre esos símbolos, en forma legible (p. ej. `A → llama → B`). */
    relations?: string[];
  };
}

export interface CartoAIPanoramaContext {
  lang?: string;
  structureHash: string;
  totals: { nodes: number; edges: number };
  groups: Array<{
    role: string;
    label: string;
    fileCount: number;
    keyFiles: string[];
  }>;
  links: Array<{
    fromRole: string;
    toRole: string;
    count: number;
    samples: string[];
  }>;
}

/**
 * Resultado de una pregunta libre scoped al repo activo (la "ventanita de
 * preguntas", Fase 6). Trae la respuesta en lenguaje natural MÁS los nodos que la
 * fundamentan: los símbolos recuperados del grafo (clickeables para abrir su
 * detalle) y los archivos citados. `promptChars` reporta el tamaño del contexto
 * enviado, para verificar que el recorte se mantiene chico.
 */
export interface CartoAskResult {
  /** Respuesta del modelo (texto + procedencia). */
  answer: CartoAIResponse;
  /** Nodos del grafo recuperados que fundamentan la respuesta (para citar/abrir). */
  usedNodes: CartoNode[];
  /** Archivos distintos citados, derivados de `usedNodes` (chips clickeables). */
  usedFiles: string[];
  /** Tamaño (caracteres) del contexto enviado al modelo. */
  promptChars: number;
}

export interface CartoPanoramaFlow {
  title: string;
  steps: string[];
}

export interface CartoPanoramaText {
  oneLine: string;
  paragraph: string;
  flows: CartoPanoramaFlow[];
  provider: string;
  generatedAt: string;
}

export interface CartoPanoramaResult {
  structureHash: string;
  panorama: CartoPanoramaText | null;
  cached: boolean;
  aiError?: string;
  promptChars?: number;
}

/**
 * Símbolo relacionado en forma MÍNIMA, para el panel de detalle y el prompt: sólo
 * nombre, clase y archivo (sin ids opacos del motor). Es el subconjunto de
 * {@link import('../lib/carto-types').CartoRelatedSymbol} que la vista necesita.
 */
export interface CartoAIRelated {
  name: string;
  kind: string;
  filePath: string;
}

/**
 * Contexto MÍNIMO Y PRECISO de un nodo, armado en main desde el grafo CodeGraph:
 * el código/firma del nodo + sus callers, callees e impacto. NADA más — este
 * recorte es la clave del ahorro de tokens y de que la explicación sea verdadera
 * (sólo relaciones reales, nunca el repo entero). Lo consume el panel de detalle
 * para mostrar estructura aunque la IA esté apagada.
 */
export interface CartoNodeContext {
  /** Identidad del nodo (nombre, clase, ubicación, firma). */
  node: CartoAINodeRef;
  /** Ruta estable del nodo para cachear, p. ej. `lib/cart.ts#calculateTotal`. */
  nodePath: string;
  /** Código del nodo, recortado. Vacío si el motor no pudo leerlo. */
  source: string;
  /** `true` si el código se truncó por tope (líneas o caracteres). */
  sourceTruncated: boolean;
  /** Hash del contenido del nodo (clave de caché de la explicación). */
  contentHash: string;
  /** Quién llama/usa al nodo (callers), acotado. */
  callers: CartoAIRelated[];
  /** Qué llama/usa el nodo (callees), acotado. */
  callees: CartoAIRelated[];
  /** Radio de impacto del nodo (qué se rompería si se toca). */
  impact: CartoImpact;
}

/**
 * Resultado de explicar un nodo: SIEMPRE trae el contexto estructural (para el
 * panel, aun con la IA apagada) y, cuando la IA está activa y disponible, la
 * explicación en lenguaje natural. `cached` distingue una respuesta reusada de la
 * caché de una recién generada; `aiError` lleva el mensaje claro si la IA estaba
 * activa pero falló (servidor caído, sin key…). `promptChars` reporta el tamaño
 * del contexto enviado al modelo (para verificar el recorte).
 */
export interface CartoExplainNodeResult {
  context: CartoNodeContext;
  explanation: CartoAIResponse | null;
  cached: boolean;
  aiError?: string;
  promptChars?: number;
}

/** Respuesta de la IA: texto plano ya generado + procedencia. Sin secretos. */
export interface CartoAIResponse {
  /** Cuerpo en lenguaje natural para mostrar en el panel. */
  text: string;
  /** Procedencia legible, p. ej. `lmstudio:local-model` o `openrouter:<model>`. */
  provider: string;
  /** ISO timestamp de generación. */
  generatedAt: string;
}

/**
 * Resultado de sondear el proveedor activo SIN gastar una generación: dice si
 * está alcanzable (p. ej. LM Studio levantado en localhost:1234, o que hay key de
 * OpenRouter). Alimenta el estado del selector en Ajustes.
 */
export interface CartoAIProbe {
  available: boolean;
  /** «Proveedor · modelo» de gitcron.json; vacío si no se llegó a resolver. */
  provider: string;
  /** Mensaje claro cuando `available` es `false` (servidor local caído, falta key…). */
  detail?: string;
}
