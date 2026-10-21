'use client';

// CartographyView — vista de workspace top-level (hermana del grafo) que ayuda
// a entender cualquier repo abierto: dónde están las cosas, qué se relaciona con
// qué y qué se rompe si tocás algo.
//
// Estética general de la app con módulos CSS y tokens de `@theme` (cambio
// mapear-pantallas-y-su-codigo, tanda 01). Columna de chat retirada en favor del
// panel de asistencia (Centauro). Cabecera única de 44px montada con ContentHeader.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Map,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useCartoLayout } from '@/hooks/use-carto-layout';
import { useGitStore } from '@/lib/git-store';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import { useAssistContribution } from '@/lib/assist/use-assist-contribution';
import { cartoContribution, headShaOf } from '@/lib/assist/view-contributors';
import { ContentHeader } from '@/components/ContentHeader';
import { cn } from '@/lib/utils';
import type { CartoGraphStatus, CartoNode } from '@/lib/carto-types';
import { CartoNodeDetail } from './CartoNodeDetail';
import { SemanticGraphLens } from './SemanticGraphLens';
import { CartoPanoramaHeader } from './CartoPanoramaHeader';
import { ScreenCatalog } from './ScreenCatalog';
import styles from './CartographyView.module.css';

type CartographyViewProps = {
  /** Ruta del repo activo. `null` si no hay repo abierto. */
  repoPath: string | null;
  /** Volver al grafo (apaga el sub-estado per-repo `inCartography`). */
  onExit: () => void;
};

type PersonaMode = 'simple' | 'technical';

const PERSONA_MODE_STORAGE_KEY = 'gitcron:cartographyPersonaMode';

import type { ScreenEntry } from '@/types/screen-map';

export function CartographyView({ repoPath, onExit }: CartographyViewProps) {
  const t = useT();

  // El modo guardado se lee al crear la vista (antes, en un efecto: setState sincrónico).
  const [personaMode, setPersonaMode] = useState<PersonaMode>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(PERSONA_MODE_STORAGE_KEY) : null;
      return saved === 'technical' || saved === 'simple' ? saved : 'simple';
    } catch (err) {
      console.warn('No se pudo leer el modo de Cartografía guardado', err);
      return 'simple';
    }
  });

  // ── Grounding estructural (CodeGraph, Fase 3) ──
  // Símbolo elegido dentro del archivo → su explicación IA + impacto. Al cambiar
  // de archivo se limpia (los símbolos son de otro archivo).
  const [selectedNode, setSelectedNode] = useState<CartoNode | null>(null);
  const [selectedScreen, setSelectedScreen] = useState<{ id: string; name: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string } | null>(null);
  const selectedAtHeadRef = useRef<string | null>(null);

  const handleSelectNode = useCallback((node: CartoNode | null) => {
    setSelectedNode(node);
    setSelectedFile(null);
    if (node) {
      const gitState = useGitStore.getState();
      selectedAtHeadRef.current = headShaOf(gitState.commits, gitState.currentBranch);
    } else {
      selectedAtHeadRef.current = null;
    }
  }, []);

  const handleSelectScreen = useCallback((screen: ScreenEntry | null) => {
    setSelectedFile(null);
    if (screen) {
      setSelectedScreen({ id: screen.id, name: screen.description?.suggestedName || screen.name });
      const gitState = useGitStore.getState();
      selectedAtHeadRef.current = headShaOf(gitState.commits, gitState.currentBranch);
    } else {
      setSelectedScreen(null);
    }
  }, []);

  const handleSelectFile = useCallback(
    (file: { path: string } | null) => {
      setSelectedFile(file);
      if (file) {
        const gitState = useGitStore.getState();
        selectedAtHeadRef.current = headShaOf(gitState.commits, gitState.currentBranch);
        useAssistDockStore.getState().setOpen(true);
        useAssistDockStore.getState().setActiveTab('chat');
        const baseName = file.path.split('/').pop() ?? file.path;
        useAssistDockStore.getState().setPendingPrompt(t('assist.ask.fileInScreen', { name: baseName }));
      }
    },
    [t],
  );

  // El viewId es el que calcula app/page.tsx para Cartografía: 'carto'.
  useAssistContribution('carto', () =>
    cartoContribution(
      selectedNode?.id ?? null,
      selectedAtHeadRef.current,
      selectedScreen,
      selectedFile,
    )
  );
  // Estado del índice del repo (idle/indexing/ready/error), gobernado por main.
  const [graphStatus, setGraphStatus] = useState<CartoGraphStatus | null>(null);
  // Se incrementa cuando el watch re-sincroniza: fuerza refetch de relaciones.
  const [graphRefresh, setGraphRefresh] = useState(0);

  // ── Capa de IA (Fase 4) ──
  // Se mantiene aiEnabled para CartoNodeDetail (explicación de nodo si está activo en Ajustes).
  const [aiEnabled, setAiEnabled] = useState(false);
  // Layout arrastrable: alto del panel de relaciones.
  const { relationsH, isDragging, beginRelationsDrag } = useCartoLayout();

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
  // La selección y el estado del índice arrancan limpios porque la vista se arma de nuevo para
  // cada repo (`key={repoPath}` en RepoMainView); antes se limpiaban acá, con setState sincrónico.
  useEffect(() => {
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
  }, [repoPath, handleSelectNode]);

  return (
    <motion.div
      key="cartography"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={styles.viewRoot}
    >
      {/* ── Cabecera única unificada (44 px / h-11) ── */}
      <ContentHeader className={cn('h-11', styles.header)}>
        {/* Izquierda: Ícono Map + Título + Beta badge + Métricas de índice */}
        <div className={styles.leftGroup}>
          <div className={styles.titleWrapper}>
            <Map size={16} className={styles.titleIcon} />
            <span className={styles.titleText}>
              {t('cartography.title')}
            </span>
            <span className={styles.betaBadge}>
              Beta
            </span>
          </div>
          {graphStatus?.state === 'ready' && graphStatus.stats && (
            <span className={styles.statsText}>
              {t('cartography.semantic.indexStats', {
                nodes: graphStatus.stats.nodes,
                edges: graphStatus.stats.edges,
              })}
            </span>
          )}
        </div>

        {/* Derecha: Selector segmentado Simple/Técnico + Refrescar + Volver al grafo */}
        <div className={styles.rightGroup}>
          <div className={styles.segmentedControl}>
            {(['simple', 'technical'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => updatePersonaMode(mode)}
                aria-pressed={personaMode === mode}
                className={cn(
                  styles.segmentedBtn,
                  personaMode === mode && styles.segmentedBtnActive,
                )}
              >
                {t(mode === 'simple' ? 'cartography.mode.simple' : 'cartography.mode.technical')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void refreshLens()}
            disabled={!repoPath}
            title={t('cartography.refresh')}
            className={styles.actionBtn}
          >
            <RefreshCw size={12} />
            <span>{t('cartography.refresh')}</span>
          </button>

          <button
            type="button"
            onClick={onExit}
            title={t('cartography.backToGraph')}
            className={styles.actionBtn}
          >
            <ArrowLeft size={13} />
            <span>{t('cartography.backToGraph')}</span>
          </button>
        </div>
      </ContentHeader>

      {/* ── Cuerpo: panel de la lente activa ── */}
      <div className={cn(styles.bodyArea, isDragging && styles.dragging)}>
        <div className={styles.lensColumn}>
          <div className={styles.lensContent}>
            {!repoPath ? (
              <CenteredState
                icon={<Map size={24} strokeWidth={1.5} />}
                title={t('cartography.empty')}
                detail={t('cartography.emptyHint')}
              />
            ) : personaMode === 'simple' ? (
              <ScreenCatalog
                repoPath={repoPath}
                refreshKey={graphRefresh}
                onSelectScreen={handleSelectScreen}
                onSelectFile={handleSelectFile}
              />
            ) : (
              <div className={styles.lensContent}>
                <CartoPanoramaHeader repoPath={repoPath} status={graphStatus} refreshKey={graphRefresh} />
                <div className={styles.graphArea}>
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
                      className={styles.resizeDivider}
                      title={t('cartography.resizeRows')}
                    >
                      <span className={styles.resizeHandle} />
                    </div>
                    <div
                      style={{ height: relationsH }}
                      className={styles.relationsPanel}
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
    <div className={styles.emptyState}>
      <span className={styles.emptyIconWrapper}>
        {icon}
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {detail && (
        <p className={styles.emptyDetail}>{detail}</p>
      )}
    </div>
  );
}
