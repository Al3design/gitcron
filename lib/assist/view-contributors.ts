import type { Commit } from '@/lib/git-store';
import type { AssistAction } from './view-contributions';
import type { ContextSelection } from '@/types/assist-context';

const SHA_REGEX = /^[0-9a-fA-F]{7,40}$/;
// Las mismas formas que valida el proceso principal (electron/assist/context-reference.ts).
const CHANGE_ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const TASK_ID_REGEX = /^\d+(\.\d+)*$/;

function createConsultAction(id: string, labelKey: string): AssistAction {
  return {
    id,
    labelKey,
    scope: 'consult',
    available: true,
    requiresConfirmation: false,
  };
}

export function graphContribution(
  selectedCommit: Pick<Commit, 'hash'> | null,
): { selection: ContextSelection; actions: AssistAction[] } {
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
