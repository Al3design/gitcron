import type { RuntimeProjection } from '@/types/pipeline';
import type { OpenSpecChangeSummary } from './pipeline-view-state';

/**
 * Derivación del "siguiente paso" del workspace OpenSpec.
 *
 * Vive fuera del componente a propósito: la pregunta "¿qué corresponde hacer
 * ahora?" tiene once respuestas posibles que se superponen entre sí, y resolverla
 * con condicionales encadenados en JSX vuelve imposible probar cada fila por
 * separado. Acá es una función pura: mismas entradas, misma respuesta.
 *
 * La regla de honestidad de F04 sigue mandando. Esta función no infiere que algo
 * pasó porque un proceso terminó; sólo mira evidencia observada (tareas leídas de
 * `tasks.md`, validación, proyección de la sesión).
 */

/**
 * Contrato del slug de un change, unificado con el proceso principal en
 * `lib/openspec-slug` (gramática OpenSpec 1.8: inicial de letra o número, sin
 * guiones consecutivos ni finales; acepta slugs numéricos). Se re-exporta con el
 * nombre histórico para no romper los imports de `pipeline-guided-forms`, y así
 * validación y mensaje de error no pueden divergir entre main y renderer.
 */
export { OPENSPEC_CHANGE_SLUG_PATTERN as CHANGE_SLUG_PATTERN } from '@/lib/openspec-slug';
export { isValidOpenSpecChangeSlug as isValidChangeSlug } from '@/lib/openspec-slug';

/**
 * Qué hace una acción al confirmarse.
 *
 * `executable` en el botón se deriva de esto: sólo los intents que abren un
 * proceso de runtime lo llevan en `true`.
 */
export type PipelineActionIntent =
  | { kind: 'open-propose-flow' }
  | { kind: 'open-explore-flow' }
  | { kind: 'start-apply'; changeId: string; taskId: string }
  | { kind: 'start-archive'; changeId: string }
  | { kind: 'view-activity' }
  | { kind: 'view-evidence' }
  | { kind: 'view-diff' }
  | { kind: 'refresh-validation' }
  | { kind: 'pause-after-task' };

/** Los únicos intents que pueden iniciar un proceso real. */
const EXECUTABLE_INTENTS: ReadonlySet<PipelineActionIntent['kind']> = new Set([
  'start-apply',
  'start-archive',
]);

export type PipelineNextActionButton = {
  intent: PipelineActionIntent;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  /**
   * `true` cuando confirmar la acción abre un runtime. El render no vuelve a
   * decidirlo: si esto es `false`, no hay camino a `pipelineRuntime.start`.
   */
  executable: boolean;
};

export type PipelineNextActionKind =
  | 'fixture-preview'
  | 'session-running'
  | 'archiving'
  | 'session-retry'
  | 'change-archived'
  | 'no-change-selected'
  | 'no-active-change'
  | 'task-pending'
  | 'validation-unknown'
  | 'validation-failed'
  | 'ready-to-archive';

export type PipelineNextAction = {
  kind: PipelineNextActionKind;
  /**
   * No hay campo de posición. OpenSpec abandonó el modelo de fases —se puede
   * trabajar cualquier artefacto habilitado en cualquier momento—, así que
   * declarar «paso N de 5» enseñaba un orden obligatorio que no existe. El
   * estado por artefacto lo da el grafo del CLI; dejar el campo en `null`
   * habría conservado la forma del modelo lista para volver a llenarse.
   */
  titleKey: string;
  titleParams?: Record<string, string | number>;
  /** Una sola frase. El tope es estructural, no estilístico. */
  helpKey: string;
  /** Parámetros de la frase de ayuda. Sin esto los `{{...}}` llegan crudos a pantalla. */
  helpParams?: Record<string, string | number>;
  primary: PipelineNextActionButton | null;
  /** Sólo cuando existe una alternativa real; nunca relleno. */
  secondary: PipelineNextActionButton | null;
  /** Instrucción exacta bajo divulgación progresiva. `null` si no hay ninguna. */
  instruction: string | null;
};

export type EngineInstructionInput = {
  instruction?: string | null;
  context?: string | null;
  error?: string | null;
} | null;

export type PipelineNextActionInput = {
  /** Hay datos de vista previa en pantalla. Bloquea todo lo ejecutable. */
  fixtureActive: boolean;
  selectedChange: OpenSpecChangeSummary | null;
  selectedArchivedChangeId: string | null;
  projection: RuntimeProjection | null;
  /**
   * Instrucciones y contexto devueltos por el motor OpenSpec.
   * Si no se proporcionan, se utilizan las instrucciones por defecto.
   */
  engineInstructions?: EngineInstructionInput;
  /**
   * Si el repositorio tiene cambios en curso, más allá de que haya alguno
   * elegido. Es el dato mínimo que distingue «no elegiste ninguno» de «no hay
   * ninguno»: desde que el panel dejó de entrar a un cambio por descarte, un
   * `selectedChange` nulo es el estado normal de la pantalla de entrada, y sin
   * esto la guía lo leía como un repositorio vacío.
   *
   * Es un booleano y no la lista: la derivación no necesita nada más, y recibir
   * la lista invitaría a que empiece a decidir sobre ella.
   */
  hasActiveChanges?: boolean;
  /**
   * Si hay al menos un diff que mirar. Los diffs se producen a partir de
   * sesiones de runtime lanzadas desde la aplicación, así que un cambio
   * trabajado a mano —o por un agente arrancado desde la terminal, que es el
   * caso habitual acá— no genera ninguno: el conjunto vacío no es marginal, es
   * el normal.
   *
   * Es un booleano y no la lista, por el mismo motivo que `hasActiveChanges`: la
   * derivación no necesita nada más, y recibir la lista invitaría a que empiece
   * a decidir sobre ella.
   */
  hasDiffs?: boolean;
};

/**
 * Si un snapshot trae evidencia de diff.
 *
 * Existe para que la guía y el botón del panel compartan el criterio en vez de
 * repetirlo: estaban divergiendo, con el botón condicionado y la guía
 * ofreciendo la acción siempre, y por el camino de la guía se llegaba a la
 * sub-pestaña de diffs vacía.
 */
export function hasDiffEvidence(snapshot: { diffs?: readonly unknown[] | null }): boolean {
  return (snapshot.diffs?.length ?? 0) > 0;
}

function button(
  intent: PipelineActionIntent,
  labelKey: string,
  labelParams?: Record<string, string | number>,
): PipelineNextActionButton {
  return {
    intent,
    labelKey,
    ...(labelParams ? { labelParams } : {}),
    executable: EXECUTABLE_INTENTS.has(intent.kind),
  };
}

/**
 * Numeración humana de una tarea, tomada del propio texto de `tasks.md`.
 *
 * `TaskEvidence.id` es un hash estable derivado de archivo, línea y contenido:
 * sirve para identificar la tarea aunque se renumere, pero no es lo que la
 * persona escribió ni lo que un agente entiende. El "2.1" vive dentro del texto,
 * así que se extrae de ahí y el hash queda para uso interno.
 */
const TASK_LABEL_PATTERN = /^(\d+(?:\.\d+)*)[.)]?\s+(.*)$/;

export function resolveTaskLabel(task: { id: string; text: string }): string {
  return TASK_LABEL_PATTERN.exec(task.text)?.[1] ?? task.id;
}

/** El texto sin su numeración, para no repetirla al lado de la etiqueta. */
export function resolveTaskText(task: { id: string; text: string }): string {
  return TASK_LABEL_PATTERN.exec(task.text)?.[2] ?? task.text;
}

/**
 * Instrucción de implementación, proveniente del motor OpenSpec.
 *
 * Consume el canal (`instruction`, `context`) que devuelve el CLI en vez de
 * componer comandos a mano. La aplicación agrega únicamente la identificación
 * de la tarea y el cambio.
 */
export function composeApplyInstruction(
  changeId: string,
  taskId: string,
  taskText: string,
  engine?: EngineInstructionInput,
): string {
  const parts: string[] = [];
  const baseInstruction = engine?.instruction?.trim();

  parts.push(
    baseInstruction && baseInstruction.length > 0
      ? `Implementá la tarea ${taskId} del change «${changeId}» en este repositorio.\n\n${baseInstruction}`
      : `Implementá la tarea ${taskId} del change «${changeId}» en este repositorio.`,
  );

  parts.push(`Tarea ${taskId}: ${taskText.trim()}`);

  if (engine?.context && engine.context.trim()) {
    parts.push(`Contexto del proyecto:\n${engine.context.trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Comando real de archivado.
 *
 * Antes devolvía `/opsx:archive <id>`, un slash command que Claude Code no
 * tiene —los lee de `.claude/commands/`, y ahí no existe `opsx`—. La sesión
 * cerraba en milisegundos con `"Unknown command"` e `is_error: false`, así que
 * la app declaraba éxito sin haber archivado nada.
 *
 * Ahora archiva el proceso principal invocando el CLI, y esto es literalmente
 * lo que se ejecuta: lo mostrado y lo ejecutado no pueden divergir.
 */
export function composeArchiveInstruction(changeId: string): string {
  return `openspec archive ${changeId} --yes`;
}

/**
 * Instrucción de propuesta, proveniente del motor OpenSpec.
 *
 * Consume la instrucción del motor si se proporciona y agrega encima
 * únicamente el objetivo y el alcance que escribió la persona, sin enumerar
 * comandos del CLI a mano.
 */
export function composeProposeInstruction(
  slug: string,
  objective: string,
  constraints?: string,
  engine?: EngineInstructionInput,
): string {
  const parts: string[] = [];
  const scope = constraints?.trim();
  const baseInstruction = engine?.instruction?.trim();

  parts.push(
    baseInstruction && baseInstruction.length > 0
      ? `Creá el change «${slug}» en este repositorio y generá sus artefactos de planificación.\n\n${baseInstruction}`
      : `Creá el change «${slug}» en este repositorio y generá sus artefactos de planificación.`,
  );

  parts.push(`Objetivo: ${objective.trim()}`);
  if (scope) {
    parts.push(`Alcance y restricciones: ${scope}`);
  }

  if (engine?.context && engine.context.trim()) {
    parts.push(`Contexto del proyecto:\n${engine.context.trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Instrucción de exploración.
 *
 * No crea nada a propósito: explorar es pensar en voz alta antes de comprometer
 * estructura, y arrancar creando un change convertiría la duda en una decisión.
 */
export function composeExploreInstruction(
  description: string,
  engine?: EngineInstructionInput,
): string {
  const parts: string[] = [
    'Explorá esta idea en el repositorio sin crear ningún change ni artefacto todavía.',
    `Quiero explorar: ${description.trim()}`,
  ];

  if (engine?.instruction && engine.instruction.trim()) {
    parts.push(engine.instruction.trim());
  } else {
    parts.push(
      'Mirá cómo está resuelto hoy, proponé el camino más limpio y decime qué alcance tendría.\nSi la idea se sostiene, el change se crea después, como paso aparte.',
    );
  }

  if (engine?.context && engine.context.trim()) {
    parts.push(`Contexto del proyecto:\n${engine.context.trim()}`);
  }

  return parts.join('\n\n');
}

function taskCounts(change: OpenSpecChangeSummary): { completed: number; total: number } {
  return {
    completed: change.tasks.filter((task) => task.completed).length,
    total: change.tasks.length,
  };
}

/** Disponibilidad del archivado, con su motivo y lo que queda pendiente. */
export type ArchiveAvailability = {
  available: boolean;
  /** Por qué no se puede archivar. `null` cuando sí se puede. */
  reasonKey: string | null;
  /** Tareas sin tildar. Se muestra para que archivar no sea una decisión a ciegas. */
  pendingTasks: number;
};

/**
 * Si archivar está permitido, y qué queda pendiente si lo está.
 *
 * Responde una pregunta distinta a la de `derivePipelineNextAction`. Esa dice
 * qué *conviene* hacer ahora; ésta dice qué está *permitido* hacer. Mezclarlas
 * obligaba a elegir entre mentir —anunciar el archivo como siguiente paso con
 * tareas pendientes— y bloquear, que es lo que pasaba.
 *
 * La validación aprobada es la única condición. Las tareas pendientes NO lo
 * son, y no por comodidad: la convención de `tasks.md` cierra cada change con
 * una tarea de handoff humano que ningún runtime tilda, así que exigir cero
 * pendientes volvía el archivo inalcanzable en todos los changes, siempre. Una
 * sesión persistida tampoco bloquea: es historia, no un permiso.
 *
 * Lo que sí se conserva es que sin validación aprobada no se archiva, y que el
 * pendiente se declara en vez de esconderse.
 */
export function deriveArchiveAvailability(
  change: OpenSpecChangeSummary | null,
  archived: boolean,
): ArchiveAvailability {
  if (!change || archived) return { available: false, reasonKey: null, pendingTasks: 0 };
  const counts = taskCounts(change);
  const pendingTasks = counts.total - counts.completed;
  if (change.validation !== 'passed') {
    return {
      available: false,
      reasonKey: change.validation === 'failed'
        ? 'pipeline.openspec.archive.blockedFailed'
        : 'pipeline.openspec.archive.blockedUnknown',
      pendingTasks,
    };
  }
  return { available: true, reasonKey: null, pendingTasks };
}

/**
 * Deriva el único siguiente paso a mostrar.
 *
 * El orden de evaluación ES la prioridad, y no es arbitrario:
 *
 * 1. El fixture va primero porque es una restricción de seguridad, no un estado
 *    de trabajo: cualquier otra rama podría devolver una acción ejecutable.
 * 2. Recién después se miran sesión, tareas, validación y archivo.
 */
export function derivePipelineNextAction(input: PipelineNextActionInput): PipelineNextAction {
  const { fixtureActive, selectedChange, selectedArchivedChangeId, projection } = input;

  // 1 · Vista previa: se declara como tal y no ofrece ninguna acción.
  if (fixtureActive) {
    return {
      kind: 'fixture-preview',
      titleKey: 'pipeline.next.fixture.title',
      helpKey: 'pipeline.next.fixture.help',
      primary: null,
      secondary: null,
      instruction: null,
    };
  }

  // 2 · Sesión viva. Archivar y trabajar una tarea se ven distintos aunque
  //     ambos sean "hay un proceso corriendo".
  if (projection?.active === true) {
    const archiving = projection.taskId === null && selectedChange?.validation === 'passed';
    const canPause = projection.controlCapabilities.includes('pause-after-task');
    return {
      kind: archiving ? 'archiving' : 'session-running',
      titleKey: archiving ? 'pipeline.next.archiving.title' : 'pipeline.next.running.title',
      ...(archiving || !projection.taskId ? {} : { titleParams: { task: projection.taskId } }),
      helpKey: archiving ? 'pipeline.next.archiving.help' : 'pipeline.next.running.help',
      primary: button({ kind: 'view-activity' }, 'pipeline.next.running.action'),
      // La pausa sólo aparece si la sesión declara soportarla de verdad.
      secondary: !archiving && canPause
        ? button({ kind: 'pause-after-task' }, 'pipeline.next.running.pause')
        : null,
      instruction: null,
    };
  }

  // 4 · Sesión cerrada que no movió la evidencia.
  //
  //     Cubre fallo, interrupción y también el cierre "exitoso" cuya tarea sigue
  //     pendiente en `tasks.md`. Ese último caso es el que evita declarar éxito
  //     porque el proceso terminó.
  if (projection && selectedChange && projection.changeId === selectedChange.changeId) {
    // Se compara contra la etiqueta humana porque es lo que se envió como
    // `taskId` al iniciar la sesión. Compararlo contra el hash no coincidiría
    // nunca y el reintento jamás se ofrecería.
    const targetTask = projection.taskId
      ? selectedChange.tasks.find((task) => resolveTaskLabel(task) === projection.taskId) ?? null
      : null;
    const failed = projection.outcome === 'failed' || projection.outcome === 'interrupted';
    const stalled = targetTask !== null && !targetTask.completed;
    if (targetTask && (failed || stalled)) {
      if (input.engineInstructions?.error) {
        return {
          kind: 'session-retry',
          titleKey: failed ? 'pipeline.next.retry.title' : 'pipeline.next.retry.stalledTitle',
          titleParams: { task: resolveTaskLabel(targetTask) },
          helpKey: 'pipeline.next.engineError',
          helpParams: { error: input.engineInstructions.error },
          primary: null,
          secondary: button({ kind: 'view-activity' }, 'pipeline.next.retry.activity'),
          instruction: null,
        };
      }

      return {
        kind: 'session-retry',
        titleKey: failed ? 'pipeline.next.retry.title' : 'pipeline.next.retry.stalledTitle',
        titleParams: { task: resolveTaskLabel(targetTask) },
        helpKey: failed ? 'pipeline.next.retry.help' : 'pipeline.next.retry.stalledHelp',
        primary: button(
          { kind: 'start-apply', changeId: selectedChange.changeId, taskId: resolveTaskLabel(targetTask) },
          'pipeline.next.retry.action',
          { task: resolveTaskLabel(targetTask) },
        ),
        secondary: button({ kind: 'view-activity' }, 'pipeline.next.retry.activity'),
        instruction: composeApplyInstruction(
          selectedChange.changeId,
          resolveTaskLabel(targetTask),
          resolveTaskText(targetTask),
          input.engineInstructions,
        ),
      };
    }
  }

  // 5 · Cambio archivado seleccionado: ese trabajo terminó.
  if (!selectedChange && selectedArchivedChangeId) {
    return {
      kind: 'change-archived',
      titleKey: 'pipeline.next.archived.title',
      helpKey: 'pipeline.next.archived.help',
      primary: button({ kind: 'open-propose-flow' }, 'pipeline.next.archived.action'),
      secondary: button({ kind: 'open-explore-flow' }, 'pipeline.next.noActive.explore'),
      instruction: null,
    };
  }

  // 6 · Nada elegido, pero sí hay trabajo en curso. Es el estado normal de la
  // pantalla de entrada desde que el panel dejó de entrar a un cambio por
  // descarte, y no es lo mismo que un repositorio sin cambios: afirmarlo era
  // contradecir a la lista que la propia pantalla muestra arriba.
  if (!selectedChange && input.hasActiveChanges) {
    return {
      kind: 'no-change-selected',
      titleKey: 'pipeline.next.noSelection.title',
      helpKey: 'pipeline.next.noSelection.help',
      primary: button({ kind: 'open-propose-flow' }, 'pipeline.next.noActive.propose'),
      secondary: button({ kind: 'open-explore-flow' }, 'pipeline.next.noActive.explore'),
      instruction: null,
    };
  }

  // 7 · Sin cambio activo: los dos caminos se distinguen explícitamente.
  if (!selectedChange) {
    return {
      kind: 'no-active-change',
      titleKey: 'pipeline.next.noActive.title',
      helpKey: 'pipeline.next.noActive.help',
      primary: button({ kind: 'open-propose-flow' }, 'pipeline.next.noActive.propose'),
      secondary: button({ kind: 'open-explore-flow' }, 'pipeline.next.noActive.explore'),
      instruction: null,
    };
  }

  // 7 · Tarea pendiente.
  const nextTask = selectedChange.tasks.find((task) => !task.completed) ?? null;
  if (nextTask) {
    const counts = taskCounts(selectedChange);
    if (input.engineInstructions?.error) {
      return {
        kind: 'task-pending',
        titleKey: 'pipeline.next.task.title',
        titleParams: { task: resolveTaskLabel(nextTask), completed: counts.completed, total: counts.total },
        helpKey: 'pipeline.next.engineError',
        helpParams: { error: input.engineInstructions.error },
        primary: null,
        secondary: null,
        instruction: null,
      };
    }

    return {
      kind: 'task-pending',
      titleKey: 'pipeline.next.task.title',
      titleParams: { task: resolveTaskLabel(nextTask), completed: counts.completed, total: counts.total },
      helpKey: 'pipeline.next.task.help',
      helpParams: { completed: counts.completed, total: counts.total },
      primary: button(
        { kind: 'start-apply', changeId: selectedChange.changeId, taskId: resolveTaskLabel(nextTask) },
        'pipeline.next.task.action',
        { task: resolveTaskLabel(nextTask) },
      ),
      secondary: null,
      instruction: composeApplyInstruction(
        selectedChange.changeId,
        resolveTaskLabel(nextTask),
        resolveTaskText(nextTask),
        input.engineInstructions,
      ),
    };
  }

  // 8 · Tareas completas: manda el estado de validación.
  if (selectedChange.validation === 'failed') {
    return {
      kind: 'validation-failed',
      titleKey: 'pipeline.next.validationFailed.title',
      helpKey: 'pipeline.next.validationFailed.help',
      primary: button({ kind: 'view-evidence' }, 'pipeline.next.validationFailed.action'),
      secondary: null,
      instruction: null,
    };
  }

  if (selectedChange.validation === 'unknown') {
    return {
      kind: 'validation-unknown',
      titleKey: 'pipeline.next.validationUnknown.title',
      helpKey: 'pipeline.next.validationUnknown.help',
      primary: button({ kind: 'refresh-validation' }, 'pipeline.next.validationUnknown.action'),
      secondary: button({ kind: 'view-evidence' }, 'pipeline.next.validationUnknown.evidence'),
      instruction: null,
    };
  }

  // 9 · Validación aprobada y nada pendiente: recién acá aparece archivar.
  //
  // "Ver diff" sólo se ofrece si hay alguno. Sin sesiones de runtime corridas no
  // existe ninguno, y ofrecerlo igual llevaba a la sub-pestaña de diffs vacía:
  // una guía que propone un paso que no lleva a nada deja de servir para saber
  // cuál es el próximo paso.
  return {
    kind: 'ready-to-archive',
    titleKey: 'pipeline.next.readyToArchive.title',
    helpKey: 'pipeline.next.readyToArchive.help',
    primary: button({ kind: 'start-archive', changeId: selectedChange.changeId }, 'pipeline.next.readyToArchive.action'),
    secondary: input.hasDiffs ? button({ kind: 'view-diff' }, 'pipeline.next.readyToArchive.diff') : null,
    instruction: composeArchiveInstruction(selectedChange.changeId),
  };
}
