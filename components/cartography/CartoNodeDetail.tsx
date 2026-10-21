'use client';

// CartoNodeDetail — Cartografía, Fase 5. PANEL DE DETALLE de un nodo (símbolo).
//
// Primera superficie "estrella": elegís un símbolo y la IA lo explica en lenguaje
// humano, bajado a tierra, para alguien no experto. La explicación se construye SOLO
// con contexto real y recortado (código del nodo + callers/callees/impacto del
// grafo), armado en main — este componente nunca ve el repo entero.
//
// Funciona con la IA apagada: en ese caso muestra al menos la estructura (ruta,
// relaciones, impacto). La explicación se cachea por contenido en main, así que
// re-abrir un nodo que no cambió no vuelve a gastar el modelo. Tokens --carto-*.

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertTriangle,
  Zap,
  ArrowRight,
  ArrowLeftRight,
  DatabaseZap,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import type { CartoNode } from '@/lib/carto-types';
import type { CartoExplainNodeResult } from '@/types/carto-ai';
import { cn } from '@/lib/utils';
import { AiUseLine } from '../ai/AiUseLine';
import { AiSentDetails } from '../ai/AiSentDetails';
import styles from './CartoNodeDetail.module.css';

type CartoNodeDetailProps = {
  repoPath: string;
  /** Nodo seleccionado (para la cabecera inmediata, antes de que llegue el detalle). */
  node: CartoNode;
  /** Si la IA está activa (opt-in). Con ella apagada, sólo se muestra estructura. */
  aiEnabled: boolean;
  /** Volver a la lista de relaciones/símbolos del archivo. */
  onBack: () => void;
  /** En Panorama simple, las relaciones técnicas arrancan colapsadas. */
  technicalOpenDefault?: boolean;
};

type NodeExplainState = {
  key: string;
  result: CartoExplainNodeResult | null;
  error: string | null;
  loading: boolean;
};

export function CartoNodeDetail({
  repoPath,
  node,
  aiEnabled,
  onBack,
  technicalOpenDefault = true,
}: CartoNodeDetailProps) {
  const t = useT();
  const lang = useGitStore((s) => s.language);
  const reqKey = `${repoPath}:${node.id}:${lang}`;

  const [state, setState] = useState<NodeExplainState>({
    key: '',
    result: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    void window.api.cartoAi
      .explainNode(repoPath, node.id, lang)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) {
          setState({ key: reqKey, result: res.data, error: null, loading: false });
        } else {
          setState({ key: reqKey, result: null, error: res.error ?? t('cartography.detail.error'), loading: false });
        }
      })
      .catch((err) => {
        if (!active) return;
        setState({
          key: reqKey,
          result: null,
          error: err instanceof Error ? err.message : t('cartography.detail.error'),
          loading: false,
        });
      });

    return () => {
      active = false;
    };
  }, [reqKey, repoPath, node.id, lang, t]);

  const result = state.key === reqKey ? state.result : null;
  const loading = state.key === reqKey ? state.loading : true;
  const error = state.key === reqKey ? state.error : null;

  const loc =
    node.startLine != null
      ? `${node.filePath}:${node.startLine}${node.endLine != null ? `-${node.endLine}` : ''}`
      : node.filePath;

  const ctx = result?.context;

  return (
    <div className={styles.container}>
      {/* Cabecera: volver + identidad del nodo */}
      <div className={styles.header}>
        <button
          type="button"
          onClick={onBack}
          title={t('cartography.detail.back')}
          className={styles.backButton}
        >
          <ArrowLeft size={12} />
        </button>
        <Sparkles size={13} className={styles.titleIcon} />
        <span className={styles.nodeName} title={node.name}>
          {node.name}
        </span>
        <span className={styles.kindBadge}>
          {node.kind}
        </span>
      </div>

      <div className={styles.content}>
        {/* Ruta */}
        <p className={styles.locationText} title={loc}>
          {loc}
        </p>

        {/* Línea del modelo y detalles de lo enviado en Cartografía (D11, D14) */}
        {aiEnabled && (
          <div className={styles.aiRow}>
            <AiUseLine use="gitcron-cartography" repoPath={repoPath} />
            <AiSentDetails use="gitcron-cartography" busy={loading} />
          </div>
        )}

        {/* Explicación de la IA (o estado) */}
        <ExplanationBlock
          aiEnabled={aiEnabled}
          loading={loading}
          error={error}
          result={result}
        />

        {/* Estructura: impacto + relaciones (siempre que haya contexto) */}
        {ctx && (
          <details
            className={styles.technicalDetails}
            open={technicalOpenDefault}
          >
            <summary className={styles.technicalSummary}>
              {t('cartography.detail.technicalDetails')}
            </summary>
            <div className={styles.technicalContent}>
              <ImpactSection
                summary={t('cartography.graph.impactSummary', {
                  files: ctx.impact.impactedFiles.length,
                  symbols: ctx.impact.total,
                })}
                files={ctx.impact.impactedFiles}
              />
              <RelatedSection
                icon={<ArrowLeftRight size={13} />}
                title={t('cartography.detail.calledBy')}
                items={ctx.callers}
              />
              <RelatedSection
                icon={<ArrowRight size={13} />}
                title={t('cartography.detail.calls')}
                items={ctx.callees}
              />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function ExplanationBlock({
  aiEnabled,
  loading,
  error,
  result,
}: {
  aiEnabled: boolean;
  loading: boolean;
  error: string | null;
  result: CartoExplainNodeResult | null;
}) {
  const t = useT();

  if (error) {
    return <Banner tone="error" icon={<AlertTriangle size={14} />} text={error} />;
  }
  if (loading) {
    return (
      <div className={styles.loadingRow}>
        <Loader2 size={14} className={styles.spinnerAi} />
        {aiEnabled ? (
          <span>
            <span className="ai-thinking-text">{t('cartography.detail.explaining')}</span>
          </span>
        ) : (
          t('cartography.detail.loading')
        )}
      </div>
    );
  }

  const explanation = result?.explanation;
  const aiError = result?.aiError;

  // IA apagada: mostramos sólo estructura, con un aviso claro.
  if (!aiEnabled) {
    return <Banner tone="muted" icon={<Sparkles size={14} />} text={t('cartography.detail.aiOff')} />;
  }
  // IA activa pero falló (servidor caído, sin key…): estructura + aviso.
  if (aiError) {
    return <Banner tone="error" icon={<AlertTriangle size={14} />} text={aiError} />;
  }
  if (explanation) {
    return (
      <div className={cn('ai-surface ai-panel', styles.explanationPanel)}>
        <p className={styles.explanationText}>
          {explanation.text}
        </p>
        <div className={styles.explanationMeta}>
          <span className={styles.providerName}>{explanation.provider}</span>
          {result?.cached && (
            <span className={styles.cachedBadge}>
              <DatabaseZap size={10} />
              {t('cartography.detail.cached')}
            </span>
          )}
        </div>
      </div>
    );
  }
  return null;
}

function Banner({
  tone,
  icon,
  text,
}: {
  tone: 'error' | 'muted';
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className={cn(styles.banner, tone === 'error' && styles.bannerError)}>
      <span className={styles.bannerIcon}>{icon}</span>
      <span className={styles.bannerText}>{text}</span>
    </div>
  );
}

const LIST_CAP = 20;

function ImpactSection({ summary, files }: { summary: string; files: string[] }) {
  const t = useT();
  const shown = files.slice(0, LIST_CAP);
  return (
    <div>
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon}><Zap size={13} /></span>
        <span className={styles.sectionTitle}>
          {t('cartography.graph.impact')}
        </span>
      </div>
      <p className={styles.sectionSummary}>{summary}</p>
      {shown.length > 0 && (
        <ul className={styles.fileList}>
          {shown.map((p) => (
            <li key={p} className={styles.fileItem} title={p}>
              {p}
            </li>
          ))}
          {files.length > shown.length && (
            <li className={styles.moreNotice}>
              {t('cartography.graph.more', { count: files.length - shown.length })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function RelatedSection({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: { name: string; kind: string; filePath: string }[];
}) {
  const t = useT();
  const shown = items.slice(0, LIST_CAP);
  return (
    <div>
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon}>{icon}</span>
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionBadge}>· {items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className={styles.emptyNotice}>{t('cartography.graph.none')}</p>
      ) : (
        <ul className={styles.fileList}>
          {shown.map((it) => (
            <li
              key={`${it.filePath}#${it.name}`}
              className={styles.fileItem}
              title={`${it.name} — ${it.filePath}`}
            >
              <span className={styles.fileName}>{it.name}</span>
              <span className={styles.filePath}> · {it.filePath}</span>
            </li>
          ))}
          {items.length > shown.length && (
            <li className={styles.moreNotice}>
              {t('cartography.graph.more', { count: items.length - shown.length })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
