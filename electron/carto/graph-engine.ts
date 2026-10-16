// electron/carto/graph-engine.ts
//
// Cartografía — Fase 3. Motor estructural CodeGraph EMBEBIDO en el proceso main.
//
// Es el sustrato que mantiene honesta a la IA: un grafo local de símbolos, llamadas
// e imports del repo activo. Invariantes de la fase:
//   · CERO RED — CodeGraph es 100% local (SQLite vía node:sqlite). No abre sockets.
//   · Todo el cómputo vive acá, en main. El renderer sólo recibe el contrato
//     normalizado (lib/carto-types) traducido por el adapter (lib/carto-from-codegraph).
//   · No toca lógica de Git.
//
// Dónde vive el índice (decisión de la fase): en `<repo>/.codegraph-gitcron/`.
// El SDK siempre guarda el DB bajo projectRoot (`open`/`init` lo derivan; el
// override `CODEGRAPH_DIR` es sólo un NOMBRE de carpeta, no una ruta a userData,
// y relocalizar a userData exigiría forkear el constructor privado del motor).
// Usamos un nombre DEDICADO, no el `.codegraph/` por defecto, a propósito:
//   · Aísla a GitCron de cualquier índice externo de CodeGraph (CLI, o el daemon
//     MCP que puede correr sobre el mismo repo). Reusar ese índice ajeno nos hacía
//     heredar un grafo INCOMPLETO (faltaban aristas de imports sin resolver, p. ej.
//     "es usado por" daba 0 en archivos muy usados) y arriesgaba contención de
//     SQLite ("database is locked") entre dos procesos sobre el mismo DB.
//   · El motor reconoce `.codegraph-*` como carpeta de datos suya, así que la
//     auto-ignora al indexar y al watch-ear. Está gitignoreada en este proyecto.
// El índice es naturalmente per-repo: cada repo abierto tiene el suyo.

import * as path from 'node:path';
import { createHash } from 'node:crypto';

// Nombre dedicado del directorio de índice de GitCron (ver bloque de arriba).
// `CODEGRAPH_DIR` se lee en vivo por el motor, así que basta fijarlo en el env del
// proceso main antes de cualquier llamada al SDK.
const GITCRON_CODEGRAPH_DIR = '.codegraph-gitcron';
process.env.CODEGRAPH_DIR = GITCRON_CODEGRAPH_DIR;
// SÓLO TIPOS: `import type` no genera un `require` en runtime, así que este import
// NO carga el módulo nativo al arrancar. El valor (la clase `CodeGraph`) se carga
// de forma DIFERIDA — ver `loadCodeGraph()` más abajo.
import type { CodeGraph, IndexProgress, Node } from '@colbymchenry/codegraph';
import {
  adaptRelated,
  adaptSearchHits,
  adaptImpact,
  toCartoNode,
  type RawRelated,
} from '../../lib/carto-from-codegraph';
import type {
  CartoGraphStatus,
  CartoGraph,
  CartoSearchHit,
  CartoRelatedSymbol,
  CartoImpact,
  CartoFileRelations,
  CartoNode,
  CartoEdgeRelation,
} from '../../lib/carto-types';
import type { CartoNodeContext, CartoAIRelated } from '../../types/carto-ai';
import { extractQueryTerms } from '../../lib/carto-retrieval';
import { scanRepoFilePaths } from './repo-files';

// Profundidad de impacto: 3 niveles es el default del motor y un radio razonable
// para "qué se rompe si toco esto" sin volverse todo el grafo.
const IMPACT_DEPTH = 3;
// Tope de símbolos de un archivo sobre los que calculamos impacto, para acotar el
// trabajo en archivos enormes (la unión de sus radios sigue siendo representativa).
const IMPACT_SYMBOL_CAP = 60;

// Recorte del CÓDIGO de un nodo para el contexto de la IA (Fase 5): nunca mandamos
// el archivo entero. Un símbolo que excede estos topes se trunca — el grounding no
// necesita el cuerpo completo, sólo lo suficiente para explicar qué hace.
const NODE_SOURCE_LINE_CAP = 160;
const NODE_SOURCE_CHAR_CAP = 6000;
// Tope de callers/callees adjuntos al contexto: una muestra basta para explicar el
// rol del nodo sin inflar el prompt (el panel ya muestra la lista completa).
const NODE_RELATED_CAP = 12;

// ── Recuperación para la ventanita de preguntas (Fase 6) ──
// La clave de la fase es que el contexto sea CHICO: sólo los nodos que tocan la
// pregunta, recuperados por nombre + sus vecinos inmediatos por relación. Estos
// topes acotan ese radio para que el prompt no crezca con el tamaño del repo.
const RETRIEVE_PER_TERM = 5; // hits por término buscado
const RETRIEVE_SEED_CAP = 6; // símbolos "semilla" (los mejor rankeados)
const RETRIEVE_NEIGHBORS_PER_SEED = 4; // vecinos (callers+callees) por semilla
const RETRIEVE_NODE_CAP = 24; // total de nodos citados (semillas + vecinos)
const RETRIEVE_RELATION_CAP = 30; // total de aristas legibles para el prompt

// Lente Grafo semántico (F7): la foto global se acota en main para que repos
// grandes no saturen ni el IPC ni el renderer. La selección prioriza archivos
// con más relaciones reales; el orden final es determinista.
const SEMANTIC_GRAPH_NODE_CAP = 220;
const SEMANTIC_GRAPH_EDGE_CAP = 520;
const FILE_NODE_PREFIX = 'file:';

function fileNodeId(filePath: string): string {
  return `${FILE_NODE_PREFIX}${createHash('sha1').update(filePath).digest('hex').slice(0, 18)}`;
}

function toFileCartoNode(filePath: string): CartoNode {
  return {
    id: fileNodeId(filePath),
    name: path.posix.basename(filePath),
    kind: 'file',
    filePath,
    startLine: 1,
    endLine: 1,
  };
}

interface EngineEntry {
  cg: CodeGraph | null;
  status: CartoGraphStatus;
  /** Indexado en vuelo, para no re-disparar mientras corre. */
  task: Promise<void> | null;
  /** Notificador al renderer cuando el watch re-sincroniza (índice fresco). */
  onUpdated?: () => void;
}

/** Un motor por repo, keyed por ruta absoluta resuelta. */
const entries = new Map<string, EngineEntry>();

function rootOf(repoPath: string): string {
  return path.resolve(repoPath);
}

function sanitize(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

// ── Carga DIFERIDA del motor CodeGraph ──
// El paquete `@colbymchenry/codegraph` arrastra binarios nativos (tree-sitter y
// `web-tree-sitter`) que en algunos empaquetados (p. ej. el `.exe` de producción)
// no resuelven. Si el import fuera estático (de valor) al tope del módulo, ese
// `require` correría al ARRANQUE del main —porque el IPC de Cartografía se registra
// al inicio— y tumbaría TODA la app antes de mostrar ventana. Por eso cargamos la
// clase la PRIMERA vez que se usa Cartografía, cacheada, y detrás de un guard: si el
// módulo nativo falta, Cartografía degrada con un aviso y el resto de GitCron sigue.
type CodeGraphClass = (typeof import('@colbymchenry/codegraph'))['CodeGraph'];

/**
 * El motor de análisis (CodeGraph) no está disponible en esta instalación: su
 * módulo nativo no pudo cargarse. Es un fallo ESPERABLE y acotado a Cartografía —
 * NO debe voltear la app. El handler lo traduce a un estado degradado para la UI.
 */
export class CartoEngineUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Carto engine (CodeGraph) is unavailable in this installation');
    this.name = 'CartoEngineUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** Clase `CodeGraph` cacheada tras la primera carga exitosa (no re-importa). */
let codeGraphClass: CodeGraphClass | null = null;

/**
 * Extrae la clase `CodeGraph` del namespace de `await import(...)`, tolerando el
 * interop CJS/ESM. El paquete es CommonJS y re-exporta un bundle por plataforma con
 * un `require` dinámico (`module.exports = require(resolveLibrary())`), así que el
 * cjs-module-lexer NO puede detectar los named exports: `await import()` deja la
 * clase bajo `.default.CodeGraph`, no en `.CodeGraph`. En el bundle de esbuild, en
 * cambio, aparece como `.CodeGraph`. Probamos ambas formas. Devuelve `null` si no
 * encontramos una clase (constructor) — el caller lo trata como motor no disponible.
 */
export function resolveCodeGraphExport(mod: unknown): CodeGraphClass | null {
  const ns = mod as { CodeGraph?: unknown; default?: { CodeGraph?: unknown } };
  const candidate = ns?.CodeGraph ?? ns?.default?.CodeGraph;
  return typeof candidate === 'function' ? (candidate as CodeGraphClass) : null;
}

/**
 * Importa dinámicamente la clase `CodeGraph`, cacheándola. Si el módulo nativo no
 * resuelve —o no expone la clase—, lanza {@link CartoEngineUnavailableError} (nunca
 * un throw crudo), para que quien la invoque pueda degradar con gracia en vez de
 * propagar el crash.
 */
async function loadCodeGraph(): Promise<CodeGraphClass> {
  if (codeGraphClass) return codeGraphClass;
  try {
    const mod = await import('@colbymchenry/codegraph');
    const ctor = resolveCodeGraphExport(mod);
    if (!ctor) throw new Error('CodeGraph class not found on @colbymchenry/codegraph module');
    codeGraphClass = ctor;
    return codeGraphClass;
  } catch (error) {
    console.error('[carto-graph] CodeGraph engine unavailable:', sanitize(error));
    throw new CartoEngineUnavailableError(error);
  }
}

export interface EnsureGraphOptions {
  /** Se invoca con cada avance del indexado (para reflejarlo en la UI). */
  onProgress?: (status: CartoGraphStatus) => void;
  /** Se invoca cuando el watch re-sincroniza el índice tras una edición. */
  onUpdated?: () => void;
}

/**
 * Garantiza que el repo tenga un índice abierto y fresco. NO bloquea: si hay que
 * indexar, lanza el trabajo en background y devuelve de inmediato el estado
 * `indexing`; el avance llega por `onProgress` y el fin por cambio de estado
 * (el renderer re-consulta `getGraphStatus`). Idempotente: si ya está listo o
 * indexando, no re-dispara.
 */
export function ensureGraph(repoPath: string, opts: EnsureGraphOptions = {}): CartoGraphStatus {
  const root = rootOf(repoPath);
  let entry = entries.get(root);
  if (!entry) {
    entry = { cg: null, status: { state: 'idle' }, task: null };
    entries.set(root, entry);
  }
  if (opts.onUpdated) entry.onUpdated = opts.onUpdated;

  if (entry.status.state === 'ready' || entry.status.state === 'indexing') {
    return entry.status;
  }

  entry.status = { state: 'indexing', progress: { phase: 'scanning', current: 0, total: 0 } };
  entry.task = buildIndex(root, entry, opts).catch((error) => {
    // Si el motor nativo no está disponible, degradamos a un estado DEDICADO
    // (`engine-unavailable`) que el renderer traduce a un aviso amable, en vez de
    // un `error` genérico. Cualquier otro fallo sí es un error real del índice.
    entry!.status =
      error instanceof CartoEngineUnavailableError
        ? { state: 'engine-unavailable' }
        : { state: 'error', error: sanitize(error) };
    console.error('[carto-graph] index error:', sanitize(error));
    opts.onProgress?.(entry!.status);
  });
  return entry.status;
}

async function buildIndex(root: string, entry: EngineEntry, opts: EnsureGraphOptions): Promise<void> {
  const onIndexProgress = (p: IndexProgress) => {
    entry.status = {
      state: 'indexing',
      progress: { phase: p.phase, current: p.current, total: p.total },
    };
    opts.onProgress?.(entry.status);
  };

  // Carga diferida del motor. Si el módulo nativo falta, `loadCodeGraph` lanza
  // CartoEngineUnavailableError y `ensureGraph` lo traduce a un estado degradado.
  const Engine = await loadCodeGraph();

  let cg: CodeGraph;
  if (Engine.isInitialized(root)) {
    // Ya hay un índice NUESTRO (mismo CODEGRAPH_DIR dedicado). Lo abrimos y, si lo
    // construyó un motor más viejo (`isIndexStale`), lo re-indexamos completo para
    // re-resolver todas las relaciones; si no, basta un `sync` incremental.
    cg = await Engine.open(root, { sync: false });
    if (cg.isIndexStale()) {
      await cg.indexAll({ onProgress: onIndexProgress });
    } else {
      await cg.sync({ onProgress: onIndexProgress });
    }
  } else {
    // Primer índice de este repo: crear `.codegraph-gitcron/` e indexar completo.
    cg = await Engine.init(root, { index: false });
    await cg.indexAll({ onProgress: onIndexProgress });
  }

  entry.cg = cg;
  entry.status = { state: 'ready', ...readStats(cg) };
  opts.onProgress?.(entry.status);

  // Watch nativo del motor: re-sincroniza al editar sin bloquear el renderer.
  // Ignora `.codegraph/` y `.git/` por sí mismo. Al terminar cada sync avisamos
  // al renderer para que refresque las relaciones que esté mostrando.
  try {
    cg.watch({
      onSyncComplete: () => {
        if (entry.cg) entry.status = { state: 'ready', ...readStats(entry.cg) };
        entry.onUpdated?.();
      },
      onSyncError: (error) => console.error('[carto-graph] sync error:', sanitize(error)),
    });
  } catch (error) {
    // El watch es una mejora, no es load-bearing: si el SO no lo soporta, el
    // índice queda igual de válido (sólo no se auto-refresca).
    console.error('[carto-graph] watch unavailable:', sanitize(error));
  }
}

function readStats(cg: CodeGraph): Pick<CartoGraphStatus, 'stats' | 'lastIndexedAt'> {
  const s = cg.getStats();
  return {
    stats: { files: s.fileCount, nodes: s.nodeCount, edges: s.edgeCount },
    lastIndexedAt: cg.getLastIndexedAt(),
  };
}

/** Estado actual del índice de un repo (sin disparar nada). */
export function getGraphStatus(repoPath: string): CartoGraphStatus {
  return entries.get(rootOf(repoPath))?.status ?? { state: 'idle' };
}

/** El motor listo de un repo, o null si todavía no está indexado. */
function readyGraph(repoPath: string): CodeGraph | null {
  const entry = entries.get(rootOf(repoPath));
  return entry && entry.status.state === 'ready' ? entry.cg : null;
}

/** Búsqueda de símbolos por texto. `null` si el índice no está listo aún. */
export function searchGraph(repoPath: string, query: string, limit?: number): CartoSearchHit[] | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  const q = query.trim();
  if (!q) return [];
  return adaptSearchHits(cg.searchNodes(q, limit ? { limit } : undefined), limit);
}

/** Quién llama / referencia a un símbolo. `null` si el índice no está listo. */
export function graphCallers(repoPath: string, nodeId: string): CartoRelatedSymbol[] | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  return adaptRelated(cg.getCallers(nodeId) as RawRelated[]);
}

/** Qué llama / referencia un símbolo. `null` si el índice no está listo. */
export function graphCallees(repoPath: string, nodeId: string): CartoRelatedSymbol[] | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  return adaptRelated(cg.getCallees(nodeId) as RawRelated[]);
}

/** Radio de impacto de un símbolo. `null` si el índice no está listo. */
export function graphImpact(repoPath: string, nodeId: string): CartoImpact | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  const focal = cg.getNode(nodeId);
  const sg = cg.getImpactRadius(nodeId, IMPACT_DEPTH);
  return adaptImpact([...sg.nodes.values()], {
    filePath: focal?.filePath,
    ids: new Set([nodeId]),
  });
}

/**
 * Paquete de relaciones de un ARCHIVO (alimenta el panel de QA del Explorador):
 * a qué importa, quién lo usa, y el impacto agregado de sus símbolos. `null` si
 * el índice no está listo aún.
 */
export function graphFileRelations(repoPath: string, filePath: string): CartoFileRelations | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;

  // ¿El motor trackea este archivo? Los assets no-código (SVG, imágenes, etc.) no
  // están en el índice: devolvemos `indexed: false` para que la vista lo distinga
  // de un archivo de código que sí está pero no tiene relaciones.
  const indexed = cg.getFile(filePath) !== null;
  if (!indexed) {
    return { filePath, indexed, imports: [], usedBy: [], impact: emptyImpact() };
  }

  const imports = cg.getFileDependencies(filePath);
  const usedBy = cg.getFileDependents(filePath);

  // Impacto a nivel archivo: unión de los radios de impacto de sus símbolos.
  const nodes = cg.getNodesInFile(filePath);
  const focalIds = new Set(nodes.map((n) => n.id));
  const symbols = nodes.filter((n) => n.kind !== 'file').slice(0, IMPACT_SYMBOL_CAP);

  const impactedById = new Map<string, Node>();
  for (const sym of symbols) {
    const sg = cg.getImpactRadius(sym.id, IMPACT_DEPTH);
    for (const node of sg.nodes.values()) {
      if (!focalIds.has(node.id)) impactedById.set(node.id, node);
    }
  }

  const impact = adaptImpact([...impactedById.values()], { filePath, ids: focalIds });
  return { filePath, indexed, imports, usedBy, impact };
}

/** Impacto vacío para archivos fuera del grafo (no-código). */
function emptyImpact(): CartoImpact {
  return { impactedFiles: [], impactedSymbols: [], total: 0, truncated: false };
}

/** Imports resueltos de un archivo según el índice; `null` si el índice no está listo. */
export function graphFileDependencies(repoPath: string, filePath: string): string[] | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  if (!cg.getFile(filePath)) return [];
  try {
    return cg.getFileDependencies(filePath);
  } catch {
    return [];
  }
}

/**
 * Símbolos de un archivo (función/clase/método/…), para el selector de nodos del
 * panel de detalle. Excluye el nodo `file` (representa el archivo, no un símbolo) y
 * los `import` (ruido). Ordenados por línea para reflejar el orden del archivo.
 * `null` si el índice no está listo aún.
 */
export function graphFileSymbols(repoPath: string, filePath: string): CartoNode[] | null {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  return cg
    .getNodesInFile(filePath)
    .filter((n) => n.kind !== 'file' && n.kind !== 'import')
    .sort((a, b) => a.startLine - b.startLine)
    .map(toCartoNode);
}

interface SnapshotGraphSource {
  getFiles(): Array<{ path: string }>;
  getFileDependencies(filePath: string): string[];
}

export function buildGraphSnapshot(
  cg: SnapshotGraphSource,
  repoFilePaths: string[],
  repoScanTruncated = false,
  generatedAt = Date.now(),
): CartoGraph {
  const fileNodeByPath = new Map<string, CartoNode>();
  for (const filePath of repoFilePaths) {
    fileNodeByPath.set(filePath, toFileCartoNode(filePath));
  }
  for (const file of cg.getFiles()) {
    fileNodeByPath.set(file.path, toFileCartoNode(file.path));
  }

  const rawEdges = new Map<string, { fromId: string; toId: string; relation: CartoEdgeRelation }>();
  const degreeByNode = new Map<string, number>();
  for (const file of cg.getFiles().sort((a, b) => a.path.localeCompare(b.path))) {
    const fromPath = file.path;
    const fromNode = fileNodeByPath.get(fromPath);
    if (!fromNode) continue;
    for (const toPath of cg.getFileDependencies(fromPath)) {
      const toNode = fileNodeByPath.get(toPath);
      if (!toNode || fromNode.id === toNode.id) continue;
      const edge = { fromId: fromNode.id, toId: toNode.id, relation: 'import' as const };
      const key = `${edge.fromId}->${edge.toId}:${edge.relation}`;
      if (!rawEdges.has(key)) rawEdges.set(key, edge);
      degreeByNode.set(fromNode.id, (degreeByNode.get(fromNode.id) ?? 0) + 1);
      degreeByNode.set(toNode.id, (degreeByNode.get(toNode.id) ?? 0) + 1);
    }
  }

  const rankedNodes = [...fileNodeByPath.values()].sort((a, b) => {
    const byDegree = (degreeByNode.get(b.id) ?? 0) - (degreeByNode.get(a.id) ?? 0);
    return byDegree || a.filePath.localeCompare(b.filePath);
  });
  const visibleNodes = rankedNodes.slice(0, SEMANTIC_GRAPH_NODE_CAP);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = [...rawEdges.values()]
    .filter((edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId))
    .sort((a, b) => {
      const aDegree = (degreeByNode.get(a.fromId) ?? 0) + (degreeByNode.get(a.toId) ?? 0);
      const bDegree = (degreeByNode.get(b.fromId) ?? 0) + (degreeByNode.get(b.toId) ?? 0);
      return bDegree - aDegree || `${a.fromId}${a.toId}`.localeCompare(`${b.fromId}${b.toId}`);
    })
    .slice(0, SEMANTIC_GRAPH_EDGE_CAP);

  return {
    nodes: visibleNodes,
    allNodes: rankedNodes,
    edges: visibleEdges,
    totals: { nodes: fileNodeByPath.size, edges: rawEdges.size },
    truncated: repoScanTruncated || visibleNodes.length < fileNodeByPath.size || visibleEdges.length < rawEdges.size,
    generatedAt,
  };
}

/** Foto global normalizada para la lente "Grafo": archivos como nodos y aristas reales. */
export async function graphSnapshot(repoPath: string): Promise<CartoGraph | null> {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  const root = rootOf(repoPath);
  const scan = await scanRepoFilePaths(root);
  return buildGraphSnapshot(cg, scan.paths, scan.truncated);
}

/**
 * Recuperación ESTRUCTURAL para una pregunta libre (Fase 6): los nodos del grafo
 * que tocan la pregunta + sus relaciones, listos para fundamentar la respuesta.
 * `nodes` arranca por las semillas (símbolos que matchean los términos) y sigue con
 * sus vecinos; `relations` son las aristas reales entre ellos, en forma legible.
 */
export interface GraphRetrieval {
  nodes: CartoNode[];
  relations: string[];
}

/** Verbo legible para una relación del grafo (para el prompt y nada más). */
function relationVerb(relation: CartoEdgeRelation): string {
  switch (relation) {
    case 'call':
      return 'llama a';
    case 'import':
      return 'importa';
    case 'extends':
      return 'extiende';
    case 'contains':
      return 'contiene';
    case 'export':
      return 'exporta';
    default:
      return 'usa';
  }
}

/**
 * Semillas de la recuperación: busca símbolos por cada término, se queda con el
 * mejor score por nodo (deduplicado), excluye nodos `file`/`import` (queremos
 * símbolos reales) y devuelve los mejor rankeados, acotados a `RETRIEVE_SEED_CAP`.
 */
function retrieveSeeds(repoPath: string, terms: string[]): CartoNode[] {
  const bestById = new Map<string, CartoSearchHit>();
  for (const term of terms) {
    const hits = searchGraph(repoPath, term, RETRIEVE_PER_TERM) ?? [];
    for (const hit of hits) {
      if (hit.node.kind === 'file' || hit.node.kind === 'import') continue;
      const prev = bestById.get(hit.node.id);
      if (!prev || hit.score > prev.score) bestById.set(hit.node.id, hit);
    }
  }
  return [...bestById.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, RETRIEVE_SEED_CAP)
    .map((h) => h.node);
}

/**
 * Vecinos por relación de las semillas: para cada una, una muestra de quién la
 * llama/usa y a qué llama/usa. Acumula los nodos vecinos (deduplicados, junto a las
 * semillas) y las aristas reales en forma legible, todo acotado por los topes.
 */
function retrieveNeighbors(repoPath: string, seeds: CartoNode[]): GraphRetrieval {
  const nodesById = new Map<string, CartoNode>();
  for (const s of seeds) nodesById.set(s.id, s);
  const relations: string[] = [];
  const seenRel = new Set<string>();

  const addNode = (node: CartoNode) => {
    if (nodesById.size < RETRIEVE_NODE_CAP && !nodesById.has(node.id)) nodesById.set(node.id, node);
  };
  const addRelation = (from: string, verb: string, to: string) => {
    const key = `${from}|${verb}|${to}`;
    if (seenRel.has(key) || relations.length >= RETRIEVE_RELATION_CAP) return;
    seenRel.add(key);
    relations.push(`${from} ${verb} ${to}`);
  };

  for (const seed of seeds) {
    for (const c of (graphCallers(repoPath, seed.id) ?? []).slice(0, RETRIEVE_NEIGHBORS_PER_SEED)) {
      addNode(c.node);
      addRelation(c.node.name, relationVerb(c.relation), seed.name);
    }
    for (const c of (graphCallees(repoPath, seed.id) ?? []).slice(0, RETRIEVE_NEIGHBORS_PER_SEED)) {
      addNode(c.node);
      addRelation(seed.name, relationVerb(c.relation), c.node.name);
    }
  }

  return { nodes: [...nodesById.values()], relations };
}

/**
 * Recupera, para una pregunta libre, un contexto CHICO y verificado del grafo del
 * repo: busca símbolos por los términos de la pregunta (búsqueda por nombre), toma
 * las mejores semillas y suma sus vecinos inmediatos (callers/callees). Devuelve los
 * nodos citables y las aristas reales entre ellos. NUNCA vuelca el repo entero: todo
 * está acotado por los topes `RETRIEVE_*`. `null` si el índice no está listo aún.
 *
 * La recuperación es por NOMBRE/relación (estructural). La difusa por significado
 * (embeddings) es una fase posterior — acá no se usa.
 */
export function graphRetrieve(repoPath: string, question: string): GraphRetrieval | null {
  if (!readyGraph(repoPath)) return null;

  // Términos de la pregunta. Si todo eran palabras vacías, caemos a la pregunta
  // cruda como único término (una pregunta de una sola palabra sigue anclando).
  let terms = extractQueryTerms(question);
  if (terms.length === 0) {
    const raw = question.trim();
    if (raw) terms = [raw];
  }

  return retrieveNeighbors(repoPath, retrieveSeeds(repoPath, terms));
}

/** Reduce un símbolo relacionado a su forma mínima para contexto/panel. */
function toRelated(rs: CartoRelatedSymbol): CartoAIRelated {
  return { name: rs.node.name, kind: rs.node.kind, filePath: rs.node.filePath };
}

function syntheticFilePath(cg: CodeGraph, nodeId: string): string | null {
  if (!nodeId.startsWith(FILE_NODE_PREFIX)) return null;
  return cg.getFiles().find((file) => fileNodeId(file.path) === nodeId)?.path ?? null;
}

async function graphFileNodeContext(cg: CodeGraph, filePath: string): Promise<CartoNodeContext> {
  const symbols = cg
    .getNodesInFile(filePath)
    .filter((n) => n.kind !== 'file' && n.kind !== 'import')
    .sort((a, b) => a.startLine - b.startLine);
  const sampledSymbols = symbols.slice(0, NODE_RELATED_CAP);

  let source = '';
  let sourceTruncated = symbols.length > sampledSymbols.length;
  for (const symbol of sampledSymbols) {
    try {
      const code = (await cg.getCode(symbol.id)) ?? '';
      if (!code) continue;
      source += `${source ? '\n\n' : ''}// ${symbol.name} (${symbol.startLine}-${symbol.endLine})\n${code}`;
    } catch (error) {
      console.error('[carto-graph] getCode error:', sanitize(error));
    }
    if (source.length > NODE_SOURCE_CHAR_CAP) {
      source = source.slice(0, NODE_SOURCE_CHAR_CAP);
      sourceTruncated = true;
      break;
    }
  }

  const callersByKey = new Map<string, CartoAIRelated>();
  const calleesByKey = new Map<string, CartoAIRelated>();
  for (const symbol of sampledSymbols) {
    for (const rel of adaptRelated(cg.getCallers(symbol.id) as RawRelated[], 4).map(toRelated)) {
      callersByKey.set(`${rel.name}|${rel.filePath}|${rel.kind}`, rel);
    }
    for (const rel of adaptRelated(cg.getCallees(symbol.id) as RawRelated[], 4).map(toRelated)) {
      calleesByKey.set(`${rel.name}|${rel.filePath}|${rel.kind}`, rel);
    }
  }

  const focalIds = new Set(symbols.map((n) => n.id));
  const impactedById = new Map<string, Node>();
  for (const symbol of symbols.slice(0, IMPACT_SYMBOL_CAP)) {
    const sg = cg.getImpactRadius(symbol.id, IMPACT_DEPTH);
    for (const node of sg.nodes.values()) {
      if (!focalIds.has(node.id)) impactedById.set(node.id, node);
    }
  }

  const endLine = Math.max(1, ...symbols.map((n) => n.endLine));
  const contentHash = createHash('sha256')
    .update(`${filePath}\n${symbols.map((s) => `${s.qualifiedName}:${s.signature ?? ''}`).join('\n')}\n${source}`)
    .digest('hex');

  return {
    node: {
      name: path.posix.basename(filePath),
      kind: 'file',
      filePath,
      startLine: 1,
      endLine,
      signature: `${symbols.length} symbols`,
    },
    nodePath: filePath,
    source,
    sourceTruncated,
    contentHash,
    callers: [...callersByKey.values()].slice(0, NODE_RELATED_CAP),
    callees: [...calleesByKey.values()].slice(0, NODE_RELATED_CAP),
    impact: adaptImpact([...impactedById.values()], { filePath, ids: focalIds }),
  };
}

/**
 * Contexto MÍNIMO Y PRECISO de un nodo para explicarlo (Fase 5): el código/firma
 * del nodo + sus callers, callees e impacto. NADA más — ni el archivo entero ni el
 * repo. Recorta el código a topes defensivos y calcula el `contentHash` (clave de
 * caché): si el código del nodo no cambió, la explicación guardada sigue valiendo.
 * `null` si el índice no está listo o el nodo no existe.
 */
export async function graphNodeContext(
  repoPath: string,
  nodeId: string,
): Promise<CartoNodeContext | null> {
  const cg = readyGraph(repoPath);
  if (!cg) return null;
  const filePath = syntheticFilePath(cg, nodeId);
  if (filePath) return graphFileNodeContext(cg, filePath);

  const node = cg.getNode(nodeId);
  if (!node) return null;

  // Código del nodo (el motor lo lee entre startLine/endLine). Lo recortamos para
  // no mandar cuerpos gigantes: el grounding no los necesita. Si el archivo no se
  // puede leer (borrado, permisos), degradamos a sin-código: la explicación sigue
  // valiendo desde las relaciones, y el panel muestra igual la estructura.
  let source = '';
  try {
    source = (await cg.getCode(nodeId)) ?? '';
  } catch (error) {
    console.error('[carto-graph] getCode error:', sanitize(error));
  }
  let sourceTruncated = false;
  const lines = source.split('\n');
  if (lines.length > NODE_SOURCE_LINE_CAP) {
    source = lines.slice(0, NODE_SOURCE_LINE_CAP).join('\n');
    sourceTruncated = true;
  }
  if (source.length > NODE_SOURCE_CHAR_CAP) {
    source = source.slice(0, NODE_SOURCE_CHAR_CAP);
    sourceTruncated = true;
  }

  const callers = adaptRelated(cg.getCallers(nodeId) as RawRelated[], NODE_RELATED_CAP).map(toRelated);
  const callees = adaptRelated(cg.getCallees(nodeId) as RawRelated[], NODE_RELATED_CAP).map(toRelated);

  const sg = cg.getImpactRadius(nodeId, IMPACT_DEPTH);
  const impact = adaptImpact([...sg.nodes.values()], {
    filePath: node.filePath,
    ids: new Set([nodeId]),
  });

  // Hash del CONTENIDO del nodo: identidad cualificada + firma + código. Cambia
  // exactamente cuando el nodo cambia, invalidando la caché de su explicación.
  const contentHash = createHash('sha256')
    .update(`${node.qualifiedName}\n${node.signature ?? ''}\n${source}`)
    .digest('hex');

  return {
    node: {
      name: node.name,
      kind: node.kind,
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      ...(node.signature ? { signature: node.signature } : {}),
    },
    nodePath: `${node.filePath}#${node.name}`,
    source,
    sourceTruncated,
    contentHash,
    callers,
    callees,
    impact,
  };
}

/** Cierra el índice de un repo y libera recursos (detiene su watch). */
function disposeGraph(repoPath: string): void {
  const root = rootOf(repoPath);
  const entry = entries.get(root);
  if (!entry) return;
  try {
    entry.cg?.unwatch();
    entry.cg?.close();
  } catch (error) {
    console.error('[carto-graph] dispose error:', sanitize(error));
  }
  entries.delete(root);
}

/** Cierra TODOS los índices abiertos. Se llama desde app 'before-quit'. */
export function closeAllGraphs(): void {
  for (const root of [...entries.keys()]) disposeGraph(root);
}
