'use client';

// components/ai/AiSentDetails.tsx
//
// Muestra el pedido efectivo que se envió al motor de IA (D14): dirección o CLI,
// modelo, parámetros con su procedencia, cabeceras y autenticación.
// Nunca muestra claves, prompts, diffs ni contenido sensible.

import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import type { AiTextUse } from '@/types/ai-use';
import type { CommitAiLastRequest } from '@/types/commit-message-ai';
import styles from './AiSentDetails.module.css';

export interface AiSentDetailsProps {
  use?: AiTextUse;
  request?: CommitAiLastRequest | null;
  busy?: boolean;
  className?: string;
}

export function AiSentDetails({ use, request: externalRequest, busy, className }: AiSentDetailsProps) {
  const t = useT();
  const [internalRequest, setInternalRequest] = useState<CommitAiLastRequest | null>(null);
  const [showSentDetails, setShowSentDetails] = useState<boolean>(false);

  useEffect(() => {
    if (externalRequest !== undefined || !use) return;
    let alive = true;

    const reqPromise = (use === 'gitcron-commit' && window.api?.commitAi?.lastRequest)
      ? window.api.commitAi.lastRequest()
      : window.api?.aiUse?.lastRequest
        ? window.api.aiUse.lastRequest({ use })
        : null;

    if (reqPromise) {
      reqPromise
        .then((res) => {
          if (alive && res?.success && res.data) {
            setInternalRequest(res.data);
          }
        })
        .catch(() => undefined);
    }

    return () => {
      alive = false;
    };
  }, [use, externalRequest, busy]);

  const req = externalRequest !== undefined ? externalRequest : internalRequest;
  if (!req) {
    if (busy) {
      return (
        <div className={`${styles.aiSentSection} ${className ?? ''}`.trim()}>
          <span className={styles.aiSendingText}>
            <span>
              <span className="ai-thinking-text">{t('aiUse.sending')}</span>
            </span>
          </span>
        </div>
      );
    }
    return null;
  }

  const sentOrigin = (item: { provenance: string; file?: string }) =>
    item.file ? `${item.provenance} · ${t('pipeline.openspec.prepare.aiSentFromRepo')}` : item.provenance;

  const handleToggle = () => {
    setShowSentDetails((prev) => !prev);
  };

  return (
    <div className={`${styles.aiSentSection} ${className ?? ''}`.trim()}>
      <button
        type="button"
        className={styles.aiSentToggle}
        onClick={handleToggle}
        aria-expanded={showSentDetails}
      >
        {busy ? (
          <span>
            <span className="ai-thinking-text">{t('aiUse.sending')}</span>
          </span>
        ) : showSentDetails
          ? t('pipeline.openspec.prepare.aiHideSent')
          : t('pipeline.openspec.prepare.aiShowSent')}
      </button>
      {showSentDetails && (
        <div className={styles.aiSentDetails} data-testid="ai-sent-details">
          <dl className={styles.aiSentList}>
            <dt>{t('pipeline.openspec.prepare.aiSentEndpoint')}</dt>
            <dd>{req.endpoint}</dd>
            <dt>{t('pipeline.openspec.prepare.aiSentModel')}</dt>
            <dd>
              {String(req.model.value)}
              <span className={styles.aiSentProvenance}> ({sentOrigin(req.model)})</span>
            </dd>
            <dt>{t('pipeline.openspec.prepare.aiSentParams')}</dt>
            <dd>
              {Object.keys(req.parameters).length > 0 ? (
                <ul className={styles.aiSentParamList}>
                  {Object.entries(req.parameters).map(([key, item]) => (
                    <li key={key}>
                      <code>{key}</code>: <span>{typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}</span>
                      <span className={styles.aiSentProvenance}> ({sentOrigin(item)})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span>{t('pipeline.openspec.prepare.aiSentNone')}</span>
              )}
            </dd>
            <dt>{t('pipeline.openspec.prepare.aiSentHeaders')}</dt>
            <dd>
              {req.headers.length > 0 ? (
                <ul className={styles.aiSentHeaderList}>
                  {req.headers.map((h) => (
                    <li key={h.name}>
                      <code>{h.name}</code>
                      <span className={styles.aiSentProvenance}> ({sentOrigin(h)})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span>{t('pipeline.openspec.prepare.aiSentNone')}</span>
              )}
            </dd>
            {req.auth && (
              <>
                <dt>{t('pipeline.openspec.prepare.aiSentAuth')}</dt>
                <dd>{req.auth}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
