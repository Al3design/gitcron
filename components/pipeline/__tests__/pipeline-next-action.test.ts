import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import type { RuntimeProjection } from '@/types/pipeline';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';
import {
  composeApplyInstruction,
  composeArchiveInstruction,
  composeExploreInstruction,
  composeProposeInstruction,
  deriveArchiveAvailability,
  derivePipelineNextAction,
  hasDiffEvidence,
  isValidChangeSlug,
  resolveTaskLabel,
  resolveTaskText,
  type PipelineNextActionInput,
} from '../pipeline-next-action';

/**
 * Forma real de la evidencia: `id` es el hash estable que produce
 * `parseMarkdownTasks`, y la numeración humana vive dentro del texto.
 */
function task(label: string, completed: boolean, text = `hacer ${label}`) {
  return {
    id: `hash-${label.replace('.', '-')}`,
    text: `${label} ${text}`,
    completed,
    line: 1,
    sourceRef: 'tasks.md',
  };
}

function change(overrides: Partial<OpenSpecChangeSummary> = {}): OpenSpecChangeSummary {
  return {
    changeId: 'demo-change',
    intent: 'intención',
    tasks: [task('1.1', true), task('1.2', false)],
    proposalExists: true,
    designExists: true,
    specsCount: 1,
    validation: 'unknown',
    artifacts: null,
    ...overrides,
  };
}

function projection(overrides: Partial<RuntimeProjection> = {}): RuntimeProjection {
  return {
    schemaVersion: '1.0',
    repoId: 'repo-1',
    sessionId: 'session-1',
    runtime: 'claude',
    changeId: 'demo-change',
    taskId: '1.2',
    role: 'builder',
    active: false,
    outcome: 'completed',
    startedAt: '2026-07-28T10:00:00.000Z',
    endedAt: '2026-07-28T10:05:00.000Z',
    agents: [],
    activity: [],
    reasoningVisibility: 'unknown',
    telemetry: null,
    controlCapabilities: [],
    droppedActivity: 0,
    diagnostics: [],
    ...overrides,
  } as RuntimeProjection;
}

function input(overrides: Partial<PipelineNextActionInput> = {}): PipelineNextActionInput {
  return {
    fixtureActive: false,
    selectedChange: null,
    selectedArchivedChangeId: null,
    projection: null,
    ...overrides,
  };
}

describe('derivePipelineNextAction · matriz de estados', () => {
  it('declara la vista previa y no ofrece ninguna acción', () => {
    const result = derivePipelineNextAction(input({ fixtureActive: true, selectedChange: change() }));
    expect(result.kind).toBe('fixture-preview');
    expect(result.primary).toBeNull();
    expect(result.secondary).toBeNull();
  });

  it('sin cambio activo distingue proponer de explorar', () => {
    const result = derivePipelineNextAction(input());
    expect(result.kind).toBe('no-active-change');
    expect(result.primary?.intent.kind).toBe('open-propose-flow');
    expect(result.secondary?.intent.kind).toBe('open-explore-flow');
  });

  it('con cambios en curso y ninguno elegido no afirma que no haya ninguno', () => {
    // El defecto que introdujo la pantalla de entrada: al retirar la selección
    // por descarte, `selectedChange` nulo pasó a ser el estado normal, y la guía
    // lo seguía leyendo como un repositorio vacío. La pantalla listaba cuatro
    // cambios en curso y debajo afirmaba que no había ninguno.
    const result = derivePipelineNextAction(input({ hasActiveChanges: true }));
    expect(result.kind).toBe('no-change-selected');
    expect(result.helpKey).not.toBe('pipeline.next.noActive.help');
    // Los dos caminos siguen siendo los mismos: lo que cambia es lo que declara.
    expect(result.primary?.intent.kind).toBe('open-propose-flow');
    expect(result.secondary?.intent.kind).toBe('open-explore-flow');
  });

  it('un archivado seleccionado gana sobre no haber elegido ninguno activo', () => {
    const result = derivePipelineNextAction(input({
      hasActiveChanges: true,
      selectedArchivedChangeId: 'viejo-change',
    }));
    expect(result.kind).toBe('change-archived');
  });

  it('un cambio archivado informa que ese trabajo terminó', () => {
    const result = derivePipelineNextAction(input({ selectedArchivedChangeId: 'viejo-change' }));
    expect(result.kind).toBe('change-archived');
    expect(result.primary?.intent.kind).toBe('open-propose-flow');
  });

  it('nombra la próxima tarea pendiente y compone su instrucción', () => {
    const result = derivePipelineNextAction(input({ selectedChange: change() }));
    expect(result.kind).toBe('task-pending');
    expect(result.titleParams).toMatchObject({ task: '1.2', completed: 1, total: 2 });
    expect(result.primary?.intent).toEqual({ kind: 'start-apply', changeId: 'demo-change', taskId: '1.2' });
    expect(result.instruction).toContain('tarea 1.2');
    expect(result.instruction).toContain('hacer 1.2');
    expect(result.instruction).toContain('«demo-change»');
  });

  it('un fallo del motor en tarea pendiente informa el motivo real y no arranca ninguna sesión', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      engineInstructions: {
        instruction: null,
        context: null,
        error: 'Change is blocked by dependency: specs missing',
      },
    }));
    expect(result.kind).toBe('task-pending');
    expect(result.helpKey).toBe('pipeline.next.engineError');
    expect(result.helpParams?.error).toBe('Change is blocked by dependency: specs missing');
    expect(result.primary).toBeNull();
    expect(result.instruction).toBeNull();
  });

  it('un fallo del motor en reintento de sesión informa el motivo real y no arranca ninguna sesión', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ outcome: 'failed' }),
      engineInstructions: {
        instruction: null,
        context: null,
        error: 'Engine crashed with exit code 1',
      },
    }));
    expect(result.kind).toBe('session-retry');
    expect(result.helpKey).toBe('pipeline.next.engineError');
    expect(result.helpParams?.error).toBe('Engine crashed with exit code 1');
    expect(result.primary).toBeNull();
    expect(result.instruction).toBeNull();
  });

  it('con sesión activa dirige a la actividad y no ofrece arrancar otra', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ active: true, outcome: 'running' }),
    }));
    expect(result.kind).toBe('session-running');
    expect(result.primary?.executable).toBe(false);
    expect(result.secondary).toBeNull();
  });

  it('ofrece pausar sólo cuando la sesión declara la capability', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ active: true, outcome: 'running', controlCapabilities: ['pause-after-task'] }),
    }));
    expect(result.secondary?.intent.kind).toBe('pause-after-task');
  });

  it('una sesión fallida ofrece reintentar la misma tarea', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ outcome: 'failed' }),
    }));
    expect(result.kind).toBe('session-retry');
    expect(result.primary?.intent).toEqual({ kind: 'start-apply', changeId: 'demo-change', taskId: '1.2' });
    // Reintentar entrega la misma instrucción que la primera vez: si difiriera,
    // el reintento no sería del mismo trabajo.
    expect(result.instruction).toBe(composeApplyInstruction('demo-change', '1.2', 'hacer 1.2'));
  });

  it('una sesión interrumpida también ofrece reintentar', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ outcome: 'interrupted' }),
    }));
    expect(result.kind).toBe('session-retry');
  });

  it('con tareas completas y validación desconocida pide comprobar el cambio', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'unknown' }),
    }));
    expect(result.kind).toBe('validation-unknown');
    expect(result.primary?.intent.kind).toBe('refresh-validation');
  });

  it('con validación fallida dirige a corregir', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'failed' }),
    }));
    expect(result.kind).toBe('validation-failed');
  });

  it('con validación aprobada ofrece archivar', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'passed' }),
    }));
    expect(result.kind).toBe('ready-to-archive');
    expect(result.primary?.intent).toEqual({ kind: 'start-archive', changeId: 'demo-change' });
    expect(result.instruction).toBe('openspec archive demo-change --yes');
  });

  it('listo para archivar sin ningún diff no ofrece verlos', () => {
    // Los diffs salen de sesiones de runtime lanzadas desde la aplicación. Un
    // cambio trabajado a mano o desde la terminal no genera ninguno, así que el
    // caso vacío es el habitual, y ofrecer la acción llevaba a un panel vacío.
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'passed' }),
      hasDiffs: false,
    }));
    expect(result.kind).toBe('ready-to-archive');
    expect(result.primary?.intent).toEqual({ kind: 'start-archive', changeId: 'demo-change' });
    expect(result.secondary).toBeNull();
  });

  it('listo para archivar con diffs sí ofrece verlos', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'passed' }),
      hasDiffs: true,
    }));
    expect(result.kind).toBe('ready-to-archive');
    expect(result.secondary?.intent).toEqual({ kind: 'view-diff' });
  });

  it('el panel y la guía comparten el criterio de evidencia de diff', () => {
    // Estaban divergiendo: el botón del panel condicionado y la guía ofreciendo
    // la acción siempre. El criterio es uno solo para que no vuelvan a separarse.
    expect(hasDiffEvidence({ diffs: [] })).toBe(false);
    expect(hasDiffEvidence({ diffs: null })).toBe(false);
    expect(hasDiffEvidence({})).toBe(false);
    expect(hasDiffEvidence({ diffs: [{}] })).toBe(true);
  });

  it('distingue el archivo en curso de una tarea en curso', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'passed' }),
      projection: projection({ active: true, outcome: 'running', taskId: null }),
    }));
    expect(result.kind).toBe('archiving');
    expect(result.secondary).toBeNull();
  });
});

describe('derivePipelineNextAction · prioridad entre estados superpuestos', () => {
  it('el fixture gana sobre cualquier otro estado', () => {
    const result = derivePipelineNextAction(input({
      fixtureActive: true,
      selectedChange: change(),
      projection: projection({ active: true, outcome: 'running' }),
    }));
    expect(result.kind).toBe('fixture-preview');
  });

  it('la sesión activa gana sobre la tarea pendiente', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ active: true, outcome: 'running' }),
    }));
    expect(result.kind).toBe('session-running');
  });

  it('el reintento gana sobre la tarea pendiente cuando la sesión cerró sin avanzar', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ outcome: 'completed' }),
    }));
    expect(result.kind).toBe('session-retry');
  });
});

describe('derivePipelineNextAction · honestidad de la evidencia', () => {
  it('ninguna acción derivada de un fixture es ejecutable', () => {
    const scenarios: PipelineNextActionInput[] = [
      input({ fixtureActive: true, selectedChange: change() }),
      input({ fixtureActive: true, selectedChange: change({ tasks: [task('1.1', true)], validation: 'passed' }) }),
      input({ fixtureActive: true, selectedArchivedChangeId: 'viejo' }),
      input({ fixtureActive: true, projection: projection({ active: true, outcome: 'running' }) }),
    ];
    for (const scenario of scenarios) {
      const result = derivePipelineNextAction(scenario);
      expect(result.primary?.executable ?? false).toBe(false);
      expect(result.secondary?.executable ?? false).toBe(false);
    }
  });

  it('la validación fallida nunca habilita archivar', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true)], validation: 'failed' }),
    }));
    expect(result.primary?.intent.kind).not.toBe('start-archive');
    expect(result.secondary?.intent.kind).not.toBe('start-archive');
  });

  it('un proceso terminado no marca la tarea como completada', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change(),
      projection: projection({ outcome: 'completed', taskId: '1.2' }),
    }));
    expect(result.kind).toBe('session-retry');
    expect(result.titleKey).toBe('pipeline.next.retry.stalledTitle');
  });

  it('cuando la tarea sí avanzó, pasa a la siguiente en vez de ofrecer reintento', () => {
    const result = derivePipelineNextAction(input({
      selectedChange: change({ tasks: [task('1.1', true), task('1.2', true), task('1.3', false)] }),
      projection: projection({ outcome: 'completed', taskId: '1.2' }),
    }));
    expect(result.kind).toBe('task-pending');
    expect(result.titleParams).toMatchObject({ task: '1.3' });
  });

  it('es determinística: las mismas entradas dan el mismo resultado', () => {
    const scenario = input({ selectedChange: change(), projection: projection({ active: true, outcome: 'running' }) });
    expect(derivePipelineNextAction(scenario)).toEqual(derivePipelineNextAction(scenario));
  });
});

describe('composición de instrucciones', () => {
  /**
   * Las tres instrucciones que empezaban con un comando de extensión —`/opsx:…`—
   * sólo funcionaban si el runtime lo tenía instalado. Con Claude no existe
   * `.claude/commands/`, así que la sesión terminaba sin hacer nada. Ahora
   * nombran los comandos del CLI, que es lo que esos guiones hacen igual.
   */
  it('la instrucción de implementación nombra cambio, tarea y texto, y consume datos del motor', () => {
    const instruction = composeApplyInstruction('c1', '2.1', 'hacer algo', {
      instruction: 'Read context files and work through tasks.',
      context: 'Language: es\nRegla de prueba',
    });

    expect(instruction).toContain('«c1»');
    expect(instruction).toContain('tarea 2.1');
    expect(instruction).toContain('hacer algo');
    expect(instruction).toContain('Read context files and work through tasks.');
    expect(instruction).toContain('Contexto del proyecto:\nLanguage: es\nRegla de prueba');
    // La instrucción ya no enumera comandos del CLI a mano
    expect(instruction).not.toContain('openspec status --change');
  });

  it('compone Archive', () => {
    expect(composeArchiveInstruction('c1')).toBe('openspec archive c1 --yes');
  });

  it('la instrucción de propuesta nombra el slug, el objetivo y las restricciones', () => {
    const instruction = composeProposeInstruction('mi-cambio', 'lograr X', 'sin tocar Y', {
      instruction: 'Instrucción base del motor',
      context: 'Contexto de arquitectura',
    });

    expect(instruction).toContain('«mi-cambio»');
    expect(instruction).toContain('Instrucción base del motor');
    expect(instruction).toContain('Objetivo: lograr X');
    expect(instruction).toContain('Alcance y restricciones: sin tocar Y');
    expect(instruction).toContain('Contexto del proyecto:\nContexto de arquitectura');
    // No enumera comandos uno por uno a mano
    expect(instruction).not.toContain('openspec new change');
    expect(instruction).not.toContain('openspec status');
  });

  it('omite la línea de alcance cuando no hay restricciones', () => {
    // Emitirla vacía le pediría respetar una restricción que nadie escribió.
    expect(composeProposeInstruction('mi-cambio', 'lograr X')).not.toContain('Alcance y restricciones');
    expect(composeProposeInstruction('mi-cambio', 'lograr X', '   ')).not.toContain('Alcance y restricciones');
  });

  it('la instrucción de exploración no compromete estructura', () => {
    const instruction = composeExploreInstruction('  una idea  ', {
      context: 'Contexto de exploración',
    });

    expect(instruction).toContain('Quiero explorar: una idea');
    // Explorar es pensar antes de decidir: crear un change acá convertiría la
    // duda en una decisión tomada.
    expect(instruction).toContain('sin crear ningún change');
    expect(instruction).not.toContain('openspec new change');
    expect(instruction).toContain('Contexto del proyecto:\nContexto de exploración');
  });

  it('ninguna instrucción depende de un comando de extensión', () => {
    // Ésta es la red contra la regresión: un `/opsx:…` vuelve a atar la acción
    // a que el runtime tenga el guion instalado, y su ausencia no se anuncia.
    const composed = [
      composeApplyInstruction('c1', '2.1', 'hacer algo'),
      composeArchiveInstruction('c1'),
      composeProposeInstruction('mi-cambio', 'lograr X', 'sin tocar Y'),
      composeExploreInstruction('una idea'),
    ];

    for (const instruction of composed) {
      expect(instruction).not.toContain('/opsx:');
      expect(instruction.startsWith('/')).toBe(false);
    }
  });
});

describe('interpolación de textos', () => {
  // Se escapó a producción una frase que mostraba "{{completed}} of {{total}}"
  // porque la ayuda se renderizaba sin sus parámetros. Esta prueba recorre la
  // matriz y verifica que ningún texto quede con marcadores sin resolver.
  const scenarios: Array<[string, PipelineNextActionInput]> = [
    ['fixture', input({ fixtureActive: true, selectedChange: change() })],
    ['sin cambio activo', input()],
    ['archivado', input({ selectedArchivedChangeId: 'viejo' })],
    ['tarea pendiente', input({ selectedChange: change() })],
    ['sesión activa', input({ selectedChange: change(), projection: projection({ active: true, outcome: 'running' }) })],
    ['reintento', input({ selectedChange: change(), projection: projection({ outcome: 'failed' }) })],
    ['validación desconocida', input({ selectedChange: change({ tasks: [task('1.1', true)], validation: 'unknown' }) })],
    ['validación fallida', input({ selectedChange: change({ tasks: [task('1.1', true)], validation: 'failed' }) })],
    ['listo para archivar', input({ selectedChange: change({ tasks: [task('1.1', true)], validation: 'passed' }) })],
  ];

  for (const [name, scenario] of scenarios) {
    it(`resuelve todos los marcadores en "${name}"`, () => {
      const action = derivePipelineNextAction(scenario);
      const rendered = [
        translate(action.titleKey, 'es', action.titleParams),
        translate(action.helpKey, 'es', action.helpParams),
        action.primary ? translate(action.primary.labelKey, 'es', action.primary.labelParams) : '',
        action.secondary ? translate(action.secondary.labelKey, 'es', action.secondary.labelParams) : '',
      ];
      for (const text of rendered) expect(text).not.toMatch(/\{\{|\}\}/);
    });
  }
});

describe('resolveTaskLabel / resolveTaskText', () => {
  // `parseMarkdownTasks` siempre asigna un hash como `id`; el "2.1" queda en el
  // texto. Mostrar el hash era exactamente lo que se veía roto en pantalla.
  it('toma la numeración del texto, no el hash', () => {
    const item = { id: 'a1b2c3d4e5f6', text: '2.1 Add CSS variables' };
    expect(resolveTaskLabel(item)).toBe('2.1');
    expect(resolveTaskText(item)).toBe('Add CSS variables');
  });

  it('admite numeración de un solo nivel y de tres', () => {
    expect(resolveTaskLabel({ id: 'h', text: '3 Preparar' })).toBe('3');
    expect(resolveTaskLabel({ id: 'h', text: '1.2.3 Preparar' })).toBe('1.2.3');
  });

  it('admite el punto o el paréntesis tras el número', () => {
    expect(resolveTaskLabel({ id: 'h', text: '4. Cerrar' })).toBe('4');
    expect(resolveTaskText({ id: 'h', text: '4) Cerrar' })).toBe('Cerrar');
  });

  it('cae al hash cuando la tarea no trae numeración', () => {
    const item = { id: 'a1b2c3d4e5f6', text: 'Sin numerar' };
    expect(resolveTaskLabel(item)).toBe('a1b2c3d4e5f6');
    expect(resolveTaskText(item)).toBe('Sin numerar');
  });

  it('no confunde una versión dentro del texto con la numeración', () => {
    expect(resolveTaskLabel({ id: 'h', text: 'Actualizar a 2.1 el paquete' })).toBe('h');
  });
});

/**
 * Archivar no puede depender de que no queden tareas: la convención de
 * `tasks.md` cierra cada change con una tarea de handoff humano que ningún
 * runtime tilda, así que exigir cero pendientes lo volvía inalcanzable siempre.
 * La validación sigue siendo condición; el pendiente se declara, no se esconde.
 */
describe('deriveArchiveAvailability', () => {
  it('habilita el archivo con validación aprobada y todo tildado', () => {
    const result = deriveArchiveAvailability(
      change({ validation: 'passed', tasks: [task('1.1', true)] }),
      false,
    );
    expect(result).toEqual({ available: true, reasonKey: null, pendingTasks: 0 });
  });

  it('habilita el archivo con validación aprobada aunque queden tareas, y dice cuántas', () => {
    const result = deriveArchiveAvailability(
      change({ validation: 'passed', tasks: [task('1.1', true), task('1.2', false), task('1.3', false)] }),
      false,
    );
    expect(result.available).toBe(true);
    expect(result.pendingTasks).toBe(2);
  });

  it('bloquea con validación fallida y declara el motivo', () => {
    const result = deriveArchiveAvailability(change({ validation: 'failed' }), false);
    expect(result.available).toBe(false);
    expect(result.reasonKey).toBe('pipeline.openspec.archive.blockedFailed');
  });

  it('bloquea con validación sin comprobar y declara el motivo', () => {
    const result = deriveArchiveAvailability(change({ validation: 'unknown' }), false);
    expect(result.available).toBe(false);
    expect(result.reasonKey).toBe('pipeline.openspec.archive.blockedUnknown');
  });

  it('no ofrece archivar un cambio ya archivado ni sin cambio seleccionado', () => {
    expect(deriveArchiveAvailability(change({ validation: 'passed' }), true).available).toBe(false);
    expect(deriveArchiveAvailability(null, false).available).toBe(false);
  });

  it('traduce los motivos en los tres idiomas', () => {
    for (const key of ['pipeline.openspec.archive.blockedFailed', 'pipeline.openspec.archive.blockedUnknown']) {
      for (const locale of ['es', 'en', 'zh'] as const) {
        expect(translate(key, locale)).not.toBe(key);
      }
    }
  });
});

describe('isValidChangeSlug', () => {
  it('acepta los nombres que acepta el CLI (gramática 1.8: admite prefijo numérico)', () => {
    for (const value of ['ok9-name', 'guide-openspec-next-actions', 'a', 'a1', '9start', '100-add-feature']) {
      expect(isValidChangeSlug(value)).toBe(true);
    }
  });

  it('rechaza los mismos nombres que rechaza el CLI', () => {
    for (const value of ['Bad_Name', 'has spaces', 'UPPER', 'trailing-', 'a--b', 'acento-ñ', '']) {
      expect(isValidChangeSlug(value)).toBe(false);
    }
  });
});
