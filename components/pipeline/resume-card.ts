import type { ChangeLastCommit, ChangeTimestamp, TaskEvidence } from '@/types/pipeline';
import { resolveTaskLabel, resolveTaskText } from './pipeline-next-action';

/**
 * Resumen determinista "Dónde quedaste" para un cambio OpenSpec (Tareas 3.1 y 3.5).
 *
 * Función pura: mismas entradas, misma respuesta.
 * No invoca IA ni modelos, lee sólo lo que está en disco y en Git.
 * Reutiliza el cálculo de tareas de `pipeline-next-action.ts`.
 */

export interface ResumeCardParsedTask {
  id: string;
  label: string;
  title: string;
  responsible: string | null;
  check: string | null;
  rawText: string;
  completed: boolean;
  section: string | null;
}

export interface ResumeCardRow {
  labelKey: string;
  text: string;
  isFallback?: boolean;
}

export interface ResumeCardNextStepRow extends ResumeCardRow {
  task: ResumeCardParsedTask | null;
  detail: {
    responsible: string | null;
    check: string | null;
  } | null;
}

export interface ResumeCardTaskItem {
  id: string;
  label: string;
  title: string;
  text: string;
  responsible: string | null;
  check: string | null;
  completed: boolean;
}

export interface ResumeCardCommitItem {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  timeAgo: string;
  text: string;
}

export interface ResumeCardSectionGroup {
  sectionName: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  isCurrent: boolean;
  label: string;
  firstPendingTaskId?: string | null;
  firstTaskId?: string | null;
}

export interface ResumeCardEvidence {
  hasEvidence: boolean;
  commitsAfterLastTask: ResumeCardCommitItem[];
  uncommittedFiles: string[];
  session: {
    runtime: string;
    role?: string;
    outcome?: string;
    statusLabel: string;
    text: string;
  } | null;
  emptyText: string | null;
}

export interface ResumeCardWhatYouWereDoing {
  completedTasks: ResumeCardTaskItem[];
  commits: ResumeCardCommitItem[];
  emptyText: string | null;
}

export interface ResumeCardCurrentWork {
  currentTask: ResumeCardTaskItem | null;
  isArchived: boolean;
  allCompleted: boolean;
  statusText: string;
  detail: {
    responsible: string | null;
    check: string | null;
  } | null;
  evidence: ResumeCardEvidence;
}

export interface ResumeCardRemainingWork {
  sections: ResumeCardSectionGroup[];
  allCompleted: boolean;
  noTasks: boolean;
  emptyText: string | null;
}

export interface ResumeCardData {
  changeId: string;
  isArchived: boolean;
  archivedNotice: string | null;
  objective: {
    text: string;
    isFallback: boolean;
  };
  whatYouWereDoing: ResumeCardWhatYouWereDoing;
  currentWork: ResumeCardCurrentWork;
  remainingWork: ResumeCardRemainingWork;
  rows: {
    objective: ResumeCardRow;
    progress: ResumeCardRow;
    lastActivity: ResumeCardRow;
    nextStep: ResumeCardNextStepRow;
  };
}

export interface ResumeCardInput {
  changeId: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  archivedOn?: ChangeTimestamp | null;
  proposal?: string | null;
  intent?: string | null;
  tasks?: TaskEvidence[];
  tasksRaw?: string | null;
  lastCommit?: ChangeLastCommit | null;
  recentCommits?: ChangeLastCommit[] | null;
  commitsAfterLastTask?: ChangeLastCommit[] | null;
  uncommittedFiles?: string[] | null;
  latestSession?: {
    runtime?: string;
    role?: string;
    outcome?: string;
    active?: boolean;
    startedAt?: string;
  } | null;
  now?: string | number | Date;
  locale?: string;
  t?: (key: string, params?: Record<string, string | number>) => string;
}

const DEFAULT_TEXTS_ES: Record<string, string> = {
  'pipeline.resumeCard.title': 'Dónde quedaste',
  'pipeline.resumeCard.row.objective': 'Objetivo',
  'pipeline.resumeCard.row.progress': 'Avance',
  'pipeline.resumeCard.row.lastActivity': 'Última actividad',
  'pipeline.resumeCard.row.nextStep': 'Siguiente paso',
  'pipeline.resumeCard.row.whatYouWereDoing': 'Lo que venías haciendo',
  'pipeline.resumeCard.row.currentWork': 'En qué estabas',
  'pipeline.resumeCard.row.remainingWork': 'Lo que queda',
  'pipeline.resumeCard.howToCheckToggle': 'Cómo se comprueba',
  'pipeline.resumeCard.objectiveEmpty': 'El cambio no tiene propuesta definida todavía.',
  'pipeline.resumeCard.noTasks': 'Sin tareas definidas',
  'pipeline.resumeCard.noCommits': 'Todavía sin commits',
  'pipeline.resumeCard.noPendingTasks': 'Sin tareas pendientes',
  'pipeline.resumeCard.allTasksCompleted': 'Todas las tareas completadas',
  'pipeline.resumeCard.whatYouWereDoingEmpty': 'Todavía no hay tareas completadas ni commits en este cambio.',
  'pipeline.resumeCard.noWorkStarted': 'Todavía no se empezó a trabajar en esta tarea.',
  'pipeline.resumeCard.archivedNotice': 'Cambio archivado el {{date}}',
  'pipeline.resumeCard.archivedStep': 'Cambio completado y archivado',
  'pipeline.resumeCard.progressWithSection': '{{completed}} de {{total}} tareas · En «{{section}}»',
  'pipeline.resumeCard.progressAllDone': '{{completed}} de {{total}} tareas · Todas las tareas completadas',
  'pipeline.resumeCard.sectionNumber': 'Sección {{number}}',
  'pipeline.resumeCard.defaultSection': 'Sección inicial',
  'pipeline.resumeCard.taskSingular': 'tarea',
  'pipeline.resumeCard.taskPlural': 'tareas',
  'pipeline.resumeCard.lastCommitActivity': '{{message}} · {{timeAgo}}',
  'pipeline.resumeCard.evidenceCommits': '{{count}} commits posteriores a la última tarea',
  'pipeline.resumeCard.evidenceCommitSingle': '1 commit posterior a la última tarea',
  'pipeline.resumeCard.evidenceUncommitted': '{{count}} archivos con cambios sin confirmar',
  'pipeline.resumeCard.evidenceUncommittedSingle': '1 archivo con cambios sin confirmar',
  'pipeline.resumeCard.evidenceSession': 'Última sesión de SDD ({{runtime}}): {{status}}',
  'pipeline.resumeCard.sessionStatus.running': 'en curso',
  'pipeline.resumeCard.sessionStatus.completed': 'completada',
  'pipeline.resumeCard.sessionStatus.failed': 'fallida',
  'pipeline.resumeCard.sessionStatus.interrupted': 'interrumpida',
  'pipeline.resumeCard.sessionStatus.unknown': 'desconocido',
  'pipeline.resumeCard.responsibleLabel': 'Responsable:',
  'pipeline.resumeCard.checkLabel': 'Comprobación:',
  'pipeline.resumeCard.detailToggle': 'Cómo se comprueba',
};

/**
 * Extrae el primer párrafo bajo `## Why` en un proposal.md.
 */
export function extractWhyParagraph(markdown: string): string | null {
  const section = /^## Why\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(markdown)?.[1] ?? '';
  const paragraph = section
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length > 0 && !part.startsWith('#'));
  return paragraph || null;
}

/**
 * Recorta prolijamente una o dos frases sacadas del Why, sin cortar palabras a la mitad.
 */
export function extractObjectiveSentences(whyText: string, maxSentences: number = 2, maxChars: number = 280): string {
  const clean = whyText.replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const sentenceMatches = clean.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [clean];
  const selected = sentenceMatches.slice(0, maxSentences).map((s) => s.trim()).join(' ');

  if (selected.length <= maxChars) {
    return selected;
  }

  const sliced = selected.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > 0) {
    return sliced.slice(0, lastSpace).trim() + '…';
  }
  return sliced.trim() + '…';
}

/**
 * Identifica la sección de `tasks.md` en la que se encuentra la próxima tarea.
 */
export function extractTaskSection(nextTask: TaskEvidence, tasksRaw?: string | null): string | null {
  if (tasksRaw) {
    const lines = tasksRaw.split(/\r?\n/);
    let currentSection: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const headingMatch = /^##\s+(.+)$/.exec(lines[i]);
      if (headingMatch) {
        currentSection = headingMatch[1].trim();
      }
      if (lineNum >= nextTask.line && currentSection) {
        return currentSection;
      }
    }
    if (currentSection) return currentSection;
  }

  const label = resolveTaskLabel(nextTask);
  const sectionNumberMatch = /^(\d+)(?:\.\d+)*$/.exec(label);
  if (sectionNumberMatch) {
    return `Sección ${sectionNumberMatch[1]}`;
  }
  return null;
}

/**
 * Agrupa tareas por sección y contabiliza las pendientes, marcando la que contiene la próxima tarea.
 */
export function groupTasksBySection(
  tasks: TaskEvidence[],
  tasksRaw?: string | null,
  t?: (key: string, params?: Record<string, string | number>) => string,
): ResumeCardSectionGroup[] {
  if (!tasks || tasks.length === 0) return [];

  interface SectionHeader {
    title: string;
    line: number;
  }
  const headers: SectionHeader[] = [];
  if (tasksRaw) {
    const rawLines = tasksRaw.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const match = /^##\s+(.+)$/.exec(rawLines[i]);
      if (match) {
        headers.push({ title: match[1].trim(), line: i + 1 });
      }
    }
  }

  const sectionMap = new Map<string, { total: number; completed: number; pending: number; firstTaskId: string | null; firstPendingTaskId: string | null }>();
  const firstPending = tasks.find((t) => !t.completed) ?? null;
  let firstPendingSectionName: string | null = null;

  for (const task of tasks) {
    let sectionName: string | null = null;
    if (headers.length > 0 && task.line > 0) {
      for (let h = headers.length - 1; h >= 0; h--) {
        if (task.line >= headers[h].line) {
          sectionName = headers[h].title;
          break;
        }
      }
    }
    if (!sectionName) {
      sectionName = extractTaskSection(task, tasksRaw) ?? (t?.('pipeline.resumeCard.defaultSection') ?? 'Sección inicial');
    }

    if (firstPending && task.id === firstPending.id) {
      firstPendingSectionName = sectionName;
    }

    let entry = sectionMap.get(sectionName);
    if (!entry) {
      entry = { total: 0, completed: 0, pending: 0, firstTaskId: null, firstPendingTaskId: null };
      sectionMap.set(sectionName, entry);
    }
    if (!entry.firstTaskId) entry.firstTaskId = task.id;
    entry.total++;
    if (task.completed) {
      entry.completed++;
    } else {
      entry.pending++;
      if (!entry.firstPendingTaskId) entry.firstPendingTaskId = task.id;
    }
  }

  const taskSingular = t?.('pipeline.resumeCard.taskSingular') ?? 'tarea';
  const taskPlural = t?.('pipeline.resumeCard.taskPlural') ?? 'tareas';

  const result: ResumeCardSectionGroup[] = [];
  for (const [name, stats] of sectionMap.entries()) {
    const isCurrent = name === firstPendingSectionName;
    const taskWord = stats.pending === 1 ? taskSingular : taskPlural;
    result.push({
      sectionName: name,
      totalTasks: stats.total,
      completedTasks: stats.completed,
      pendingTasks: stats.pending,
      isCurrent,
      label: `${name}: ${stats.pending} ${taskWord}`,
      firstPendingTaskId: stats.firstPendingTaskId,
      firstTaskId: stats.firstTaskId,
    });
  }

  return result;
}

/**
 * Parsea el texto de una tarea separando título legible de responsable y comprobación.
 */
export function parseTaskDetails(task: TaskEvidence): {
  label: string;
  title: string;
  responsible: string | null;
  check: string | null;
} {
  const label = resolveTaskLabel(task);
  let text = resolveTaskText(task).trim();

  let responsible: string | null = null;
  const respMatch = /^\*\*(?:Responsable:\s*)?([^*]+?):?\*\*:?\s*/i.exec(text);
  if (respMatch) {
    responsible = respMatch[1].trim();
    text = text.slice(respMatch[0].length).trim();
  }

  let check: string | null = null;
  const checkMatch = /(?:\*\*|\b)(?:Comprobaci[oó]n|Verificaci[oó]n):\s*(?:\*\*)?\s*(.+)$/i.exec(text);
  if (checkMatch) {
    check = checkMatch[1].trim();
    text = text.slice(0, checkMatch.index).trim();
  }

  const title = text.replace(/[\s\t\n]+$/, '');

  return {
    label,
    title,
    responsible,
    check,
  };
}

/**
 * Formatea hace cuánto ocurrió una fecha de forma determinista y legible.
 */
export function formatRelativeTime(
  dateInput: string | Date,
  nowInput: string | Date | number = new Date(),
  locale: string = 'es',
): string {
  const date = new Date(dateInput);
  const now = new Date(nowInput);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return '';

  const diffMs = date.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  const isEn = locale.startsWith('en');
  if (absSec < 45) {
    return isEn ? 'just now' : 'hace unos momentos';
  }

  const rtf = new Intl.RelativeTimeFormat(isEn ? 'en' : 'es', { numeric: 'always' });

  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return rtf.format(diffMin, 'minute');
  }

  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return rtf.format(diffDays, 'day');
  }

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, 'month');
  }

  const diffYears = Math.round(diffDays / 365);
  return rtf.format(diffYears, 'year');
}

/**
 * Deriva los datos completos de la tarjeta «Dónde quedaste».
 */
export function deriveResumeCard(input: ResumeCardInput): ResumeCardData {
  const {
    changeId,
    isArchived = false,
    archivedAt,
    archivedOn,
    proposal,
    intent,
    tasks = [],
    tasksRaw,
    lastCommit,
    recentCommits,
    commitsAfterLastTask,
    uncommittedFiles,
    latestSession,
    now = new Date(),
    locale = 'es',
  } = input;

  const t = input.t ?? ((key: string, params?: Record<string, string | number>) => {
    let template = DEFAULT_TEXTS_ES[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        template = template.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return template;
  });

  // 1. Objetivo
  let objectiveText = '';
  let objectiveFallback = false;
  const whyParagraph = proposal ? extractWhyParagraph(proposal) : intent;
  if (whyParagraph && whyParagraph.trim().length > 0) {
    objectiveText = extractObjectiveSentences(whyParagraph);
  } else {
    objectiveText = t('pipeline.resumeCard.objectiveEmpty');
    objectiveFallback = true;
  }

  // Tareas generales y siguiente paso
  const totalTasks = tasks.length;
  const completedTasksList = tasks.filter((t) => t.completed);
  const nextTask = tasks.find((t) => !t.completed) ?? null;

  // ----------------------------------------------------
  // BLOQUE 1: Lo que venías haciendo
  // ----------------------------------------------------
  const lastCompletedTasks: ResumeCardTaskItem[] = completedTasksList.slice(-3).map((task) => {
    const parsed = parseTaskDetails(task);
    return {
      id: task.id,
      label: parsed.label,
      title: parsed.title,
      text: parsed.label ? `${parsed.label} ${parsed.title}` : parsed.title,
      responsible: parsed.responsible,
      check: parsed.check,
      completed: true,
    };
  });

  const rawCommitList: ChangeLastCommit[] = (recentCommits && recentCommits.length > 0)
    ? recentCommits
    : (lastCommit ? [lastCommit] : []);

  const lastCommits: ResumeCardCommitItem[] = rawCommitList.slice(0, 3).map((c) => {
    const shortMessage = c.message.split(/\r?\n/)[0].trim();
    const timeAgo = formatRelativeTime(c.date, now, locale);
    return {
      hash: c.hash,
      shortHash: c.shortHash || c.hash.slice(0, 7),
      message: shortMessage,
      date: c.date,
      timeAgo,
      text: `${shortMessage} · ${timeAgo}`,
    };
  });

  const whatYouWereDoingEmpty = lastCompletedTasks.length === 0 && lastCommits.length === 0;
  const whatYouWereDoing: ResumeCardWhatYouWereDoing = {
    completedTasks: lastCompletedTasks,
    commits: lastCommits,
    emptyText: whatYouWereDoingEmpty ? t('pipeline.resumeCard.whatYouWereDoingEmpty') : null,
  };

  // ----------------------------------------------------
  // BLOQUE 2: En qué estabas
  // ----------------------------------------------------
  const archiveDate = archivedOn?.at ?? archivedAt;
  const formattedArchiveDate = typeof archiveDate === 'string'
    ? archiveDate.split('T')[0]
    : (archiveDate ? String(archiveDate) : '');

  const isArchivedNotice = isArchived
    ? (archiveDate
        ? t('pipeline.resumeCard.archivedNotice', { date: formattedArchiveDate })
        : t('pipeline.resumeCard.archivedStep'))
    : null;

  let currentTaskItem: ResumeCardTaskItem | null = null;
  let currentDetail: { responsible: string | null; check: string | null } | null = null;
  let currentStatusText = '';

  if (isArchived) {
    currentStatusText = isArchivedNotice ?? t('pipeline.resumeCard.archivedStep');
  } else if (totalTasks === 0) {
    currentStatusText = t('pipeline.resumeCard.noTasks');
  } else if (!nextTask) {
    currentStatusText = t('pipeline.resumeCard.allTasksCompleted');
  } else {
    const parsed = parseTaskDetails(nextTask);
    currentTaskItem = {
      id: nextTask.id,
      label: parsed.label,
      title: parsed.title,
      text: parsed.label ? `${parsed.label} ${parsed.title}` : parsed.title,
      responsible: parsed.responsible,
      check: parsed.check,
      completed: false,
    };
    currentStatusText = currentTaskItem.text;
    if (parsed.responsible || parsed.check) {
      currentDetail = {
        responsible: parsed.responsible,
        check: parsed.check,
      };
    }
  }

  // Evidencia de trabajo en la tarea en curso
  const branchCommitsAfterList: ResumeCardCommitItem[] = (commitsAfterLastTask ?? []).map((c) => {
    const shortMessage = c.message.split(/\r?\n/)[0].trim();
    const timeAgo = formatRelativeTime(c.date, now, locale);
    return {
      hash: c.hash,
      shortHash: c.shortHash || c.hash.slice(0, 7),
      message: shortMessage,
      date: c.date,
      timeAgo,
      text: `${shortMessage} · ${timeAgo}`,
    };
  });

  const uncommittedList = (uncommittedFiles ?? []).filter(Boolean);

  let sessionInfo: ResumeCardEvidence['session'] = null;
  if (latestSession) {
    const runtime = latestSession.runtime || 'SDD';
    const outcome = latestSession.outcome || (latestSession.active ? 'running' : 'unknown');
    const statusLabel = t(`pipeline.resumeCard.sessionStatus.${outcome}`) || outcome;
    sessionInfo = {
      runtime,
      role: latestSession.role,
      outcome,
      statusLabel,
      text: t('pipeline.resumeCard.evidenceSession', { runtime, status: statusLabel }),
    };
  }

  const hasEvidence = !isArchived && !(!nextTask && totalTasks > 0) && (
    branchCommitsAfterList.length > 0 || uncommittedList.length > 0 || Boolean(sessionInfo)
  );

  const evidenceEmptyText = (!isArchived && Boolean(nextTask) && !hasEvidence)
    ? t('pipeline.resumeCard.noWorkStarted')
    : null;

  const currentWork: ResumeCardCurrentWork = {
    currentTask: currentTaskItem,
    isArchived,
    allCompleted: totalTasks > 0 && !nextTask,
    statusText: currentStatusText,
    detail: currentDetail,
    evidence: {
      hasEvidence,
      commitsAfterLastTask: branchCommitsAfterList,
      uncommittedFiles: uncommittedList,
      session: sessionInfo,
      emptyText: evidenceEmptyText,
    },
  };

  // ----------------------------------------------------
  // BLOQUE 3: Lo que queda
  // ----------------------------------------------------
  const sectionGroups = groupTasksBySection(tasks, tasksRaw, t);
  const remainingSections = sectionGroups.filter((g) => g.pendingTasks > 0);
  const allTasksCompleted = totalTasks > 0 && completedTasksList.length === totalTasks;

  let remainingEmptyText: string | null = null;
  if (totalTasks === 0) {
    remainingEmptyText = t('pipeline.resumeCard.noTasks');
  } else if (allTasksCompleted) {
    remainingEmptyText = t('pipeline.resumeCard.allTasksCompleted');
  }

  const remainingWork: ResumeCardRemainingWork = {
    sections: remainingSections,
    allCompleted: allTasksCompleted,
    noTasks: totalTasks === 0,
    emptyText: remainingEmptyText,
  };

  // ----------------------------------------------------
  // Compatibilidad con rows
  // ----------------------------------------------------
  let progressText = '';
  let progressFallback = false;
  if (totalTasks === 0) {
    progressText = t('pipeline.resumeCard.noTasks');
    progressFallback = true;
  } else if (allTasksCompleted) {
    progressText = t('pipeline.resumeCard.progressAllDone', {
      completed: completedTasksList.length,
      total: totalTasks,
    });
  } else {
    const sectionName = (nextTask ? extractTaskSection(nextTask, tasksRaw) : null) ?? t('pipeline.resumeCard.defaultSection');
    progressText = t('pipeline.resumeCard.progressWithSection', {
      completed: completedTasksList.length,
      total: totalTasks,
      section: sectionName,
    });
  }

  let activityText = '';
  let activityFallback = false;
  const primaryCommit = rawCommitList[0] ?? null;
  if (primaryCommit && primaryCommit.message) {
    const shortMessage = primaryCommit.message.split(/\r?\n/)[0].trim();
    const timeAgo = formatRelativeTime(primaryCommit.date, now, locale);
    activityText = t('pipeline.resumeCard.lastCommitActivity', {
      message: shortMessage,
      timeAgo,
    });
  } else {
    activityText = t('pipeline.resumeCard.noCommits');
    activityFallback = true;
  }

  let legacyNextStepText = '';
  let legacyNextStepFallback = false;
  let parsedNextTask: ResumeCardParsedTask | null = null;
  if (isArchived) {
    legacyNextStepText = isArchivedNotice ?? t('pipeline.resumeCard.archivedStep');
    legacyNextStepFallback = true;
  } else if (totalTasks === 0) {
    legacyNextStepText = t('pipeline.resumeCard.noPendingTasks');
    legacyNextStepFallback = true;
  } else if (!nextTask) {
    legacyNextStepText = t('pipeline.resumeCard.allTasksCompleted');
    legacyNextStepFallback = true;
  } else {
    const parsed = parseTaskDetails(nextTask);
    legacyNextStepText = `${parsed.label} ${parsed.title}`;
    parsedNextTask = {
      id: nextTask.id,
      label: parsed.label,
      title: parsed.title,
      responsible: parsed.responsible,
      check: parsed.check,
      rawText: nextTask.text,
      completed: nextTask.completed,
      section: extractTaskSection(nextTask, tasksRaw),
    };
  }

  return {
    changeId,
    isArchived,
    archivedNotice: isArchivedNotice,
    objective: {
      text: objectiveText,
      isFallback: objectiveFallback,
    },
    whatYouWereDoing,
    currentWork,
    remainingWork,
    rows: {
      objective: {
        labelKey: 'pipeline.resumeCard.row.objective',
        text: objectiveText,
        isFallback: objectiveFallback,
      },
      progress: {
        labelKey: 'pipeline.resumeCard.row.progress',
        text: progressText,
        isFallback: progressFallback,
      },
      lastActivity: {
        labelKey: 'pipeline.resumeCard.row.lastActivity',
        text: activityText,
        isFallback: activityFallback,
      },
      nextStep: {
        labelKey: 'pipeline.resumeCard.row.nextStep',
        text: legacyNextStepText,
        isFallback: legacyNextStepFallback,
        task: parsedNextTask,
        detail: currentDetail,
      },
    },
  };
}
