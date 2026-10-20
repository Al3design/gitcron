import { describe, it, expect } from 'vitest';
import {
  cartoContribution,
  graphContribution,
  headShaOf,
  sddContribution,
} from '../assist/view-contributors';
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
      graphContribution({ hash: 'abcdef123456' }, { runId: 'run-1', branchId: 'br-1' }),
      cartoContribution('node-1', 'abcdef123456'),
      cartoContribution(null, null),
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

  it('7. headShaOf: por HEAD, por rama actual, el primero si no hay, null sin commits', () => {
    const commitsWithHead: Pick<Commit, 'hash' | 'refs'>[] = [
      { hash: '1111111', refs: ['feature'] },
      { hash: '2222222', refs: ['HEAD', 'main'] },
      { hash: '3333333', refs: [] },
    ];
    expect(headShaOf(commitsWithHead, 'main')).toBe('2222222');

    const commitsWithBranch: Pick<Commit, 'hash' | 'refs'>[] = [
      { hash: '1111111', refs: ['other'] },
      { hash: '2222222', refs: ['feature-branch'] },
    ];
    expect(headShaOf(commitsWithBranch, 'feature-branch')).toBe('2222222');

    const commitsWithoutMatchingRefs: Pick<Commit, 'hash' | 'refs'>[] = [
      { hash: 'first-sha', refs: [] },
      { hash: 'second-sha', refs: [] },
    ];
    expect(headShaOf(commitsWithoutMatchingRefs, 'main')).toBe('first-sha');

    expect(headShaOf([], 'main')).toBeNull();
  });

  it('8. grafo con idea (tiene prioridad sobre el commit) y con idea de forma inválida (vuelve al commit)', () => {
    const commit = { hash: '1234567890abcdef' };
    const validIdea = { runId: 'run-uuid-1', branchId: 'branch-uuid-2' };

    const withIdea = graphContribution(commit, validIdea);
    expect(withIdea.selection).toEqual({
      kind: 'temporal-idea',
      runId: 'run-uuid-1',
      branchId: 'branch-uuid-2',
    });
    expect(withIdea.actions.map((a) => a.id)).toEqual(['idea-explain', 'idea-vs-now']);

    // Idea con runId vacío o inválido vuelve al commit
    const invalidIdeaEmpty = graphContribution(commit, { runId: '', branchId: 'valid-branch' });
    expect(invalidIdeaEmpty.selection).toEqual({
      kind: 'commit',
      sha: '1234567890abcdef',
    });

    // Idea con runId demasiado largo (> 200 caracteres) vuelve al commit
    const tooLongId = 'a'.repeat(201);
    const invalidIdeaLong = graphContribution(commit, { runId: tooLongId, branchId: 'valid-branch' });
    expect(invalidIdeaLong.selection).toEqual({
      kind: 'commit',
      sha: '1234567890abcdef',
    });
  });

  it('9. Cartografía con pieza y HEAD, sin pieza, y con HEAD inválido', () => {
    const validHead = '1234567890abcdef';

    // Con pieza y HEAD válido
    const withNode = cartoContribution('node-auth-login', validHead);
    expect(withNode.selection).toEqual({
      kind: 'carto-node',
      nodeId: 'node-auth-login',
      takenAtHead: validHead,
    });
    expect(withNode.actions.map((a) => a.id)).toEqual(['node-explain', 'node-impact']);

    // Sin pieza
    const noNode = cartoContribution(null, validHead);
    expect(noNode.selection).toEqual({ kind: 'none' });
    expect(noNode.actions.map((a) => a.id)).toEqual(['carto-overview']);

    // Con HEAD inválido (demasiado corto o no hex)
    const invalidHead = cartoContribution('node-auth-login', 'bad-sha');
    expect(invalidHead.selection).toEqual({ kind: 'none' });
    expect(invalidHead.actions.map((a) => a.id)).toEqual(['carto-overview']);

    // Un identificador de más de 200 caracteres no se manda: el proceso principal lo rechazaría
    expect(cartoContribution('x'.repeat(201), validHead).selection).toEqual({ kind: 'none' });
    expect(cartoContribution('x'.repeat(200), validHead).selection.kind).toBe('carto-node');
  });
  it('10. Cartografía con archivo seleccionado: tiene prioridad sobre la pantalla y el nodo', () => {
    const validHead = '1234567890abcdef';
    const screen = { id: 'screen-settings', name: 'Ajustes' };
    const file = { path: 'components/SettingsForm.tsx' };

    // Con archivo y HEAD válido: selección kind: 'file'
    const res = cartoContribution('node-1', validHead, screen, file);
    expect(res.selection).toEqual({
      kind: 'file',
      path: 'components/SettingsForm.tsx',
      at: 'worktree',
      takenAtHead: validHead,
    });
    expect(res.actions.map((a) => a.id)).toEqual(['file-in-screen']);
    expect(res.actions[0].labelKey).toBe('assist.ask.fileInScreen');
    expect(res.actions[0].labelParams).toEqual({ name: 'SettingsForm.tsx' });

    // Una ruta con .. se descarta y vuelve a la pantalla
    const resDotDot = cartoContribution('node-1', validHead, screen, { path: '../etc/passwd' });
    expect(resDotDot.selection).toEqual({
      kind: 'carto-screen',
      screenId: 'screen-settings',
      screenName: 'Ajustes',
      takenAtHead: validHead,
    });
    expect(resDotDot.actions.map((a) => a.id)).toEqual(['screen-explain']);

    // Sin commit válido no hay selección de archivo (ni de pantalla ni de nodo)
    const resBadHead = cartoContribution('node-1', 'bad-sha', screen, file);
    expect(resBadHead.selection).toEqual({ kind: 'none' });
    expect(resBadHead.actions.map((a) => a.id)).toEqual(['carto-overview']);

    // Ruta de más de 500 caracteres se descarta
    const resTooLong = cartoContribution('node-1', validHead, screen, { path: 'a/'.repeat(251) });
    expect(resTooLong.selection.kind).toBe('carto-screen');
  });
});