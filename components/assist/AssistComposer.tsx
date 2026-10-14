'use client';

// components/assist/AssistComposer.tsx
// Cuadro de texto de asistencia estilo Claude escritorio (tarea 2.8).
// Empieza en una línea y crece con el texto; abajo a la izquierda menú «+» y destino;
// abajo a la derecha modelo como texto, vista previa y enviar/detener.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronDown, Eye, PenLine, Plus, Square, X } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { MarkdownViewer } from '@/components/pipeline/MarkdownViewer';
import { AiModelPicker } from '@/components/ai/AiModelPicker';
import type { AiUseStatus } from '@/types/ai-use';
import styles from './AssistComposer.module.css';

export interface AssistComposerProps {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  /** Mientras la IA piensa, el botón de enviar pasa a detener. */
  thinking: boolean;
  onStop(): void;
  /** Deshabilita enviar (otro pedido en curso en otra conversación). */
  sendDisabled: boolean;
  repoPath: string | null;
  /** Texto del destino elegido en la pantalla (lo arma el chat con formatTarget), o null si no hay. */
  targetLabel: string | null;
  /** Se destaca cuando el destino cambió con una conversación abierta (lo que hoy hace scopeLineChanged). */
  targetChanged: boolean;
  /** Quitar el destino: la próxima pregunta va sobre el repositorio. */
  onClearTarget(): void;
  /** Lo que va en el menú «+»: las acciones consult de la vista y «Nueva conversación». */
  menuItems: { id: string; label: string; onSelect(): void }[];
}

export function AssistComposer({
  value,
  onChange,
  onSend,
  thinking,
  onStop,
  sendDisabled,
  repoPath,
  targetLabel,
  targetChanged,
  onClearTarget,
  menuItems,
}: AssistComposerProps): React.JSX.Element {
  const t = useT();

  const [isPreview, setIsPreview] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelStatus, setModelStatus] = useState<AiUseStatus | null>(null);
  const [version, setVersion] = useState(0);

  const [modelPickerCoords, setModelPickerCoords] = useState<{ bottom: number; right: number; maxHeight: number }>({
    bottom: 0,
    right: 0,
    maxHeight: 400,
  });
  const [menuCoords, setMenuCoords] = useState<{ bottom: number; left: number }>({
    bottom: 0,
    left: 0,
  });

  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toggleModelPicker = () => {
    if (!showModelPicker && modelBtnRef.current) {
      const rect = modelBtnRef.current.getBoundingClientRect();
      const bottom = Math.max(8, window.innerHeight - rect.top + 6);
      const right = Math.max(8, window.innerWidth - rect.right);
      const maxHeight = Math.max(200, rect.top - 16);
      setModelPickerCoords({ bottom, right, maxHeight });
      setShowModelPicker(true);
    } else {
      setShowModelPicker(false);
    }
  };

  const toggleMenu = () => {
    if (!menuOpen && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      const bottom = Math.max(8, window.innerHeight - rect.top + 6);
      const left = Math.max(8, rect.left);
      setMenuCoords({ bottom, left });
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
    }
  };

  // Consulta el modelo asignado a gitcron-assist y escucha cambios de config
  useEffect(() => {
    const aiUse = window.api?.aiUse;
    if (!aiUse) return;
    let alive = true;
    aiUse
      .status({ use: 'gitcron-assist', repoPath })
      .then((res) => {
        if (!alive) return;
        setModelStatus(res?.success && res.data ? res.data : null);
      })
      .catch((err) => {
        console.warn('[AssistComposer] Error al consultar modelo:', err);
      });

    const stop = window.api?.commitAi?.onConfigChanged?.(() => setVersion((v) => v + 1));
    return () => {
      alive = false;
      stop?.();
    };
  }, [repoPath, version]);

  // Cierre de popovers al hacer clic afuera o con Escape
  useEffect(() => {
    if (!menuOpen && !showModelPicker) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuOpen &&
        menuRef.current &&
        !menuRef.current.contains(target) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
      if (
        showModelPicker &&
        modelPickerRef.current &&
        !modelPickerRef.current.contains(target) &&
        modelBtnRef.current &&
        !modelBtnRef.current.contains(target)
      ) {
        setShowModelPicker(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menuOpen) {
          setMenuOpen(false);
          menuBtnRef.current?.focus();
        }
        if (showModelPicker) {
          setShowModelPicker(false);
          modelBtnRef.current?.focus();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, showModelPicker]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.shiftKey && !e.ctrlKey) {
        // Shift+Enter salta de línea por defecto
        return;
      }
      e.preventDefault();
      if (!sendDisabled && !thinking && value.trim()) {
        onSend();
      }
    }
  };

  const handleSavedModel = () => {
    setShowModelPicker(false);
    setVersion((v) => v + 1);
  };

  const isResolved = modelStatus?.status === 'resolved';
  const modelText = isResolved ? modelStatus.modelId || modelStatus.providerName : null;
  const effortText = isResolved && modelStatus.effort ? modelStatus.effort : null;

  return (
    <div className={styles.composer}>
      {/* Zona superior: textarea o vista previa de Markdown */}
      {isPreview ? (
        <div className={styles.previewArea}>
          <MarkdownViewer content={value} />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={t('assist.placeholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={thinking}
          rows={1}
        />
      )}

      {/* Fila inferior: controles */}
      <div className={styles.bottomRow}>
        {/* Izquierda: menú «+» y etiqueta de destino */}
        <div className={styles.bottomLeft}>
          <div className={styles.popoverAnchor}>
            <button
              ref={menuBtnRef}
              type="button"
              className={styles.iconBtn}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('assist.menu')}
              title={t('assist.menu')}
              onClick={toggleMenu}
            >
              <Plus size={16} aria-hidden="true" />
            </button>

            {menuOpen && typeof document !== 'undefined' && (() => {
              const menuStyle: React.CSSProperties = {
                bottom: menuCoords.bottom,
                left: menuCoords.left,
              };
              return createPortal(
                <div
                  ref={menuRef}
                  className={styles.menuPopover}
                  role="menu"
                  style={menuStyle}
                >
                  {menuItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        item.onSelect();
                        setMenuOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>,
                document.body,
              );
            })()}
          </div>

          {targetLabel ? (
            <div
              className={`${styles.targetBadge} ${targetChanged ? styles.targetBadgeChanged : ''}`}
            >
              <span className={styles.targetText}>{targetLabel}</span>
              <button
                type="button"
                className={styles.clearTargetBtn}
                aria-label={t('assist.clearTarget')}
                title={t('assist.clearTarget')}
                onClick={onClearTarget}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <span className={styles.scopeRepoText}>{t('assist.scopeRepo')}</span>
          )}
        </div>

        {/* Derecha: vista previa, modelo y botón de enviar/detener */}
        <div className={styles.bottomRight}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-pressed={isPreview}
            aria-label={t(isPreview ? 'assist.write' : 'assist.preview')}
            title={t(isPreview ? 'assist.write' : 'assist.preview')}
            onClick={() => setIsPreview(!isPreview)}
          >
            {isPreview ? <PenLine size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>

          <div className={styles.popoverAnchor}>
            <button
              ref={modelBtnRef}
              type="button"
              className={styles.modelBtn}
              onClick={toggleModelPicker}
              aria-haspopup="dialog"
              aria-expanded={showModelPicker}
            >
              {modelText ? (
                <>
                  <span className={styles.modelName}>{modelText}</span>
                  {effortText && (
                    <>
                      <span className={styles.modelDot}>·</span>
                      <span className={styles.modelEffort}>{effortText}</span>
                    </>
                  )}
                </>
              ) : (
                <span className={styles.modelName}>{t('assist.chooseModel')}</span>
              )}
              <ChevronDown size={14} className={styles.modelChevron} aria-hidden="true" />
            </button>

            {showModelPicker && typeof document !== 'undefined' && (() => {
              const modelPickerStyle: React.CSSProperties = {
                bottom: modelPickerCoords.bottom,
                right: modelPickerCoords.right,
                maxHeight: modelPickerCoords.maxHeight,
              };
              return createPortal(
                <div
                  ref={modelPickerRef}
                  className={styles.modelPickerPopover}
                  role="dialog"
                  aria-label={t('assist.chooseModel')}
                  style={modelPickerStyle}
                >
                  <AiModelPicker
                    use="gitcron-assist"
                    repoPath={repoPath}
                    onClose={() => setShowModelPicker(false)}
                    onSaved={handleSavedModel}
                  />
                </div>,
                document.body,
              );
            })()}
          </div>

          <button
            type="button"
            className={styles.sendBtn}
            disabled={thinking ? false : sendDisabled || !value.trim()}
            onClick={thinking ? onStop : onSend}
            aria-label={t(thinking ? 'assist.stop' : 'assist.send')}
            title={t(thinking ? 'assist.stop' : 'assist.send')}
          >
            {thinking ? <Square size={14} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
