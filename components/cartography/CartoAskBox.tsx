'use client';

// CartoAskBox — Cartografía, Fase 6. La "ventanita de preguntas": escribís una
// pregunta libre sobre el repo activo y la IA responde, anclada a archivos reales.
//
// A diferencia de las fases previas (que anclaban la pregunta al archivo
// seleccionado), acá la recuperación es ESTRUCTURAL Y DESDE LA PREGUNTA: main busca
// los símbolos relevantes por nombre + sus vecinos por relación, arma un contexto
// CHICO y responde citando qué archivos miró. La respuesta trae esos nodos, que se
// muestran clickeables para abrir su detalle.
//
// Per-repo: la pregunta va contra el índice del `repoPath` activo. Cambiar de solapa
// cambia el repo (el padre re-monta con otro repoPath), así que el índice consultado
// cambia solo. Conversación con turnos: el hilo se acumula dentro de la sesión.
//
// No toca secretos: todo pasa por window.api.cartoAi.askRepo, que recupera y dispara
// la petición en main. La visibilidad la gobierna la vista (sólo monta esto si la IA
// está activa).

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Loader2, AlertTriangle, Trash2, User, FileCode } from 'lucide-react';
import { useGitStore } from '@/lib/git-store';
import { useT } from '@/hooks/use-translation';
import type { CartoNode } from '@/lib/carto-types';
import { AiUseLine } from '../ai/AiUseLine';
import { AiSentDetails } from '../ai/AiSentDetails';

type Turn =
  | { id: number; role: 'user'; text: string }
  | {
      id: number;
      role: 'ai';
      text: string;
      provider: string;
      usedNodes: CartoNode[];
      usedFiles: string[];
      promptChars: number;
    }
  | { id: number; role: 'error'; text: string };

type CartoAskBoxProps = {
  /** Repo activo: la pregunta se recupera y responde contra SU índice (per-repo). */
  repoPath: string | null;
  /** Abre el detalle de un nodo citado (panel de la columna izquierda). */
  onSelectNode: (node: CartoNode) => void;
};

export function CartoAskBox({ repoPath, onSelectNode }: CartoAskBoxProps) {
  const t = useT();
  const lang = useGitStore((s) => s.language);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const reqToken = useRef(0);
  const nextId = useRef(1);
  const threadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último turno cuando el hilo crece o llega una respuesta.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, loading]);

  // Cambiar de repo (de solapa) limpia el hilo: la conversación es del repo activo.
  useEffect(() => {
    setTurns([]);
    reqToken.current++; // descarta cualquier respuesta en vuelo del repo anterior
    setLoading(false);
  }, [repoPath]);

  async function submit() {
    const q = question.trim();
    if (!q || loading || !repoPath) return;
    const token = ++reqToken.current;
    setTurns((prev) => [...prev, { id: nextId.current++, role: 'user', text: q }]);
    setQuestion('');
    setLoading(true);
    try {
      const res = await window.api.cartoAi.askRepo(repoPath, q, lang);
      if (token !== reqToken.current) return;
      if (res.success && res.data) {
        const d = res.data;
        setTurns((prev) => [
          ...prev,
          {
            id: nextId.current++,
            role: 'ai',
            text: d.answer.text,
            provider: d.answer.provider,
            usedNodes: d.usedNodes,
            usedFiles: d.usedFiles,
            promptChars: d.promptChars,
          },
        ]);
      } else {
        setTurns((prev) => [...prev, { id: nextId.current++, role: 'error', text: res.error ?? t('cartography.ai.error') }]);
      }
    } catch (err) {
      if (token !== reqToken.current) return;
      const msg = err instanceof Error ? err.message : t('cartography.ai.error');
      setTurns((prev) => [...prev, { id: nextId.current++, role: 'error', text: msg }]);
    } finally {
      if (token === reqToken.current) setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-carto-node/[0.02]">
      {/* Cabecera */}
      <div className="flex shrink-0 items-center gap-2 border-b border-carto-grid px-3 py-2">
        <Bot size={13} className="shrink-0 text-[var(--color-ai)]" />
        <span className="truncate text-[length:var(--font-size-2xs)] font-bold uppercase tracking-widest text-carto-text-muted">
          {t('cartography.ai.askTitle')}
        </span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
            title={t('cartography.ai.clear')}
            className="ml-auto flex items-center gap-1 text-[length:var(--font-size-xs)] text-carto-text-muted transition-colors hover:text-carto-text"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Hilo de conversación */}
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {turns.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-carto-text-muted">
            <Bot size={20} className="text-[var(--color-ai)]" />
            <p className="max-w-[18rem] text-xs leading-relaxed">{t('cartography.ai.repoHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {turns.map((turn) => (
              <Bubble key={turn.id} turn={turn} onSelectNode={onSelectNode} t={t} />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-carto-text-muted">
                <Loader2 size={13} className="animate-spin text-[var(--color-ai)]" />
                <span>
                  <span className="ai-thinking-text">{t('cartography.ai.thinking')}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Línea del modelo y detalles de lo enviado en Cartografía (D11, D14) */}
      <div className="border-t border-carto-grid px-3 py-2 flex flex-col gap-1.5 bg-carto-canvas/50">
        <AiUseLine use="gitcron-cartography" repoPath={repoPath} />
        <AiSentDetails use="gitcron-cartography" busy={loading} />
      </div>

      {/* Caja de entrada */}
      <div className="flex shrink-0 items-center gap-2 border-t border-carto-grid px-3 py-2.5">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder={t('cartography.ai.askPlaceholder')}
          disabled={loading || !repoPath}
          className="min-w-0 flex-1 rounded border border-carto-grid bg-carto-canvas px-2.5 py-1.5 text-xs text-carto-text placeholder:text-carto-text-muted/60 focus:border-carto-accent/50 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading || !question.trim() || !repoPath}
          className="shrink-0 flex items-center gap-1.5 rounded border border-carto-accent/40 bg-carto-accent/10 px-2.5 py-1.5 text-xs font-semibold text-carto-accent transition-colors hover:bg-carto-accent/20 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 size={12} className="animate-spin text-[var(--color-ai)]" />
              <span>
                <span className="ai-thinking-text">{t('cartography.ai.send')}</span>
              </span>
            </>
          ) : (
            <>
              <Send size={12} />
              {t('cartography.ai.send')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Bubble({
  turn,
  onSelectNode,
  t,
}: {
  turn: Turn;
  onSelectNode: (node: CartoNode) => void;
  t: ReturnType<typeof useT>;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-1.5 rounded-lg border border-carto-accent/30 bg-carto-accent/10 px-2.5 py-1.5 text-xs text-carto-text">
          <p className="min-w-0 whitespace-pre-wrap break-words">{turn.text}</p>
          <User size={12} className="mt-0.5 shrink-0 text-carto-accent" />
        </div>
      </div>
    );
  }
  if (turn.role === 'error') {
    return (
      <div className="flex items-start gap-1.5 rounded-lg border border-error/30 bg-error/5 px-2.5 py-1.5 text-[length:var(--font-size-2xs)] text-error">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{turn.text}</span>
      </div>
    );
  }
  // Respuesta de la IA: prosa + nodos citados (clickeables) + procedencia.
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] ai-surface ai-panel px-2.5 py-1.5 text-xs leading-relaxed text-carto-text">
        <p className="whitespace-pre-wrap break-words">{turn.text}</p>

        {turn.usedNodes.length > 0 ? (
          <div className="mt-2 border-t border-carto-grid pt-1.5">
            <p className="mb-1 text-[length:var(--font-size-2xs)] font-semibold uppercase tracking-wider text-carto-text-muted/70">
              {t('cartography.ai.basedOn')}
            </p>
            <div className="flex flex-wrap gap-1">
              {turn.usedNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node)}
                  title={node.filePath}
                  className="flex max-w-full items-center gap-1 rounded border border-carto-grid bg-carto-node/[0.04] px-1.5 py-0.5 text-[length:var(--font-size-2xs)] text-carto-text-muted transition-colors hover:border-carto-accent/50 hover:text-carto-text"
                >
                  <FileCode size={10} className="shrink-0 text-carto-accent/70" />
                  <span className="truncate font-mono">{node.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2 border-t border-carto-grid pt-1.5 text-[length:var(--font-size-xs)] italic text-carto-text-muted/60">
            {t('cartography.ai.noMatches')}
          </p>
        )}

        <p className="mt-1.5 font-mono text-[length:var(--font-size-xs)] text-carto-text-muted/70">
          {turn.provider} · {t('cartography.ai.contextChars', { chars: turn.promptChars })}
        </p>
      </div>
    </div>
  );
}
