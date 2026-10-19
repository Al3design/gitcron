// types/screen-map.ts
//
// Contrato del mapa de pantallas de Cartografía (mapear-pantallas-y-su-codigo, tarea 1.1).
// Una «pantalla» es lo que una persona reconoce al usar la app: una ruta web o una vista
// que cambia sin cambiar de dirección (en GitCron: Graph, SDD, Cartografía…). Una pantalla
// usa muchos archivos y un archivo puede servir a muchas pantallas: la relación es de
// muchos a muchos y cada vínculo dice de dónde salió.

/** De dónde sale una pantalla: una ruta web o una vista elegida por estado, sin URL propia. */
export type ScreenKind = 'route' | 'view';

/**
 * Cómo se sabe que un archivo forma parte de una pantalla.
 * - `static`: se leyó en el código (import resuelto, archivo de ruta o layout).
 * - `inferred`: se dedujo con una regla (convención de nombres, misma carpeta) y puede fallar.
 * - `manual`: lo indicó una persona; ninguna regla lo pisa ni lo borra.
 * - `unknown`: hay un vínculo que no se pudo resolver (import dinámico, ruta calculada).
 */
export type ScreenLinkProvenance = 'static' | 'inferred' | 'manual' | 'unknown';

/** Para qué sirve el archivo dentro de la pantalla, en categorías que se entienden sin programar. */
export type ScreenFileRole = 'screen' | 'component' | 'style' | 'data' | 'logic' | 'text' | 'other';

export type ScreenTag = 'graphics' | 'data' | 'ai' | 'git' | 'settings' | 'content' | 'accounts' | 'payments';

export interface ScreenTagEvidence {
  tag: ScreenTag;
  /** Archivos de la pantalla que hicieron saltar la regla (hasta 5). */
  files: string[];
  /** Cuántos de esos son propios (no compartidos). */
  ownCount: number;
}

export interface ScreenStats {
  /** Archivos por rol, para la barra de composición. */
  byRole: Partial<Record<ScreenFileRole, number>>;
  /** Fecha (ISO) del archivo de la pantalla modificado más recientemente; null si no se pudo leer. */
  lastChangedAt: string | null;
}

export interface ScreenFileLink {
  /** Ruta relativa al repositorio, con `/`. */
  path: string;
  role: ScreenFileRole;
  provenance: ScreenLinkProvenance;
  /**
   * `true` si el archivo también forma parte de otra pantalla del catálogo. Se calcula al
   * armar el catálogo, no lo decide el detector: un compartido no «pertenece» a la primera
   * pantalla que lo encontró.
   */
  shared: boolean;
  /** Si `provenance` es `unknown`, qué no se pudo resolver (por ejemplo «import(`./${x}`)»). */
  unresolved?: string;
}

/** Qué hace la pantalla en lenguaje llano. La manual siempre gana a la sugerida. */
export interface ScreenDescription {
  text: string;
  source: 'manual' | 'ai';
  /** Nombre corto sugerido en lenguaje llano (hasta 40 caracteres). */
  suggestedName?: string;
  /** Para `ai`: los archivos en que se basó. Una sugerencia sin citas no se muestra. */
  citedFiles: string[];
  /** Para `ai`: modelo y fecha, como el resto de las respuestas de IA de la app. */
  model?: string;
  createdAt: string;
}

export interface ScreenEntry {
  /** Estable entre lecturas: `route:/settings` o `view:graph`. */
  id: string;
  kind: ScreenKind;
  /** Nombre legible («Ajustes», «Graph»); el identificador técnico va aparte. */
  name: string;
  /** Ruta web para `route`; el valor de estado que la elige para `view` (por ejemplo `activeView=settings`). */
  locator: string;
  /** El archivo donde se declara la pantalla (archivo de ruta o el switch que elige la vista). */
  declaredIn: string;
  files: ScreenFileLink[];
  description: ScreenDescription | null;
  tags: ScreenTagEvidence[];
  primaryTag: ScreenTag | null;
  stats: ScreenStats;
}

/**
 * Qué tan completo está el mapa. «Cero archivos» no es lo mismo que «no se pudo mirar»:
 * `partial` y `unsupported` lo dicen para que nadie lea un vacío como respuesta.
 */
export type ScreenMapCoverage =
  | { state: 'complete' }
  | { state: 'partial'; unresolved: number; excluded: number; errors: string[] }
  | { state: 'unsupported'; reason: 'no-ui' | 'unknown-stack' }
  | { state: 'indexing'; done: number; total: number };

export interface ScreenMap {
  repoPath: string;
  /** El HEAD sobre el que se leyó: si cambia, el mapa queda viejo. */
  headSha: string | null;
  /** Los detectores que corrieron (por ejemplo `next-app-router`, `gitcron-views`). */
  detectors: string[];
  screens: ScreenEntry[];
  coverage: ScreenMapCoverage;
  readAt: string;
}

/**
 * Una asociación hecha por una persona. Vive fuera de la caché que se regenera, así un
 * reindexado no la pierde. Si su pantalla o su archivo ya no existen, queda pendiente de
 * resolver: no se reasigna sola a algo parecido.
 */
export interface ManualScreenLink {
  screenId: string;
  path: string;
  action: 'add' | 'remove';
  createdAt: string;
  /** Lo calcula la lectura: `true` si la pantalla o el archivo ya no están. */
  orphaned?: boolean;
}

export interface ScreenCapture {
  screenId: string;
  /** `data:image/jpeg;base64,…`, listo para un <img>. */
  dataUrl: string;
  capturedAt: string;
  /** Cambiaron los archivos de la pantalla desde que se sacó: se muestra y se rehace. */
  stale: boolean;
}

export type ScreenCaptureConsent =
  | { status: 'unsupported'; reason: 'no-package' | 'no-start-command' | 'not-installed' }
  | { status: 'needs-consent'; command: string }
  | { status: 'granted'; command: string; grantedAt: string };

export interface ScreenCaptureState {
  consent: ScreenCaptureConsent;
  captures: Record<string, ScreenCapture>;
  running: boolean;
}

export type ScreenCaptureSkipReason = 'view' | 'dynamic-route' | 'timeout' | 'load-failed';

export interface ScreenCaptureRunResult {
  captured: number;
  skipped: { screenId: string; reason: ScreenCaptureSkipReason }[];
  cancelled: boolean;
  /** El servidor no arrancó o se cayó: texto para mostrar. */
  error?: string;
}
