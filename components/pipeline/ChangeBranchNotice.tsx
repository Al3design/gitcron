'use client';

import { GitBranch } from 'lucide-react';
import type { BranchDivergence } from '@/types/pipeline';
import { useT } from '@/hooks/use-translation';
import { deriveChangeBranchState } from '@/lib/change-branch';
import { Text } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';

/**
 * Lo que Git dice sobre la rama de un cambio, en dos piezas.
 *
 * `ChangeBranchNotice` es el aviso de que el cambio abierto no se está
 * trabajando en su rama. Existe porque la regla tiene cero cumplimiento medido:
 * `git branch --list "change/*"` devolvió vacío cuatro días después de
 * escribirla, con unos diez cambios creados en ese lapso. La regla llega por el
 * canal, así que no es un problema de transporte —nada la hace visible cuando
 * importa—.
 *
 * `BranchBaseNotice` declara de dónde va a salir la rama que está por crearse.
 * `git checkout -b` no lo dice, y este repositorio tiene 35 ramas locales con
 * varias deliberadamente sin fusionar: crear un cambio parado en una de ellas
 * hereda una base de meses atrás sin que nada lo declare.
 *
 * Ninguna de las dos bloquea. Los cambios se crean también desde la terminal,
 * donde no hay nada que bloquear, y trabajar en `main` a propósito es una
 * decisión legítima.
 */

export type ChangeBranchNoticeProps = {
  /** Rama en la que está parado el repositorio. */
  branch?: string | null;
  /** Cambio abierto. Sin uno no hay rama que corresponda. */
  changeId?: string | null;
};

export function ChangeBranchNotice({ branch, changeId }: ChangeBranchNoticeProps) {
  const t = useT();
  const state = deriveChangeBranchState(branch, changeId);
  // Sin cambio abierto, sin nombre de rama, o con la rama correcta: no hay nada
  // que declarar. Un bloque que siempre está enseña a saltearlo.
  if (state === null || state.matches) return null;

  return (
    <section className={styles.branchNoticeBadge} data-kind="branch">
      <GitBranch size={13} aria-hidden="true" />
      <p>
        <strong>{t('pipeline.openspec.branch.mismatchTitle', { branch: state.actual })}</strong>
        {' '}
        {t('pipeline.openspec.branch.mismatchHelp', { expected: state.expected })}
      </p>
    </section>
  );
}

export type BranchBaseNoticeProps = {
  divergence?: BranchDivergence;
  /** Rama actual, que es la base si no se elige otra. */
  branch?: string | null;
};

export function BranchBaseNotice({ divergence, branch }: BranchBaseNoticeProps) {
  const t = useT();
  // Sin el dato no se afirma nada: no medir no es «está al día».
  if (!divergence) return null;
  if (!divergence.measured) {
    return <Text variant="mono-xs" as="p">{t('pipeline.openspec.branch.baseUnknown')}</Text>;
  }
  // Al día y sin trabajo propio: no hay nada que decir sobre la base.
  if (divergence.behind === 0 && divergence.ahead === 0) return null;

  return (
    <p className={styles.branchBase} role="status">
      <strong>
        {t('pipeline.openspec.branch.baseFrom', { branch: (branch ?? '').trim() || divergence.base })}
      </strong>
      {' '}
      {divergence.behind > 0 && t('pipeline.openspec.branch.baseBehind', {
        count: divergence.behind,
        base: divergence.base,
      })}
      {/* Los commits propios se declaran aparte: pueden ser trabajo sin fusionar
          a propósito —una línea deprecada, o algo en curso—, y en ese caso la
          base correcta no es `main`. Por eso se dice y no se corrige. */}
      {divergence.ahead > 0 && (
        <>
          {' '}
          {t('pipeline.openspec.branch.baseAhead', { count: divergence.ahead })}
        </>
      )}
      {' '}
      <em>{t('pipeline.openspec.branch.baseLocalOnly', { base: divergence.base })}</em>
    </p>
  );
}
