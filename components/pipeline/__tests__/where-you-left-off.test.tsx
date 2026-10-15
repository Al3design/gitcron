// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { TaskEvidence, OpenSpecChangeEvidence } from '@/types/pipeline';
import {
  deriveResumeCard,
  extractObjectiveSentences,
  extractWhyParagraph,
  extractTaskSection,
  groupTasksBySection,
  parseTaskDetails,
  formatRelativeTime,
} from '../resume-card';
import { WhereYouLeftOffCard } from '../WhereYouLeftOffCard';
import { OpenSpecTasksView } from '../OpenSpecTasksView';
import type { OpenSpecChangeSummary, OpenSpecWorkspaceSnapshot } from '../pipeline-view-state';

describe('Resumen determinista «Dónde quedaste» (Tareas 3.1, 3.3 y 3.5)', () => {
  afterEach(() => {
    cleanup();
  });

  const fixedNow = new Date('2026-10-09T14:00:00Z');

  const sampleProposal = `
# Retomar trabajo con asistencia contextual

## Why

Los historiales actuales registran ejecuciones y decisiones, pero no ofrecen una conversación continua ni una entrada que permita recuperar de inmediato el objetivo y el siguiente paso. El usuario necesita retomar tras semanas y consultar desde cualquier pantalla sin reconstruir manualmente todo el contexto.

## What Changes

- Introducir contexto compartido.
`;

  const sampleTasksRaw = `
# Tasks

## 1. Contrato de contexto

- [x] 1.1 **Orquestador/auditor:** Fijar identidad repo y selección. **Comprobación:** Contrato en design.
- [x] 1.2 **IA local:** Implementar el resolvedor en main. **Comprobación:** Rechaza otro repo.

## 2. Conversación durable

- [x] 2.1 **IA local:** Agregar esquema SQLite. **Comprobación:** Migración idempotente.

## 3. Retomar y orientación

- [ ] 3.1 **IA local:** Construir resumen determinista del cambio con objetivo, evidencia y próximo paso. **Comprobación:** Funciona sin IA; distingue documentos presentes, tareas marcadas, pruebas verificadas y commit.
- [ ] 3.2 **IA local:** Invalidar el resumen por cambios de fuentes. **Comprobación:** Muestra pendiente de relectura.
`;

  const sampleTasks: TaskEvidence[] = [
    { id: '1.1', text: '1.1 **Orquestador/auditor:** Fijar identidad repo y selección. **Comprobación:** Contrato en design.', completed: true, line: 6, sourceRef: 'tasks.md' },
    { id: '1.2', text: '1.2 **IA local:** Implementar el resolvedor en main. **Comprobación:** Rechaza otro repo.', completed: true, line: 7, sourceRef: 'tasks.md' },
    { id: '2.1', text: '2.1 **IA local:** Agregar esquema SQLite. **Comprobación:** Migración idempotente.', completed: true, line: 11, sourceRef: 'tasks.md' },
    { id: '3.1', text: '3.1 **IA local:** Construir resumen determinista del cambio con objetivo, evidencia y próximo paso. **Comprobación:** Funciona sin IA; distingue documentos presentes, tareas marcadas, pruebas verificadas y commit.', completed: false, line: 15, sourceRef: 'tasks.md' },
    { id: '3.2', text: '3.2 **IA local:** Invalidar el resumen por cambios de fuentes. **Comprobación:** Muestra pendiente de relectura.', completed: false, line: 16, sourceRef: 'tasks.md' },
  ];

  const sampleCommit = {
    hash: '3ddfb0b123456789',
    shortHash: '3ddfb0b',
    message: 'docs(openspec): los roles del desarrollo vuelven a los planes',
    date: '2026-10-08T14:00:00Z', // 1 day before fixedNow
  };

  const sampleCommitNew = {
    hash: '97e544e123456789',
    shortHash: '97e544e',
    message: 'style(retomar): alineación y aire adentro',
    date: '2026-10-09T13:30:00Z', // 30 mins before fixedNow
  };

  // -------------------------------------------------------------
  // Los 5 casos requeridos explícitamente por el encargo:
  // 1. sin nada hecho
  // 2. a mitad con commits nuevos
  // 3. a mitad sin evidencia
  // 4. con cambios sin confirmar
  // 5. todo hecho y archivado
  // -------------------------------------------------------------

  it('caso 1: sin nada hecho', () => {
    const unstartedTasks: TaskEvidence[] = sampleTasks.map((t) => ({ ...t, completed: false }));
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasksRaw: sampleTasksRaw,
      tasks: unstartedTasks,
      recentCommits: [],
      commitsAfterLastTask: [],
      uncommittedFiles: [],
      latestSession: null,
      now: fixedNow,
    });

    // Objetivo
    expect(card.objective.text).toContain('Los historiales actuales registran ejecuciones y decisiones');

    // 1. Lo que venías haciendo: frase que dice que no hay nada hecho todavía
    expect(card.whatYouWereDoing.completedTasks).toHaveLength(0);
    expect(card.whatYouWereDoing.commits).toHaveLength(0);
    expect(card.whatYouWereDoing.emptyText).toBe('Todavía no hay tareas completadas ni commits en este cambio.');

    // 2. En qué estabas: primera sin marcar (1.1), y sin evidencia dice que todavía no se empezó
    expect(card.currentWork.currentTask?.id).toBe('1.1');
    expect(card.currentWork.currentTask?.title).toBe('Fijar identidad repo y selección.');
    expect(card.currentWork.evidence.hasEvidence).toBe(false);
    expect(card.currentWork.evidence.emptyText).toBe('Todavía no se empezó a trabajar en esta tarea.');

    // 3. Lo que queda: agrupadas por sección con la próxima resaltada
    expect(card.remainingWork.sections.length).toBeGreaterThan(0);
    expect(card.remainingWork.sections[0].isCurrent).toBe(true);
    expect(card.remainingWork.sections[0].sectionName).toBe('1. Contrato de contexto');
  });

  it('caso 2: a mitad con commits nuevos', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasksRaw: sampleTasksRaw,
      tasks: sampleTasks,
      recentCommits: [sampleCommitNew, sampleCommit],
      commitsAfterLastTask: [sampleCommitNew],
      uncommittedFiles: [],
      latestSession: null,
      now: fixedNow,
    });

    // 1. Lo que venías haciendo: hasta 3 hechas con título legible y últimos commits
    expect(card.whatYouWereDoing.completedTasks).toHaveLength(3);
    expect(card.whatYouWereDoing.completedTasks[0].title).toBe('Fijar identidad repo y selección.');
    expect(card.whatYouWereDoing.commits).toHaveLength(2);
    expect(card.whatYouWereDoing.commits[0].message).toBe('style(retomar): alineación y aire adentro');

    // 2. En qué estabas: 3.1 y evidencia con el commit nuevo de la rama
    expect(card.currentWork.currentTask?.id).toBe('3.1');
    expect(card.currentWork.detail?.responsible).toBe('IA local');
    expect(card.currentWork.evidence.hasEvidence).toBe(true);
    expect(card.currentWork.evidence.commitsAfterLastTask).toHaveLength(1);
    expect(card.currentWork.evidence.commitsAfterLastTask[0].message).toBe('style(retomar): alineación y aire adentro');
    expect(card.currentWork.evidence.emptyText).toBeNull();

    // 3. Lo que queda: sección 3 resaltada con 2 tareas pendientes
    const sec3 = card.remainingWork.sections.find((s) => s.sectionName.includes('3. Retomar'));
    expect(sec3).toBeTruthy();
    expect(sec3?.isCurrent).toBe(true);
    expect(sec3?.pendingTasks).toBe(2);
    expect(sec3?.label).toBe('3. Retomar y orientación: 2 tareas');
  });

  it('caso 3: a mitad sin evidencia', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasksRaw: sampleTasksRaw,
      tasks: sampleTasks,
      recentCommits: [sampleCommit],
      commitsAfterLastTask: [],
      uncommittedFiles: [],
      latestSession: null,
      now: fixedNow,
    });

    // 1. Lo que venías haciendo tiene lo completado
    expect(card.whatYouWereDoing.completedTasks).toHaveLength(3);

    // 2. En qué estabas: 3.1, pero sin evidencia dice que todavía no se empezó
    expect(card.currentWork.currentTask?.id).toBe('3.1');
    expect(card.currentWork.evidence.hasEvidence).toBe(false);
    expect(card.currentWork.evidence.emptyText).toBe('Todavía no se empezó a trabajar en esta tarea.');
  });

  it('caso 4: con cambios sin confirmar', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasksRaw: sampleTasksRaw,
      tasks: sampleTasks,
      recentCommits: [sampleCommit],
      commitsAfterLastTask: [],
      uncommittedFiles: ['components/pipeline/WhereYouLeftOffCard.tsx', 'lib/i18n.ts'],
      latestSession: {
        runtime: 'opencode',
        role: 'IA local',
        outcome: 'completed',
        active: false,
      },
      now: fixedNow,
    });

    // 2. En qué estabas: evidencia incluye los archivos sin confirmar y la última sesión SDD
    expect(card.currentWork.evidence.hasEvidence).toBe(true);
    expect(card.currentWork.evidence.uncommittedFiles).toEqual([
      'components/pipeline/WhereYouLeftOffCard.tsx',
      'lib/i18n.ts',
    ]);
    expect(card.currentWork.evidence.session?.runtime).toBe('opencode');
    expect(card.currentWork.evidence.session?.statusLabel).toBe('completada');
  });

  it('caso 5: todo hecho y archivado', () => {
    const allCompletedTasks: TaskEvidence[] = sampleTasks.map((t) => ({ ...t, completed: true }));

    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      isArchived: true,
      archivedAt: '2026-09-18',
      proposal: sampleProposal,
      tasksRaw: sampleTasksRaw,
      tasks: allCompletedTasks,
      recentCommits: [sampleCommit],
      now: fixedNow,
    });

    expect(card.isArchived).toBe(true);
    expect(card.archivedNotice).toBe('Cambio archivado el 2026-09-18');
    expect(card.whatYouWereDoing.completedTasks).toHaveLength(3);
    expect(card.currentWork.allCompleted).toBe(true);
    expect(card.remainingWork.allCompleted).toBe(true);
    expect(card.remainingWork.sections).toHaveLength(0);
  });

  it('recorta prolijamente sin cortar palabras a la mitad', () => {
    const longSentence = 'Esta es una frase deliberadamente larga que contiene muchas palabras para probar el recorte exacto en los límites de palabras y asegurar que nunca termine con una palabra partida al azar sino con puntos suspensivos prolijos.';
    const trimmed = extractObjectiveSentences(longSentence, 1, 80);

    expect(trimmed.endsWith('…')).toBe(true);
    const withoutEllipsis = trimmed.slice(0, -1);
    expect(withoutEllipsis.endsWith(' ')).toBe(false);
    expect(withoutEllipsis.length).toBeLessThanOrEqual(80);
    const lastWord = withoutEllipsis.split(/\s+/).pop()!;
    expect(longSentence).toContain(lastWord);
  });

  it('soporta textos en inglés (i18n)', () => {
    const card = deriveResumeCard({
      changeId: 'test-change',
      proposal: null,
      tasks: [],
      recentCommits: [],
      locale: 'en',
      t: (key) => {
        const enMap: Record<string, string> = {
          'pipeline.resumeCard.objectiveEmpty': 'The change has no proposal defined yet.',
          'pipeline.resumeCard.noTasks': 'No tasks defined',
          'pipeline.resumeCard.whatYouWereDoingEmpty': 'No completed tasks or commits for this change yet.',
          'pipeline.resumeCard.noWorkStarted': 'Work has not started on this task yet.',
        };
        return enMap[key] ?? key;
      },
    });

    expect(card.objective.text).toBe('The change has no proposal defined yet.');
    expect(card.whatYouWereDoing.emptyText).toBe('No completed tasks or commits for this change yet.');
    expect(card.remainingWork.emptyText).toBe('No tasks defined');
  });

  describe('Prueba de montaje de la tarjeta (React)', () => {
    const mockChange: OpenSpecChangeSummary = {
      changeId: 'retomar-trabajo',
      intent: 'Recuperar de inmediato el objetivo y el siguiente paso.',
      tasks: sampleTasks,
      proposalExists: true,
      designExists: true,
      specsCount: 1,
      validation: 'passed',
      artifacts: {
        proposal: sampleProposal,
        design: '# Design',
        tasks: sampleTasksRaw,
        specs: [],
      },
      lastCommit: sampleCommit,
    };

    it('monta la tarjeta y muestra los tres bloques con el botón «Cómo se comprueba»', () => {
      render(
        <WhereYouLeftOffCard
          repoPath="/test/repo"
          selectedChange={mockChange}
          nextTask={sampleTasks[3]}
          commitsAfterLastTask={[sampleCommitNew]}
        />
      );

      // Tarjeta presente
      expect(screen.getByTestId('where-you-left-off-card')).toBeTruthy();
      expect(screen.getByText('Dónde quedaste')).toBeTruthy();

      // Objetivo
      const obj = screen.getByTestId('resume-objective');
      expect(obj.textContent).toContain('Los historiales actuales registran ejecuciones y decisiones');

      // Bloque 1: Lo que venías haciendo
      const doing = screen.getByTestId('resume-what-you-were-doing');
      expect(doing.textContent).toContain('1.1 Fijar identidad repo y selección.');
      expect(doing.textContent).toContain('docs(openspec): los roles del desarrollo vuelven a los planes');

      // Bloque 2: En qué estabas con la evidencia y botón «Cómo se comprueba»
      const work = screen.getByTestId('resume-current-work');
      expect(work.textContent).toContain('3.1 Construir resumen determinista del cambio con objetivo, evidencia y próximo paso.');
      expect(work.textContent).toContain('style(retomar): alineación y aire adentro');

      // Botón «Cómo se comprueba»
      const checkBtn = screen.getByRole('button', { name: /Cómo se comprueba/i });
      expect(checkBtn).toBeTruthy();

      // Despliega responsable y comprobación al hacer clic
      expect(screen.queryByTestId('next-step-detail')).toBeNull();
      fireEvent.click(checkBtn);
      const detail = screen.getByTestId('next-step-detail');
      expect(detail).toBeTruthy();
      expect(detail.textContent).toContain('IA local');
      expect(detail.textContent).toContain('Funciona sin IA');

      // Bloque 3: Lo que queda agrupado por sección y resaltado
      const remaining = screen.getByTestId('resume-remaining-work');
      expect(remaining.textContent).toContain('3. Retomar y orientación: 2 tareas');
    });

    it('monta la tarjeta con un cambio archivado', () => {
      const mockArchive: OpenSpecWorkspaceSnapshot['archivedChanges'][number] = {
        changeId: '2026-09-18-gestionar-ciclo-openspec',
        archivedAt: '2026-09-18',
        sourceRef: 'openspec/changes/archive/2026-09-18-gestionar-ciclo-openspec',
        artifacts: {
          proposal: sampleProposal,
          design: '# Design',
          tasks: '- [x] 1.1 Tarea archivada',
          specs: [],
        },
        lastCommit: sampleCommit,
      };

      render(
        <WhereYouLeftOffCard
          repoPath="/test/repo"
          selectedArchive={mockArchive}
        />
      );

      expect(screen.getByTestId('where-you-left-off-card')).toBeTruthy();
      expect(screen.getAllByText(/Cambio archivado el 2026-09-18/i).length).toBeGreaterThanOrEqual(1);
    });

    it('al pasar a otro cambio no muestra el último commit del anterior', async () => {
      let responderA: (value: unknown) => void = () => {};
      const pedidos: string[] = [];
      (window as unknown as { api: unknown }).api = {
        pipelineGetChangeCommits: vi.fn((_repo: string, changeId: string) => {
          pedidos.push(changeId);
          if (changeId === 'cambio-a') return new Promise((resolve) => { responderA = resolve; });
          return Promise.resolve({ success: true, data: { recentCommits: [], commitsAfterLastTask: [] } });
        }),
      };
      const sinCommit = { ...mockChange, lastCommit: null };
      const { rerender } = render(<WhereYouLeftOffCard repoPath="/test/repo" selectedChange={{ ...sinCommit, changeId: 'cambio-a' }} />);
      rerender(<WhereYouLeftOffCard repoPath="/test/repo" selectedChange={{ ...sinCommit, changeId: 'cambio-b' }} />);
      await act(async () => {
        responderA({ success: true, data: { recentCommits: [sampleCommit], commitsAfterLastTask: [] } });
      });
      expect(pedidos).toEqual(['cambio-a', 'cambio-b']);
      delete (window as unknown as { api?: unknown }).api;
    });

    it('muestra el botón «Explicarme este resumen» al pie de la tarjeta sin consultar al modelo', () => {
      const mockNarrate = vi.fn();
      (window as unknown as { api?: unknown }).api = {
        assistConversations: {
          narrateResume: mockNarrate,
        },
      };

      render(
        <WhereYouLeftOffCard
          repoPath="/test/repo"
          selectedChange={mockChange}
          nextTask={sampleTasks[3]}
        />,
      );

      expect(screen.getByTestId('resume-narration')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Explicarme este resumen/i })).toBeTruthy();
      expect(mockNarrate).not.toHaveBeenCalled();

      delete (window as unknown as { api?: unknown }).api;
    });
  });

  describe('Lista interactiva de tareas con títulos legibles (Tarea 3.5)', () => {
    it('muestra el título legible y despliega «Cómo se comprueba» a demanda', () => {
      const mockChange: OpenSpecChangeEvidence = {
        changeId: 'retomar-trabajo',
        intent: null,
        validation: 'passed',
        tasks: sampleTasks,
        proposalExists: true,
        designExists: true,
        specsCount: 1,
        artifacts: {
          proposal: sampleProposal,
          design: '# Design',
          tasks: sampleTasksRaw,
          specs: [],
        },
      };

      render(
        <OpenSpecTasksView
          repoPath="/test/repo"
          selectedChange={mockChange}
          nextTask={sampleTasks[3]}
        />
      );

      // El título se muestra limpio sin el markdown crudo "**IA local:**"
      expect(screen.getByText('Construir resumen determinista del cambio con objetivo, evidencia y próximo paso.')).toBeTruthy();

      // Botón «Cómo se comprueba» para la tarea 3.1
      const howToCheckButtons = screen.getAllByRole('button', { name: /Cómo se comprueba/i });
      expect(howToCheckButtons.length).toBeGreaterThanOrEqual(1);

      // Al pulsar «Cómo se comprueba», aparece el responsable y la comprobación
      expect(screen.queryByTestId('task-check-detail-3.1')).toBeNull();
      fireEvent.click(howToCheckButtons[howToCheckButtons.length - 2]); // botón de la tarea 3.1
      const detailBox = screen.getByTestId('task-check-detail-3.1');
      expect(detailBox).toBeTruthy();
      expect(detailBox.textContent).toContain('IA local');
      expect(detailBox.textContent).toContain('Funciona sin IA');
    });
  });
});
