'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import {
  useNewChangeDraft,
  useNewChangeDraftStore,
  type NewChangeDraftStep,
} from '@/lib/new-change-draft-store';
import type { BranchDivergence, RuntimeProjection } from '@/types/pipeline';
import { ActivityFeed } from './ActivityFeed';
import { BranchBaseNotice } from './ChangeBranchNotice';
import { PipelineRuntimeLauncher } from './PipelineRuntimeLauncher';
import { validateExploreForm, validateProposeForm } from './pipeline-guided-forms';
import { Stack, Text } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';

export type PipelineNewChangeMode = 'propose' | 'explore';
export type PipelineNewChangeStep = NewChangeDraftStep;

export type PipelineNewChangeFlowProps = {
  repoPath: string;
  projection: RuntimeProjection | null;
  blockedByFixture?: boolean;
  onStarted?: () => void;
  /** Rama actual: es la base de la que sale la del cambio si no se elige otra. */
  currentBranch?: string | null;
  /** Cuánto se aparta esa base del `main` local. */
  divergence?: BranchDivergence;
  /**
   * Si el árbol de trabajo está limpio.
   *
   * `undefined` es no saber, y con eso no se afirma que esté sucio: la rama se
   * crea igual, como hasta ahora.
   */
  workingTreeClean?: boolean;
  /** Relee la evidencia del repositorio. */
  onRefresh?: () => void;
  /** Abre el cambio recién creado y descarta el borrador. */
  onOpenChange?: (changeId: string) => void;
};

const JOURNEY_STEPS: { id: NewChangeDraftStep; labelKey: string }[] = [
  { id: 'explore', labelKey: 'pipeline.journey.step.explore' },
  { id: 'propose', labelKey: 'pipeline.journey.step.propose' },
  { id: 'apply', labelKey: 'pipeline.journey.step.apply' },
  { id: 'archive', labelKey: 'pipeline.journey.step.archive' },
];

export function formatOpenSpecError(error: string): string {
  try {
    const parsed = JSON.parse(error) as {
      status?: Array<{ message?: string }>;
      message?: string;
    };
    if (parsed && Array.isArray(parsed.status) && parsed.status.length > 0) {
      const messages = parsed.status
        .map((s) => s?.message)
        .filter((m): m is string => typeof m === 'string' && m.length > 0);
      if (messages.length > 0) return messages.join(' · ');
    }
    if (parsed && typeof parsed.message === 'string' && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // Not JSON
  }
  return error;
}

/**
 * Recorrido guiado para abrir un cambio nuevo.
 *
 * Reemplaza el selector de modo por un recorrido de cuatro pasos (explorar,
 * proponer, aplicar, archivar). Cada paso dice dónde está la persona, qué
 * contestó el motor y qué sigue.
 *
 * No arranca nada por sí solo. Cuando el formulario es válido entrega la
 * instrucción al lanzador existente, que sigue siendo el único que abre procesos.
 */
function deriveReasoningAvailable(
  session: { reasoningVisibility?: string | null } | null,
): boolean | null {
  if (!session) return null;
  if (session.reasoningVisibility === 'emitted' || session.reasoningVisibility === 'summary') {
    return true;
  }
  if (session.reasoningVisibility === 'unavailable') {
    return false;
  }
  return null;
}

export function PipelineNewChangeFlow({
  repoPath,
  projection,
  blockedByFixture = false,
  onStarted,
  currentBranch,
  divergence,
  workingTreeClean,
  onRefresh,
  onOpenChange,
}: PipelineNewChangeFlowProps) {
  const t = useT();
  const fieldId = useId();
  /**
   * Lo que se está escribiendo vive en el store y no acá.
   *
   * Las solapas de la aplicación se desmontan al cambiar: ir al grafo y volver
   * se llevaba el formulario entero. Lo transitorio —errores, la instrucción ya
   * compuesta— sí se queda en el componente: se recalcula de los campos, y
   * guardarlo sería un segundo lugar donde vive el mismo dato.
   */
  const draft = useNewChangeDraft(repoPath);
  const patchDraft = useNewChangeDraftStore((state) => state.patchDraft);
  const { step, objective, slug, constraints, description } = draft;

  const setStep = (next: NewChangeDraftStep) => {
    patchDraft(repoPath, { step: next });
    setErrors({});
    setBranchError(null);
    setDirtyBlocked(false);
    setInstruction(null);
  };

  const setObjective = (next: string) => patchDraft(repoPath, { objective: next });
  const setSlug = (next: string) => patchDraft(repoPath, { slug: next });
  const setConstraints = (next: string) => patchDraft(repoPath, { constraints: next });
  const setDescription = (next: string) => patchDraft(repoPath, { description: next });
  const [errors, setErrors] = useState<{ objective?: string; slug?: string; description?: string }>({});
  const [instruction, setInstruction] = useState<string | null>(null);

  /**
   * Trabajar el cambio en su propia rama. Marcado por defecto: desmarcado
   * dejaría la función invisible y el trabajo seguiría en `main` por inercia.
   * No es silencioso —se declara en el formulario— y desmarcarlo no toca Git.
   */
  const withBranch = draft.withBranch;
  const setWithBranch = (next: boolean) => patchDraft(repoPath, { withBranch: next });
  /** Motivo real informado por Git. No se normaliza a un mensaje propio. */
  const [branchError, setBranchError] = useState<string | null>(null);
  /**
   * Crear la rama a partir de `main` en vez de donde se está parado.
   *
   * Desmarcado por omisión: una rama con commits propios sin fusionar puede ser
   * exactamente donde se quiere estar, y elegir la base por la persona perdería
   * ese trabajo de vista.
   */
  const fromMain = draft.fromMain;
  const setFromMain = (next: boolean) => patchDraft(repoPath, { fromMain: next });
  /** Se pidió crear la rama con trabajo sin confirmar. Se declara, no se hace. */
  const [dirtyBlocked, setDirtyBlocked] = useState(false);

  const [historyList, setHistoryList] = useState<RuntimeProjection[]>([]);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineRuntime?.history || !repoPath) return;
    let cancelled = false;
    void api.pipelineRuntime.history(repoPath).then((result) => {
      if (!cancelled && result?.success && Array.isArray(result.data)) {
        setHistoryList(result.data);
      }
    });
    return () => { cancelled = true; };
  }, [repoPath, projection?.active, draft.sessions.explore, draft.sessions.propose]);

  // Derivar proyecciones en render (sin setState en useEffect)
  const exploreSessionId = draft.sessions.explore;
  const exploreProj = exploreSessionId
    ? (projection && projection.sessionId === exploreSessionId
        ? projection
        : historyList.find((entry) => entry.sessionId === exploreSessionId) ?? null)
    : null;
  const isExploreDone = exploreProj?.outcome === 'completed';
  const exploreState: 'current' | 'done' | 'pending' | 'declared' =
    isExploreDone
      ? 'done'
      : step === 'explore'
        ? 'current'
        : 'pending';

  const proposeSessionId = draft.sessions.propose;
  const proposeProj = proposeSessionId
    ? (projection && projection.sessionId === proposeSessionId
        ? projection
        : historyList.find((entry) => entry.sessionId === proposeSessionId) ?? null)
    : null;

  const [artifactState, setArtifactState] = useState<{
    changeId: string | null;
    loaded: boolean;
    error: string | null;
  }>({ changeId: null, loaded: false, error: null });

  const isProposeFailed =
    proposeProj?.outcome === 'failed' || proposeProj?.outcome === 'interrupted';

  const proposeArtifactsLoaded =
    !isProposeFailed &&
    artifactState.changeId === draft.proposedChangeId &&
    artifactState.loaded;

  const proposeGraphError =
    isProposeFailed
      ? null
      : artifactState.changeId === draft.proposedChangeId
        ? artifactState.error
        : null;

  useEffect(() => {
    const changeId = draft.proposedChangeId;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!changeId || !api?.pipelineOpenSpec?.getArtifactGraph) return;
    if (proposeProj?.active) return;
    if (proposeProj?.outcome === 'failed' || proposeProj?.outcome === 'interrupted') return;

    let cancelled = false;
    void api.pipelineOpenSpec.getArtifactGraph({ repoPath, changeId }).then((result) => {
      if (cancelled) return;
      if (result?.ok && Array.isArray(result.artifacts) && result.artifacts.length > 0) {
        setArtifactState({ changeId, loaded: true, error: null });
      } else if (result && !result.ok) {
        setArtifactState({ changeId, loaded: false, error: result.error ?? 'error' });
      }
    });
    return () => { cancelled = true; };
  }, [repoPath, draft.proposedChangeId, proposeProj?.active, proposeProj?.outcome]);

  const proposeState: 'current' | 'done' | 'pending' | 'declared' =
    proposeArtifactsLoaded
      ? 'done'
      : step === 'propose'
        ? 'current'
        : 'pending';

  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const exploreAnswerRef = useRef<HTMLDivElement | null>(null);
  const explorePinnedRef = useRef(true);
  const proposeAnswerRef = useRef<HTMLDivElement | null>(null);
  const proposePinnedRef = useRef(true);

  const handleExploreScroll = () => {
    const el = exploreAnswerRef.current;
    if (!el) return;
    explorePinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  const handleProposeScroll = () => {
    const el = proposeAnswerRef.current;
    if (!el) return;
    proposePinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  const isExploreRunning = exploreProj?.active || (exploreProj && exploreProj.outcome === null);
  const exploreActivityLen = exploreProj?.activity?.length ?? 0;

  useEffect(() => {
    const el = exploreAnswerRef.current;
    if (!el) return;
    if (isExploreRunning && explorePinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [isExploreRunning, exploreActivityLen]);

  const isProposeRunning = proposeProj?.active || (proposeProj && proposeProj.outcome === null);
  const proposeActivityLen = proposeProj?.activity?.length ?? 0;

  useEffect(() => {
    const el = proposeAnswerRef.current;
    if (!el) return;
    if (isProposeRunning && proposePinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [isProposeRunning, proposeActivityLen]);

  const isProposeSuccess =
    proposeArtifactsLoaded &&
    Boolean(draft.proposedChangeId) &&
    (!proposeProj?.active && proposeProj?.outcome !== 'failed' && proposeProj?.outcome !== 'interrupted');

  /**
   * Valida y, si corresponde, deja el repositorio parado en la rama del cambio
   * antes de entregar la instrucción al lanzador.
   *
   * Al proponer un nuevo change, la carpeta aún no existe en el sistema de archivos:
   * `openspec instructions proposal --change <slug>` exige obligatoriamente `--change`
   * y falla con "Change 'x' not found" si el directorio no existe.
   * La instrucción de propuesta se compone con el objetivo y alcance declarados por la persona,
   * delegando la creación del scaffold y los artefactos al ejecutor sin consultar al motor
   * sobre un change inexistente.
   */
  const submitPropose = async () => {
    const result = validateProposeForm({ objective, slug, constraints });
    setErrors(result.errors);
    setBranchError(null);
    if (result.focus === 'objective') objectiveRef.current?.focus();
    else if (result.focus === 'slug') slugRef.current?.focus();
    if (!result.instruction) {
      setInstruction(null);
      return;
    }

    if (withBranch) {
      // Con trabajo sin confirmar la rama no se crea: `git checkout -b` lo
      // arrastra, y la rama se crea al **abrir** un cambio, que es justo cuando
      // lo que hay sin confirmar es de otro. Pasó al proponer este mismo cambio.
      if (workingTreeClean === false) {
        setBranchError(null);
        setDirtyBlocked(true);
        setInstruction(null);
        return;
      }
      setDirtyBlocked(false);
      // Sin elección explícita se invoca sin punto de partida: la rama sale de
      // donde se está parado, que es lo que hace Git. La alternativa se ofrece,
      // no se aplica sola.
      const branchName = `change/${slug.trim()}`;
      const created = fromMain
        ? await window.api?.gitCreateBranch(repoPath, branchName, 'main')
        : await window.api?.gitCreateBranch(repoPath, branchName);
      if (!created?.success) {
        // La rama de **este mismo cambio** ya existe: es trabajo propio que se
        // retoma, así que el repositorio se para en ella en vez de cortar el
        // flujo. `branchName` lo construye esta función a partir del slug, de
        // modo que un «already exists» sólo puede ser de esta rama y nunca de
        // otro trabajo: cambiarse no arrastra commits ajenos. Cualquier otro
        // fallo sigue cortando, con el motivo real y sin normalizar, porque uno
        // genérico obliga a ir a la terminal a averiguar qué pasó.
        //
        // Con `fromMain` marcado la rama no se recrea desde main: ya existe y
        // rehacerla descartaría lo que tenga. Se retoma donde quedó.
        const yaExistia = /already exists/i.test(created?.error ?? '');
        const parado = yaExistia ? await window.api?.gitCheckout(repoPath, branchName) : null;
        if (!parado?.success) {
          setBranchError(created?.error || 'unknown');
          setInstruction(null);
          return;
        }
      }
      // La rama recién creada es dónde está parado el repositorio ahora, y el
      // panel lo declara en la franja de evidencia. Sin releer seguía mostrando
      // la anterior: el formulario cambiaba el hecho que el panel afirma, y lo
      // dejaba afirmando el viejo.
      onRefresh?.();
    }

    setInstruction(result.instruction);
  };

  /**
   * Explorar es una actividad previa que no posee un change ni artefactos asociados.
   * Por contrato del CLI, `openspec instructions` exige `--change <id>`; al no existir
   * un change para explorar, la instrucción se compone directamente a partir de la
   * descripción de la idea planteada por la persona.
   */
  const submitExplore = () => {
    const result = validateExploreForm({ description });
    setErrors(result.errors);
    setBranchError(null);
    if (result.focus === 'description') {
      descriptionRef.current?.focus();
      setInstruction(null);
      return;
    }

    setInstruction(result.instruction);
  };

  return (
    <section className={styles.newChangeFlow} aria-label={t('pipeline.newChange.title')}>
      {/* Riel de pasos del recorrido de apertura */}
      <ol className={styles.timelineList}>
        {JOURNEY_STEPS.map((s, index) => {
          const isCurrent = step === s.id;
          const isLast = index === JOURNEY_STEPS.length - 1;
          const stepState: 'current' | 'done' | 'pending' | 'declared' =
            s.id === 'explore'
              ? exploreState
              : s.id === 'propose'
                ? proposeState
                : 'declared';

          return (
            <li
              key={s.id}
              className={styles.timelineNode}
              data-state={stepState}
              data-selected={isCurrent ? 'true' : undefined}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <button
                type="button"
                className={styles.timelineNodeBtn}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => setStep(s.id)}
              >
                <div className={styles.timelineCircle} aria-hidden="true">
                  {stepState === 'done' ? <Check size={13} /> : index + 1}
                </div>
                <span className={styles.timelineTitle}>{t(s.labelKey)}</span>
              </button>
              {!isLast && <div className={styles.timelineConnector} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {step === 'explore' && (
        <div className={styles.flowFields}>
          <p className={styles.journeyNotice}>{t('pipeline.journey.explore.notExposed')}</p>

          <button
            type="button"
            className={styles.secondaryAction}
            onClick={() => setStep('propose')}
          >
            {t('pipeline.journey.explore.skip')}
          </button>

          <label className={styles.flowField} htmlFor={`${fieldId}-description`}>
            <span>{t('pipeline.newChange.explore.description')}</span>
            <textarea
              id={`${fieldId}-description`}
              ref={descriptionRef}
              rows={3}
              value={description}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? `${fieldId}-description-error` : `${fieldId}-description-help`}
              onChange={(event) => setDescription(event.target.value)}
            />
            {errors.description ? (
              <em id={`${fieldId}-description-error`} className={styles.flowError} role="alert">
                {t(errors.description)}
              </em>
            ) : (
              <Text variant="mono-xs" as="em" id={`${fieldId}-description-help`}>
                {t('pipeline.newChange.explore.descriptionHelp')}
              </Text>
            )}
          </label>

          <button type="button" className={styles.primaryAction} onClick={submitExplore}>
            {t('pipeline.newChange.explore.review')}
          </button>

          {instruction && (
            <div className={styles.launcherPanel}>
              <PipelineRuntimeLauncher
                key={`explore:${instruction}`}
                repoPath={repoPath}
                projection={projection}
                intent="explore"
                initialInstruction={instruction}
                changeId={null}
                taskId={null}
                blockedByFixture={blockedByFixture}
                startLabelKey="pipeline.newChange.explore.start"
                onStarted={(sessionId) => {
                  patchDraft(repoPath, {
                    sessions: {
                      ...draft.sessions,
                      explore: sessionId,
                    },
                  });
                  onStarted?.();
                }}
              />
            </div>
          )}

          {draft.sessions.explore && (
            <div
              ref={exploreAnswerRef}
              className={styles.journeyAnswer}
              onScroll={handleExploreScroll}
            >
              {exploreProj ? (
                exploreProj.activity && exploreProj.activity.length > 0 ? (
                  <ActivityFeed
                    entries={exploreProj.activity}
                    reasoningAvailable={deriveReasoningAvailable(exploreProj)}
                    runtimeAttached={exploreProj.active}
                  />
                ) : (
                  <Text variant="mono-xs" as="p">{t('pipeline.journey.noAnswer')}</Text>
                )
              ) : (
                <Text variant="mono-xs" as="p">{t('pipeline.journey.noAnswer')}</Text>
              )}
            </div>
          )}

          {exploreProj && (exploreProj.outcome === 'failed' || exploreProj.outcome === 'interrupted') && (
            <p className={styles.flowError} role="alert">
              {t(`pipeline.journey.outcome.${exploreProj.outcome}`)}
            </p>
          )}

          {isExploreDone && (
            <Stack gap="2" className={styles.journeyNext}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={() => setStep('propose')}
              >
                {t('pipeline.journey.explore.next')}
              </button>
            </Stack>
          )}
        </div>
      )}

      {step === 'propose' && (
        <div className={styles.flowFields}>
          <p className={styles.flowNature}>{t('pipeline.newChange.propose.nature')}</p>

          <label className={styles.flowField} htmlFor={`${fieldId}-objective`}>
            <span>{t('pipeline.newChange.propose.objective')}</span>
            <textarea
              id={`${fieldId}-objective`}
              ref={objectiveRef}
              rows={3}
              value={objective}
              aria-invalid={errors.objective ? true : undefined}
              aria-describedby={errors.objective ? `${fieldId}-objective-error` : undefined}
              onChange={(event) => setObjective(event.target.value)}
            />
            {errors.objective ? (
              <em id={`${fieldId}-objective-error`} className={styles.flowError} role="alert">
                {t(errors.objective)}
              </em>
            ) : (
              <Text variant="mono-xs" as="em">{t('pipeline.newChange.propose.objectiveHelp')}</Text>
            )}
          </label>

          <label className={styles.flowField} htmlFor={`${fieldId}-slug`}>
            <span>{t('pipeline.newChange.propose.slug')}</span>
            <input
              id={`${fieldId}-slug`}
              ref={slugRef}
              type="text"
              value={slug}
              spellCheck={false}
              aria-invalid={errors.slug ? true : undefined}
              aria-describedby={errors.slug ? `${fieldId}-slug-error` : `${fieldId}-slug-help`}
              onChange={(event) => setSlug(event.target.value)}
            />
            {errors.slug ? (
              <em id={`${fieldId}-slug-error`} className={styles.flowError} role="alert">
                {t(errors.slug)}
              </em>
            ) : (
              <Text variant="mono-xs" as="em" id={`${fieldId}-slug-help`}>
                {t('pipeline.newChange.propose.slugHelp')}
                {' '}
                {t('pipeline.newChange.propose.slugTarget')}
              </Text>
            )}
          </label>

          <label className={styles.flowField} htmlFor={`${fieldId}-constraints`}>
            <span>{t('pipeline.newChange.propose.constraints')}</span>
            <textarea
              id={`${fieldId}-constraints`}
              rows={2}
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
            />
            <Text variant="mono-xs" as="em">{t('pipeline.newChange.propose.constraintsHelp')}</Text>
          </label>

          <label className={styles.flowCheck}>
            <input
              type="checkbox"
              checked={withBranch}
              onChange={(event) => setWithBranch(event.target.checked)}
            />
            <span>
              <strong>{t('pipeline.newChange.propose.branch', { branch: `change/${slug.trim() || '<slug>'}` })}</strong>
              <em>{t('pipeline.newChange.propose.branchHelp')}</em>
            </span>
          </label>

          {withBranch && (
            <>
              <BranchBaseNotice divergence={divergence} branch={currentBranch} />
              {divergence?.measured && (divergence.behind > 0 || divergence.ahead > 0) && (
                <label className={styles.flowCheck}>
                  <input
                    type="checkbox"
                    checked={fromMain}
                    onChange={(event) => setFromMain(event.target.checked)}
                  />
                  <span>
                    <strong>{t('pipeline.newChange.propose.fromBase', { base: divergence.base })}</strong>
                    <em>{t('pipeline.newChange.propose.fromBaseHelp')}</em>
                  </span>
                </label>
              )}
            </>
          )}

          {dirtyBlocked && (
            <p className={styles.flowError} role="alert">
              {t('pipeline.newChange.propose.branchDirty')}
            </p>
          )}
          {branchError && (
            <p className={styles.flowError} role="alert">
              {t('pipeline.newChange.propose.branchFailed')} {branchError}
            </p>
          )}

          <button type="button" className={styles.primaryAction} onClick={() => void submitPropose()}>
            {withBranch
              ? t('pipeline.newChange.propose.createBranchAndReview')
              : t('pipeline.newChange.propose.review')}
          </button>

          {instruction && (
            <div className={styles.launcherPanel}>
              <PipelineRuntimeLauncher
                key={`propose:${instruction}`}
                repoPath={repoPath}
                projection={projection}
                intent="write-artifact"
                initialInstruction={instruction}
                changeId={null}
                taskId={null}
                blockedByFixture={blockedByFixture}
                startLabelKey="pipeline.newChange.propose.start"
                onStarted={(sessionId) => {
                  patchDraft(repoPath, {
                    sessions: {
                      ...draft.sessions,
                      propose: sessionId,
                    },
                    proposedChangeId: slug.trim(),
                  });
                  onStarted?.();
                }}
              />
            </div>
          )}

          {draft.sessions.propose && (
            <div
              ref={proposeAnswerRef}
              className={styles.journeyAnswer}
              onScroll={handleProposeScroll}
            >
              {proposeProj ? (
                proposeProj.activity && proposeProj.activity.length > 0 ? (
                  <ActivityFeed
                    entries={proposeProj.activity}
                    reasoningAvailable={deriveReasoningAvailable(proposeProj)}
                    runtimeAttached={proposeProj.active}
                  />
                ) : (
                  <Text variant="mono-xs" as="p">{t('pipeline.journey.noAnswer')}</Text>
                )
              ) : (
                <Text variant="mono-xs" as="p">{t('pipeline.journey.noAnswer')}</Text>
              )}
            </div>
          )}

          {proposeProj && (proposeProj.outcome === 'failed' || proposeProj.outcome === 'interrupted') && (
            <p className={styles.flowError} role="alert">
              {t(`pipeline.journey.outcome.${proposeProj.outcome}`)}
            </p>
          )}

          {proposeGraphError && (
            <p className={styles.flowError} role="alert">
              {formatOpenSpecError(proposeGraphError)}
            </p>
          )}

          {isProposeSuccess ? (
            <Stack gap="2" className={styles.journeyNext}>
              <p className={styles.journeyNotice}>
                {t('pipeline.journey.changeCreated', { change: draft.proposedChangeId! })}
              </p>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={() => onOpenChange?.(draft.proposedChangeId!)}
              >
                {t('pipeline.journey.viewChange')}
              </button>
            </Stack>
          ) : (
            <Stack gap="2" className={styles.journeyNext}>
              <p className={styles.journeyNotice}>
                {t('pipeline.journey.continuesInChange')}
              </p>
            </Stack>
          )}
        </div>
      )}

      {(step === 'apply' || step === 'archive') && (
        <div className={styles.flowFields}>
          <p className={styles.journeyNotice}>
            {t('pipeline.journey.continuesInChange')}
          </p>
        </div>
      )}
    </section>
  );
}
