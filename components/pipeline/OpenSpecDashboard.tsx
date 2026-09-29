'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Code2,
  Copy,
  FileCode2,
  FileSearch,
  FileText,
  ChevronDown,
  ChevronLeft,
  FolderOpen,
  ListChecks,
  ListTodo,
  MinusSquare,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  PlusSquare,
  Star,
  GitBranch,
  GitCommit,
  GitCompare,
  GitMerge,
  Loader2,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  User,
  Wrench,
  MessageSquareText,
  BrainCircuit,
  PanelRight,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { ContentHeader } from '@/components/ContentHeader';
import { cn } from '@/lib/utils';
import { useGitStore, type GitFile } from '@/lib/git-store';
import { useGitActions } from '@/hooks/use-git-actions';
import { archivedChangeId, deriveRepoCommitScope, fileKind, soleChangeId, suggestCommitMessage, type ChangeAttribution, type CommitFileOrigin } from '@/lib/change-commit-scope';
import { changeIdFromBranch } from '@/lib/change-branch';
import { usePipelineStore } from '@/lib/pipeline-store';
import { AiElapsed } from './AiElapsed';
import { appendDraftChunks, clearDraftLog, finishDraftLog, startDraftLog } from '@/lib/commit-draft-log';
import { adviceKeyForStreamError } from '@/lib/stream-error-advice';
import { MIN_CONTEXT_LENGTH, filterDraftableModels, type LocalModel } from '@/types/commit-message-ai';
import { useRememberedAiModel, useRememberedAiSettings, rememberAiSettings, rememberAiModel as rememberAiModelGlobally, getRememberedAiModel, formatAiDeviceLabel } from '@/lib/ai-model-memory';
import { useT } from '@/hooks/use-translation';
import type { RuntimeProjection } from '@/types/pipeline';
import { ActivityFeed } from './ActivityFeed';
import { PipelineDetails, type DetailTab } from './PipelineDetails';
import { PipelineRuntimeLauncher } from './PipelineRuntimeLauncher';
import { useReducedMotion } from 'motion/react';
import { ChangeBranchNotice } from './ChangeBranchNotice';
import { ChangeTimestampLabel } from './ChangeTimestampLabel';
import { OpenSpecUpdateReview } from './OpenSpecUpdateReview';
import type { ArchivePlan, OpenSpecEngineStatus, OpenSpecInstallPlan, OpenSpecRegistryCheck, OpenSpecUpdatePlan } from '@/types/pipeline';
import { SpecificationViewer } from './SpecificationViewer';
import { LazyDiffViewer } from './LazyDiffViewer';
import { TaskConfirmToast } from './TaskConfirmToast';
import { OpenSpecTasksView } from './OpenSpecTasksView';
import { PipelineNewChangeFlow, type PipelineNewChangeMode } from './PipelineNewChangeFlow';
import { ViewSwitcherRail, type ViewSwitcherItem } from './ViewSwitcherRail';
import { AiModelControls } from './AiModelControls';
import { useNewChangeDraft, useNewChangeDraftStore } from '@/lib/new-change-draft-store';
import {
  composeArchiveInstruction,
  deriveArchiveAvailability,
  derivePipelineNextAction,
  hasDiffEvidence,
  resolveTaskLabel,
  resolveTaskText,
  type EngineInstructionInput,
  type PipelineActionIntent,
} from './pipeline-next-action';
import {
  getOpenSpecEngineUpgrade,
  groupActivity,
  hasOpenSpecEngineAttention,
  runtimeDisplayName,
  type ActivityChannel,
} from './pipeline-domain';
import type { OpenSpecChangeSummary, PipelineSnapshot } from './pipeline-view-state';
import {
  OPENSPEC_CYCLE_TARGET_VERSION,
  isInstalledBehindCycle,
} from '@/lib/openspec-version';
import { readEngineStatus } from '@/lib/engine-status-reader';
import styles from './OpenSpecDashboard.module.css';

const INTEGRATION_STATE_KEY_MAP: Record<string, string> = {
  'up-to-date': 'pipeline.openspec.engine.integrationState.upToDate',
  outdated: 'pipeline.openspec.engine.integrationState.outdated',
  conflicted: 'pipeline.openspec.engine.integrationState.conflicted',
  custom: 'pipeline.openspec.engine.integrationState.custom',
  unknown: 'pipeline.openspec.engine.integrationState.unknown',
};

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

/**
 * Estado de un archivo, dicho con palabra.
 *
 * Era un recuadro con la inicial, con la palabra sólo en el `title`. Un dato que
 * aparece al pasar el mouse no está presentado: es el mismo criterio por el que
 * el control de tarea dejó de ser un elemento sin señal. El color se conserva,
 * que es lo que permite barrer la lista de un vistazo.
 *
 * El estado sale del store, no del alcance derivado: la derivación responde de
 * dónde viene el archivo, no en qué estado está.
 */
function FileStatusBadge({ path, files }: { path: string; files: GitFile[] }) {
  const t = useT();
  const status = files.find((file) => file.path === path)?.status ?? 'modified';
  const label = t(`pipeline.openspec.prepare.state.${status}`);
  return (
    <span className={styles.fileStatus} data-status={status}>{label}</span>
  );
}

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

/**
 * Con qué marca se rotula cada redacción.
 *
 * Un contador y no un identificador al azar: sólo tiene que distinguir una
 * corrida de la anterior dentro de esta ventana, y eso lo cumple. Vive afuera
 * del componente porque el panel se desmonta al cerrarlo, y reiniciándose
 * volvería a emitir la marca de una corrida que puede seguir en vuelo.
 */
let draftRunCounter = 0;

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
  const commitMessage = useGitStore((state) => state.commitMessage);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const openRepos = useGitStore((state) => state.openRepos);
  const openRepoPaths = useMemo(() => (openRepos ?? []).map((r) => r.path).filter(Boolean), [openRepos]);
  const { stageFiles } = useGitActions();
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
   * El launcher descubre los runtimes de forma asíncrona. Mientras no resolvió,
   * su interior está vacío; el panel contenedor no pinta su marco hasta que haya
   * algo para ver, para no ofrecer un recuadro vacío.
   */
  const [launcherLoading, setLauncherLoading] = useState(false);
  /**
   * Archivado pendiente de confirmación humana.
   *
   * Archivar escribe en el repositorio —mueve el change y consolida sus specs—,
   * así que no se dispara con el click del control: primero se muestra el
   * comando exacto y recién al confirmarlo se ejecuta.
   */
  const [archiveRequest, setArchiveRequest] = useState<{ changeId: string; command: string } | null>(null);
  const [archivePlanData, setArchivePlanData] = useState<ArchivePlan | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [copiedArchiveCmd, setCopiedArchiveCmd] = useState(false);
  const [archiveCmdExecuting, setArchiveCmdExecuting] = useState(false);
  /**
   * Archivos elegidos para preparar. Vacío por defecto y para todos los grupos:
   * sin un cambio de referencia no hay criterio para que ninguno entre solo, y
   * preseleccionar el que estuviera enfocado en la lista lateral produciría un
   * commit distinto según dónde estuviera el foco.
   */
  const [chosenFiles, setChosenFiles] = useState<string[]>([]);
  const [prepareBusy, setPrepareBusy] = useState(false);
  /**
   * Panel de preparación abierto. Se abre a pedido desde el estado del árbol y
   * no al detectar que hay algo sin confirmar: abrirse solo taparía lo que se
   * estaba mirando sin que nadie lo pidiera.
   *
   * La única fuente de verdad es el store de Zustand para mantener
   * sincronizados el cuerpo central y el panel derecho sin estados duplicados.
   */
  const prepareOpen = usePipelineStore((state) => state.prepareOpen);
  const setPrepareOpen = usePipelineStore((state) => state.setPrepareOpen);
  /**
   * Cambios desplegados en la pantalla de entrada, y si la lista de archivados
   * está abierta. Plegados por defecto: con cuatro cambios de veintiocho tareas,
   * una pantalla de estado desplegada sería una lista de tareas.
   */
  const [expandedStart, setExpandedStart] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  /**
   * Cuántos archivos se enviaron en la última preparación.
   *
   * El toast se va solo y deja el panel sin rastro de lo que pasó. Esto
   * sostiene el resultado a la vista hasta que haya algo nuevo que preparar.
   */
  const [lastPreparedCount, setLastPreparedCount] = useState<number | null>(null);

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

  /** Motivo real informado por el CLI. No se normaliza a un mensaje propio. */
  const [archiveError, setArchiveError] = useState<string | null>(null);
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
  type ActiveChangeView = 'tasks' | 'artifacts' | 'diffs' | 'activity';
  const [activeChangeView, setActiveChangeView] = useState<ActiveChangeView>('tasks');
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

    // Ranura 2: Vista principal alternativa (Tareas / Artefactos)
    if (activeChangeView === 'artifacts') {
      items.push({
        id: 'tasks',
        label: t('pipeline.switcher.tasks'),
        count: selectedChange ? pendingOf(selectedChange).length : 0,
        icon: <ListChecks size={13} />,
        slotIndex: 2,
      });
    } else {
      items.push({
        id: 'artifacts',
        label: t('pipeline.switcher.artifacts'),
        icon: <FileText size={13} />,
        slotIndex: 2,
      });
      if (activeChangeView !== 'tasks') {
        items.push({
          id: 'tasks',
          label: t('pipeline.switcher.tasks'),
          count: selectedChange ? pendingOf(selectedChange).length : 0,
          icon: <ListChecks size={13} />,
          slotIndex: 3,
        });
      }
    }

    // Ranura 3: Diffs (sólo si hay cambios sin confirmar)
    if (hasDiffs) {
      items.push({
        id: 'diffs',
        label: t('pipeline.switcher.diffs'),
        count: snapshot.diffs?.length ?? 0,
        icon: <Code2 size={13} />,
        slotIndex: (activeChangeView === 'tasks' || activeChangeView === 'artifacts') ? 3 : 4,
      });
    }

    // Ranura 4: Actividad (sólo si hay sesión o bitácora)
    if (hasActivity) {
      items.push({
        id: 'activity',
        label: t('pipeline.switcher.activity'),
        badge: runtimeActive ? t('pipeline.openspec.task.running') : undefined,
        count: visibleActivity.length > 0 ? visibleActivity.length : null,
        icon: <Activity size={13} />,
        slotIndex: (activeChangeView === 'tasks' || activeChangeView === 'artifacts') ? 4 : 5,
      });
    }

    return items;
  }, [launchTarget, activeChangeView, selectedChange, hasDiffs, hasActivity, snapshot.diffs?.length, runtimeActive, visibleActivity.length, t]);


  /**
   * Evidencia observada de la sesión ligada al cambio seleccionado.
   *
   * Es evidencia **de sesión**, no de tarea: ningún runtime atribuye archivos ni
   * líneas a una tarea concreta de `tasks.md`. Mostrarla como si fuera por tarea
   * sería inventar la atribución, así que se rotula por lo que realmente es y
   * queda `null` cuando el stream no la reportó.
   */
  const changeSession = projection && selectedChange && projection.changeId === selectedChange.changeId
    ? projection
    : null;
  const gitDelta = (() => {
    const entry = changeSession?.activity.find((item) => item.text?.startsWith('git.changed '));
    const match = entry?.text ? /^git\.changed files=(\d+) additions=(\d+|unknown) deletions=(\d+|unknown)$/.exec(entry.text) : null;
    return match ? { files: match[1], additions: match[2], deletions: match[3] } : null;
  })();
  const lastObservedActivity = changeSession?.activity
    .filter((item) => item.channel === 'narrative' || item.channel === 'tool')
    .at(-1)?.text ?? null;

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
  /**
   * Redactar el asunto con un modelo local.
   *
   * El catálogo se pide una vez al abrir la preparación: es un GET barato y sin
   * generar nada. Redactar, en cambio, es explícito —medido: 25 a 98 segundos y
   * 7 GB de VRAM—, así que nada de esto ocurre en un refresco.
   */
  // El idioma sale del mismo store que el traductor, para que las frases de la
  // espera cambien junto con el resto del panel.
  const uiLanguage = useGitStore((state) => state.language);
  const [aiModels, setAiModels] = useState<LocalModel[]>([]);
  const aiModel = useRememberedAiModel(repoPath);
  /**
   * En qué está la IA: quieta, cargando un modelo, o redactando.
   *
   * Era un solo booleano para las dos operaciones, y por eso las frases de
   * espera arrancaban durante la carga —Ale lo marcó: tienen que aparecer al
   * apretar «Redactar con IA», no antes—. Un booleano tampoco permite mostrar
   * una barra durante la carga y un contador durante la redacción, que son cosas
   * distintas y se ven en momentos distintos.
   */
  const [aiPhase, setAiPhase] = useState<'idle' | 'loading' | 'drafting'>('idle');
  /** Cuándo arrancó lo que está corriendo, para contar los segundos. */
  const [aiStartedAt, setAiStartedAt] = useState<number | null>(null);
  /** Ocupada en cualquiera de las dos: es lo que deshabilita los controles. */
  /**
   * Cuál de las dos operaciones corre dentro de la fase «loading».
   *
   * Cargar y expulsar comparten fase porque ocupan al servidor igual y bloquean
   * los mismos controles, pero no dicen lo mismo: expulsar mostraba «Cargando el
   * modelo…», lo contrario de lo que pasaba. Ale lo vio expulsando.
   */
  const [aiOpKind, setAiOpKind] = useState<'load' | 'eject'>('load');
  const aiBusy = aiPhase !== 'idle';
  const setAiBusy = (busy: boolean) => {
    setAiPhase(busy ? 'drafting' : 'idle');
    setAiStartedAt(busy ? Date.now() : null);
  };
  const aiNotice = usePipelineStore((state) => state.aiNotice);
  const setAiNotice = usePipelineStore((state) => state.setAiNotice);
  /**
   * Contexto y minutos de inactividad, elegidos antes de cargar.
   *
   * Los dos se fijan **en la carga** y no se pueden cambiar después, así que
   * tienen que estar antes del botón. El TTL es lo que hace que el modelo se
   * cierre solo; media hora es un punto de partida, no una imposición.
   */
  /**
   * Identificador de máquina → nombre legible.
   *
   * Llega por un canal propio y no con el catálogo: el catálogo con sus
   * identificadores sale en 42 ms por WebSocket, y esto invoca un proceso —300 a
   * 700 ms, medido—. Mezclarlos haría que abrir el panel pague el proceso, que
   * es exactamente el error de la versión que hubo que retirar.
   */
  const [aiDeviceNames, setAiDeviceNames] = useState<Record<string, string>>({});
  /**
   * El modelo elegido sobrevive a que el panel se cierre y se vuelva a abrir.
   *
   * No contradice que nada venga preseleccionado: esa regla existe para que la
   * aplicación no elija por la persona, y acá se conserva **lo que ella
   * eligió**. Perderlo la obligaba a elegir de nuevo cada vez, y Ale se encontró
   * con el botón de redactar apagado sin entender por qué.
   *
   * Por repositorio y en memoria, como el borrador del cambio nuevo.
   */
  const rememberAiModel = (id: string) => {
    rememberAiModelGlobally(repoPath, id);
  };
  const aiSettings = useRememberedAiSettings(repoPath);
  const aiContext = aiSettings.contextLength;
  const aiTtlMinutes = aiSettings.ttlMinutes;
  const aiAbort = useRef<AbortController | null>(null);

  const [engineSnapshot, setEngineSnapshot] = useState<OpenSpecEngineStatus | null>(null);
  const [latestRegistryCheck, setLatestRegistryCheck] = useState<OpenSpecRegistryCheck | null>(null);
  const [engineLoading, setEngineLoading] = useState<boolean>(true);
  const [installPlan, setInstallPlan] = useState<OpenSpecInstallPlan | null>(null);

  useEffect(() => {
    let isMounted = true;
    setEngineSnapshot(null);
    setLatestRegistryCheck(null);
    setInstallPlan(null);
    setEngineLoading(true);

    if (typeof window !== 'undefined' && window.api?.pipelineOpenSpec) {
      readEngineStatus(repoPath, (snapshot) => {
        if (isMounted) {
          setEngineSnapshot(snapshot);
          setEngineLoading(false);
        }
      }).catch(() => {
        if (isMounted) {
          setEngineSnapshot(null);
          setEngineLoading(false);
        }
      });
      const getCheck = window.api.pipelineOpenSpec.checkLatestVersion
        ? window.api.pipelineOpenSpec.checkLatestVersion()
        : Promise.resolve(null);
      const getPlan = window.api.pipelineOpenSpec.getInstallPlan
        ? window.api.pipelineOpenSpec.getInstallPlan(repoPath)
        : Promise.resolve(null);

      getCheck
        .then((check) => {
          if (isMounted && check) {
            setLatestRegistryCheck(check);
          }
        })
        .catch(() => {});

      getPlan
        .then((plan) => {
          if (isMounted && plan) {
            setInstallPlan(plan);
          }
        })
        .catch(() => {});
    } else {
      setEngineLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [repoPath, engineChangeToken]);

  const effectiveEngineStatus = useMemo<OpenSpecEngineStatus | null>(() => {
    if (propEngineStatus !== undefined) return propEngineStatus;
    if (!engineSnapshot) return null;
    if (!latestRegistryCheck) return engineSnapshot;
    return {
      ...engineSnapshot,
      latestAvailable: latestRegistryCheck,
    };
  }, [propEngineStatus, engineSnapshot, latestRegistryCheck]);

  const effectiveEngineLoading = propEngineLoading !== undefined ? propEngineLoading : engineLoading;

  /**
   * Razones reales observadas del estado del motor para la franja de identidad (7.15).
   */
  const attentionReasonSeparator = uiLanguage === 'en' ? ' and ' : uiLanguage === 'zh' ? '，' : ' y ';
  const attentionReasons = effectiveEngineStatus
    ? [
        ...(effectiveEngineStatus.integrationState === 'outdated'
          ? [t('pipeline.openspec.engine.attentionReason.outdated')]
          : []),
        ...(effectiveEngineStatus.repoState === 'not-initialized'
          ? [t('pipeline.openspec.engine.attentionReason.notInitialized')]
          : []),
        ...(effectiveEngineStatus.divergence?.isDivergent
          ? [t('pipeline.openspec.engine.attentionReason.divergent')]
          : []),
      ]
    : [];

  // Lo que la rama declara sobre el trabajo del árbol.
  //
  // Memoizada sobre `currentBranch` (string, estable) porque antes era una IIFE
  // que devolvía un objeto literal nuevo en cada render: como dependencia de
  // `commitScope`, lo invalidaba siempre y anulaba su memoización. Es la
  // atribución primaria que Ale eligió —una rama es una afirmación deliberada,
  // no una correlación temporal con qué se editó mientras la sesión estaba
  // abierta—. Parado en una rama sin change, no hay nada que atribuir: es
  // `null`, y ese `null` sí es estable.
  const branchAttribution = useMemo<ChangeAttribution | null>(() => {
    const changeId = changeIdFromBranch(currentBranch);
    return changeId ? { changeId, source: 'branch' } : null;
  }, [currentBranch]);

  /**
   * Alcance del repositorio: todo lo modificado, agrupado por procedencia.
   *
   * No depende del cambio seleccionado. El commit describe el estado del árbol,
   * y atarlo a la selección dejaba estados reales sin ninguna superficie desde
   * la cual prepararse —los restos de un archivado sobre un repositorio sin
   * cambios activos—.
   *
   * Memoizado: `deriveRepoCommitScope` recorre el array, construye un `Set`, un
   * `Map` y los ordena —varias asignaciones—, y `modifiedFiles` cambia de
   * referencia en cada `set` del store. Con deps `[modifiedFiles,
   * branchAttribution]` (las dos entradas reales, y `branchAttribution` ya
   * estable), sólo recalcula cuando los archivos modificados o la rama cambian
   * de verdad, no en cada re-render por selección u hover.
   *
   * Los ya preparados salen del cálculo: si siguieran, la lista mostraría como
   * pendiente lo que se acaba de enviar, y el conteo no bajaría nunca.
   */
  const commitScope = useMemo(
    () => deriveRepoCommitScope(
      modifiedFiles.filter((file) => !file.staged).map((file) => file.path),
      branchAttribution,
    ),
    [modifiedFiles, branchAttribution],
  );
  const nothingLeftToPrepare = commitScope.files.length === 0;
  /** La otra mitad: lo que ya viajó al stage y el panel deja de listar. */
  const stagedFiles = modifiedFiles.filter((file) => file.staged);
  /** Etiqueta de un grupo. El del cambio nombra cuál, que es la atribución real. */
  const groupLabel = (origin: CommitFileOrigin): string => (
    origin.kind === 'change'
      ? origin.source === 'branch'
        // La fuente va en el rótulo, no sólo en la ayuda: es la diferencia entre
        // "vive en la carpeta de este cambio" y "lo editaste parado en su rama".
        ? t('pipeline.openspec.prepare.groupBranch', { change: origin.changeId })
        : t('pipeline.openspec.prepare.groupChange', { change: origin.changeId })
      : origin.kind === 'archived'
        ? t('pipeline.openspec.prepare.groupArchived')
        : t('pipeline.openspec.prepare.groupUnattributed')
  );
  /**
   * Qué contiene el grupo, en una línea. Un rótulo solo no permite auditarlo:
   * sumando todo de una, un archivo que no correspondía queda declarado apenas
   * como sin atribución y ahí se agota la información.
   *
   * El del archivado nombra qué se archivó cuando la carpeta lo declara; sin
   * prefijo de fecha no hay identificador y se dice lo genérico en vez de
   * inventar uno.
   */
  const groupHelp = (group: { origin: CommitFileOrigin; entries: Array<{ path: string }> }): string => {
    if (group.origin.kind === 'change') {
      // El punto ciego se declara donde se atribuye, no en un reporte que nadie
      // abre al confirmar: la rama afirma sobre el archivo por dónde se lo
      // editó, no por lo que el archivo es.
      return group.origin.source === 'branch'
        ? t('pipeline.openspec.prepare.groupBranchHelp', { branch: currentBranch || 'change/…' })
        : t('pipeline.openspec.prepare.groupChangeHelp');
    }
    if (group.origin.kind === 'unattributed') return t('pipeline.openspec.prepare.groupUnattributedHelp');
    const archived = group.entries.map((entry) => archivedChangeId(entry.path)).find(Boolean);
    return archived
      ? t('pipeline.openspec.prepare.groupArchivedHelp', { change: archived })
      : t('pipeline.openspec.prepare.groupArchivedHelpPlain');
  };
  /** Elegidos que siguen existiendo entre lo modificado, en el orden del árbol. */
  const chosen = commitScope.files
    .filter((entry) => chosenFiles.includes(entry.path))
    .map((entry) => entry.path);

  /** Suma o quita un conjunto entero: el total o un grupo. */
  const toggleMany = (paths: string[]) => {
    const allChosen = paths.every((path) => chosenFiles.includes(path));
    setChosenFiles((current) => (allChosen
      ? current.filter((path) => !paths.includes(path))
      : [...new Set([...current, ...paths])]
    ));
  };

  /**
   * Deja el commit listo: archivos preparados y mensaje sugerido escrito.
   *
   * **No confirma.** Confirmar es del flujo de commit, con el mensaje a la vista
   * y su botón propio: preparar es reversible y confirmar queda en la historia.
   */
  /**
   * El catálogo, una vez al abrir la preparación.
   *
   * Un GET barato que no genera nada. Si el servidor local no está, el
   * desplegable queda vacío y lo dice: la preparación sigue funcionando sin IA,
   * igual que Cartografía.
   */
  useEffect(() => {
    if (!prepareOpen || !repoPath) return;
    let alive = true;
    window.api?.commitAi?.catalog().then((result) => {
      if (!alive) return;
      // Los de embeddings no redactan nada; se filtran acá y no en el proveedor,
      // que los conserva con su tipo para poder explicar por qué no sirven.
      // Nada preseleccionado: elegir el modelo es de la persona, y eso es el
      // fundamento entero del selector —está medido que la función sirve o no
      // según cuál sea—. Dejar uno puesto convertiría esa decisión en un
      // descuido, que es el mismo motivo por el que no entra ningún archivo
      // tildado en este panel.
      const disponibles = filterDraftableModels(result?.data ?? []);
      setAiModels(disponibles);
      // Lo que se eligió antes sigue elegido, salvo que ya no esté en el
      // catálogo: sostener una elección que el servidor ya no ofrece dejaría el
      // botón encendido sobre un modelo que no existe.
      const currentModel = getRememberedAiModel(repoPath);
      if (currentModel && !disponibles.some((model) => model.id === currentModel)) {
        rememberAiModelGlobally(repoPath, '');
      }
    }).catch(() => { if (alive) setAiModels([]); });
    // Los nombres de las máquinas, aparte y después: cuestan un proceso y el
    // catálogo no puede esperarlos. Si no llegan, el desplegable muestra el
    // identificador recortado, que se lee peor pero es cierto.
    window.api?.commitAi?.deviceNames?.().then((result) => {
      if (alive && result?.data) setAiDeviceNames(result.data);
    }).catch(() => undefined);
    // NO se relee el catálogo al volver el foco, y hay una medición detrás.
    //
    // Se probó y hubo que retirarlo: cada `catalog()` no es un GET barato, sino
    // un GET **más un WebSocket** —`fetchModelCatalog` llama a `fetchDeviceIndex`
    // para resolver en qué máquina vive cada modelo—. Colgado del evento `focus`,
    // eso corre cada vez que la ventana se activa, y alternar entre LM Studio y
    // GitCron para comparar estados dispara decenas. Ale reportó la máquina
    // notoriamente más lenta con eso puesto, y sin eso no.
    //
    // Queda entonces un límite conocido: si alguien saca o carga un modelo desde
    // LM Studio, GitCron muestra el estado viejo hasta la próxima acción que
    // relea el catálogo —cargar o expulsar, que sí lo verifican—. Es preferible a
    // pagar un WebSocket por foco. Resolverlo bien pide un catálogo liviano, sin
    // el índice de dispositivos, y eso es trabajo aparte.
    return () => { alive = false; };
  }, [prepareOpen, repoPath]);

  /**
   * Lo que va llegando del modelo entra al store externo, no al estado del panel.
   *
   * Esta suscripción no provoca ningún re-renderizado de este componente:
   * `appendDraftChunks` escribe fuera de React y sólo despierta a quien se haya
   * suscrito al log. Con un `useState` acá, los ~8 avisos por segundo serían
   * ocho re-dibujados por segundo del panel entero durante un minuto entero de
   * redacción, que es exactamente el costo que ya hubo que sacar del temporizador
   * de la espera.
   *
   * Se da de alta con el panel y se da de baja al cerrarlo: fuera del panel no
   * hay nadie que pueda pedir una redacción.
   */
  useEffect(() => {
    if (!prepareOpen) return;
    return window.api?.commitAi?.onChunk?.((event) => appendDraftChunks(event));
  }, [prepareOpen]);

  /**
   * Al desmontar el componente, la preparación no queda abierta en el store.
   */
  useEffect(() => {
    return () => {
      setPrepareOpen(false);
    };
  }, [setPrepareOpen]);

  /**
   * El modelo elegido, para saber si hace falta cargarlo antes de redactar.
   *
   * Un modelo en disco no tiene contexto: el que se use lo decide LM Studio al
   * levantarlo. Por eso «no alcanza» y «no está cargado» se resuelven igual —hay
   * que cargarlo— y se ofrecen juntos.
   */
  const aiChosenModel = aiModels.find((model) => model.id === aiModel) ?? null;
  /**
   * En qué máquina vive un modelo, en una frase.
   *
   * La cadena vacía en la lista significa esta máquina; un identificador, otra.
   * Del identificador se muestran seis caracteres: el completo son treinta y dos
   * y no le dice nada a nadie, pero seis alcanzan para distinguir dos máquinas y
   * para reconocerlas en LM Studio.
   *
   * Lista vacía devuelve `null` y no «esta máquina»: no saber no es lo mismo que
   * saber que no.
   */
  const aiDeviceLabel = (devices: string[] | undefined): string | null => {
    return formatAiDeviceLabel(devices, aiDeviceNames, t);
  };
  const aiNeedsLoad = Boolean(aiChosenModel)
    && !(aiChosenModel!.loaded && (aiChosenModel!.loadedContextLength ?? 0) >= MIN_CONTEXT_LENGTH);

  /**
   * Por qué no se puede cargar todavía, o `null` si se puede.
   *
   * Existe porque el botón se apagaba **en silencio**: Ale bajó el contexto a
   * 16.328 para que la placa aguantara, el número quedó por debajo del piso y el
   * botón se puso gris sin decir nada. Es el tercer caso del mismo patrón que él
   * ya marcó dos veces —los campos que desaparecían, el botón de redactar
   * apagado— y la lección es siempre la misma: un control inerte tiene que decir
   * qué le falta, porque si no lo dice obliga a adivinar.
   */
  const aiLoadBlocker = ((): string | null => {
    if (!aiModel) return null;
    if (aiContext < MIN_CONTEXT_LENGTH) {
      return t('pipeline.openspec.prepare.aiContextTooLow', { minimum: MIN_CONTEXT_LENGTH });
    }
    if (aiTtlMinutes < 1) return t('pipeline.openspec.prepare.aiTtlTooLow');
    return null;
  })();

  const confirmAiLoad = async () => {
    if (aiBusy || !aiModel) return;
    // El botón queda apretable cuando falta corregir un valor, para poder
    // explicar qué falta en vez de apagarse en silencio. Quien corta es esto.
    if (aiContext < MIN_CONTEXT_LENGTH || aiTtlMinutes < 1) return;
    // Fase «cargando», no «redactando»: es lo que hace que las frases de espera
    // no arranquen acá, y lo que permite mostrar una barra en su lugar.
    setAiOpKind('load');
    setAiPhase('loading');
    setAiStartedAt(Date.now());
    setAiNotice(null);
    try {
      const result = await window.api?.commitAi?.load(aiModel, undefined, aiContext, aiTtlMinutes * 60);
      if (!result?.success) {
        setAiNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }));
        return;
      }
      // Relee el catálogo: el modelo que se acaba de cargar tiene ahora un
      // contexto real, y el desplegable lo seguía mostrando «en disco».
      const catalog = await window.api?.commitAi?.catalog();
      const disponibles = filterDraftableModels(catalog?.data ?? []);
      setAiModels(disponibles);
      // Se avisa que terminó, y se lo confirma contra el catálogo en vez de
      // darlo por hecho porque la llamada no falló. Ale cargó un modelo y no
      // vio ninguna señal de que hubiera terminado: la barra desaparecía y
      // nada ocupaba su lugar.
      const cargado = disponibles.find((model) => model.id === aiModel);
      setAiNotice(cargado?.loaded
        ? t('pipeline.openspec.prepare.aiLoadedOk', {
          model: aiModel,
          context: cargado.loadedContextLength ?? aiContext,
        })
        : t('pipeline.openspec.prepare.aiLoadedUnconfirmed', { model: aiModel }));
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * Cerrar el panel también corta lo que esté en vuelo.
   *
   * Antes cerraba la vista y dejaba al modelo trabajando: la persona ya declaró
   * que no lo quiere, y quedaba un aviso viejo esperando a que reabriera.
   */
  const closePrepare = () => {
    if (aiBusy) cancelAiDraft();
    setAiNotice(null);
    // Acá sí se borra lo que pensó: el rail se va con el panel, y dejarlo
    // guardado haría que la próxima vez que se abra aparezca el razonamiento de
    // un commit que ya se preparó.
    clearDraftLog();
    setPrepareOpen(false);
  };

  /**
   * Descargar el modelo a mano, sin esperar a que venza su TTL.
   *
   * Ale lo pidió: GitCron cargaba 7 GB en la placa y no daba ninguna salida.
   * Esperar los minutos del TTL no es una respuesta cuando querés la VRAM ahora.
   */
  const unloadAiModel = async () => {
    if (aiBusy || !aiModel) return;
    setAiOpKind('eject');
    setAiPhase('loading');
    setAiStartedAt(Date.now());
    setAiNotice(null);
    try {
      // Primero se mira si TODAVÍA está cargado, y recién después se expulsa.
      //
      // El catálogo se lee al abrir el panel y no se vuelve a mirar solo, así
      // que quien saque el modelo desde LM Studio deja a GitCron afirmando que
      // sigue cargado. Ale lo hizo: sacó el modelo a mano, la aplicación siguió
      // diciendo «cargado», apretó expulsar y vio la animación de una expulsión
      // que no expulsaba nada. Sin esta comprobación el panel actúa sobre una
      // instancia que ya no existe y le informa un éxito inventado.
      const previo = await window.api?.commitAi?.catalog();
      const antes = filterDraftableModels(previo?.data ?? []);
      setAiModels(antes);
      const vigente = antes.find((model) => model.id === aiModel);
      if (!vigente?.loaded) {
        setAiNotice(t('pipeline.openspec.prepare.aiAlreadyEjected', { model: aiModel }));
        return;
      }

      const result = await window.api?.commitAi?.unload(aiModel);
      if (!result?.success) {
        setAiNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }));
        return;
      }
      // El estado se actualiza en memoria y NO releyendo el catálogo.
      //
      // Un `catalog()` cuesta un GET más un WebSocket, y la comprobación previa
      // ya pagó uno en esta misma acción: pedirlo de nuevo duplicaba el costo de
      // expulsar. Acá no hace falta preguntar nada —el servidor acaba de
      // confirmar que la expulsión salió bien—, así que se marca ese modelo como
      // descargado y listo. Los demás no se tocan.
      setAiModels((actuales) => actuales.map((model) => (
        model.id === aiModel
          ? { ...model, loaded: false, loadedContextLength: null, loadedInstanceId: null }
          : model
      )));
      setAiNotice(t('pipeline.openspec.prepare.aiEjectedOk', { model: aiModel }));
    } finally {
      setAiPhase('idle');
      setAiStartedAt(null);
    }
  };

  const abortInFlightAiDraft = () => {
    if (!aiAbort.current) return;
    aiAbort.current.abort();
    aiAbort.current = null;
    // El rail deja de decir «en vivo». Lo pensado hasta acá se queda: se canceló
    // la redacción, no lo que se había visto.
    finishDraftLog();
    // Corta la petición del otro lado, no sólo descarta la respuesta: antes el
    // modelo seguía trabajando después de apretar «Cancelar».
    void window.api?.commitAi?.cancel();
  };

  const cancelAiDraft = () => {
    abortInFlightAiDraft();
    setAiBusy(false);
    setAiNotice(null);
  };

  /**
   * Cambiar de repositorio desmonta este panel (el workspace lleva `key` por
   * repo). Sin cortar acá, una redacción en vuelo terminaba escribiendo su
   * asunto en el campo de commit del repositorio al que se cambió, y el modelo
   * seguía trabajando: medido en la auditoría 4.2 del 2026-09-29.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Se vuelve a marcar al montar: en desarrollo React monta, desmonta y
    // remonta cada efecto, y sin esto el panel quedaba creyéndose desmontado
    // —«Preparar» con el spinner para siempre—, visto por Ale el 2026-09-29.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortInFlightAiDraft();
    };
  }, []);

  const draftWithAi = async () => {
    if (aiBusy || !repoPath || !aiModel || chosen.length === 0) return;
    const originRepoPath = repoPath;
    setAiBusy(true);
    setAiNotice(null);
    const controller = new AbortController();
    aiAbort.current = controller;
    // La marca se declara ANTES de pedir: los pedazos empiezan a llegar mientras
    // el `await` sigue esperando, y sin la marca puesta de antemano no habría con
    // qué distinguirlos de los de una corrida anterior que se canceló.
    const draftId = String(++draftRunCounter);
    startDraftLog(draftId);
    try {
      const result = await window.api?.commitAi?.draft({
        repoPath: originRepoPath,
        paths: chosen,
        changeId: soleChangeId(chosen, branchAttribution),
        intent: selectedChange?.intent ?? null,
        model: aiModel,
        draftId,
      });
      // Cancelar mientras estaba en vuelo: lo que llegue después ya no se aplica.
      if (controller.signal.aborted || !isMountedRef.current) return;
      const draft = result?.data;
      if (!result?.success || !draft) {
        if (isMountedRef.current) {
          setAiNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }));
        }
        return;
      }
      if (draft.status === 'drafted') {
        // Montado implica que el repositorio activo sigue siendo el de origen.
        setCommitMessage(draft.subject);
        // Se nombra el modelo: quien confirma tiene que poder ver que esto lo
        // escribió un modelo y no la aplicación.
        if (isMountedRef.current) {
          setAiNotice(t('pipeline.openspec.prepare.aiWrote', { model: draft.model }));
        }
        return;
      }
      if (!isMountedRef.current) return;
      if (draft.status === 'no-answer') {
        // «No contestó» y no «contestó vacío»: con el razonamiento comiéndose el
        // presupuesto, decir que devolvió un mensaje vacío haría pensar que la
        // función está rota cuando lo que falta es techo de tokens.
        setAiNotice(draft.reason === 'budget'
          ? t('pipeline.openspec.prepare.aiNoAnswerBudget', { model: draft.model })
          : t('pipeline.openspec.prepare.aiNoAnswer', { model: draft.model }));
        return;
      }
      if (draft.status === 'malformed') {
        // Contestó, pero sin la forma pedida. No se impone en el campo —eso
        // obligaría a corregirlo a mano— y se muestra igual: puede ser una buena
        // descripción a la que sólo le falta el prefijo, y tirarla diciendo que
        // no contestó sería mentir sobre lo que pasó.
        setAiNotice(t('pipeline.openspec.prepare.aiMalformed', {
          model: draft.model,
          subject: draft.subject,
        }));
        return;
      }
      // El aviso del centro dice qué hacer, no el volcado del servidor: acá
      // llegaba el JSON crudo de LM Studio, que es exacto y no le sirve a nadie
      // para decidir. El motivo técnico completo queda en el rail, que es donde
      // se lo va a buscar. Si el error no se reconoce, se muestra tal cual:
      // inventar un consejo sería peor.
      const consejo = adviceKeyForStreamError(draft.detail);
      setAiNotice(consejo ? t(`pipeline.openspec.prepare.${consejo}`) : draft.detail);
    } finally {
      if (aiAbort.current === controller) aiAbort.current = null;
      if (!controller.signal.aborted && isMountedRef.current) setAiBusy(false);
      // Se terminó, con cuadro de cierre o sin él: un servidor que corta a mitad
      // dejaría el rail diciendo «en vivo» para siempre. Lo que se pensó queda a
      // la vista —recién se limpia cuando empieza otra redacción o se cierra el
      // panel—, porque el momento de leerlo es justo después de que termina.
      finishDraftLog();
    }
  };

  const prepareCommit = async () => {
    if (prepareBusy || fixtureActive || chosen.length === 0 || !repoPath) return;
    const originRepoPath = repoPath;
    setPrepareBusy(true);
    try {
      const staged = await stageFiles(chosen, true);
      if (!staged) return;
      // El mensaje se compone sobre el conjunto que realmente se envía, no sobre
      // todo lo modificado: la sugerencia describe el commit que se va a hacer.
      // Montado, el repositorio activo es el de origen. Si se cambió de repo
      // mientras se preparaba, el stage ya quedó en el de origen y la sugerencia
      // va ahí, por ruta; si ese repo se cerró, no se escribe en ningún lado.
      if (isMountedRef.current) {
        if (!commitMessage.trim()) setCommitMessage(suggestCommitMessage(chosen, branchAttribution));
      } else {
        const originRepo = useGitStore.getState().openRepos.find((repo) => repo.path === originRepoPath);
        if (originRepo && !originRepo.commitMessage.trim()) {
          useGitStore.getState().updateRepoByPath(originRepoPath, {
            commitMessage: suggestCommitMessage(chosen, branchAttribution),
          });
        }
        return;
      }
      setLastPreparedCount(chosen.length);
      // Lo elegido ya viajó: dejarlo marcado haría que una segunda preparación
      // volviera a incluir archivos que ya no están en la lista.
      setChosenFiles([]);
      setSuccess(tCount('pipeline.openspec.prepare.done', chosen.length));
    } catch (error: unknown) {
      if (isMountedRef.current) {
        setAiNotice(error instanceof Error ? error.message : t('pipeline.openspec.prepare.aiFailed', { detail: '—' }));
      }
    } finally {
      if (isMountedRef.current) setPrepareBusy(false);
    }
  };



  /**
   * Ejecuta el archivado ya confirmado.
   *
   * El resultado se lee de lo que devuelve el CLI, no del hecho de que la
   * llamada terminó: un fallo muestra el motivo real y el cambio sigue activo.
   */
  const confirmArchive = () => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!archiveRequest || archiveBusy || fixtureActive || !api?.pipelineArchiveChange || isMainOrMaster) return;
    setArchiveBusy(true);
    setArchiveError(null);
    const trimmedReason = archiveReason.trim();
    const archivePromise = trimmedReason
      ? api.pipelineArchiveChange(repoPath, archiveRequest.changeId, trimmedReason)
      : api.pipelineArchiveChange(repoPath, archiveRequest.changeId);
    void archivePromise
      .then((response) => {
        const result = response as { success?: boolean; error?: string } | null;
        if (result?.success) {
          setArchiveRequest(null);
          setArchiveReason('');
          // Por la superficie de notificaciones de la aplicación, no por una
          // propia: el éxito de archivar no es una clase de aviso distinta de
          // las demás, y el toast ya resuelve autocierre y cierre manual.
          setSuccess(t('pipeline.openspec.archive.done', { change: archiveRequest.changeId }));
          // La evidencia se relee: el cambio pasa a figurar entre los archivados
          // porque el disco lo dice, no porque la llamada haya vuelto sin error.
          onRefresh?.();
          return;
        }
        setArchiveError(result?.error || 'unknown');
      })
      .catch((error: unknown) => setArchiveError(error instanceof Error ? error.message : 'unknown'))
      .finally(() => setArchiveBusy(false));
  };

  const handleCopyArchiveCommand = async () => {
    if (!archiveRequest?.command) return;
    try {
      await navigator.clipboard.writeText(archiveRequest.command);
      setCopiedArchiveCmd(true);
      setTimeout(() => setCopiedArchiveCmd(false), 2000);
    } catch {
      // Ignorar fallo de portapapeles
    }
  };

  const handleExecuteArchiveCommand = async () => {
    if (!archiveRequest?.command || archiveCmdExecuting || isMainOrMaster) return;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineOpenSpec?.executeCommand) return;
    setArchiveCmdExecuting(true);
    setArchiveError(null);
    try {
      const res = await api.pipelineOpenSpec.executeCommand({ repoPath, command: archiveRequest.command });
      if (res.success) {
        setArchiveRequest(null);
        setArchiveReason('');
        setSuccess(t('pipeline.openspec.archive.done', { change: archiveRequest.changeId }));
        onRefresh?.();
      } else {
        setArchiveError(res.error || res.stderr || res.stdout || 'Error al ejecutar comando');
      }
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setArchiveCmdExecuting(false);
    }
  };

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
    setActiveChangeView('tasks');
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
        setArchiveError(null);
        setArchivePlanData(null);
        setArchiveRequest({ changeId: intent.changeId, command: composeArchiveInstruction(intent.changeId) });
        setActiveChangeView('tasks');
        setCenterTab('work');
        if (typeof window !== 'undefined' && window.api?.pipelineArchivePlan) {
          void window.api.pipelineArchivePlan(repoPath, intent.changeId).then((res) => {
            if (res.success && res.data) {
              setArchivePlanData(res.data);
            }
          }).catch(() => {});
        }
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
      <ContentHeader className="h-11 border-b border-border-subtle/15 flex items-center justify-between gap-3 normal-case font-normal shrink-0">
        {/* Left: Branch name and repo status indicators */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Branch name */}
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <GitBranch size={13} className="shrink-0 text-text-secondary/70" />
            <span
              className="font-mono font-semibold text-xs text-text-primary truncate"
              title={currentBranch || '-'}
            >
              {currentBranch || '-'}
            </span>
          </div>

          {/* Indicators */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Working tree state */}
            <div
              role="status"
              title={workingTreeClean ? t('pipeline.openspec.repo.clean') : t('pipeline.openspec.repo.changed')}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0',
                workingTreeClean
                  ? 'bg-secondary/10 text-secondary'
                  : 'bg-git-mod/15 text-git-mod'
              )}
            >
              {workingTreeClean ? (
                <Check size={11} strokeWidth={2.5} className="shrink-0" />
              ) : (
                <AlertCircle size={11} className="shrink-0" />
              )}
              <span>
                {workingTreeClean
                  ? t('sidebar.workingTreeClean')
                  : `${modifiedFiles.length} ${t('sidebar.workingTreeModified')}`}
              </span>
            </div>

            {/* Tracking / validation status */}
            {(() => {
              const tracking = (currentBranch && branchTracking) ? branchTracking[currentBranch] : undefined;
              if (tracking?.gone) {
                return (
                  <div
                    role="status"
                    title={t('sidebar.branchStatus.gone', { upstream: tracking.upstream ?? '' })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-error/15 text-error"
                  >
                    <AlertCircle size={11} className="shrink-0" />
                    <span>{t('sidebar.upstreamGone')}</span>
                  </div>
                );
              }
              if (tracking && (tracking.ahead > 0 || tracking.behind > 0)) {
                return (
                  <div
                    role="status"
                    title={t('sidebar.branchStatus.diverged', {
                      upstream: tracking.upstream ?? '',
                      ahead: tracking.ahead,
                      behind: tracking.behind,
                    })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-secondary/10 text-secondary font-mono"
                  >
                    <GitMerge size={11} className="shrink-0" />
                    <span>+{tracking.ahead} -{tracking.behind}</span>
                  </div>
                );
              }
              if (tracking) {
                return (
                  <div
                    role="status"
                    title={t('sidebar.branchStatus.synced', { upstream: tracking.upstream ?? '' })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-secondary/10 text-secondary"
                  >
                    <Check size={11} strokeWidth={2.5} className="shrink-0" />
                    <span>{t('sidebar.branchStatus.syncedShort')}</span>
                  </div>
                );
              }
              return (
                <div
                  role="status"
                  title={t('sidebar.branchStatus.local')}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-text-primary/[0.035] text-text-secondary/80"
                >
                  <Monitor size={11} className="shrink-0" />
                  <span>{t('sidebar.branchStatus.localShort')}</span>
                </div>
              );
            })()}

            {/* OpenSpec Engine version */}
            {(() => {
              if (effectiveEngineLoading || !effectiveEngineStatus) {
                return (
                  <div
                    role="status"
                    title={t('pipeline.openspec.engine.reading')}
                    className="relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 font-mono bg-text-primary/[0.035] text-text-secondary/80"
                  >
                    <Package size={11} className="shrink-0 animate-pulse" />
                    <span>{t('pipeline.openspec.engine.reading')}</span>
                  </div>
                );
              }
              const cliInstalled = effectiveEngineStatus?.cli?.installed ?? false;
              const runtimeVer = effectiveEngineStatus?.cli?.runtimeVersion ?? null;
              const isAbsent = !cliInstalled;
              const notDetected = cliInstalled && runtimeVer === null;
              const isBehind = isInstalledBehindCycle(runtimeVer);
              const versionStr = isAbsent
                ? t('pipeline.openspec.engine.status.absent')
                : notDetected
                  ? t('pipeline.openspec.engine.pill.notDetected')
                  : `OpenSpec v${runtimeVer}`;
              const stateKey = effectiveEngineStatus?.integrationState
                ? (INTEGRATION_STATE_KEY_MAP[effectiveEngineStatus.integrationState] ?? 'pipeline.openspec.engine.integrationState.unknown')
                : null;
              const stateStr = stateKey ? t(stateKey) : null;
              const upgrade = getOpenSpecEngineUpgrade(effectiveEngineStatus);
              const engineAttention = isAbsent || notDetected || hasOpenSpecEngineAttention(effectiveEngineStatus) || isBehind || upgrade !== null;
              const cycleNotice = isBehind
                ? t('pipeline.openspec.engine.versionBehindCycle', { installed: runtimeVer ?? '?', cycle: OPENSPEC_CYCLE_TARGET_VERSION })
                : null;
              const engineTitle = (isAbsent || notDetected)
                ? [
                    versionStr,
                    stateStr,
                    engineAttention && attentionReasons.length > 0 ? attentionReasons.join(attentionReasonSeparator) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : [
                    versionStr,
                    t('pipeline.openspec.engine.cycleVersion', { version: OPENSPEC_CYCLE_TARGET_VERSION }),
                    stateStr,
                    cycleNotice,
                    upgrade ? t('pipeline.openspec.engine.pill.upgradeAvailable', { latest: upgrade.latest }) : null,
                    engineAttention && attentionReasons.length > 0 ? attentionReasons.join(attentionReasonSeparator) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');

              return (
                <div
                  role="status"
                  title={engineTitle}
                  onClick={() => {
                    setReviewOpen(true);
                  }}
                  className={cn(
                    'relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 font-mono',
                    engineAttention
                      ? 'bg-warning/15 text-warning'
                      : 'bg-text-primary/[0.035] text-text-secondary/80',
                    'cursor-pointer hover:bg-text-primary/[0.07]',
                  )}
                >
                  <Package size={11} className="shrink-0" />
                  <span>{versionStr}</span>
                  {upgrade && (
                    <span
                      className="absolute -right-1 -top-1 w-2 h-2 rounded-full bg-git-mod ring-2 ring-bg-base/70 shadow-[0_0_8px_var(--color-git-mod)]"
                      aria-label={t('pipeline.openspec.engine.pill.upgradeAvailable', { latest: upgrade.latest })}
                      data-upgrade="available"
                    />
                  )}
                </div>
              );
            })()}

            {/* OpenSpec Validation status */}
            {(() => {
              const valStatus = selectedChange?.validation;
              let valText = t('pipeline.openspec.notApplicable');
              let valClass = 'bg-text-primary/[0.035] text-text-secondary/80';
              let valIcon = <ShieldCheck size={11} className="shrink-0" />;

              if (selectedChange) {
                if (valStatus === 'passed') {
                  valText = t('pipeline.openspec.validation.passed');
                  valClass = 'bg-secondary/10 text-secondary';
                  valIcon = <Check size={11} strokeWidth={2.5} className="shrink-0" />;
                } else if (valStatus === 'failed') {
                  valText = t('pipeline.openspec.validation.failed');
                  valClass = 'bg-error/15 text-error';
                  valIcon = <AlertCircle size={11} className="shrink-0" />;
                } else {
                  valText = t('pipeline.openspec.validation.unknown');
                  valClass = 'bg-text-primary/[0.035] text-text-secondary/80';
                  valIcon = <ShieldCheck size={11} className="shrink-0" />;
                }
              }

              return (
                <div
                  role="status"
                  title={`${t('pipeline.openspec.evidence.validation')}: ${valText}`}
                  className={cn(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0',
                    valClass,
                  )}
                >
                  {valIcon}
                  <span>{valText}</span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right: Acciones de encabezado */}
        <div className="shrink-0 ml-auto flex items-center gap-1.5">
          <div className="bg-bg-base/80 border border-border-subtle/30 rounded-lg flex items-center p-0.5 shadow-sm">
            <button
              type="button"
              data-clean={workingTreeClean}
              aria-expanded={prepareOpen}
              title={t('pipeline.openspec.prepare.open')}
              onClick={() => {
                const next = !prepareOpen;
                setPrepareOpen(next);
                if (next && onEnsureRightOpen) {
                  onEnsureRightOpen();
                }
              }}
              className={cn(
                "h-7 px-2.5 py-1 rounded-md transition-all duration-150 flex items-center justify-center gap-1.5",
                prepareOpen
                  ? "bg-secondary/15 text-secondary shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-add)_25%,transparent)]"
                  : "text-text-secondary hover:text-text-primary hover:bg-border-subtle/50"
              )}
            >
              <GitCommit size={13} className="shrink-0" />
              <span className="text-[length:var(--font-size-xs)] leading-none font-semibold">{t('pipeline.openspec.prepare.open')}</span>
            </button>
          </div>

          {/* Alternar resumen fijado (intercambiador de vistas) */}
          <div className="bg-bg-base/80 border border-border-subtle/30 rounded-lg flex items-center p-0.5 shadow-sm">
            <button
              type="button"
              data-testid="pipeline.switcher.toggle"
              data-active={isSwitcherOpen ? 'true' : undefined}
              aria-label={t('pipeline.switcher.toggle')}
              aria-expanded={isSwitcherVisible}
              aria-disabled={rightOpen}
              disabled={rightOpen}
              title={rightOpen ? t('pipeline.switcher.toggleDisabledHelp') : t('pipeline.switcher.toggle')}
              onClick={() => {
                if (!rightOpen) {
                  setIsSwitcherOpen((prev) => !prev);
                }
              }}
              className={cn(
                styles.iconBtn,
                isSwitcherOpen && styles.iconBtnActive,
                rightOpen && "opacity-50 cursor-not-allowed"
              )}
            >
              <PanelRight size={13} className="shrink-0" />
            </button>
          </div>
        </div>
      </ContentHeader>

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
                        setActiveChangeView('tasks');
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
                  setPrepareOpen(true);
                }}
                onUpdateCompleted={() => {
                  onRefresh?.();
                }}
              />
            </div>
          ) : prepareOpen ? (
            <section className={styles.prepareArea} aria-label={t('pipeline.openspec.prepare.title')}>
              {/* Las acciones se empujan a la derecha del encabezado con
                  margin-left: auto en .prepareActions; comparten fila con el
                  título arriba a la derecha: al final de la lista quedaban fuera
                  de vista con veinte archivos y había que bajar para encontrarlas. */}
              <div className={styles.prepareHead}>
                <div className={styles.archiveConfirmHead}>
                  <strong>{t('pipeline.openspec.prepare.title')}</strong>
                  <span>{t('pipeline.openspec.prepare.help')}</span>
                  {/* Un commit lo definen tres cosas: qué archivos, con qué
                      mensaje y a qué rama. La preparación ejecuta la operación
                      de Git para dejar los archivos listos (`stageFiles`), y el
                      commit se confirma desde el panel de staging. */}
                  <em className={styles.prepareBranch}>
                    <GitBranch size={11} />
                    {t('pipeline.openspec.prepare.toBranch', {
                      branch: currentBranch || t('pipeline.openspec.repo.branchUnknown'),
                    })}
                  </em>
                </div>
                <div className={styles.prepareActions}>
                  {!nothingLeftToPrepare && (
                    <>
                      <span className={styles.prepareCount}>
                        {t('pipeline.openspec.prepare.selected', {
                          count: chosen.length,
                          total: commitScope.files.length,
                        })}
                      </span>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        disabled={prepareBusy}
                        onClick={() => toggleMany(commitScope.files.map((entry) => entry.path))}
                      >
                        {chosen.length === commitScope.files.length
                          ? t('pipeline.openspec.prepare.deselectAll')
                          : t('pipeline.openspec.prepare.selectAll')}
                      </button>
                      {/* `aria-disabled` y no `disabled`: el panel se abre sin
                          nada elegido, que es el estado más frecuente, y con el
                          `disabled` nativo la acción principal salía del orden de
                          foco. Quien recorre con teclado nunca se enteraba de que
                          existía. `prepareCommit` ya corta solo, así que apretarla
                          no prepara nada. */}
                      <button
                        type="button"
                        className={styles.primaryAction}
                        aria-disabled={prepareBusy || fixtureActive || chosen.length === 0}
                        onClick={() => {
                          void prepareCommit().catch((error: unknown) => {
                            setAiNotice(error instanceof Error ? error.message : t('pipeline.openspec.prepare.aiFailed', { detail: '—' }));
                          });
                        }}
                      >
                        {prepareBusy ? <Loader2 size={14} className={styles.spin} /> : <GitBranch size={14} />}
                        {t('pipeline.openspec.prepare.action')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={closePrepare}
                  >
                    {t('pipeline.openspec.prepare.close')}
                  </button>
                </div>
              </div>

              {nothingLeftToPrepare ? (
                /* El toast se va solo; esto deja el resultado a la vista hasta
                   que haya algo nuevo que preparar. */
                <p className={styles.prepareEmpty}>
                  {lastPreparedCount === null
                    ? t('pipeline.openspec.prepare.empty')
                    : tCount('pipeline.openspec.prepare.preparedSummary', lastPreparedCount)}
                </p>
              ) : (
                <>
                  {/* El mensaje se corrige acá, donde se decide qué entra. Era un
                      `code` de sólo lectura: obligaba a recordar la corrección
                      hasta la vista de Commit. El campo escribe directo en el
                      `commitMessage` del store, así que lo que se lee es lo que se
                      va a confirmar; con dos fuentes podrían no coincidir, que es
                      el modo de fallo que este panel existe para evitar. */}
                  {/* El campo ocupa su lugar desde el principio, vacío mientras
                      no haya nada elegido. Aparecer al tildar el primer archivo
                      empujaba toda la lista hacia abajo justo cuando se estaba
                      mirando dónde tildar. */}
                  {/* El campo muestra SIEMPRE lo que hay en el estado, sin
                      fallback. La sugerencia va en el `placeholder`, que es lo
                      que de verdad es: una propuesta, no algo escrito.

                      Antes el valor era `commitMessage || sugerencia`, y eso
                      hacía imposible dejarlo vacío: borrar todo devolvía `''`,
                      el `||` reponía la sugerencia y el texto reaparecía solo.
                      Ale lo encontró queriendo escribir el suyo. Además la
                      sugerencia se veía como texto tipeado sin serlo: el estado
                      estaba vacío y la pantalla mostraba otra cosa.

                      Preparar con el campo vacío sigue usando la sugerencia —eso
                      pasa en `prepareCommit`, no acá—, así que no se pierde la
                      comodidad de no tener que escribir nada. */}
                  <label className={styles.messageField}>
                    <strong>{t('pipeline.openspec.prepare.message')}</strong>
                    <input
                      type="text"
                      value={commitMessage}
                      disabled={prepareBusy || aiBusy}
                      placeholder={chosen.length > 0
                        ? suggestCommitMessage(chosen, branchAttribution)
                        : t('pipeline.openspec.prepare.messagePlaceholder')}
                      onChange={(event) => setCommitMessage(event.target.value)}
                    />
                  </label>
                  {/* La frase de espera va DEBAJO del campo.
                      Primero se probó encima, y con el campo vacío se leía
                      encimada con el texto de ayuda —Ale lo marcó—. Debajo no
                      tapa nada y sigue sin poder ser el mensaje: el valor del
                      input nunca la toca. Es un estado, no un valor. */}
                  {/* En su propio componente: el temporizador vivía acá y cada
                      2,8 s re-renderizaba el panel entero durante los 40 s de
                      una redacción. */}
                  {/* Los dos estados en un contenedor propio, y no sueltos.
                      Sueltos peleaban con los márgenes negativos de sus vecinos
                      —el campo de arriba y la fila del modelo de abajo, que se
                      pega con -0,75rem— y la barra terminaba encimada con el
                      borde del desplegable. Ale lo marcó. */}
                  {/* Todo lo de la IA en un contenedor propio, con su fondo.
                      Los controles, lo que le falta, el aviso y las
                      características eran seis bloques sueltos separados sólo
                      por líneas y por el orden: había que leerlos para saber
                      cuáles iban juntos. Ale lo pidió señalando el sector
                      entero. El fondo distingue el sector de un vistazo, que es
                      lo que una línea no hace. */}
                  <AiModelControls
                    repoPath={repoPath}
                    models={aiModels}
                    deviceNames={aiDeviceNames}
                    onModelsChange={setAiModels}
                    busy={aiBusy}
                    phase={aiPhase}
                    startedAt={aiStartedAt}
                    opKind={aiOpKind}
                    notice={!rightOpen ? aiNotice : null}
                    onNoticeChange={setAiNotice}
                    onLoad={confirmAiLoad}
                    onUnload={unloadAiModel}
                    actions={
                      <>
                        {!aiNeedsLoad && (
                          <button
                            type="button"
                            className={styles.secondaryAction}
                            disabled={aiBusy || chosen.length === 0 || !aiModel}
                            onClick={draftWithAi}
                          >
                            {aiPhase === 'drafting' ? t('pipeline.openspec.prepare.aiBusy') : t('pipeline.openspec.prepare.aiDraft')}
                          </button>
                        )}
                        {aiBusy && (
                          <button type="button" className={styles.secondaryAction} onClick={cancelAiDraft}>
                            {t('pipeline.openspec.prepare.aiCancel')}
                          </button>
                        )}
                      </>
                    }
                  />
                  {/* Cada grupo declara de dónde viene lo que contiene. Ninguno
                      entra preseleccionado: sin un cambio de referencia,
                      privilegiar uno produciría un commit distinto según dónde
                      estuviera el foco de la lista lateral. */}
                  {commitScope.groups.map((group) => {
                    const paths = group.entries.map((entry) => entry.path);
                    const allChosen = paths.every((path) => chosenFiles.includes(path));
                    return (
                      <div key={group.key} className={styles.fileGroup}>
                        <p>
                          <strong>{groupLabel(group.origin)} ({group.entries.length})</strong>
                          <button
                            type="button"
                            className={styles.groupToggle}
                            disabled={prepareBusy}
                            onClick={() => toggleMany(paths)}
                          >
                            {allChosen ? <MinusSquare size={12} /> : <PlusSquare size={12} />}
                            {allChosen
                              ? t('pipeline.openspec.prepare.deselectAll')
                              : t('pipeline.openspec.prepare.selectAll')}
                          </button>
                        </p>
                        <p className={styles.groupHelp}>{groupHelp(group)}</p>
                        <ul className={styles.fileList}>
                          {group.entries.map((entry) => (
                            <li key={entry.path}>
                              {/* La etiqueta envuelve la fila entera: con el área
                                  del tamaño de la casilla había que apuntar. */}
                              <label className={styles.fileChoice}>
                                <input
                                  type="checkbox"
                                  checked={chosenFiles.includes(entry.path)}
                                  disabled={prepareBusy}
                                  onChange={(event) => setChosenFiles((current) => (
                                    event.target.checked
                                      ? [...current, entry.path]
                                      : current.filter((file) => file !== entry.path)
                                  ))}
                                />
                                <FileStatusBadge path={entry.path} files={modifiedFiles} />
                                <span>{entry.path}</span>
                                {/* El tipo sólo donde no hay otra información. En
                                    los demás grupos la procedencia ya está dicha
                                    arriba, y repetirlo por fila sería ruido. */}
                                {group.origin.kind === 'unattributed' && (
                                  <em className={styles.fileKind}>
                                    {t(`pipeline.openspec.prepare.kind.${fileKind(entry.path)}`)}
                                  </em>
                                )}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
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
                      setActiveChangeView('tasks');
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
                <header
                  ref={changeHeaderRef}
                  className={styles.changeHeader}
                  data-revalidating={revalidating || undefined}
                  aria-busy={revalidating || undefined}
                >
                  <div className={styles.headerIdentity}>
                    <div className={styles.changeTitleGroup}>
                      <h3>
                        {t('pipeline.openspec.change.active')}: <strong>{selectedChange.changeId}</strong>
                        <ChangeTimestampLabel labelKey="pipeline.openspec.stamp.created" stamp={selectedChange.createdAt} />
                      </h3>
                      {!launchTarget && nextAction.helpKey && (
                        <p className={styles.nextStepInline}>{t(nextAction.helpKey, nextAction.helpParams)}</p>
                      )}
                    </div>
                  </div>
                </header>

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
                        onClick={() => { setArchiveRequest(null); setArchiveReason(''); setArchiveError(null); setArchivePlanData(null); }}
                      >
                        {t('pipeline.openspec.archive.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                  {/* Vista A: TAREAS (o pantalla dedicada de continuación) */}
                  {activeChangeView === 'tasks' && (
                    launchTarget ? (
                      <section className={styles.startScreen} aria-label={t('pipeline.openspec.launcher.title')}>
                        <div
                          className={cn(styles.centerBlock, styles.launcherPanel)}
                          data-launcher-loading={launcherLoading || undefined}
                        >
                          <h4 className={styles.blockHeader}>
                            <Play size={13} aria-hidden="true" />
                            <span>{t('pipeline.openspec.launcher.title')}</span>
                          </h4>
                          <PipelineRuntimeLauncher
                            key={`${selectedChange.changeId}:${launchTarget.taskId ?? 'archive'}`}
                            repoPath={repoPath}
                            projection={projection}
                            intent="implement-task"
                            initialInstruction={launchTarget.instruction}
                            changeId={selectedChange.changeId}
                            taskId={launchTarget.taskId}
                            blockedByFixture={fixtureActive}
                            startLabelKey={launchTarget.taskId ? 'pipeline.launcher.startApply' : 'pipeline.launcher.startArchive'}
                            onStarted={() => {
                              setLaunchTarget(null);
                              setActiveChangeView('activity');
                              setCenterTab('activity');
                            }}
                            onDiscoveringChange={setLauncherLoading}
                          />
                        </div>
                      </section>
                    ) : (
                      <section className={styles.startScreen} aria-label={t('pipeline.switcher.tasks')}>
                        <OpenSpecTasksView
                          key={selectedChange.changeId}
                          repoPath={repoPath}
                          selectedChange={selectedChange}
                          fixtureActive={fixtureActive}
                          runtimeActive={runtimeActive}
                          runningName={runningName}
                          nextTask={nextTask}
                          changeSession={changeSession}
                          gitDelta={gitDelta}
                          lastObservedActivity={lastObservedActivity}
                          onRefresh={onRefresh}
                          setSuccess={setSuccess}
                          resolveTaskLabel={resolveTaskLabel}
                          resolveTaskText={resolveTaskText}
                        />
                      </section>
                    ))}

                  {/* Vista B: ARTEFACTOS Y EVIDENCIA */}
                  {activeChangeView === 'artifacts' && (
                    <section className={styles.startScreen} aria-label={t('pipeline.switcher.artifacts')}>
                      <PipelineDetails
                        snapshot={snapshot}
                        repoPath={repoPath}
                        selectedChange={selectedChange}
                        tab={evidenceTab}
                        onTabChange={setEvidenceTab}
                      />
                    </section>
                  )}

                  {/* Vista C: DIFFS (sólo si hay cambios sin confirmar) */}
                  {activeChangeView === 'diffs' && (
                    <section className={styles.startScreen} aria-label={t('pipeline.switcher.diffs')}>
                      <div className={styles.centerBlock}>
                        <LazyDiffViewer
                          diffs={snapshot.diffs ?? []}
                          agentRuntimes={Object.fromEntries(snapshot.agents.map((agent) => [agent.agentId, agent.runtime]))}
                        />
                      </div>
                    </section>
                  )}

                  {/* Vista D: ACTIVIDAD (sólo si hay sesión o bitácora) */}
                  {activeChangeView === 'activity' && (
                    <section className={styles.startScreen} aria-label={t('pipeline.switcher.activity')}>
                      <div className={styles.centerBlock}>
                        <ActivityFeed
                          entries={visibleActivity}
                          reasoningAvailable={selectedReasoningAvailable}
                          runtimeAttached={selectedSession !== null || projection !== null}
                          agentRuntimes={Object.fromEntries(snapshot.agents.map((agent) => [agent.agentId, agent.runtime]))}
                        />
                      </div>
                    </section>
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
                <section className={styles.completedSummary}>
                  {/* La identidad del cambio queda fija arriba mientras se recorren
                      sus artefactos: al llegar el contenido, el resumen se iba de
                      vista con el scroll y se perdía de qué cambio se estaba
                      mirando. */}
                  <div className={styles.completedHeader}>
                    <CheckCircle2 size={38} />
                    <p>{t('pipeline.openspec.change.completed')}</p>
                    <h3>{selectedArchive.changeId}</h3>
                    {/* Creación y archivado, ambas con hora: con la fecha sola no se
                        podía saber cuánto duró el trabajo.

                        Acá vivían tres filas que se retiraron. Dos eran texto
                        constante —"Especificaciones principales" y "Actividad y
                        evidencia" rendían siempre "Conservadas", sin consultar el
                        cambio— y la tercera mostraba una ruta cuya fecha ya estaba
                        impresa arriba. Una fila que siempre dice lo mismo enseña a
                        saltear el bloque entero, incluido lo que sí varía. */}
                    <div className={styles.completedStamps}>
                      <ChangeTimestampLabel labelKey="pipeline.openspec.stamp.created" stamp={selectedArchive.createdAt} />
                      <ChangeTimestampLabel labelKey="pipeline.openspec.stamp.archived" stamp={selectedArchive.archivedOn} />
                      {!selectedArchive.archivedOn && (
                        <span className={styles.changeStamp}>
                          <span>{t('pipeline.openspec.stamp.archived')}</span> {selectedArchive.archivedAt ?? t('pipeline.openspec.dateUnknown')}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Lo archivado es el registro de lo que se hizo, incluida la
                      firma humana. Revisarlo no debería obligar a salir de la
                      aplicación ni a leer el diff del commit de archivado. */}
                  {/* La región existe desde el primer render, aunque el contenido
                      todavía no haya llegado: al seleccionar un archivado hay una
                      relectura de por medio, y sin reservar el espacio la vista
                      saltaba de una ficha corta a una pantalla entera. */}
                  <div className={styles.archivedArtifacts} data-pending={!selectedArchive.artifacts || undefined}>
                    {!selectedArchive.artifacts ? (
                      <p className={styles.archivedPending}>{t('pipeline.revalidating')}</p>
                    ) : (
                      <PipelineDetails
                        snapshot={snapshot}
                        repoPath={repoPath}
                        isArchived={true}
                        selectedChange={{
                          changeId: selectedArchive.changeId,
                          intent: null,
                          tasks: [],
                          proposalExists: selectedArchive.artifacts.proposal !== null,
                          designExists: selectedArchive.artifacts.design !== null,
                          specsCount: selectedArchive.artifacts.specs.length,
                          validation: 'unknown',
                          artifacts: selectedArchive.artifacts,
                        }}
                        tab={evidenceTab}
                        onTabChange={setEvidenceTab}
                      />
                    )}
                  </div>
                  {flowMode && (
                    <>
                      <PipelineNewChangeFlow
                        repoPath={repoPath}
                        projection={projection}
                        blockedByFixture={fixtureActive}
                        onStarted={() => setCenterTab('activity')}
                        currentBranch={currentBranch}
                        divergence={snapshot.branchDivergence}
                        workingTreeClean={workingTreeClean}
                        onRefresh={onRefresh}
                        onOpenChange={handleOpenChange}
                      />
                    </>
                  )}
                </section>
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
                {activeStartView === 'in-progress' && (
                  <section className={styles.startScreen} aria-label={t('pipeline.openspec.start.title')}>
                    <header className={styles.startHeader}>
                      <div className={styles.startHeaderTitleGroup}>
                        <h3>{t('pipeline.openspec.start.title')}</h3>
                        <p className={styles.startSpecsBadge}>
                          <span>
                            {specifications.length === 0
                              ? t('pipeline.openspec.start.specsPending')
                              : t('pipeline.openspec.start.specificationsCount', { count: specifications.length })}
                          </span>
                          <span> · </span>
                          <span data-testid="start-global-progress">
                            {globalTaskPercent !== null
                              ? t('pipeline.openspec.start.globalProgress', { percent: globalTaskPercent })
                              : t('pipeline.openspec.start.noTasksToMeasure')}
                          </span>
                        </p>
                      </div>
                    </header>

                    {/* Centro de la pantalla: CAMBIOS EN CURSO */}
                    <div className={styles.startMainBlock}>
                      <div className={styles.startBlock}>
                        <h4>{t('pipeline.openspec.start.inProgress')} <span>{activeChanges.length}</span></h4>
                        {activeChanges.length === 0 ? (
                          <p className={styles.startNote}>{t('pipeline.openspec.start.noActive')}</p>
                        ) : (
                          <ul className={styles.startList}>
                            {startChanges.map(({ change, progress }) => {
                              const isPinned = pinnedChangeIds.includes(change.changeId);
                              return (
                                <li
                                  key={change.changeId}
                                  data-branch={change.changeId === branchChangeId || undefined}
                                  data-pinned={isPinned || undefined}
                                  tabIndex={0}
                                  role="button"
                                  aria-label={`${change.changeId} ${t('pipeline.openspec.start.enter')}`}
                                  onClick={(e) => handleCardClick(e, change.changeId)}
                                  onKeyDown={(e) => handleCardKeyDown(e, change.changeId)}
                                >
                                  <div className={styles.startItemHead}>
                                    <strong>{change.changeId}</strong>
                                    {/* La rama se señala, no navega: gastarla en saltar
                                        adentro la volvía invisible. */}
                                    {change.changeId === branchChangeId && (
                                      <em className={styles.branchPill}>{t('pipeline.openspec.start.branchMatch')}</em>
                                    )}
                                    {/* Criterio de diseño (2026-09-08, Obs. 8.16 & 8.17): La tarjeta entera es pulsable para abrir el cambio.
                                        El botón «Abrir» se retira. La estrella de fijado se ubica arriba a la derecha y detiene la propagación. */}
                                    <button
                                      type="button"
                                      className={cn(styles.iconBtn, styles.startCardPinBtn, isPinned && styles.startCardPinBtnPinned)}
                                      title={isPinned ? t('pipeline.openspec.start.unpinAction') : t('pipeline.openspec.start.pinAction')}
                                      aria-label={isPinned ? `${t('pipeline.openspec.start.pinned')}: ${t('pipeline.openspec.start.unpinAction')}` : t('pipeline.openspec.start.pinAction')}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        togglePinChange(change.changeId);
                                      }}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                      }}
                                    >
                                      <Star size={13} aria-hidden="true" />
                                    </button>
                                  </div>
                                  <p title={change.intent ?? undefined}>{change.intent ?? t('pipeline.openspec.intentUnknown')}</p>
                                  <div className={styles.startProgress}>
                                    <span>
                                      {progress.total === 0
                                        ? t('pipeline.openspec.start.noTasks')
                                        : t('pipeline.openspec.start.tasks', { done: progress.completed, total: progress.total })}
                                    </span>
                                    {progress.total > 0 && (
                                      <span className={styles.startBar} aria-hidden="true">
                                        <span style={{ width: `${progress.percent}%` }} />
                                      </span>
                                    )}
                                    {/* Saber que van cinco de seis no dice cuál es la
                                        sexta, que es con lo que se decide. Plegado por
                                        defecto: con cuatro cambios de veintiocho tareas,
                                        esta pantalla sería una lista de tareas. */}
                                    {pendingOf(change).length > 0 && (
                                      <button
                                        type="button"
                                        className={styles.startPendingToggle}
                                        aria-expanded={expandedStart[change.changeId] ?? false}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedStart((current) => ({
                                            ...current,
                                            [change.changeId]: !(current[change.changeId] ?? false),
                                          }));
                                        }}
                                        onKeyDown={(e) => {
                                          e.stopPropagation();
                                        }}
                                      >
                                        <ChevronDown size={12} />
                                        {tCount('pipeline.openspec.start.pending', pendingOf(change).length)}
                                      </button>
                                    )}
                                  </div>
                                  {(expandedStart[change.changeId] ?? false) && (
                                    /* Sólo lo pendiente: el avance ya está en la barra y
                                       en el conteo, y lo que falta es lo que sirve. */
                                    <ul className={styles.startPending}>
                                      {pendingOf(change).map((task) => (
                                        <li key={task.id}><Circle size={9} /> {task.text}</li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {activeStartView === 'archived' && (
                  <section className={styles.startScreen} aria-label={t('pipeline.openspec.start.archived')}>
                    <header className={styles.startHeader}>
                      <div className={styles.startHeaderTitleGroup}>
                        <h3>{t('pipeline.openspec.start.archived')}</h3>
                        <p className={styles.startSpecsBadge}>
                          {tCount('pipeline.openspec.start.archivedCount', archivedChanges.length)}
                        </p>
                      </div>
                    </header>

                    <div className={styles.startMainBlock}>
                      <div className={styles.startBlock}>
                        <h4>{t('pipeline.openspec.start.closed')} <span>{archivedChanges.length}</span></h4>
                        {archivedChanges.length === 0 ? (
                          <p className={styles.startNote}>{t('pipeline.openspec.start.neverArchived')}</p>
                        ) : (
                          <ul className={styles.startList}>
                            {archivedChanges.map((change) => (
                              <li
                                key={`${change.archivedAt}-${change.changeId}`}
                                tabIndex={0}
                                role="button"
                                aria-label={`${change.changeId} ${t('pipeline.openspec.start.enter')}`}
                                onClick={(e) => handleCardClick(e, change.changeId)}
                                onKeyDown={(e) => handleCardKeyDown(e, change.changeId)}
                              >
                                <div className={styles.startItemHead}>
                                  <div className={styles.startItemTitleWithIcon}>
                                    <CheckCircle2 size={13} className={styles.startArchivedIcon} />
                                    <strong>{change.changeId}</strong>
                                  </div>
                                </div>
                                <p>{change.archivedAt ?? t('pipeline.openspec.dateUnknown')}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {activeStartView === 'new-change' && (
                  <section className={styles.startScreen} aria-label={t('pipeline.newChange.title')}>
                    <header className={styles.startHeader}>
                      <div className={styles.startHeaderTitleGroup}>
                        <h3>{t('pipeline.newChange.title')}</h3>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() => {
                          dismissFlow();
                          handleSwitchStartView('in-progress');
                        }}
                      >
                        {t('pipeline.newChange.close')}
                      </button>
                    </header>

                    <div className={styles.startMainBlock}>
                      <div className={styles.startNewChangeModal}>
                        <PipelineNewChangeFlow
                          repoPath={repoPath}
                          projection={projection}
                          blockedByFixture={fixtureActive}
                          onStarted={() => setCenterTab('activity')}
                          currentBranch={currentBranch}
                          divergence={snapshot.branchDivergence}
                          workingTreeClean={workingTreeClean}
                          onRefresh={onRefresh}
                          onOpenChange={handleOpenChange}
                        />
                      </div>
                    </div>
                  </section>
                )}
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
