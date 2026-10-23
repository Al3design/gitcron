import { describe, expect, it, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase } from '../db/connection';
import {
  getScreenCaptures,
  upsertScreenCapture,
  deleteScreenCapturesNotIn,
  getCaptureConsent,
  setCaptureConsent,
  clearCaptureConsent,
} from '../db/carto-captures';

describe('carto captures db', () => {
  let db: DatabaseSync;
  const opts = () => ({ db, now: () => '2026-10-16T12:00:00.000Z' });

  beforeEach(() => {
    db = openTemporalAgentDatabase(':memory:');
  });

  describe('capturas de pantalla', () => {
    it('guarda y recupera capturas por repositorio', () => {
      expect(getScreenCaptures('/repo-a', opts())).toEqual([]);

      const imgA = Buffer.from('image-a-data');
      upsertScreenCapture(
        {
          repoPath: '/repo-a',
          screenId: 'route:/dashboard',
          contentKey: 'hash-dash-1',
          image: imgA,
        },
        opts(),
      );

      const captures = getScreenCaptures('/repo-a', opts());
      expect(captures).toHaveLength(1);
      expect(captures[0].screenId).toBe('route:/dashboard');
      expect(captures[0].contentKey).toBe('hash-dash-1');
      expect(captures[0].image.toString()).toBe('image-a-data');
      expect(captures[0].capturedAt).toBe('2026-10-16T12:00:00.000Z');

      // Actualizar la misma pantalla (upsert)
      const imgA2 = Buffer.from('image-a-updated');
      upsertScreenCapture(
        {
          repoPath: '/repo-a',
          screenId: 'route:/dashboard',
          contentKey: 'hash-dash-2',
          image: imgA2,
        },
        opts(),
      );

      const updated = getScreenCaptures('/repo-a', opts());
      expect(updated).toHaveLength(1);
      expect(updated[0].contentKey).toBe('hash-dash-2');
      expect(updated[0].image.toString()).toBe('image-a-updated');
    });

    it('borra las capturas de pantallas que ya no están', () => {
      upsertScreenCapture(
        { repoPath: '/repo-a', screenId: 'route:/dash', contentKey: 'k1', image: Buffer.from('1') },
        opts(),
      );
      upsertScreenCapture(
        { repoPath: '/repo-a', screenId: 'route:/settings', contentKey: 'k2', image: Buffer.from('2') },
        opts(),
      );
      upsertScreenCapture(
        { repoPath: '/repo-a', screenId: 'route:/profile', contentKey: 'k3', image: Buffer.from('3') },
        opts(),
      );

      deleteScreenCapturesNotIn('/repo-a', ['route:/dash', 'route:/settings'], opts());

      const remaining = getScreenCaptures('/repo-a', opts());
      expect(remaining.map((r) => r.screenId)).toEqual(['route:/dash', 'route:/settings']);

      deleteScreenCapturesNotIn('/repo-a', [], opts());
      expect(getScreenCaptures('/repo-a', opts())).toEqual([]);
    });
  });

  describe('permiso de ejecución (consent)', () => {
    it('guarda, lee y borra el permiso por repositorio', () => {
      expect(getCaptureConsent('/repo-a', opts())).toBeNull();

      setCaptureConsent('/repo-a', 'pnpm run dev', opts());

      const consent = getCaptureConsent('/repo-a', opts());
      expect(consent).toEqual({
        command: 'pnpm run dev',
        grantedAt: '2026-10-16T12:00:00.000Z',
      });

      // Modificar el permiso
      setCaptureConsent('/repo-a', 'next dev -p <puerto libre>', opts());
      expect(getCaptureConsent('/repo-a', opts())?.command).toBe('next dev -p <puerto libre>');

      // Borrar el permiso
      clearCaptureConsent('/repo-a', opts());
      expect(getCaptureConsent('/repo-a', opts())).toBeNull();
    });
  });
});
