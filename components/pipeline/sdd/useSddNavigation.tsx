import { useState, useMemo } from 'react';
import {
  ListTodo,
  Milestone,
  ListChecks,
  FileText,
  Code2,
  Activity,
  Undo2,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import type { ViewSwitcherItem } from '../ViewSwitcherRail';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';

export type ActiveChangeView = 'overview' | 'tasks' | 'artifacts' | 'diffs' | 'activity';

export interface UseSddNavigationOptions {
  initialView?: ActiveChangeView;
  selectedChange?: OpenSpecChangeSummary | null;
  launchTarget?: { taskId?: string | null; instruction?: string } | null;
  hasDiffs?: boolean;
  hasActivity?: boolean;
  diffCount?: number;
  activityCount?: number | null;
  runtimeActive?: boolean;
}

export function useSddNavigation({
  initialView = 'overview',
  selectedChange = null,
  launchTarget = null,
  hasDiffs = false,
  hasActivity = false,
  diffCount = 0,
  activityCount = null,
  runtimeActive = false,
}: UseSddNavigationOptions = {}) {
  const t = useT();
  const [activeChangeView, setActiveChangeView] = useState<ActiveChangeView>(initialView);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  const handleNavigateToTask = (taskId: string) => {
    setActiveChangeView('tasks');
    setHighlightedTaskId(taskId);
  };

  const changeViews: ViewSwitcherItem[] = useMemo(() => {
    if (launchTarget) {
      return [
        {
          id: 'tasks',
          label: t('pipeline.switcher.tasksReturn'),
          count: selectedChange ? selectedChange.tasks.length : null,
          icon: <ListChecks size={13} />,
          slotIndex: 1,
        },
        {
          id: 'start',
          label: t('pipeline.switcher.start'),
          icon: <Undo2 size={13} />,
          slotIndex: 2,
        },
      ];
    }
    const items: ViewSwitcherItem[] = [];

    // Ranura 1: Volver a cambios en curso (navegación contextual dinámica del panel)
    items.push({
      id: 'start',
      label: t('pipeline.openspec.start.inProgress'),
      icon: <ListTodo size={13} />,
      slotIndex: 1,
    });

    // Vista nueva «Resumen», primera del menú de cambio
    if (activeChangeView !== 'overview') {
      items.push({
        id: 'overview',
        label: t('pipeline.switcher.overview'),
        icon: <Milestone size={13} />,
        slotIndex: 2,
      });
    }

    // Tareas (con contador de pendientes)
    if (activeChangeView !== 'tasks') {
      const pendingCount = selectedChange ? selectedChange.tasks.filter((task) => !task.completed).length : 0;
      items.push({
        id: 'tasks',
        label: t('pipeline.switcher.tasks'),
        count: pendingCount,
        icon: <ListChecks size={13} />,
        slotIndex: 3,
      });
    }

    // Artefactos y evidencia
    if (activeChangeView !== 'artifacts') {
      items.push({
        id: 'artifacts',
        label: t('pipeline.switcher.artifacts'),
        icon: <FileText size={13} />,
        slotIndex: 4,
      });
    }

    // Diffs (sólo si hay cambios sin confirmar)
    if (hasDiffs && activeChangeView !== 'diffs') {
      items.push({
        id: 'diffs',
        label: t('pipeline.switcher.diffs'),
        count: diffCount,
        icon: <Code2 size={13} />,
        slotIndex: 5,
      });
    }

    // Actividad (sólo si hay sesión o bitácora)
    if (hasActivity && activeChangeView !== 'activity') {
      items.push({
        id: 'activity',
        label: t('pipeline.switcher.activity'),
        badge: runtimeActive ? t('pipeline.openspec.task.running') : undefined,
        count: activityCount,
        icon: <Activity size={13} />,
        slotIndex: 5,
      });
    }

    // Asignación estable y contigua de ranuras (1..N sin duplicados ni huecos)
    items.forEach((item, index) => {
      item.slotIndex = index + 1;
    });

    return items;
  }, [
    launchTarget,
    activeChangeView,
    selectedChange,
    hasDiffs,
    hasActivity,
    diffCount,
    runtimeActive,
    activityCount,
    t,
  ]);

  return {
    activeChangeView,
    setActiveChangeView,
    highlightedTaskId,
    setHighlightedTaskId,
    handleNavigateToTask,
    changeViews,
  };
}
