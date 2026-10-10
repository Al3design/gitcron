'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileCode2,
  FileSearch,
  FileText,
  ChevronLeft,
  FolderOpen,
  ListChecks,
  ListTodo,
  Milestone,
  MinusSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  PlusSquare,
  GitCompare,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  User,
  Wrench,
  MessageSquareText,
  BrainCircuit,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGitStore } from '@/lib/git-store';
import { changeIdFromBranch } from '@/lib/change-branch';
import { usePipelineStore } from '@/lib/pipeline-store';
import { useT } from '@/hooks/use-translation';
import type { RuntimeProjection } from '@/types/pipeline';
import type { DetailTab } from './PipelineDetails';
import { useReducedMotion } from 'motion/react';
import { ChangeBranchNotice } from './ChangeBranchNotice';
import { OpenSpecUpdateReview } from './OpenSpecUpdateReview';
import type { OpenSpecEngineStatus, OpenSpecUpdatePlan } from '@/types/pipeline';
import { SpecificationViewer } from './SpecificationViewer';
import { TaskConfirmToast } from './TaskConfirmToast';
import type { PipelineNewChangeMode } from './PipelineNewChangeFlow';
import { ViewSwitcherRail, type ViewSwitcherItem } from './ViewSwitcherRail';
import {
  useSddNavigation,
  type ActiveChangeView,
  SddOverviewView,
  SddTasksView,
  SddArtifactsView,
  SddDiffsView,
  SddActivityView,
  SddPrepareCommit,
  useEngineStatus,
  SddStatusBar,
  SddChangeHeader,
  useArchiveFlow,
  SddArchivedChange,
  SddStartScreens,
  type StartView,
} from './sdd';
import { useNewChangeDraft, useNewChangeDraftStore } from '@/lib/new-change-draft-store';
import {
  deriveArchiveAvailability,
  derivePipelineNextAction,
  hasDiffEvidence,
  resolveTaskLabel,
  resolveTaskText,
  type EngineInstructionInput,
  type PipelineActionIntent,
} from './pipeline-next-action';
import {
  groupActivity,
  runtimeDisplayName,
  type ActivityChannel,
} from './pipeline-domain';
import type { OpenSpecChangeSummary, PipelineSnapshot } from './pipeline-view-state';
import { configWarningLines, contributingConfigFiles, formatConfigParseError, lastValidNotices, paramWarningText } from '@/lib/gitcron-config-messages';
import styles from './OpenSpecDashboard.module.css';

function getSecondaryActionIcon(intent: PipelineActionIntent): React.ReactNode | null {
  switch (intent.kind) {
    case 'pause-after-task':
      return <Pause size={13} />;
    case 'view-activity':
      return <Activity size={13} />;
    case 'view-evidence':
      return <FileText size={13} />;
    case 'view-diff':
      return <GitCompare size={13} />;
    case 'open-explore-flow':
      return <FileSearch size={13} />;
    case 'open-propose-flow':
      return <Plus size={13} />;
    case 'start-apply':
      return <Play size={13} />;
    case 'start-archive':
      return <FolderOpen size={13} />;
    case 'refresh-validation':
      return <RotateCcw size={13} />;
    default:
      return null;
  }
}

type OpenSpecDashboardProps = {
  snapshot: PipelineSnapshot;
  repoPath: string;
  currentBranch: string;
  workingTreeClean: boolean;
  leftOpen?: boolean;
  rightOpen?: boolean;
  leftWidth?: number;
  rightWidth?: number;
  onResizeLeft?: (event: React.MouseEvent) => void;
  onResizeRight?: (event: React.MouseEvent) => void;
  onEnsureRightOpen?: () => void;
  projection: RuntimeProjection | null;
  runtimeHistory: RuntimeProjection[];
  /** Hay datos de vista previa en pantalla: nada ejecutable puede habilitarse. */
  fixtureActive?: boolean;
  /**
   * Hay una relectura de evidencia en curso.
   *
   * Se declara en el ciclo de vida, que es el elemento que va a cambiar cuando
   * termine: un indicador sólo global queda lejos de donde ocurre y la espera se
   * lee como que la aplicación no respondió.
   */
  revalidating?: boolean;
  /** Relee la evidencia del repo. Es el fallback explícito del watcher. */
  onRefresh?: () => void;
  /**
   * Se avisa cuando el renderer selecciona un change manualmente, para que el
   * backend transporte el contenido de sus artefactos sin depender de la rama.
   */
  onSelectChange?: (changeId: string) => void;
  onPauseAfterTask: () => void;
  onRespondDecision?: (decisionId: string, optionId: string) => void;
  engineStatus?: OpenSpecEngineStatus | null;
  engineLoading?: boolean;
};

type CenterTab = 'work' | 'activity' | 'artifacts';


const ACTIVITY_ICONS: Record<ActivityChannel, React.ComponentType<{ size?: number }>> = {
  narrative: MessageSquareText,
  reasoning: BrainCircuit,
  tool: Wrench,
  file: FileCode2,
  system: CheckCircle2,
};

function taskProgress(change: OpenSpecChangeSummary): { completed: number; total: number; percent: number } {
  const tasks = Array.isArray(change.tasks) ? change.tasks : [];
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

function formatTime(value: string | null): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** Cuándo corrió una sesión, con día y hora. Sin esto, una vieja se lee como actual. */
function formatSessionMoment(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function formatSessionOption(session: RuntimeProjection): string {
  const runtime = runtimeDisplayName(session.runtime) ?? session.runtime;
  const context = [session.changeId, session.taskId].filter(Boolean).join(' · ');
  const date = new Date(session.startedAt);
  const started = Number.isNaN(date.getTime())
    ? session.startedAt
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  return [runtime, context, started].filter(Boolean).join(' · ');
}

/**
 * La memoria del último modelo elegido por repositorio se gestiona en
 * lib/ai-model-memory.ts para sincronizarse con OpenSpecReleaseNotes.
 */


export function OpenSpecDashboard({
  snapshot,
  repoPath,
  currentBranch,
  workingTreeClean,
  leftOpen,
  rightOpen,
  leftWidth,
  rightWidth,
  onResizeLeft,
  onResizeRight,
  onEnsureRightOpen,
  projection,
  runtimeHistory = [],
  fixtureActive = false,
  revalidating = false,
  onRefresh,
  onSelectChange,
  onPauseAfterTask,
  engineStatus: propEngineStatus,
  engineLoading: propEngineLoading,
}: OpenSpecDashboardProps) {
  const t = useT();
  /**
   * Texto con cantidad, concordando en número.
   *
   * Un texto que no concuerda —«Ver las 1 que faltan»— delata que nadie miró el
   * caso de uno, y el caso de uno es el más frecuente al final de cualquier
   * trabajo: la última tarea, el único archivo preparado. Se resuelve acá y no
   * en cada punto de uso, porque son cinco lugares y el sexto se olvidaría.
   *
   * El chino no concuerda en número: su variante `.one` existe igual con el
   * texto que corresponde, para que la ausencia no se lea como un olvido.
   */
  const tCount = (key: string, count: number, params?: Record<string, string | number>): string =>
    t(count === 1 ? `${key}.one` : key, { count, ...params });
  const setSuccess = useGitStore((state) => state.setSuccess);
  const modifiedFiles = useGitStore((state) => state.modifiedFiles);
  const branchTracking = useGitStore((state) => state.branchTracking);
  const openRepos = useGitStore((state) => state.openRepos);
  const openRepoPaths = useMemo(() => (openRepos ?? []).map((r) => r.path).filter(Boolean), [openRepos]);
  const openSpec = snapshot.openSpec;
  const [selection, setSelectionState] = useState<string | null>(null);
  const setSelection = (val: string | null | ((prev: string | null) => string | null)) => {
    const next = typeof val === 'function' ? val(selection) : val;
    setSelectionState(next);
    usePipelineStore.getState().setSelectedChangeId(next);
    if (next) {
      onSelectChange?.(next);
    }
  };
  const [centerTab, setCenterTab] = useState<CenterTab>('work');
  const [evidenceTab, setEvidenceTab] = useState<DetailTab>('proposal');
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  /**
   * Cambios desplegados. Sin entrada, un cambio va plegado.
   *
   * Antes seguía a la selección, y desplegado ocupa varias veces el alto de un
   * ítem plegado: al cambiar de cambio se plegaba el anterior, se liberaba
   * espacio y aparecía otro que hasta entonces estaba fuera de vista. Desplegar
   * es una acción que se pide con su control, no un efecto de seleccionar.
   */
  const [expandedChanges, setExpandedChanges] = useState<Record<string, boolean>>({});
  /**
   * Instrucción a lanzar y su destino.
   *
   * El `taskId` viaja con la instrucción en vez de volver a derivarse de la
   * próxima tarea pendiente al renderizar el lanzador. Re-derivarlo permitía que
   * lo ejecutado dejara de coincidir con lo confirmado: un archivado con tareas
   * pendientes arrancaba atado a una de ellas y quedaba registrado como un
   * intento sobre esa tarea, que es justo lo que traba un change.
   */
  const [launchTarget, setLaunchTarget] = useState<{ instruction: string; taskId: string | null } | null>(null);

  /**
   * Panel de preparación abierto. Se abre a pedido desde el estado del árbol y
   * no al detectar que hay algo sin confirmar: abrirse solo taparía lo que se
   * estaba mirando sin que nadie lo pidiera.
   *
   * La única fuente de verdad es el store de Zustand para mantener
   * sincronizados el cuerpo central y el panel derecho sin estados duplicados.
   */
  const prepareOpen = usePipelineStore((state) =>
    (repoPath && state.prepareOpenByRepo[repoPath] !== undefined
      ? state.prepareOpenByRepo[repoPath]
      : state.prepareOpen),
  );
  const setPrepareOpen = usePipelineStore((state) => state.setPrepareOpen);


  /**
   * Especificación abierta en el centro, si hay alguna.
   *
   * Es una vista aparte y no una pestaña del cambio: una spec consolidada no
   * pertenece a ningún cambio activo, es el resultado acumulado de todos los
   * archivados.
   */
  const [openSpecificationId, setOpenSpecificationIdState] = useState<string | null>(null);
  const setOpenSpecificationId = (val: string | null | ((prev: string | null) => string | null)) => {
    const next = typeof val === 'function' ? val(openSpecificationId) : val;
    setOpenSpecificationIdState(next);
    usePipelineStore.getState().setOpenSpecificationId(next);
  };

  useEffect(() => {
    return usePipelineStore.subscribe((state, prevState) => {
      if (state.selectedChangeId !== prevState.selectedChangeId) {
        setSelectionState(state.selectedChangeId);
        if (state.selectedChangeId) {
          onSelectChange?.(state.selectedChangeId);
        }
      }
      if (state.openSpecificationId !== prevState.openSpecificationId) {
        setOpenSpecificationIdState(state.openSpecificationId);
      }
    });
  }, [onSelectChange]);

  const reviewOpen = usePipelineStore((state) => state.reviewOpen);
  const setReviewOpen = usePipelineStore((state) => state.setReviewOpen);
  const engineChangeToken = usePipelineStore((state) => state.engineChangeToken);
  const [updatePlan, setUpdatePlan] = useState<OpenSpecUpdatePlan | null>(null);

  useEffect(() => {
    if (reviewOpen) {
      const api = typeof window !== 'undefined' ? window.api : undefined;
      if (api?.pipelineOpenSpec?.getUpdatePlan) {
        void api.pipelineOpenSpec.getUpdatePlan(repoPath).then((plan) => {
          setUpdatePlan(plan);
        }).catch(() => {
          // Silently keep fallback plan
        });
      }
    }
  }, [reviewOpen, repoPath, engineChangeToken]);
  const [initBusy, setInitBusy] = useState(false);
  /** Motivo real informado por el CLI. No se normaliza a un mensaje propio. */
  const [initError, setInitError] = useState<string | null>(null);
  /**
   * El CLI no pudo detectar ninguna herramienta y hay que elegir una.
   *
   * Se guarda aparte del error porque no es un fallo: es el único caso en que el
   * comando exige `--tools`, y la respuesta que pide es una elección, no leer un
   * mensaje.
   */
  const [initNeedsTool, setInitNeedsTool] = useState(false);
  /**
   * Preferencia del sistema por menos movimiento.
   *
   * El panel ya la respeta en CSS para la banda de relectura; acá hace falta en
   * JavaScript porque el movimiento lo produce la animación de layout, que no
   * pasa por una hoja de estilos.
   */
  const reducedMotion = useReducedMotion();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  /**
   * Que el flujo esté abierto es parte del borrador y no estado local.
   *
   * Vivía en un `useState` acá, y cambiar de solapa desmonta el panel entero: al
   * volver, la pantalla no estaba. Es lo primero que se pierde y lo que más
   * desconcierta, porque no queda ni rastro de que había algo empezado.
   */
  const draft = useNewChangeDraft(repoPath);
  const patchDraft = useNewChangeDraftStore((state) => state.patchDraft);
  const clearDraft = useNewChangeDraftStore((state) => state.clearDraft);
  const flowMode: PipelineNewChangeMode | null = draft.open ? draft.mode : null;
  /**
   * Cerrar sin descartar: elegir un cambio o lanzar una tarea sacan el
   * formulario de la vista, pero no son la persona diciendo que ya no lo quiere.
   * Sólo «cerrar sin empezar» y arrancar la sesión descartan lo escrito.
   */
  const closeFlow = () => patchDraft(repoPath, { open: false });
  const openFlow = (mode: PipelineNewChangeMode) => patchDraft(repoPath, { open: true, mode });
  /** «Cerrar sin empezar» sí descarta: es la persona diciendo que no lo quiere. */
  const dismissFlow = () => clearDraft(repoPath);

  type StartView = 'in-progress' | 'archived' | 'new-change';
  const [activeStartView, setActiveStartView] = useState<StartView>(() => (draft.open ? 'new-change' : 'in-progress'));
  /**
   * Aclaración de arquitectura (Revisión visual 4.6 / Tarea 3.4):
   * Que el control «Alternar resumen fijado» corra el contenido del medio para hacerle
   * lugar al panel (o le devuelva ese lugar al ocultarlo) NO incumple el requisito
   * consolidado «Un control no desplaza a los demás al cambiar».
   *
   * Dicho requisito prohíbe terminantemente que los elementos de la interfaz se muevan
   * SOLOS, sin que nadie lo haya pedido (por ejemplo, que una lista crezca o un desplegable
   * empuje fuera de vista lo que se estaba mirando).
   *
   * En este caso, el desplazamiento del contenido es la respuesta deliberada, directa y
   * esperada a una acción explícita de la persona al alternar la visibilidad del panel.
   * El contenido central permanece siempre centrado en ambos estados.
   */
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(true);
  const isSwitcherVisible = isSwitcherOpen && !rightOpen;

  // El switcher no se desmonta de golpe al abrirse el panel derecho de la app (rightOpen):
  // se mantiene montado durante el cierre y se pliega animado (300ms, idéntico al panel)
  // hasta desmontarse en transitionend. Al abrirse, lo inverso.
  const [isClosingByRightOpen, setIsClosingByRightOpen] = useState(false);
  const [isEnteringFromRightClose, setIsEnteringFromRightClose] = useState(false);
  const [prevRightOpen, setPrevRightOpen] = useState(rightOpen);
  if (prevRightOpen !== rightOpen) {
    setPrevRightOpen(rightOpen);
    const prefersReducedMotion = typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (rightOpen && isSwitcherOpen && !prefersReducedMotion) {
      setIsClosingByRightOpen(true);
      setIsEnteringFromRightClose(false);
    }
    if (!rightOpen) {
      setIsClosingByRightOpen(false);
      if (isSwitcherOpen && !prefersReducedMotion) {
        setIsEnteringFromRightClose(true);
      } else {
        setIsEnteringFromRightClose(false);
      }
    }
  }

  useEffect(() => {
    if (!isClosingByRightOpen) return;
    const timer = setTimeout(() => {
      setIsClosingByRightOpen(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [isClosingByRightOpen]);

  useEffect(() => {
    if (!isEnteringFromRightClose) return;
    let raf1: number | null = null;
    let raf2: number | null = null;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          setIsEnteringFromRightClose(false);
        });
      });
    } else {
      const fallbackTimer = setTimeout(() => {
        setIsEnteringFromRightClose(false);
      }, 16);
      return () => clearTimeout(fallbackTimer);
    }
    const timer = setTimeout(() => {
      setIsEnteringFromRightClose(false);
    }, 400);
    return () => {
      if (raf1 !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(raf1);
      }
      if (raf2 !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(raf2);
      }
      clearTimeout(timer);
    };
  }, [isEnteringFromRightClose]);

  const handleSwitcherTransitionEnd = (e: React.TransitionEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) {
      if (isClosingByRightOpen) {
        setIsClosingByRightOpen(false);
      }
      if (isEnteringFromRightClose) {
        setIsEnteringFromRightClose(false);
      }
    }
  };

  const isSwitcherMounted = isSwitcherOpen && (!rightOpen || isClosingByRightOpen);
  const isSwitcherFolded = isClosingByRightOpen || isEnteringFromRightClose;
  const startScrollPositionsRef = useRef<Record<string, number>>({});
  const startBodyRef = useRef<HTMLDivElement>(null);
  const changeHeaderRef = useRef<HTMLElement>(null);

  const [pinnedChangeIds, setPinnedChangeIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(`gitcron:openspec:pinned-changes:${repoPath}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [prevRepoPath, setPrevRepoPath] = useState(repoPath);
  if (prevRepoPath !== repoPath) {
    setPrevRepoPath(repoPath);
    let initialPinned: string[] = [];
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(`gitcron:openspec:pinned-changes:${repoPath}`);
        initialPinned = raw ? JSON.parse(raw) : [];
      } catch {
        initialPinned = [];
      }
    }
    setPinnedChangeIds(initialPinned);
  }

  const togglePinChange = (changeId: string) => {
    setPinnedChangeIds((prev) => {
      const next = prev.includes(changeId)
        ? prev.filter((id) => id !== changeId)
        : [...prev, changeId];
      try {
        localStorage.setItem(`gitcron:openspec:pinned-changes:${repoPath}`, JSON.stringify(next));
      } catch {
        // Ignorar fallos de cuota o privacidad
      }
      return next;
    });
  };

  const handleSwitchStartView = (nextView: StartView) => {
    if (startBodyRef.current) {
      startScrollPositionsRef.current[activeStartView] = startBodyRef.current.scrollTop;
    }
    if (nextView === 'new-change') {
      if (!draft.open) {
        patchDraft(repoPath, { open: true, mode: draft.mode ?? 'propose' });
      }
    } else if (draft.open) {
      closeFlow();
    }
    setActiveStartView(nextView);
  };

  useLayoutEffect(() => {
    if (startBodyRef.current) {
      const saved = startScrollPositionsRef.current[activeStartView] ?? 0;
      startBodyRef.current.scrollTop = saved;
    }
  }, [activeStartView]);

  const activeChanges = openSpec?.activeChanges ?? [];
  const archivedChanges = openSpec?.archivedChanges ?? [];
  const specifications = openSpec?.specifications ?? [];
  const openSpecPresent = openSpec?.openSpecPresent;
  const openSpecTools = openSpec?.openSpecTools;
  const pendingToolCount = (openSpecTools ?? []).filter((tool) => !tool.configured).length;
  const selectableIds = new Set([
    ...activeChanges.map((change) => change.changeId),
    ...archivedChanges.map((change) => change.changeId),
  ]);

  /**
   * Sólo la elección explícita. Sin ella no hay cambio seleccionado y el panel
   * muestra el estado del repositorio.
   *
   * Antes había una cadena de descartes que terminaba en `activeChanges[0]`, y
   * eso hacía que abrir Pipeline entrara al primero de la lista mostrando sus
   * tareas como si fueran el asunto del momento. Un cambio elegido por orden de
   * lista no es información, y nada lo distinguía de uno elegido a propósito.
   *
   * `openSpec.selectedChangeId` tampoco entra acá: cuando el backend deriva una
   * correspondencia entre la rama y un cambio, se señala en la pantalla de
   * entrada. Gastarla en saltar adentro la volvía invisible.
   */
  const selectedId = selection && selectableIds.has(selection) ? selection : null;
  const selectedChange = activeChanges.find((change) => change.changeId === selectedId) ?? null;
  const selectedArchive = archivedChanges.find((change) => change.changeId === selectedId) ?? null;

  useEffect(() => {
    const headerEl = changeHeaderRef.current;
    const bodyEl = startBodyRef.current;
    if (!headerEl || !bodyEl || typeof ResizeObserver === 'undefined') return;

    const updateHeight = () => {
      const height = headerEl.getBoundingClientRect().height;
      if (height > 0) {
        bodyEl.style.setProperty('--change-header-height', `${height}px`);
      }
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [selectedChange?.changeId]);

  /**
   * Identificador del cambio que la rama actual nombra, si la rama es
   * `change/<slug>`. Se deriva estrictamente de `currentBranch` con
   * `changeIdFromBranch`. No se hereda de `openSpec.selectedChangeId` (que es la
   * selección manual y cambia al abrir cualquier cambio).
   * La etiqueta «CORRESPONDE A LA RAMA ACTUAL» y `data-branch` señalan la
   * correspondencia con la rama, no la selección.
   */
  const branchChangeId = changeIdFromBranch(currentBranch);
  const isMainOrMaster = currentBranch === 'main' || currentBranch === 'master';

  /**
   * Cambios de la pantalla de entrada: primero las tarjetas fijadas por la persona,
   * luego por avance descendente (adelante lo que está por cerrarse).
   */
  const startChanges = activeChanges
    .map((change) => ({ change, progress: taskProgress(change) }))
    .sort((left, right) => {
      const leftPinned = pinnedChangeIds.includes(left.change.changeId);
      const rightPinned = pinnedChangeIds.includes(right.change.changeId);
      if (leftPinned && !rightPinned) return -1;
      if (!leftPinned && rightPinned) return 1;
      return right.progress.percent - left.progress.percent;
    });

  const totalGlobalTasks = activeChanges.reduce(
    (total, change) => total + (Array.isArray(change.tasks) ? change.tasks.length : 0),
    0,
  );
  const completedGlobalTasks = activeChanges.reduce(
    (total, change) =>
      total +
      (Array.isArray(change.tasks)
        ? change.tasks.filter((task) => task.completed).length
        : 0),
    0,
  );
  const globalTaskPercent =
    totalGlobalTasks === 0 ? null : Math.round((completedGlobalTasks / totalGlobalTasks) * 100);

  const startViews: ViewSwitcherItem[] = useMemo(() => [
    {
      id: 'in-progress',
      label: t('pipeline.openspec.start.inProgress'),
      count: activeChanges.length,
      icon: <ListTodo size={13} />,
      slotIndex: 1,
    },
    {
      id: 'archived',
      label: archivedChanges.length === 0
        ? t('pipeline.openspec.start.neverArchived')
        : t(archivedChanges.length === 1 ? 'pipeline.openspec.start.archivedCount.one' : 'pipeline.openspec.start.archivedCount', { count: archivedChanges.length }),
      disabled: archivedChanges.length === 0,
      icon: <Archive size={13} />,
      slotIndex: activeStartView === 'in-progress' ? 1 : 2,
    },
    {
      id: 'new-change',
      label: t('pipeline.openspec.start.newChange'),
      icon: <Plus size={13} />,
      slotIndex: 2,
    },
  ], [activeChanges.length, archivedChanges.length, activeStartView, t]);

  const archiveViews: ViewSwitcherItem[] = useMemo(() => [
    {
      id: 'archived',
      label: archivedChanges.length === 0
        ? t('pipeline.openspec.start.neverArchived')
        : t(archivedChanges.length === 1 ? 'pipeline.openspec.start.archivedCount.one' : 'pipeline.openspec.start.archivedCount', { count: archivedChanges.length }),
      icon: <Archive size={13} />,
      slotIndex: 1,
    },
    {
      id: 'new-change',
      label: t('pipeline.openspec.start.newChange'),
      icon: <Plus size={13} />,
      slotIndex: 2,
    },
  ], [archivedChanges.length, t]);

  const specViews: ViewSwitcherItem[] = useMemo(() => [
    {
      id: 'start',
      label: t('pipeline.switcher.start'),
      icon: <ChevronLeft size={13} />,
      slotIndex: 1,
    },
  ], [t]);
  /** Lo que falta de un cambio. El avance ya está en la barra; esto es qué queda. */
  const pendingOf = (change: OpenSpecChangeSummary) => change.tasks.filter((task) => !task.completed);
  const nextTask = selectedChange?.tasks.find((task) => !task.completed) ?? null;
  // Archivar responde "¿qué me está permitido hacer?", no "¿qué conviene ahora?".
  // Por eso vive fuera de la derivación del siguiente paso.
  const archive = deriveArchiveAvailability(selectedChange, selectedArchive !== null);
  const runtimeActive = projection?.active === true;
  /**
   * Sesiones que corresponden a lo que se está mirando.
   *
   * Con un cambio abierto, sólo las suyas. El resto del panel central es de ese
   * cambio —tareas, artefactos, validación—, así que una columna al lado con
   * otro criterio se lee como si fuera de él: antes caía a la más reciente del
   * repositorio, y ver la actividad de otro cambio sin que nada lo declarara era
   * un modo de fallo silencioso.
   *
   * Una sesión sin `changeId` no entra: el nulo significa que no se pudo
   * atribuir, no que sea de todos.
   *
   * Sin cambio abierto pasan todas, porque el contexto es el repositorio entero
   * y no hay contra qué restringir.
   */
  const openChangeId = selectedChange?.changeId ?? selectedArchive?.changeId ?? null;
  const runtimeSessions = [projection, ...(runtimeHistory || [])]
    .filter((entry): entry is RuntimeProjection => Boolean(entry))
    .filter((entry, index, list) => list.findIndex((candidate) => candidate?.sessionId === entry.sessionId) === index)
    .filter((entry) => openChangeId === null || entry.changeId === openChangeId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  // La proyección activa deja de privilegiarse por estar corriendo: si es de
  // otro cambio, no está en el conjunto y no puede pisar la lectura de éste.
  const effectiveSessionId = selectedSessionId && runtimeSessions.some((entry) => entry.sessionId === selectedSessionId)
    ? selectedSessionId
    : runtimeSessions.find((entry) => entry.sessionId === projection?.sessionId)?.sessionId
      ?? runtimeSessions[0]?.sessionId
      ?? null;
  const selectedSession = runtimeSessions.find((entry) => entry.sessionId === effectiveSessionId) ?? null;
  /**
   * Con un cambio abierto y sin sesiones suyas no se cae a la actividad suelta
   * del snapshot: sería la de otro trabajo, que es el defecto que se corrige.
   */
  const visibleActivity = selectedSession?.activity ?? (openChangeId === null ? snapshot.activity : []);
  const activityGroups = groupActivity(visibleActivity);
  const selectedReasoningAvailable = selectedSession
    ? selectedSession.reasoningVisibility === 'emitted' || selectedSession.reasoningVisibility === 'summary'
      ? true
      : selectedSession.reasoningVisibility === 'unavailable'
        ? false
        : null
    : snapshot.economy.reasoningAvailable;
  const runningAgent = snapshot.agents.find((agent) => agent.state === 'running') ?? snapshot.agents[0] ?? null;
  const runningName = runtimeDisplayName(selectedSession?.runtime ?? runningAgent?.runtime ?? null) ?? t('pipeline.openspec.activity.agentUnknown');

  const [engineInstructions, setEngineInstructions] = useState<EngineInstructionInput>(null);

  useEffect(() => {
    if (!selectedChange?.changeId || fixtureActive) {
      return;
    }
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineOpenSpec?.getInstructions) {
      return;
    }
    let cancelled = false;
    void api.pipelineOpenSpec.getInstructions({
      repoPath,
      target: 'apply',
      changeId: selectedChange.changeId,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) {
        if (res.data.state === 'blocked') {
          const blockedReason = res.data.status?.find((s) => s.severity === 'error')?.message || 'Change blocked by OpenSpec';
          setEngineInstructions({
            instruction: null,
            context: null,
            error: blockedReason,
          });
        } else {
          setEngineInstructions({
            instruction: res.data.instruction,
            context: res.data.context,
            error: null,
          });
        }
      } else {
        setEngineInstructions({
          instruction: null,
          context: null,
          error: res.error || 'instructions-failed',
        });
      }
    }).catch((err: unknown) => {
      if (!cancelled) {
        setEngineInstructions({
          instruction: null,
          context: null,
          error: err instanceof Error ? err.message : 'instructions-failed',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedChange?.changeId, repoPath, fixtureActive]);

  const nextAction = derivePipelineNextAction({
    fixtureActive,
    selectedChange,
    selectedArchivedChangeId: selectedArchive?.changeId ?? null,
    projection,
    hasActiveChanges: activeChanges.length > 0,
    hasDiffs: hasDiffEvidence(snapshot),
    engineInstructions,
  });
  // Se resuelve contra la lista para que un identificador que ya no exista
  // —porque el repositorio cambió— no deje la vista abierta sobre la nada.
  const openSpecification = openSpecificationId
    ? specifications.find((entry) => entry.specificationId === openSpecificationId) ?? null
    : null;
  // Se sacan a constantes para que el render no repita el chequeo de nulos ni
  // necesite aserciones: si existen, son válidas.
  const primaryAction = nextAction.primary;
  const secondaryAction = nextAction.secondary;

  const hasDiffs = hasDiffEvidence(snapshot);
  const hasActivity = runtimeActive || visibleActivity.length > 0;

  const {
    activeChangeView,
    setActiveChangeView,
    highlightedTaskId,
    setHighlightedTaskId,
    handleNavigateToTask,
    changeViews,
  } = useSddNavigation({
    selectedChange,
    launchTarget,
    hasDiffs,
    hasActivity,
    diffCount: snapshot.diffs?.length ?? 0,
    activityCount: visibleActivity.length > 0 ? visibleActivity.length : null,
    runtimeActive,
  });

  /**
   * Abre un artefacto en la columna central.
   *
   * Selecciona el cambio primero: el markdown sólo viaja para el seleccionado,
   * así que abrir un archivo de otro cambio exige traerlo antes.
   */
  const openArtifact = (changeId: string, tab: DetailTab | null) => {
    if (tab === null) return;
    setSelection(changeId);
    onSelectChange?.(changeId);
    setCenterTab('artifacts');
    setEvidenceTab(tab);
    // Igual que al elegir un cambio: lo que ocupa el centro es uno solo.
    setOpenSpecificationId(null);
  };

  /**
   * Lo que la rama declara sobre el trabajo del árbol.
   *
   * Es la fuente primaria de atribución que Ale eligió: una rama es una
   * afirmación deliberada, mientras que observar qué rutas cambiaron mientras
   * una sesión estaba abierta es una correlación temporal. Parado en cualquier
   * otra rama no hay nada que atribuir, y el archivo queda sin atribuir en vez
   * de heredar el cambio que esté seleccionado en la pantalla.
   */
  const uiLanguage = useGitStore((state) => state.language);

  const {
    effectiveEngineStatus,
    effectiveEngineLoading,
    attentionReasons,
    attentionReasonSeparator,
    installPlan,
  } = useEngineStatus({
    repoPath,
    propEngineStatus,
    propEngineLoading,
  });

  const {
    archiveRequest,
    archiveReason,
    setArchiveReason,
    archiveError,
    setArchiveError,
    archiveBusy,
    archiveCmdExecuting,
    copiedArchiveCmd,
    archivePlanData,
    startArchive,
    confirmArchive,
    handleCopyArchiveCommand,
    handleExecuteArchiveCommand,
    cancelArchive,
  } = useArchiveFlow({
    repoPath,
    isMainOrMaster,
    fixtureActive,
    onRefresh,
  });

  /**
   * Inicializa OpenSpec en el repositorio abierto.
   *
   * No pasa por ninguna sesión de runtime: el proceso principal invoca el CLI,
   * por el mismo motivo que el archivado. Un agente puede no tener el comando y
   * devolver éxito sin haber hecho nada.
   *
   * La evidencia se relee al terminar: lo que el panel muestra después sale del
   * disco, no de suponer que el comando hizo lo que dijo.
   */
  const runOpenSpecInit = (tools?: string[]) => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineInitOpenSpec || initBusy) return;
    setInitBusy(true);
    setInitError(null);
    void api.pipelineInitOpenSpec(repoPath, tools)
      .then((result) => {
        if (result?.success) {
          setInitNeedsTool(false);
          onRefresh?.();
          return;
        }
        // «No encontró herramientas» no es un fallo: es el único caso en que hay
        // que elegir a mano. Mostrarlo como error dejaría a la persona leyendo
        // un mensaje del CLI sin nada que hacer con él.
        if (result?.needsTool) {
          setInitNeedsTool(true);
          return;
        }
        setInitError(result?.error || 'unknown');
      })
      .catch((error: unknown) => setInitError(error instanceof Error ? error.message : 'unknown'))
      .finally(() => setInitBusy(false));
  };

  const selectChange = (changeId: string) => {
    setSelection(changeId);
    onSelectChange?.(changeId);
    setActiveChangeView('overview');
    setCenterTab('work');
    setLaunchTarget(null);
    closeFlow();
    // Elegir un cambio cierra la especificación abierta: las dos ocupan el
    // centro, así que dejarla puesta hacía que la barra lateral pareciera no
    // responder —se marcaba el cambio elegido y el centro seguía mostrando la
    // especificación, sin más salida que "ver el repositorio"—.
    setOpenSpecificationId(null);
    // La preparación no se reinicia acá: es del repositorio, no del cambio.
    // Borrarla al cambiar de selección perdería una elección de archivos que no
    // tiene nada que ver con qué cambio se está mirando.
  };

  const handleCardClick = (e: React.MouseEvent, changeId: string) => {
    // Protección contra selección de texto (Observación 8.16 Bloque C):
    // Si el usuario seleccionó texto con el ratón para copiarlo, ignorar el clic y no navegar.
    const selection =
      typeof window !== 'undefined' && typeof window.getSelection === 'function'
        ? window.getSelection()
        : null;
    if (selection && selection.toString().trim().length > 0) {
      return;
    }
    selectChange(changeId);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent, changeId: string) => {
    // Sólo responder si la tecla se pulsó sobre la tarjeta misma, no sobre sus controles hijos.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectChange(changeId);
    }
  };

  /**
   * Traduce el intent ya resuelto por la derivación a un efecto de UI.
   *
   * No decide nada por su cuenta: si un intent llegó hasta acá, la función pura
   * ya determinó que corresponde en este estado.
   */
  const handleIntent = (intent: PipelineActionIntent) => {
    switch (intent.kind) {
      case 'open-propose-flow':
      case 'open-explore-flow':
        openFlow(intent.kind === 'open-propose-flow' ? 'propose' : 'explore');
        setLaunchTarget(null);
        setActiveChangeView('tasks');
        setCenterTab('work');
        break;
      // Se usa la instrucción que la derivación ya compuso, que es exactamente la
      // que se muestra bajo "Ver instrucción". Recomponerla acá abriría la puerta
      // a que lo mostrado y lo ejecutado dejaran de coincidir.
      //
      // El destino sale del propio intent, no de la evidencia: `start-apply`
      // nombra su tarea y `start-archive` no tiene ninguna. Volver a derivarlo
      // del estado hacía que archivar con tareas pendientes arrancara atado a
      // una de ellas.
      case 'start-apply':
        closeFlow();
        setLaunchTarget(nextAction.instruction ? { instruction: nextAction.instruction, taskId: intent.taskId } : null);
        setActiveChangeView('tasks');
        setCenterTab('work');
        break;
      // Archivar NO abre un runtime: lo ejecuta el proceso principal con el CLI.
      // Delegarlo en un agente agregaba un intermediario que podía no tener el
      // comando ni shell para correrlo, y devolver éxito sin hacer nada. Acá se
      // pide confirmación mostrando el comando exacto que se va a ejecutar.
      case 'start-archive': {
        closeFlow();
        setLaunchTarget(null);
        startArchive(intent.changeId);
        setActiveChangeView('tasks');
        setCenterTab('work');
        break;
      }
      case 'view-activity':
        setActiveChangeView('activity');
        setCenterTab('activity');
        break;
      case 'view-evidence':
        setActiveChangeView('artifacts');
        setCenterTab('artifacts');
        break;
      case 'view-diff':
        // Los artefactos/diffs viven en su propia vista soberana ahora.
        setActiveChangeView('diffs');
        setCenterTab('artifacts');
        break;
      case 'refresh-validation':
        onRefresh?.();
        break;
      case 'pause-after-task':
        onPauseAfterTask();
        break;
    }
  };

  // Una sesión nueva pasa a estar seleccionada mientras corre: si la persona
  // estaba mirando una sesión vieja, quedarse ahí escondería la que arranca.
  const liveSessionId = projection?.active === true ? projection.sessionId : null;
  const [lastLiveSessionId, setLastLiveSessionId] = useState<string | null>(null);
  if (liveSessionId !== lastLiveSessionId) {
    setLastLiveSessionId(liveSessionId);
    if (liveSessionId) setSelectedSessionId(liveSessionId);
  }

  const handleOpenChange = (changeId: string) => {
    setSelection(changeId);
    clearDraft(repoPath);
    setLaunchTarget(null);
    setActiveChangeView('overview');
  };
  const changeEnvironmentSlot = (() => {
    const mismatchNotice = selectedChange ? (
      <ChangeBranchNotice branch={currentBranch} changeId={selectedChange.changeId} />
    ) : null;

    const cancelBtn = launchTarget ? (
      <button
        type="button"
        className={styles.railActionItem}
        title={t('pipeline.openspec.archive.cancel')}
        onClick={() => setLaunchTarget(null)}
      >
        <span className={styles.railItemIcon} aria-hidden="true">
          <RotateCcw size={13} />
        </span>
        <span className={styles.railItemLabel}>
          {t('pipeline.openspec.archive.cancel')}
        </span>
      </button>
    ) : null;

    const continueBtn = (!launchTarget && primaryAction) ? (
      <button
        type="button"
        className={cn(styles.railActionItem, styles.railPrimaryAction)}
        disabled={fixtureActive && primaryAction.executable}
        title={t(nextAction.helpKey, nextAction.helpParams)}
        onClick={() => handleIntent(primaryAction.intent)}
      >
        <span className={cn(styles.railItemIcon, styles.railPrimaryIcon)} aria-hidden="true">
          {primaryAction.executable ? <Play size={13} fill="currentColor" /> : <Activity size={13} />}
        </span>
        <span className={styles.railItemLabel}>
          {t(primaryAction.labelKey, primaryAction.labelParams)}
        </span>
      </button>
    ) : null;

    const secondaryIcon = secondaryAction ? getSecondaryActionIcon(secondaryAction.intent) : null;
    const secondaryBtn = (!launchTarget && secondaryAction) ? (
      <button
        type="button"
        className={styles.railActionItem}
        disabled={fixtureActive && secondaryAction.executable}
        onClick={() => handleIntent(secondaryAction.intent)}
      >
        {secondaryIcon && (
          <span className={styles.railItemIcon} aria-hidden="true">
            {secondaryIcon}
          </span>
        )}
        <span className={styles.railItemLabel}>
          {t(secondaryAction.labelKey, secondaryAction.labelParams)}
        </span>
      </button>
    ) : null;

    const archiveBtn = (!launchTarget && selectedChange && selectedArchive === null && primaryAction?.intent.kind !== 'start-archive') ? (
      <button
        type="button"
        className={styles.railActionItem}
        disabled={!archive.available || fixtureActive || isMainOrMaster}
        title={isMainOrMaster ? t('pipeline.openspec.archive.blockedMainBranch', { branch: currentBranch || 'main' }) : archive.reasonKey ? t(archive.reasonKey) : t('pipeline.openspec.archive.help')}
        onClick={() => handleIntent({ kind: 'start-archive', changeId: selectedChange.changeId })}
      >
        <span className={styles.railItemIcon} aria-hidden="true">
          <FolderOpen size={13} />
        </span>
        <span className={styles.railItemLabel}>
          {archive.pendingTasks > 0
            ? t('pipeline.openspec.archive.actionPending', { count: archive.pendingTasks })
            : t('pipeline.openspec.archive.action')}
        </span>
      </button>
    ) : null;

    const decisionCount = snapshot.decisions?.length ?? 0;
    const noticesBtn = decisionCount > 0 ? (
      <button
        type="button"
        className={styles.railActionItem}
        data-view-id="openspec-attention"
        onClick={() => {
          if (!rightOpen && onEnsureRightOpen) {
            onEnsureRightOpen();
          }
          usePipelineStore.getState().requestAttentionFocus();
        }}
      >
        <span className={styles.railItemIcon} aria-hidden="true">
          <AlertTriangle size={13} />
        </span>
        <span className={styles.railItemLabel}>
          {t('pipeline.inbox.title')} ({decisionCount})
        </span>
      </button>
    ) : null;

    const actionCount = (cancelBtn ? 1 : 0) + (continueBtn ? 1 : 0) + (secondaryBtn ? 1 : 0) + (archiveBtn ? 1 : 0) + (noticesBtn ? 1 : 0);

    if (!mismatchNotice && actionCount === 0) return null;

    return (
      <>
        {mismatchNotice}
        {actionCount > 0 && (
          <div className={styles.railSection}>
            <div className={styles.railSectionHeader}>
              <span className={styles.railSectionTitle}>{t('pipeline.switcher.actions')}</span>
              <span className={styles.railItemCount} aria-label={`${actionCount}`}>
                <span className={styles.railItemCountValue}>{actionCount}</span>
              </span>
            </div>
            <div className={styles.railSlots}>
              {cancelBtn}
              {continueBtn}
              {secondaryBtn}
              {archiveBtn}
              {noticesBtn}
            </div>
          </div>
        )}
      </>
    );
  })();

  const openSpecRailSlot = (
    <>
      <div className={styles.railSectionHeader}>
        <span className={styles.railSectionTitle}>{t('pipeline.openspec.config.railTitle')}</span>
      </div>
      <button
        type="button"
        className={styles.railActionItem}
        data-view-id="openspec-config"
        aria-pressed={reviewOpen}
        onClick={() => setReviewOpen(true)}
      >
        <span className={styles.railItemIcon} aria-hidden="true"><Wrench size={13} /></span>
        <span className={styles.railItemLabel}>{t('pipeline.openspec.config.railEntry')}</span>
      </button>
    </>
  );

  return (
    <div
      className={`${styles.dashboard} ${styles.openspecScope}`}
      style={{
        ['--right-panel-width' as string]: typeof rightWidth === 'number' ? `${rightWidth}px` : undefined,
      } as React.CSSProperties}
    >
      <SddStatusBar
        currentBranch={currentBranch}
        workingTreeClean={workingTreeClean}
        modifiedFilesCount={modifiedFiles.length}
        branchTracking={branchTracking}
        effectiveEngineLoading={effectiveEngineLoading}
        effectiveEngineStatus={effectiveEngineStatus}
        attentionReasons={attentionReasons}
        attentionReasonSeparator={attentionReasonSeparator}
        selectedChange={selectedChange}
        prepareOpen={prepareOpen}
        repoPath={repoPath}
        setPrepareOpen={setPrepareOpen}
        onEnsureRightOpen={onEnsureRightOpen}
        isSwitcherOpen={isSwitcherOpen}
        setIsSwitcherOpen={setIsSwitcherOpen}
        isSwitcherVisible={isSwitcherVisible}
        rightOpen={rightOpen}
        onOpenReview={() => setReviewOpen(true)}
      />

      <div className={styles.body}>
        <main className={styles.center}>
          {/* La preparación se resuelve antes que el cambio seleccionado: es del
              repositorio y tiene que alcanzarse sin ninguno, que es exactamente
              el estado que dejaba un archivado sin confirmar. */}
          {/* Una especificación abierta gana sobre el resto de la vista central,
              salvo la preparación: ésta es del repositorio y no puede quedar
              tapada por lo que se esté leyendo. */}
          {!prepareOpen && openSpecification ? (
            <div className={styles.startScreenWrapper}>
              {isSwitcherMounted && (
                <ViewSwitcherRail
                  views={specViews}
                  activeViewId="spec"
                  onSwitchView={(viewId) => {
                    if (viewId === 'start') {
                      setOpenSpecificationId(null);
                    }
                  }}
                  openSpecSlot={openSpecRailSlot}
                  ariaLabel={t('pipeline.switcher.views')}
                  isFolded={isSwitcherFolded}
                  onTransitionEnd={handleSwitcherTransitionEnd}
                />
              )}
              <div className={styles.startBody} ref={startBodyRef}>
                <SpecificationViewer
                  repoPath={repoPath}
                  specificationId={openSpecification.specificationId}
                  requirements={openSpecification.requirements}
                  sourceRef={openSpecification.sourceRef}
                  onBack={() => setOpenSpecificationId(null)}
                />
              </div>
            </div>
          ) : !prepareOpen && reviewOpen ? (
            <div className={styles.startScreenWrapper}>
              {isSwitcherMounted && (
                <ViewSwitcherRail
                  views={selectedChange ? changeViews : startViews}
                  activeViewId="review"
                  onSwitchView={(viewId) => {
                    setReviewOpen(false);
                    if (selectedChange) {
                      setLaunchTarget(null);
                      if (viewId === 'start') {
                        setSelection(null);
                        setActiveStartView('in-progress');
                        setActiveChangeView('overview');
                      } else {
                        setActiveChangeView(viewId as ActiveChangeView);
                      }
                    } else {
                      handleSwitchStartView(viewId as StartView);
                    }
                  }}
                  environmentSlot={changeEnvironmentSlot}
                  openSpecSlot={openSpecRailSlot}
                  ariaLabel={t('pipeline.switcher.views')}
                  isFolded={isSwitcherFolded}
                  onTransitionEnd={handleSwitcherTransitionEnd}
                />
              )}
              <OpenSpecUpdateReview
                repoPath={repoPath}
                status={effectiveEngineStatus}
                isLoading={effectiveEngineLoading}
                updatePlan={updatePlan}
                installPlan={installPlan}
                snapshot={snapshot}
                openRepoPaths={openRepoPaths}
                currentBranch={currentBranch}
                isClean={workingTreeClean}
                uncommittedCount={modifiedFiles.length}
                onBack={() => setReviewOpen(false)}
                onPrepareCommit={() => {
                  setReviewOpen(false);
                  setPrepareOpen(true, repoPath);
                }}
                onUpdateCompleted={() => {
                  onRefresh?.();
                }}
              />
            </div>
          ) : prepareOpen ? (
            <SddPrepareCommit
              repoPath={repoPath}
              currentBranch={currentBranch}
              selectedChange={selectedChange}
              fixtureActive={fixtureActive}
              rightOpen={rightOpen}
            />
          ) : selectedChange ? (
            <div className={styles.startScreenWrapper}>
              {isSwitcherMounted && (
                <ViewSwitcherRail
                  views={changeViews}
                  activeViewId={launchTarget ? 'launch' : activeChangeView}
                  onSwitchView={(viewId) => {
                    setLaunchTarget(null);
                    if (viewId === 'start') {
                      setSelection(null);
                      setActiveStartView('in-progress');
                      setActiveChangeView('overview');
                    } else {
                      setActiveChangeView(viewId as ActiveChangeView);
                    }
                  }}
                  environmentSlot={changeEnvironmentSlot}
                  openSpecSlot={openSpecRailSlot}
                  ariaLabel={t('pipeline.switcher.views')}
                  isFolded={isSwitcherFolded}
                  onTransitionEnd={handleSwitcherTransitionEnd}
                />
              )}
              <div className={styles.startBody} ref={startBodyRef}>
                {/* Encabezado limpio: contenido dentro del cuerpo del medio */}
                <SddChangeHeader
                  changeHeaderRef={changeHeaderRef}
                  selectedChange={selectedChange}
                  revalidating={revalidating}
                  launchTarget={launchTarget}
                  nextActionHelpKey={nextAction.helpKey}
                  nextActionHelpParams={nextAction.helpParams}
                />

                {/* Pegada a la cabecera y en el cuerpo del medio */}
                {archiveRequest && (
                  <div className={styles.archiveConfirm}>
                    <div className={styles.archiveConfirmHead}>
                      <strong>{t('pipeline.openspec.archive.confirmTitle')}</strong>
                      <span>{t('pipeline.openspec.archive.confirmHelp')}</span>
                    </div>
                    <div className={styles.archiveCommandBox}>
                      <pre className={styles.archiveCommand}><code>{archiveRequest.command}</code></pre>
                      <div className={styles.archiveCommandActions}>
                        <button
                          type="button"
                          className={styles.secondaryAction}
                          onClick={handleCopyArchiveCommand}
                          aria-label={copiedArchiveCmd ? t('pipeline.openspec.archive.copiedCommand') : t('pipeline.openspec.archive.copyCommand')}
                        >
                          {copiedArchiveCmd ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                          <span>{copiedArchiveCmd ? t('pipeline.openspec.archive.copiedCommand') : t('pipeline.openspec.archive.copyCommand')}</span>
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryAction}
                          disabled={archiveCmdExecuting || isMainOrMaster}
                          onClick={handleExecuteArchiveCommand}
                        >
                          {archiveCmdExecuting ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                          <span>{archiveCmdExecuting ? t('pipeline.openspec.archive.commandRunning') : t('pipeline.openspec.archive.executeCommand')}</span>
                        </button>
                      </div>
                    </div>
                    {pendingOf(selectedChange).length > 0 && (
                      <div className={styles.archivePendingWarning} role="status">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>{t('pipeline.openspec.archive.reasonPendingWarning')}</span>
                      </div>
                    )}
                    <div className={styles.archiveReasonField}>
                      <label htmlFor="archive-reason-input">{t('pipeline.openspec.archive.reasonLabel')}</label>
                      <input
                        id="archive-reason-input"
                        type="text"
                        className={cn(styles.archiveReasonInput, pendingOf(selectedChange).length > 0 && styles.archiveReasonInputPending)}
                        value={archiveReason}
                        onChange={(e) => setArchiveReason(e.target.value)}
                        placeholder={t('pipeline.openspec.archive.reasonPlaceholder')}
                      />
                    </div>
                    {archivePlanData?.errors && archivePlanData.errors.length > 0 && (
                      <div role="alert">
                        {archivePlanData.errors.map((err, idx) => (
                          <p key={idx} className={styles.archiveError}>
                            <AlertTriangle size={13} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 'var(--space-1)' }} />
                            {err}
                          </p>
                        ))}
                      </div>
                    )}
                    {archiveError && (
                      <p className={styles.archiveError} role="alert">
                        {t('pipeline.openspec.archive.failed')} {archiveError}
                      </p>
                    )}
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.primaryAction}
                        disabled={archiveBusy || fixtureActive || (archivePlanData?.canArchive === false) || isMainOrMaster}
                        onClick={confirmArchive}
                      >
                        {archiveBusy
                          ? <Loader2 size={14} className={styles.spin} />
                          : <FolderOpen size={14} />}
                        {archiveBusy
                          ? t('pipeline.openspec.archive.running')
                          : t('pipeline.openspec.archive.confirmAction')}
                      </button>
                      {isMainOrMaster && (
                        <span className={styles.blockedReasonInline} role="alert">
                          {t('pipeline.openspec.archive.blockedMainBranch', { branch: currentBranch || 'main' })}
                        </span>
                      )}
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        disabled={archiveBusy}
                        onClick={cancelArchive}
                      >
                        {t('pipeline.openspec.archive.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Vistas del cambio: Resumen, Tareas, Artefactos, Diffs, Actividad */}
                {activeChangeView === 'overview' && (
                  <SddOverviewView
                    repoPath={repoPath}
                    selectedChange={selectedChange}
                    nextTask={nextTask}
                    latestSession={runtimeSessions[0] ?? null}
                    onNavigateToTask={handleNavigateToTask}
                  />
                )}

                {activeChangeView === 'tasks' && (
                  <SddTasksView
                    repoPath={repoPath}
                    selectedChange={selectedChange}
                    launchTarget={launchTarget}
                    runtime={{
                      projection,
                      fixtureActive,
                      runtimeActive,
                      runningName,
                    }}
                    nextTask={nextTask}
                    highlightTaskId={highlightedTaskId}
                    onBackToOverview={() => setActiveChangeView('overview')}
                    onLaunchStarted={() => {
                      setLaunchTarget(null);
                      setActiveChangeView('activity');
                      setCenterTab('activity');
                    }}
                    onRefresh={onRefresh}
                    setSuccess={setSuccess}
                  />
                )}

                {activeChangeView === 'artifacts' && (
                  <SddArtifactsView
                    snapshot={snapshot}
                    repoPath={repoPath}
                    selectedChange={selectedChange}
                    tab={evidenceTab}
                    onTabChange={setEvidenceTab}
                  />
                )}

                {activeChangeView === 'diffs' && (
                  <SddDiffsView
                    diffs={snapshot.diffs ?? []}
                    agentRuntimes={Object.fromEntries(snapshot.agents.map((agent) => [agent.agentId, agent.runtime]))}
                  />
                )}

                {activeChangeView === 'activity' && (
                  <SddActivityView
                    entries={visibleActivity}
                    reasoningAvailable={selectedReasoningAvailable}
                    runtimeAttached={selectedSession !== null || projection !== null}
                    agentRuntimes={Object.fromEntries(snapshot.agents.map((agent) => [agent.agentId, agent.runtime]))}
                  />
                )}
                </div>
              </div>
          ) : selectedArchive ? (
            <div className={styles.startScreenWrapper}>
              {isSwitcherMounted && (
                <ViewSwitcherRail
                  views={archiveViews}
                  activeViewId="archive"
                  onSwitchView={(viewId) => {
                    if (viewId === 'archived' || viewId === 'start') {
                      setSelection(null);
                      setActiveStartView('archived');
                    } else if (viewId === 'new-change') {
                      setSelection(null);
                      handleSwitchStartView('new-change');
                    }
                  }}
                  openSpecSlot={openSpecRailSlot}
                  ariaLabel={t('pipeline.switcher.views')}
                  isFolded={isSwitcherFolded}
                  onTransitionEnd={handleSwitcherTransitionEnd}
                />
              )}
              <div className={styles.startBody} ref={startBodyRef}>
                <SddArchivedChange
                  repoPath={repoPath}
                  snapshot={snapshot}
                  selectedArchive={selectedArchive}
                  runtimeSessions={runtimeSessions}
                  evidenceTab={evidenceTab}
                  setEvidenceTab={setEvidenceTab}
                  flowMode={flowMode}
                  projection={projection}
                  fixtureActive={fixtureActive}
                  currentBranch={currentBranch}
                  workingTreeClean={workingTreeClean}
                  onRefresh={onRefresh}
                  onOpenChange={handleOpenChange}
                  onSetCenterTab={setCenterTab}
                />
              </div>
            </div>
          ) : (
            /* Pantalla de entrada del repositorio. Absorbe la vieja
               `noActiveChange`, que sólo aparecía sin cambios ni archivados:
               tener dos pantallas de repositorio según cuántos cambios haya daba
               dos lecturas del mismo estado.

               Gobernada por el mecanismo de intercambio de vistas (ViewSwitcherRail):
               - El cuerpo muestra una vista soberana por vez: 'in-progress', 'archived' o 'new-change'.
               - El riel lateral presenta las vistas alternativas disponibles en ranuras estables.
               - Intercambiar preserva la posición de scroll y el estado de la vista. */
            <div className={styles.startScreenWrapper}>
              <div className={styles.startBody} ref={startBodyRef}>
                <SddStartScreens
                  activeStartView={activeStartView}
                  specifications={specifications}
                  globalTaskPercent={globalTaskPercent}
                  activeChanges={activeChanges}
                  archivedChanges={archivedChanges}
                  startChanges={startChanges}
                  branchChangeId={branchChangeId}
                  pinnedChangeIds={pinnedChangeIds}
                  togglePinChange={togglePinChange}
                  handleCardClick={handleCardClick}
                  handleCardKeyDown={handleCardKeyDown}
                  onDismissFlow={() => {
                    dismissFlow();
                    handleSwitchStartView('in-progress');
                  }}
                  onSwitchStartView={handleSwitchStartView}
                  repoPath={repoPath}
                  projection={projection}
                  fixtureActive={fixtureActive}
                  currentBranch={currentBranch}
                  snapshot={snapshot}
                  workingTreeClean={workingTreeClean}
                  onRefresh={onRefresh}
                  onOpenChange={handleOpenChange}
                  onSetCenterTab={setCenterTab}
                />
              </div>

              {isSwitcherMounted && (
                <ViewSwitcherRail
                  views={startViews}
                  activeViewId={activeStartView}
                  onSwitchView={(viewId) => handleSwitchStartView(viewId as StartView)}
                  openSpecSlot={openSpecRailSlot}
                  ariaLabel={t('pipeline.switcher.views')}
                  isFolded={isSwitcherFolded}
                  onTransitionEnd={handleSwitcherTransitionEnd}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
