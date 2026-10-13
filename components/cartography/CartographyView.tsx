'use client';

// CartographyView — vista de workspace top-level (hermana del grafo) que ayuda
// a entender cualquier repo abierto: dónde están las cosas, qué se relaciona con
// qué y qué se rompe si tocás algo.
//
// Tokens: usa exclusivamente el bloque `--carto-*` de globals.css.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Map,
  ArrowLeft,
  RefreshCw,
  Network,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useCartoLayout } from '@/hooks/use-carto-layout';
import { useGitStore } from '@/lib/git-store';
import { useAssistContribution } from '@/lib/assist/use-assist-contribution';
import { cartoContribution, headShaOf } from '@/lib/assist/view-contributors';
import type { CartoGraphStatus, CartoNode } from '@/lib/carto-types';
import { CartoNodeDetail } from './CartoNodeDetail';
import { CartoAskBox } from './CartoAskBox';
import { SemanticGraphLens } from './SemanticGraphLens';
import { CartoPanoramaHeader } from './CartoPanoramaHeader';

type CartographyViewProps = {
  /** Ruta del repo activo. `null` si no hay repo abierto. */
  repoPath: string | null;
  /** Volver al grafo (apaga el sub-estado per-repo `inCartography`). */
  onExit: () => void;
};

type PersonaMode = 'simple' | 'technical';

const PERSONA_MODE_STORAGE_KEY = 'gitcron:cartographyPersonaMode';

export function CartographyView({ repoPath, onExit }: CartographyViewProps) {
  const t = useT();

  const [personaMode, setPersonaMode] = useState<PersonaMode>('simple');

  // ── Grounding estructural (CodeGraph, Fase 3) ──
  // Símbolo elegido dentro del archivo → su explicación IA + impacto. Al cambiar
  // de archivo se limpia (los símbolos son de otro archivo).
  const [selectedNode, setSelectedNode] = useState<CartoNode | null>(null);
  const selectedAtHeadRef = useRef<string | null>(null);

  const handleSelectNode = useCallback((node: CartoNode | null) => {
    setSelectedNode(node);
    if (node) {
      const gitState = useGitStore.getState();
      selectedAtHeadRef.current = headShaOf(gitState.commits, gitState.currentBranch);
    } else {
      selectedAtHeadRef.current = null;
    }
  }, []);

  // El viewId es el que calcula app/page.tsx para Cartografía: 'carto'.
  useAssistContribution('carto', () =>
    cartoContribution(selectedNode?.id ?? null, selectedAtHeadRef.current)
  );
  // Estado del índice del repo (idle/indexing/ready/error), gobernado por main.
  const [graphStatus, setGraphStatus] = useState<CartoGraphStatus | null>(null);
  // Se incrementa cuando el watch re-sincroniza: fuerza refetch de relaciones.
  const [graphRefresh, setGraphRefresh] = useState(0);

  // ── Capa de IA (Fase 4) ──
  // Si está activa (opt-in), montamos la columna de chat a la derecha. La vista
  // funciona igual sin IA: cuando está apagada, no hay columna ni divisor.
  const [aiEnabled, setAiEnabled] = useState(false);
  // Layout arrastrable: ancho de la columna de chat + alto del panel de relaciones.
  const { chatW, relationsH, isDragging, beginChatDrag, beginRelationsDrag } = useCartoLayout();

  const updatePersonaMode = (next: PersonaMode) => {
    setPersonaMode(next);
    localStorage.setItem(PERSONA_MODE_STORAGE_KEY, next);
  };

  const refreshLens = useCallback(async () => {
    if (repoPath) {
      await window.api.cartoGraph.ensure(repoPath);
      setGraphRefresh((n) => n + 1);
    }
  }, [repoPath]);

  useEffect(() => {
    const saved = localStorage.getItem(PERSONA_MODE_STORAGE_KEY);
    if (saved === 'technical' || saved === 'simple') setPersonaMode(saved);
  }, []);

  // Leemos si la IA de Cartografía está activa al montar la vista. Se relee al
  // volver a entrar (la vista se remonta), así un cambio en Ajustes se refleja.
  useEffect(() => {
    let active = true;
    void window.api.cartoAi.getSettings().then((res) => {
      if (active) setAiEnabled(res.success && res.data ? res.data.enabled : false);
    });
    return () => {
      active = false;
    };
  }, []);

  // Índice CodeGraph: al entrar/cambiar de repo, pedimos a main que lo abra e
  // indexe en background (no bloquea el renderer). Nos suscribimos al progreso y
  // al re-sync del watch para mantener fresco el estado y las relaciones.
  useEffect(() => {
    handleSelectNode(null);
    setGraphStatus(null);
    if (!repoPath) return;

    let active = true;
    void window.api.cartoGraph.ensure(repoPath).then((res) => {
      if (active && res.success && res.data) setGraphStatus(res.data);
    });

    const offProgress = window.api.cartoGraph.onProgress(({ repoPath: rp, status }) => {
      if (active && rp === repoPath) setGraphStatus(status);
    });
    const offUpdated = window.api.cartoGraph.onUpdated(({ repoPath: rp }) => {
      if (active && rp === repoPath) setGraphRefresh((n) => n + 1);
    });

    return () => {
      active = false;
      offProgress();
      offUpdated();
    };
  }, [repoPath]);

  return (
    <motion.div
      key="cartography"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex-1 flex flex-col min-h-0 overflow-hidden bg-carto-canvas text-carto-text select-none"
    >
      {/* ── Cabecera TCARS ── */}
      <div className="shrink-0 border-b border-carto-accent/25">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5 justify-self-start">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-carto-accent/15 text-carto-accent">
              <Map size={16} />
            </span>
            <h2 className="truncate text-[length:var(--font-size-lg)] font-bold tracking-wide text-carto-text">
              {t('cartography.title')}
            </h2>
            <span className="ml-1 rounded-full border border-carto-accent/35 px-2 py-0.5 text-[length:var(--font-size-2xs)] font-bold uppercase tracking-widest text-carto-accent">
              Beta
            </span>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="flex shrink-0 items-center gap-1.5 justify-self-end rounded border border-carto-grid px-3 py-1 text-xs font-semibold tracking-wide text-carto-text-muted transition-colors hover:border-carto-accent/50 hover:text-carto-text"
          >
            <ArrowLeft size={13} />
            {t('cartography.backToGraph')}
          </button>
        </div>
      </div>

      {/* ── Cuerpo: panel de la lente activa ── */}
      <div className={`relative flex min-h-0 flex-1 overflow-hidden ${isDragging ? 'select-none' : ''}`}>
        {/* Panel de la lente */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barra de la vista: título + métricas + refrescar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-carto-grid px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Network size={14} className="shrink-0 text-carto-accent" />
              <span className="truncate text-xs font-bold tracking-wide text-carto-text">
                {t('cartography.title')}
              </span>
              {graphStatus?.state === 'ready' && graphStatus.stats && (
                <span className="shrink-0 text-[length:var(--font-size-xs)] text-carto-text-muted">
                  {t('cartography.semantic.indexStats', {
                    nodes: graphStatus.stats.nodes,
                    edges: graphStatus.stats.edges,
                  })}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex overflow-hidden rounded border border-carto-grid">
                {(['simple', 'technical'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updatePersonaMode(mode)}
                    aria-pressed={personaMode === mode}
                    className={`px-2 py-1 text-[length:var(--font-size-xs)] font-semibold tracking-wide transition-colors ${
                      personaMode === mode
                        ? 'bg-carto-accent/15 text-carto-accent'
                        : 'text-carto-text-muted hover:bg-carto-node/5 hover:text-carto-text'
                    }`}
                  >
                    {t(mode === 'simple' ? 'cartography.mode.simple' : 'cartography.mode.technical')}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void refreshLens()}
                disabled={!repoPath}
                className="flex items-center gap-1.5 rounded border border-carto-grid px-2.5 py-1 text-[length:var(--font-size-2xs)] font-semibold tracking-wide text-carto-text-muted transition-colors hover:border-carto-accent/50 hover:text-carto-text disabled:opacity-40"
              >
                <RefreshCw size={12} />
                {t('cartography.refresh')}
              </button>
            </div>
          </div>

          {/* Contenido de la lente */}
          <div className="flex min-h-0 flex-1 flex-col">
            {!repoPath ? (
              <CenteredState
                icon={<Map size={22} strokeWidth={1.5} className="text-carto-node" />}
                title={t('cartography.empty')}
                detail={t('cartography.emptyHint')}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <CartoPanoramaHeader repoPath={repoPath} status={graphStatus} refreshKey={graphRefresh} />
                <div className="min-h-0 flex-1">
                  <SemanticGraphLens
                    repoPath={repoPath}
                    status={graphStatus}
                    refreshKey={graphRefresh}
                    selectedNodeId={selectedNode?.id ?? null}
                    onSelectNode={handleSelectNode}
                  />
                </div>
                {selectedNode && (
                  <>
                    <div
                      onMouseDown={beginRelationsDrag}
                      className="group relative h-1.5 shrink-0 cursor-row-resize bg-carto-accent/20 transition-colors hover:bg-carto-accent/50"
                      title={t('cartography.resizeRows')}
                    >
                      <span className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-carto-accent/40 group-hover:bg-carto-accent" />
                    </div>
                    <div
                      style={{ height: relationsH }}
                      className="min-h-0 shrink-0 bg-carto-node/[0.02]"
                    >
                      <CartoNodeDetail
                        repoPath={repoPath}
                        node={selectedNode}
                        aiEnabled={aiEnabled}
                        technicalOpenDefault
                        onBack={() => handleSelectNode(null)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Columna de chat de IA (Fase 4), opt-in ──
            Sólo se monta si la IA está activa. Divisor horizontal arrastrable
            entre el explorador y el chat. Con la IA apagada, la vista queda igual. */}
        {aiEnabled && (
          <>
            <div
              onMouseDown={beginChatDrag}
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-carto-accent/20 transition-colors hover:bg-carto-accent/50"
              title={t('cartography.resizeCols')}
            >
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-carto-accent/40 group-hover:bg-carto-accent" />
            </div>
            <div style={{ width: chatW }} className="min-w-0 shrink-0 border-l border-carto-accent/15">
              <CartoAskBox repoPath={repoPath} onSelectNode={handleSelectNode} />
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function CenteredState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-carto-accent/30 bg-carto-node/5">
        {icon}
      </span>
      <p className="text-base font-bold tracking-wide text-carto-text">{title}</p>
      {detail && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-carto-text-muted">{detail}</p>
      )}
    </div>
  );
}
