import type { Commit } from '@/lib/git-store';
import type { AssistAction } from './view-contributions';
import type { ContextSelection } from '@/types/assist-context';

const SHA_REGEX = /^[0-9a-fA-F]{7,40}$/;
const CHANGE_ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const TASK_ID_REGEX = /^\d+(\.\d+)*$/;

export interface TemporalIdeaRef {
  runId: string;
  branchId: string;
}

function createConsultAction(id: string, labelKey: string): AssistAction {
  return {
    id,
    labelKey,
    scope: 'consult',
    available: true,
    requiresConfirmation: false,
  };
}

/** El sha del HEAD según la lista del grafo: el commit cuyos refs nombran HEAD o la rama actual; si no hay, el primero; `null` si no hay commits. Misma regla que `headCommitNode` de ChronometricGraph. */
export function headShaOf(
  commits: Pick<Commit, 'hash' | 'refs'>[],
  currentBranch: string,
): string | null {
  if (!commits || commits.length === 0) return null;
  const active = commits.find((c) => {
    if (!c.refs) return false;
    return c.refs.some(
      (r) => r === 'HEAD' || r === currentBranch || r === `refs/heads/${currentBranch}`,
    );
  });
  return active ? active.hash : commits[0]?.hash ?? null;
}

function isValidIdea(idea: TemporalIdeaRef | null | undefined): idea is TemporalIdeaRef {
  if (!idea) return false;
  const { runId, branchId } = idea;
  if (!runId || typeof runId !== 'string' || runId.trim() === '' || runId.length > 200) {
    return false;
  }
  if (!branchId || typeof branchId !== 'string' || branchId.trim() === '' || branchId.length > 200) {
    return false;
  }
  return true;
}

export function graphContribution(
  selectedCommit: Pick<Commit, 'hash'> | null,
  temporalIdea?: TemporalIdeaRef | null,
): { selection: ContextSelection; actions: AssistAction[] } {
  if (isValidIdea(temporalIdea)) {
    return {
      selection: {
        kind: 'temporal-idea',
        runId: temporalIdea.runId,
        branchId: temporalIdea.branchId,
      },
      actions: [
        createConsultAction('idea-explain', 'assist.ask.ideaExplain'),
        createConsultAction('idea-vs-now', 'assist.ask.ideaVsNow'),
      ],
    };
  }

  if (selectedCommit?.hash && SHA_REGEX.test(selectedCommit.hash)) {
    return {
      selection: {
        kind: 'commit',
        sha: selectedCommit.hash,
      },
      actions: [
        createConsultAction('explain-commit', 'assist.ask.explainCommit'),
        createConsultAction('commit-risk', 'assist.ask.commitRisk'),
      ],
    };
  }

  return {
    selection: { kind: 'none' },
    actions: [
      createConsultAction('branch-state', 'assist.ask.branchState'),
    ],
  };
}

function isValidFilePath(path: string | null | undefined): path is string {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (trimmed === '' || trimmed.length > 500) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:/.test(trimmed)) return false;
  return true;
}

export function cartoContribution(
  nodeId: string | null,
  takenAtHead: string | null,
  selectedScreen?: { id: string; name: string } | null,
  selectedFile?: { path: string } | null,
): { selection: ContextSelection; actions: AssistAction[] } {
  if (
    selectedFile &&
    isValidFilePath(selectedFile.path) &&
    takenAtHead &&
    SHA_REGEX.test(takenAtHead)
  ) {
    return {
      selection: {
        kind: 'file',
        path: selectedFile.path,
        at: 'worktree',
        takenAtHead,
      },
      actions: [
        // Con el nombre: sin él, la sugerencia del chat mostraba «{{name}}» (auditoría de carto-06).
        {
          ...createConsultAction('file-in-screen', 'assist.ask.fileInScreen'),
          labelParams: { name: selectedFile.path.split('/').pop() ?? selectedFile.path },
        },
      ],
    };
  }
  if (
    selectedScreen &&
    selectedScreen.id &&
    selectedScreen.id.trim() !== '' &&
    selectedScreen.id.length <= 200 &&
    selectedScreen.name &&
    selectedScreen.name.trim() !== '' &&
    selectedScreen.name.length <= 200 &&
    takenAtHead &&
    SHA_REGEX.test(takenAtHead)
  ) {
    return {
      selection: {
        kind: 'carto-screen',
        screenId: selectedScreen.id,
        screenName: selectedScreen.name,
        takenAtHead,
      },
      actions: [
        createConsultAction('screen-explain', 'assist.ask.screenExplain'),
      ],
    };
  }

  if (
    nodeId &&
    nodeId.trim() !== '' &&
    // El mismo tope que valida el proceso principal: uno más largo haría fallar la pregunta entera.
    nodeId.length <= 200 &&
    takenAtHead &&
    SHA_REGEX.test(takenAtHead)
  ) {
    return {
      selection: {
        kind: 'carto-node',
        nodeId,
        takenAtHead,
      },
      actions: [
        createConsultAction('node-explain', 'assist.ask.nodeExplain'),
        createConsultAction('node-impact', 'assist.ask.nodeImpact'),
      ],
    };
  }

  return {
    selection: { kind: 'none' },
    actions: [
      createConsultAction('carto-overview', 'assist.ask.cartoOverview'),
    ],
  };
}

export function sddContribution(
  changeId: string | null,
  taskId: string | null,
): { selection: ContextSelection; actions: AssistAction[] } {
  if (!changeId || !CHANGE_ID_REGEX.test(changeId)) {
    return {
      selection: { kind: 'none' },
      actions: [
        createConsultAction('sdd-overview', 'assist.ask.sddOverview'),
      ],
    };
  }

  // Una tarea con forma inválida no hace perder el cambio: se pregunta sobre el cambio.
  if (taskId && TASK_ID_REGEX.test(taskId)) {
    return {
      selection: {
        kind: 'change',
        changeId,
        taskId,
      },
      actions: [
        createConsultAction('task-remaining', 'assist.ask.taskRemaining'),
        createConsultAction('change-status', 'assist.ask.changeStatus'),
      ],
    };
  }

  return {
    selection: {
      kind: 'change',
      changeId,
    },
    actions: [
      createConsultAction('change-status', 'assist.ask.changeStatus'),
    ],
  };
}
