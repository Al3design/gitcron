import { describe, expect, it } from 'vitest';
import {
  createContributionRegistry,
  type AssistActionScope,
  type ContributionRegistry,
  type ViewContribution,
  type ViewContributor,
} from '../assist/view-contributions';

describe('createContributionRegistry', () => {
  const graphContributor: ViewContributor = () => ({
    selection: { kind: 'commit', sha: 'abcdef1' },
    actions: [
      {
        id: 'explain-commit',
        labelKey: 'assist.explainCommit',
        scope: 'consult' as AssistActionScope,
        available: true,
        requiresConfirmation: false,
      },
    ],
  });

  const markTaskRun = () => {};
  const launchRun = () => {};

  const sddContributor: ViewContributor = () => ({
    selection: { kind: 'change', changeId: 'retomar', taskId: '1.3' },
    actions: [
      {
        id: 'mark-task',
        labelKey: 'assist.markTask',
        scope: 'execute' as AssistActionScope,
        available: true,
        requiresConfirmation: true,
        run: markTaskRun,
      },
      {
        id: 'launch-session',
        labelKey: 'assist.launch',
        scope: 'execute' as AssistActionScope,
        available: false,
        unavailableReasonKey: 'assist.sessionActive',
        requiresConfirmation: true,
        run: launchRun,
      },
    ],
  });

  it('con las dos vistas registradas devuelve cada una lo suyo', () => {
    const registry: ContributionRegistry = createContributionRegistry();
    registry.register('graph', graphContributor);
    registry.register('sdd', sddContributor);

    const graphContribution: ViewContribution = registry.contributionFor('graph');
    expect(graphContribution).toEqual({
      viewId: 'graph',
      selection: { kind: 'commit', sha: 'abcdef1' },
      actions: [
        {
          id: 'explain-commit',
          labelKey: 'assist.explainCommit',
          scope: 'consult',
          available: true,
          requiresConfirmation: false,
        },
      ],
    });

    const sddContribution: ViewContribution = registry.contributionFor('sdd');
    expect(sddContribution).toEqual({
      viewId: 'sdd',
      selection: { kind: 'change', changeId: 'retomar', taskId: '1.3' },
      actions: [
        {
          id: 'mark-task',
          labelKey: 'assist.markTask',
          scope: 'execute',
          available: true,
          requiresConfirmation: true,
          run: markTaskRun,
        },
        {
          id: 'launch-session',
          labelKey: 'assist.launch',
          scope: 'execute',
          available: false,
          unavailableReasonKey: 'assist.sessionActive',
          requiresConfirmation: true,
          run: launchRun,
        },
      ],
    });
  });

  it('vista desconocida devuelve selección none y actions vacío', () => {
    const registry = createContributionRegistry();
    const result = registry.contributionFor('plugin-ajeno');
    expect(result.viewId).toBe('plugin-ajeno');
    expect(result.selection).toEqual({ kind: 'none' });
    expect(result.actions).toEqual([]);
  });

  it('un contribuyente que tira devuelve respaldo none y sin acciones, sin tirar', () => {
    const registry = createContributionRegistry();
    registry.register('failing-view', () => {
      throw new Error('boom');
    });

    let contribution: ViewContribution | undefined;
    expect(() => {
      contribution = registry.contributionFor('failing-view');
    }).not.toThrow();

    expect(contribution).toEqual({
      viewId: 'failing-view',
      selection: { kind: 'none' },
      actions: [],
    });
  });

  it('registrar otra vez reemplaza al anterior; baja vieja no borra al nuevo y baja nueva sí', () => {
    const registry = createContributionRegistry();
    const unregister1 = registry.register('graph', graphContributor);
    const replacementContributor: ViewContributor = () => ({
      selection: { kind: 'commit', sha: '9999999' },
      actions: [],
    });
    const unregister2 = registry.register('graph', replacementContributor);

    expect(registry.contributionFor('graph').selection).toEqual({ kind: 'commit', sha: '9999999' });

    unregister1();
    expect(registry.contributionFor('graph').selection).toEqual({ kind: 'commit', sha: '9999999' });

    unregister2();
    expect(registry.contributionFor('graph').selection).toEqual({ kind: 'none' });
  });

  it('normalizeActions descarta id vacío, descarta no disponible sin motivo y conserva primer id duplicado', () => {
    const registry = createContributionRegistry();
    const runFn = () => {};
    registry.register('test-view', () => ({
      selection: { kind: 'none' },
      actions: [
        { id: 'first', labelKey: 'a.first', scope: 'consult', available: true, requiresConfirmation: false },
        { id: 'first', labelKey: 'a.first.dup', scope: 'execute', available: true, requiresConfirmation: true, run: runFn },
        { id: '', labelKey: 'a.empty', scope: 'consult', available: true, requiresConfirmation: false },
        { id: '   ', labelKey: 'a.whitespace', scope: 'consult', available: true, requiresConfirmation: false },
        { id: 'unavail-no-reason', labelKey: 'a.noReason', scope: 'prepare', available: false, requiresConfirmation: false, run: runFn },
        { id: 'unavail-empty-reason', labelKey: 'a.emptyReason', scope: 'prepare', available: false, unavailableReasonKey: '   ', requiresConfirmation: false, run: runFn },
        { id: 'unavail-with-reason', labelKey: 'a.withReason', scope: 'prepare', available: false, unavailableReasonKey: 'reason.valid', requiresConfirmation: false, run: runFn },
      ],
    }));

    const contribution = registry.contributionFor('test-view');
    expect(contribution.actions).toEqual([
      { id: 'first', labelKey: 'a.first', scope: 'consult', available: true, requiresConfirmation: false },
      { id: 'unavail-with-reason', labelKey: 'a.withReason', scope: 'prepare', available: false, unavailableReasonKey: 'reason.valid', requiresConfirmation: false, run: runFn },
    ]);
  });

  it('una acción execute o prepare sin run se descarta; con run se conserva y su run es la misma función', () => {
    const registry = createContributionRegistry();
    const customRun = () => {};
    registry.register('actions-test', () => ({
      selection: { kind: 'none' },
      actions: [
        { id: 'exec-no-run', labelKey: 'a.execNoRun', scope: 'execute', available: true, requiresConfirmation: true },
        { id: 'prep-no-run', labelKey: 'a.prepNoRun', scope: 'prepare', available: true, requiresConfirmation: false },
        { id: 'exec-with-run', labelKey: 'a.execWithRun', scope: 'execute', available: true, requiresConfirmation: true, run: customRun },
      ],
    }));

    const contribution = registry.contributionFor('actions-test');
    expect(contribution.actions).toHaveLength(1);
    expect(contribution.actions[0].id).toBe('exec-with-run');
    expect(contribution.actions[0].run).toBe(customRun);
  });

  it('las acciones devueltas son copias y modificarlas no altera llamadas subsiguientes', () => {
    const registry = createContributionRegistry();
    registry.register('graph', graphContributor);

    const first = registry.contributionFor('graph');
    expect(first.actions).toHaveLength(1);
    first.actions[0].id = 'tampered';

    const second = registry.contributionFor('graph');
    expect(second.actions[0].id).toBe('explain-commit');
  });

  it('register con viewId vacío tira error', () => {
    const registry = createContributionRegistry();
    expect(() => registry.register('  ', graphContributor)).toThrow('viewId vacío');
  });

  it('registeredViews devuelve las vistas registradas en su orden de registro', () => {
    const registry = createContributionRegistry();
    registry.register('graph', graphContributor);
    registry.register('sdd', sddContributor);

    expect(registry.registeredViews()).toEqual(['graph', 'sdd']);
  });

  it('subscribe recibe el aviso de notify, de register y de la baja', () => {
    const registry = createContributionRegistry();
    let calls = 0;
    const unsub = registry.subscribe(() => {
      calls++;
    });

    registry.notify();
    expect(calls).toBe(1);

    const unreg = registry.register('graph', graphContributor);
    expect(calls).toBe(2);

    unreg();
    expect(calls).toBe(3);

    unsub();
  });

  it('un oyente que tira no impide avisar a otro', () => {
    const registry = createContributionRegistry();
    let secondCalled = false;

    registry.subscribe(() => {
      throw new Error('oyente con error');
    });

    registry.subscribe(() => {
      secondCalled = true;
    });

    registry.notify();
    expect(secondCalled).toBe(true);
  });

  it('la baja de subscribe deja de avisar', () => {
    const registry = createContributionRegistry();
    let calls = 0;
    const unsub = registry.subscribe(() => {
      calls++;
    });

    registry.notify();
    expect(calls).toBe(1);

    unsub();
    registry.notify();
    expect(calls).toBe(1);
  });
});
