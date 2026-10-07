import type { RuntimeDiscoveryEntry } from '@/types/pipeline';

export type PipelineIntent = 'explore' | 'write-artifact' | 'implement-task';

export type IntentAvailabilityStatus = 'available' | 'partial' | 'unavailable' | 'unverified';

export interface IntentCapabilityResolution {
  status: IntentAvailabilityStatus;
  canLaunch: boolean;
  reasonKey?: string;
  reason: string;
  alternativeRuntime?: string | null;
  alternativeKey?: string;
  alternativeText?: string;
}

/**
 * Cálculo puro de disponibilidad por intención según las capacidades declaradas
 * por el adaptador (design.md, decisión 2, «Revisión 2026-09-29»).
 *
 * Toda IA lanzable desde SDD tiene las mismas capacidades (leer, escribir y
 * correr comandos/pruebas en el repositorio, con confirmación previa humana).
 * La resolución se basa en lo que declara la entrada (launchable, modifiesRepo,
 * startRunsCommands, canResume, evidenceStatus) sin ramificar por nombre de runtime.
 *
 * NOTA DE DEPRECACIÓN (5.3, tanda 27):
 * La intención `'resume'` del lanzador fue retirada porque nunca se usó y queda
 * conceptualmente superada: continuar una sesión no es elegir motor y modelo
 * desde el lanzador (se retoma con el mismo motor, modelo y nivel de la sesión original
 * directamente desde el detalle de la sesión finalizada mediante `pipeline:runtime:resume`).
 */
export function resolveIntentCapability(
  intent: PipelineIntent,
  entry: RuntimeDiscoveryEntry | null | undefined,
): IntentCapabilityResolution {
  if (!entry) {
    return {
      status: 'unavailable',
      canLaunch: false,
      reasonKey: 'pipeline.launcher.intent.runtimeUnavailable',
      reason: 'Runtime no encontrado o no disponible.',
      alternativeRuntime: null,
    };
  }

  // Runtime no lanzable (p. ej. agy o instalado sin start() en hub)
  if (!entry.launchable) {
    return {
      status: 'unavailable',
      canLaunch: false,
      reasonKey: 'pipeline.launcher.intent.runtimeNotLaunchable',
      reason: entry.diagnostics?.[0] ?? 'Este runtime no admite arranque de sesiones.',
      alternativeRuntime: null,
    };
  }

  // Runtime con evidencia no verificada contra una referencia viva (p. ej. opencode hoy):
  // capacidad sin comprobar en todas las intenciones; se muestra y no se bloquea por pending_fixture.
  if (entry.evidenceStatus && entry.evidenceStatus !== 'verified') {
    return {
      status: 'unverified',
      canLaunch: true,
      reasonKey: 'pipeline.launcher.intent.unverified',
      reason: 'Capacidad sin comprobar: el protocolo no se contrastó contra una referencia viva.',
      alternativeRuntime: null,
    };
  }

  // Intención: Explorar (requiere lectura del repo). Todo runtime lanzable puede leer.
  if (intent === 'explore') {
    return {
      status: 'available',
      canLaunch: true,
      reason: '',
      alternativeRuntime: null,
    };
  }

  // Intención: Proponer / escribir artefactos (requiere lectura y modificación del repo).
  if (intent === 'write-artifact') {
    if (entry.startModifiesRepo) {
      return {
        status: 'available',
        canLaunch: true,
        reason: '',
        alternativeRuntime: null,
      };
    }
    return {
      status: 'unavailable',
      canLaunch: false,
      reasonKey: 'pipeline.launcher.intent.unavailableWrite',
      reason: 'Este runtime no puede modificar archivos en el repositorio.',
      alternativeRuntime: null,
    };
  }

  // Intención: Implementar una tarea (requiere lectura, modificación y ejecución de comandos/pruebas).
  if (intent === 'implement-task') {
    if (!entry.startModifiesRepo) {
      return {
        status: 'unavailable',
        canLaunch: false,
        reasonKey: 'pipeline.launcher.intent.unavailableWrite',
        reason: 'Este runtime no puede modificar archivos en el repositorio.',
        alternativeRuntime: null,
      };
    }
    if (entry.startRunsCommands === false) {
      return {
        status: 'unavailable',
        canLaunch: false,
        reasonKey: 'pipeline.launcher.intent.unavailableCommands',
        reason: 'Este runtime no puede correr comandos o pruebas en el repositorio.',
        alternativeRuntime: null,
      };
    }
    return {
      status: 'available',
      canLaunch: true,
      reason: '',
      alternativeRuntime: null,
    };
  }

  return {
    status: 'unavailable',
    canLaunch: false,
    reasonKey: 'pipeline.launcher.intent.runtimeUnavailable',
    reason: 'Operación no compatible con este runtime.',
    alternativeRuntime: null,
  };
}
