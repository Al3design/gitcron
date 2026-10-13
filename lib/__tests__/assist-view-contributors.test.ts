import { describe, it, expect } from 'vitest';
import { graphContribution, sddContribution } from '../assist/view-contributors';
import type { Commit } from '../git-store';

describe('assist-view-contributors', () => {
  it('1. Grafo con un commit viejo (no el primero de la lista): la selección es ese sha, no otro.', () => {
    const commits: Commit[] = [
      {
        hash: '1111111111111111111111111111111111111111',
        shortHash: '1111111',
        message: 'HEAD commit',
        authorName: 'Author',
        authorEmail: 'a@example.com',
        date: '2026-10-10',
        parents: [],
      },
      {
        hash: '2222222222222222222222222222222222222222',
        shortHash: '2222222',
        message: 'Older commit',
        authorName: 'Author',
        authorEmail: 'a@example.com',
        date: '2026-10-09',
        parents: [],
      },
      {
        hash: '3333333333333333333333333333333333333333',
        shortHash: '3333333',
        message: 'Oldest commit',
        authorName: 'Author',
        authorEmail: 'a@example.com',
        date: '2026-10-08',
        parents: [],
      },
    ];

    const olderCommit = commits[2];
    const res = graphContribution(olderCommit);

    expect(res.selection).toEqual({
      kind: 'commit',
      sha: '3333333333333333333333333333333333333333',
    });
    expect(res.actions.map((a) => a.id)).toEqual(['explain-commit', 'commit-risk']);
  });

  it('2. Grafo sin commit: none y branch-state.', () => {
    const res = graphContribution(null);

    expect(res.selection).toEqual({ kind: 'none' });
    expect(res.actions.map((a) => a.id)).toEqual(['branch-state']);
    expect(res.actions[0].labelKey).toBe('assist.ask.branchState');
  });

  it('3. SDD con cambio y tarea: { kind: "change", changeId, taskId } y las dos acciones.', () => {
    const res = sddContribution('retomar-trabajo', '2.5');

    expect(res.selection).toEqual({
      kind: 'change',
      changeId: 'retomar-trabajo',
      taskId: '2.5',
    });
    expect(res.actions.map((a) => a.id)).toEqual(['task-remaining', 'change-status']);
    expect(res.actions[0].labelKey).toBe('assist.ask.taskRemaining');
    expect(res.actions[1].labelKey).toBe('assist.ask.changeStatus');
  });

  it('4. SDD con cambio sin tarea, y SDD sin cambio.', () => {
    const withChange = sddContribution('retomar-trabajo', null);
    expect(withChange.selection).toEqual({
      kind: 'change',
      changeId: 'retomar-trabajo',
    });
    expect(withChange.actions.map((a) => a.id)).toEqual(['change-status']);

    const withoutChange = sddContribution(null, null);
    expect(withoutChange.selection).toEqual({ kind: 'none' });
    expect(withoutChange.actions.map((a) => a.id)).toEqual(['sdd-overview']);
    expect(withoutChange.actions[0].labelKey).toBe('assist.ask.sddOverview');
  });

  it('5. Un hash o changeId con forma inválida da none.', () => {
    // Hash demasiado corto (< 7 caracteres) o con caracteres inválidos
    const invalidHashShort = graphContribution({ hash: '12345' });
    expect(invalidHashShort.selection).toEqual({ kind: 'none' });
    expect(invalidHashShort.actions.map((a) => a.id)).toEqual(['branch-state']);

    const invalidHashChars = graphContribution({ hash: 'zzzzzzzz' });
    expect(invalidHashChars.selection).toEqual({ kind: 'none' });

    // changeId con mayúsculas, espacios o caracteres raros
    const invalidChangeCaps = sddContribution('INVALID_CHANGE', null);
    expect(invalidChangeCaps.selection).toEqual({ kind: 'none' });
    expect(invalidChangeCaps.actions.map((a) => a.id)).toEqual(['sdd-overview']);

    const invalidChangeChars = sddContribution('change with spaces', null);
    expect(invalidChangeChars.selection).toEqual({ kind: 'none' });

    // changeId con guion al principio: el proceso principal lo rechaza
    expect(sddContribution('-cambio', null).selection).toEqual({ kind: 'none' });

    // taskId con formato inválido: se pregunta sobre el cambio, sin la tarea
    const invalidTaskId = sddContribution('valid-change', 'not-a-task');
    expect(invalidTaskId.selection).toEqual({ kind: 'change', changeId: 'valid-change' });
    expect(invalidTaskId.actions.map((a) => a.id)).toEqual(['change-status']);

    // una tarea de un solo nivel o de tres niveles es válida
    expect(sddContribution('valid-change', '3').selection).toEqual({ kind: 'change', changeId: 'valid-change', taskId: '3' });
    expect(sddContribution('valid-change', '1.2.3').selection).toEqual({ kind: 'change', changeId: 'valid-change', taskId: '1.2.3' });
  });

  it('6. Todas las acciones son consult, disponibles y sin confirmación.', () => {
    const contributions = [
      graphContribution({ hash: 'abcdef123456' }),
      graphContribution(null),
      sddContribution('test-change', '1.1'),
      sddContribution('test-change', null),
      sddContribution(null, null),
    ];

    for (const c of contributions) {
      for (const action of c.actions) {
        expect(action.scope).toBe('consult');
        expect(action.available).toBe(true);
        expect(action.requiresConfirmation).toBe(false);
      }
    }
  });
});
