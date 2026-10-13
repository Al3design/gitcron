'use client';

// components/assist/AssistDock.tsx
// Dock inferior común de asistencia (chat + pestañas contextuales).

import React, { useEffect, useCallback, useRef } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import { AssistChat } from './AssistChat';
import styles from './AssistDock.module.css';

export interface AssistDockProps {
  repoPath: string;
  assistViewId?: string;
}

export function AssistDock({ repoPath, assistViewId }: AssistDockProps): React.JSX.Element {
  const t = useT();

  const open = useAssistDockStore((s) => s.open);
  const height = useAssistDockStore((s) => s.height);
  const activeTabId = useAssistDockStore((s) => s.activeTabId);
  const registeredTabs = useAssistDockStore((s) => s.registeredTabs);
  const setOpen = useAssistDockStore((s) => s.setOpen);
  const setActiveTab = useAssistDockStore((s) => s.setActiveTab);
  const setHeight = useAssistDockStore((s) => s.setHeight);
  const setSlot = useAssistDockStore((s) => s.setSlot);

  const dockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      setSlot(null);
    };
  }, [setSlot]);

  const handleResizeStart = useCallback(
    (clientY: number) => {
      const startY = clientY;
      const startH = height;

      // Tope: el 75 % del área central, para que la vista de arriba nunca desaparezca.
      const area = dockRef.current?.parentElement?.clientHeight || window.innerHeight;
      const maxHeight = Math.floor(area * 0.75);
      const onMove = (ev: MouseEvent | PointerEvent) => {
        const delta = startY - ev.clientY;
        setHeight(Math.min(maxHeight, startH + delta));
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, setHeight],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleResizeStart(e.clientY);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleResizeStart(e.clientY);
  };

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    if (!open) {
      setOpen(true);
    }
  };

  const bodyStyle: React.CSSProperties = {
    height: `${height}px`,
  };

  // Cerrado: sólo una manija chica al pie, para no ocupar el ancho de la vista.
  if (!open) {
    return (
      <div className={styles.handleRow}>
        <button
          type="button"
          className={styles.handle}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <MessageSquare size={16} aria-hidden="true" />
          <span>{t('assist.dockOpen')}</span>
        </button>
      </div>
    );
  }

  return (
    <aside ref={dockRef} className={styles.dock} aria-label={t('assist.title')}>
      {(
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('assist.dockResize')}
          title={t('assist.dockResize')}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onMouseDown={handleMouseDown}
          className={styles.resizer}
        >
          <div className={styles.resizerThumb} />
        </div>
      )}

      <div className={styles.tabBar} role="tablist" aria-label={t('assist.title')}>
        <div className={styles.tabs}>
          {registeredTabs.map((tab) => {
            const isSelected = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`assist-dock-tab-${tab.id}`}
                aria-selected={isSelected}
                aria-controls={`assist-dock-panel-${tab.id}`}
                onClick={() => handleTabClick(tab.id)}
                className={`${styles.tab} ${isSelected ? styles.activeTab : ''}`}
                type="button"
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('assist.dockClose')}
            aria-expanded={true}
            title={t('assist.dockClose')}
            className={styles.toggleBtn}
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </div>

      <div
        className={`${styles.body} ${styles.bodyOpen}`}
        style={bodyStyle}
      >
        {activeTabId === 'chat' ? (
          <div
            role="tabpanel"
            id="assist-dock-panel-chat"
            aria-labelledby="assist-dock-tab-chat"
            className={styles.panel}
          >
            <AssistChat repoPath={repoPath} viewId={assistViewId ?? 'graph'} />
          </div>
        ) : (
          <div
            role="tabpanel"
            id={`assist-dock-panel-${activeTabId}`}
            aria-labelledby={`assist-dock-tab-${activeTabId}`}
            ref={(node) => {
              setSlot(node);
            }}
            className={styles.panel}
          />
        )}
      </div>
    </aside>
  );
}
