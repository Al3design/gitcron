import type { ChangeLastCommit, ChangeTimestamp, TaskEvidence } from '@/types/pipeline';
import { resolveTaskLabel, resolveTaskText } from './pipeline-next-action';

/**
 * Resumen determinista "Dónde quedaste" para un cambio OpenSpec (Tarea 3.1).
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

export interface ResumeCardData {
  changeId: string;
  isArchived: boolean;
  archivedNotice: string | null;
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
  'pipeline.resumeCard.objectiveEmpty': 'El cambio no tiene propuesta definida todavía.',
  'pipeline.resumeCard.noTasks': 'Sin tareas definidas',
  'pipeline.resumeCard.noCommits': 'Todavía sin commits',
  'pipeline.resumeCard.noPendingTasks': 'Sin tareas pendientes',
  'pipeline.resumeCard.allTasksCompleted': 'Todas las tareas completadas',
  'pipeline.resumeCard.archivedNotice': 'Cambio archivado el {{date}}',
  'pipeline.resumeCard.archivedStep': 'Cambio completado y archivado',
  'pipeline.resumeCard.progressWithSection': '{{completed}} de {{total}} tareas · En «{{section}}»',
  'pipeline.resumeCard.progressAllDone': '{{completed}} de {{total}} tareas · Todas las tareas completadas',
  'pipeline.resumeCard.sectionNumber': 'Sección {{number}}',
  'pipeline.resumeCard.defaultSection': 'Sección inicial',
  'pipeline.resumeCard.lastCommitActivity': '{{message}} · {{timeAgo}}',
  'pipeline.resumeCard.responsibleLabel': 'Responsable:',
  'pipeline.resumeCard.checkLabel': 'Comprobación:',
  'pipeline.resumeCard.detailToggle': 'Detalle',
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

  // 2. Avance
  let progressText = '';
  let progressFallback = false;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;
  const nextTask = tasks.find((t) => !t.completed) ?? null;

  if (totalTasks === 0) {
    progressText = t('pipeline.resumeCard.noTasks');
    progressFallback = true;
  } else if (completedTasks === totalTasks) {
    progressText = t('pipeline.resumeCard.progressAllDone', {
      completed: completedTasks,
      total: totalTasks,
    });
  } else {
    const sectionName = (nextTask ? extractTaskSection(nextTask, tasksRaw) : null) ?? t('pipeline.resumeCard.defaultSection');
    progressText = t('pipeline.resumeCard.progressWithSection', {
      completed: completedTasks,
      total: totalTasks,
      section: sectionName,
    });
  }

  // 3. Última actividad
  let activityText = '';
  let activityFallback = false;
  if (lastCommit && lastCommit.message) {
    const shortMessage = lastCommit.message.split(/\r?\n/)[0].trim();
    const timeAgo = formatRelativeTime(lastCommit.date, now, locale);
    activityText = t('pipeline.resumeCard.lastCommitActivity', {
      message: shortMessage,
      timeAgo,
    });
  } else {
    activityText = t('pipeline.resumeCard.noCommits');
    activityFallback = true;
  }

  // 4. Siguiente paso
  let nextStepText = '';
  let nextStepFallback = false;
  let parsedNextTask: ResumeCardParsedTask | null = null;
  let detail: { responsible: string | null; check: string | null } | null = null;

  const archiveDate = archivedOn?.at ?? archivedAt;
  const formattedArchiveDate = typeof archiveDate === 'string'
    ? archiveDate.split('T')[0]
    : (archiveDate ? String(archiveDate) : '');

  if (isArchived) {
    nextStepText = archiveDate
      ? t('pipeline.resumeCard.archivedNotice', { date: formattedArchiveDate })
      : t('pipeline.resumeCard.archivedStep');
    nextStepFallback = true;
  } else if (totalTasks === 0) {
    nextStepText = t('pipeline.resumeCard.noPendingTasks');
    nextStepFallback = true;
  } else if (!nextTask) {
    nextStepText = t('pipeline.resumeCard.allTasksCompleted');
    nextStepFallback = true;
  } else {
    const parsed = parseTaskDetails(nextTask);
    nextStepText = `${parsed.label} ${parsed.title}`;
    if (parsed.responsible || parsed.check) {
      detail = {
        responsible: parsed.responsible,
        check: parsed.check,
      };
    }
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

  const archivedNotice = isArchived
    ? (archiveDate
        ? t('pipeline.resumeCard.archivedNotice', { date: formattedArchiveDate })
        : t('pipeline.resumeCard.archivedStep'))
    : null;

  return {
    changeId,
    isArchived,
    archivedNotice,
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
        text: nextStepText,
        isFallback: nextStepFallback,
        task: parsedNextTask,
        detail,
      },
    },
  };
}
