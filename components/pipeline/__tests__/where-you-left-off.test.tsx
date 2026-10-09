// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { TaskEvidence } from '@/types/pipeline';
import {
  deriveResumeCard,
  extractObjectiveSentences,
  extractWhyParagraph,
  extractTaskSection,
  parseTaskDetails,
  formatRelativeTime,
} from '../resume-card';
import { WhereYouLeftOffCard } from '../WhereYouLeftOffCard';
import type { OpenSpecChangeSummary, OpenSpecWorkspaceSnapshot } from '../pipeline-view-state';

describe('Resumen determinista «Dónde quedaste» (Tarea 3.1)', () => {
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

  it('caso 1: cambio a medias', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasksRaw: sampleTasksRaw,
      tasks: sampleTasks,
      lastCommit: sampleCommit,
      now: fixedNow,
    });

    expect(card.isArchived).toBe(false);

    // 1. Objetivo: extraído de Why, sin cortar palabras a la mitad
    expect(card.rows.objective.text).toContain('Los historiales actuales registran ejecuciones y decisiones');
    expect(card.rows.objective.text).toContain('El usuario necesita retomar tras semanas');
    expect(card.rows.objective.isFallback).toBeFalsy();

    // 2. Avance: tareas hechas sobre el total y en qué sección está la próxima
    expect(card.rows.progress.text).toBe('3 de 5 tareas · En «3. Retomar y orientación»');
    expect(card.rows.progress.isFallback).toBeFalsy();

    // 3. Última actividad: commit corto y hace cuánto
    expect(card.rows.lastActivity.text).toContain('docs(openspec): los roles del desarrollo vuelven a los planes');
    expect(card.rows.lastActivity.text).toContain('hace 1 día');
    expect(card.rows.lastActivity.isFallback).toBeFalsy();

    // 4. Siguiente paso: primera tarea sin marcar con título legible (sin Responsable ni Comprobación en el título)
    expect(card.rows.nextStep.text).toBe('3.1 Construir resumen determinista del cambio con objetivo, evidencia y próximo paso.');
    expect(card.rows.nextStep.detail).toEqual({
      responsible: 'IA local',
      check: 'Funciona sin IA; distingue documentos presentes, tareas marcadas, pruebas verificadas y commit.',
    });
    expect(card.rows.nextStep.isFallback).toBeFalsy();
  });

  it('caso 2: sin tareas', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasks: [],
      lastCommit: sampleCommit,
      now: fixedNow,
    });

    expect(card.rows.progress.text).toBe('Sin tareas definidas');
    expect(card.rows.progress.isFallback).toBe(true);

    expect(card.rows.nextStep.text).toBe('Sin tareas pendientes');
    expect(card.rows.nextStep.isFallback).toBe(true);
    expect(card.rows.nextStep.detail).toBeNull();
  });

  it('caso 3: todo hecho', () => {
    const allCompletedTasks: TaskEvidence[] = sampleTasks.map((t) => ({ ...t, completed: true }));

    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasks: allCompletedTasks,
      lastCommit: sampleCommit,
      now: fixedNow,
    });

    expect(card.rows.progress.text).toBe('5 de 5 tareas · Todas las tareas completadas');
    expect(card.rows.progress.isFallback).toBeFalsy();

    expect(card.rows.nextStep.text).toBe('Todas las tareas completadas');
    expect(card.rows.nextStep.isFallback).toBe(true);
    expect(card.rows.nextStep.detail).toBeNull();
  });

  it('caso 4: sin proposal', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: null,
      intent: null,
      tasks: sampleTasks,
      lastCommit: sampleCommit,
      now: fixedNow,
    });

    expect(card.rows.objective.text).toBe('El cambio no tiene propuesta definida todavía.');
    expect(card.rows.objective.isFallback).toBe(true);
    // El resto sigue funcionando normalmente
    expect(card.rows.progress.text).toContain('3 de 5 tareas');
    expect(card.rows.lastActivity.text).toContain('docs(openspec)');
  });

  it('caso 5: sin commits', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      proposal: sampleProposal,
      tasks: sampleTasks,
      lastCommit: null,
      now: fixedNow,
    });

    // Según el prompt: mensaje exacto «Todavía sin commits»
    expect(card.rows.lastActivity.text).toBe('Todavía sin commits');
    expect(card.rows.lastActivity.isFallback).toBe(true);
  });

  it('caso 6: archivado', () => {
    const card = deriveResumeCard({
      changeId: 'retomar-trabajo',
      isArchived: true,
      archivedAt: '2026-09-18',
      proposal: sampleProposal,
      tasks: sampleTasks.map((t) => ({ ...t, completed: true })),
      lastCommit: sampleCommit,
      now: fixedNow,
    });

    expect(card.isArchived).toBe(true);
    expect(card.archivedNotice).toBe('Cambio archivado el 2026-09-18');
    expect(card.rows.nextStep.text).toBe('Cambio archivado el 2026-09-18');
  });

  it('recorta prolijamente sin cortar palabras a la mitad', () => {
    const longSentence = 'Esta es una frase deliberadamente larga que contiene muchas palabras para probar el recorte exacto en los límites de palabras y asegurar que nunca termine con una palabra partida al azar sino con puntos suspensivos prolijos.';
    const trimmed = extractObjectiveSentences(longSentence, 1, 80);

    expect(trimmed.endsWith('…')).toBe(true);
    // No debe haber palabras truncadas de forma irregular antes del punto suspensivo
    const withoutEllipsis = trimmed.slice(0, -1);
    expect(withoutEllipsis.endsWith(' ')).toBe(false);
    expect(withoutEllipsis.length).toBeLessThanOrEqual(80);
    // Debe coincidir exactamente con una palabra completa de la oración original
    const lastWord = withoutEllipsis.split(/\s+/).pop()!;
    expect(longSentence).toContain(lastWord);
  });

  it('soporta textos en inglés (i18n)', () => {
    const card = deriveResumeCard({
      changeId: 'test-change',
      proposal: null,
      tasks: [],
      lastCommit: null,
      locale: 'en',
      t: (key) => {
        const enMap: Record<string, string> = {
          'pipeline.resumeCard.objectiveEmpty': 'The change has no proposal defined yet.',
          'pipeline.resumeCard.noTasks': 'No tasks defined',
          'pipeline.resumeCard.noCommits': 'No commits yet',
          'pipeline.resumeCard.noPendingTasks': 'No pending tasks',
        };
        return enMap[key] ?? key;
      },
    });

    expect(card.rows.objective.text).toBe('The change has no proposal defined yet.');
    expect(card.rows.progress.text).toBe('No tasks defined');
    expect(card.rows.lastActivity.text).toBe('No commits yet');
    expect(card.rows.nextStep.text).toBe('No pending tasks');
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

    it('monta la tarjeta y muestra los cuatro renglones con sus valores', () => {
      render(
        <WhereYouLeftOffCard
          repoPath="/test/repo"
          selectedChange={mockChange}
          nextTask={sampleTasks[3]}
        />
      );

      // Tarjeta presente
      expect(screen.getByTestId('where-you-left-off-card')).toBeTruthy();
      expect(screen.getByText('Dónde quedaste')).toBeTruthy();

      // Renglón 1: Objetivo
      const obj = screen.getByTestId('resume-objective');
      expect(obj.textContent).toContain('Los historiales actuales registran ejecuciones y decisiones');

      // Renglón 2: Avance
      const prog = screen.getByTestId('resume-progress');
      expect(prog.textContent).toContain('3 de 5 tareas · En «3. Retomar y orientación»');

      // Renglón 3: Última actividad
      const act = screen.getByTestId('resume-last-activity');
      expect(act.textContent).toContain('docs(openspec): los roles del desarrollo vuelven a los planes');

      // Renglón 4: Siguiente paso
      const next = screen.getByTestId('resume-next-step');
      expect(next.textContent).toContain('3.1 Construir resumen determinista del cambio con objetivo, evidencia y próximo paso.');

      // Detalle (Responsable y Comprobación) no están visibles inicialmente
      expect(screen.queryByTestId('next-step-detail')).toBeNull();

      // Al hacer clic en el botón de Detalle, se despliega
      const detailBtn = screen.getByRole('button', { name: /Detalle/i });
      fireEvent.click(detailBtn);

      const detail = screen.getByTestId('next-step-detail');
      expect(detail).toBeTruthy();
      expect(detail.textContent).toContain('IA local');
      expect(detail.textContent).toContain('Funciona sin IA; distingue documentos presentes');

      // Al volver a hacer clic, se colapsa
      fireEvent.click(detailBtn);
      expect(screen.queryByTestId('next-step-detail')).toBeNull();
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
        pipelineGetChangeLastCommit: vi.fn((_repo: string, changeId: string) => {
          pedidos.push(changeId);
          if (changeId === 'cambio-a') return new Promise((resolve) => { responderA = resolve; });
          return Promise.resolve({ success: true, data: null });
        }),
      };
      const sinCommit = { ...mockChange, lastCommit: null };
      const { rerender } = render(<WhereYouLeftOffCard repoPath="/test/repo" selectedChange={{ ...sinCommit, changeId: 'cambio-a' }} />);
      rerender(<WhereYouLeftOffCard repoPath="/test/repo" selectedChange={{ ...sinCommit, changeId: 'cambio-b' }} />);
      // La respuesta del cambio A llega tarde, ya con B en pantalla.
      await act(async () => { responderA({ success: true, data: sampleCommit }); });
      expect(pedidos).toEqual(['cambio-a', 'cambio-b']);
      expect(screen.getByTestId('resume-last-activity').textContent).toContain('Todavía sin commits');
      delete (window as unknown as { api?: unknown }).api;
    });
  });
});
