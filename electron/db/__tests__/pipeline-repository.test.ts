import { describe, expect, it } from 'vitest';
import { openTemporalAgentDatabase } from '../connection';
import { PipelineRepository } from '../../pipeline/pipeline-repository';
import type { PipelineSemanticEvent, PipelineState, RuntimeProjection } from '../../../types/pipeline';

function runtimeProjection(repoId: string, over: Partial<RuntimeProjection> = {}): RuntimeProjection {
  return {
    schemaVersion: '1.0', repoId, sessionId: 'session-1', runtime: 'codex',
    changeId: 'change-1', taskId: '1.1', role: 'builder', active: true, outcome: 'running',
    startedAt: '2026-07-28T10:00:00.000Z', endedAt: null, agents: [], activity: [],
    reasoningVisibility: 'unknown', telemetry: null, controlCapabilities: [],
    droppedActivity: 0, diagnostics: [], ...over,
  };
}

function state(repoId: string, revision = 1): PipelineState {
  return {
    repoId, revision, observedAt: '2026-07-23T20:00:00.000Z', tasks: [], reports: [],
    activeChanges: [], archivedChanges: [], mergedChanges: [], diagnostics: [], decisions: [],
    selection: { changeId: null, confidence: 'unknown', selectionRequired: false, reason: 'no-active-change' },
  };
}

function event(repoId: string, eventId = 'event-1'): PipelineSemanticEvent {
  return { eventId, repoId, kind: 'report.added', observedAt: '2026-07-23T20:00:00.000Z', subjectId: 'report', evidenceRefs: ['report.md'] };
}

describe('PipelineRepository', () => {
  it('lee JSON antiguo sin campos de continuación y preserva los nuevos al volver a abrir la sesión', () => {
    const db = openTemporalAgentDatabase(':memory:');
    try {
      const repository = new PipelineRepository(db);
      const binding = repository.getOrCreateBinding('C:/old-repo', 'digest');
      repository.persistRuntimeProjection(runtimeProjection(binding.repoId));
      expect(repository.loadRuntimeProjections(binding.repoId)[0]).toMatchObject({
        runtimeSessionId: null, requestedModel: null, reasoningEffort: null, continuesSessionId: null,
      });
      repository.persistRuntimeProjection(runtimeProjection(binding.repoId, {
        runtimeSessionId: 'tool-id', requestedModel: 'provider/model', reasoningEffort: 'high', continuesSessionId: 'parent-id',
      }));
      expect(new PipelineRepository(db).loadRuntimeProjections(binding.repoId)[0]).toMatchObject({
        runtimeSessionId: 'tool-id', requestedModel: 'provider/model', reasoningEffort: 'high', continuesSessionId: 'parent-id',
      });
    } finally { db.close(); }
  });
  it('keeps stable bindings and isolates the same event id across repos', () => {
    const db = openTemporalAgentDatabase(':memory:');
    try {
      const repository = new PipelineRepository(db, () => '2026-07-23T20:00:00.000Z');
      const first = repository.getOrCreateBinding('C:/repo-a', 'digest-a');
      expect(repository.getOrCreateBinding('C:/repo-a', 'digest-a').repoId).toBe(first.repoId);
      const second = repository.getOrCreateBinding('C:/repo-b', 'digest-b');
      repository.persist(first, state(first.repoId), [event(first.repoId)]);
      repository.persist(first, state(first.repoId, 2), [event(first.repoId)]);
      repository.persist(second, state(second.repoId), [event(second.repoId)]);
      expect(repository.eventCount(first.repoId)).toBe(1);
      expect(repository.eventCount(second.repoId)).toBe(1);
      expect(repository.loadSnapshot(first.repoId)).toMatchObject({ sequence: 1, state: { revision: 2 } });
    } finally {
      db.close();
    }
  });

  it('redacts sensitive fields before persistence', () => {
    const db = openTemporalAgentDatabase(':memory:');
    try {
      const repository = new PipelineRepository(db);
      const binding = repository.getOrCreateBinding('C:/repo', 'digest');
      const unsafe = { ...state(binding.repoId), diagnostics: [], apiToken: 'do-not-store', nested: { reasoning: 'private' } } as PipelineState;
      repository.persist(binding, unsafe, []);
      const raw = db.prepare('SELECT state_json FROM pipeline_snapshot WHERE repo_id = ?').get(binding.repoId) as { state_json: string };
      expect(raw.state_json).not.toContain('do-not-store');
      expect(raw.state_json).not.toContain('private');
      expect(raw.state_json).toContain('[REDACTED]');
    } finally {
      db.close();
    }
  });

  it('persists sanitized runtime envelopes per repo', () => {
    const db = openTemporalAgentDatabase(':memory:');
    try {
      const repository = new PipelineRepository(db, () => '2026-07-23T20:00:00.000Z');
      const binding = repository.getOrCreateBinding('C:/repo', 'digest');
      const envelope = {
        schemaVersion: '1.0',
        eventId: 'env-1',
        sequence: 1,
        kind: 'session.update',
        observedAt: '2026-07-24T00:00:00.000Z',
        payload: { status: 'active', authorization: 'do-not-store' },
      };
      const result = repository.persistRuntimeEnvelope(binding, envelope);
      expect(result.sequence).toBe(1);
      expect(repository.eventCount(binding.repoId)).toBe(1);
      const raw = db.prepare('SELECT payload_json FROM pipeline_event WHERE repo_id = ? AND event_id = ?').get(binding.repoId, 'env-1') as { payload_json: string };
      expect(raw.payload_json).not.toContain('do-not-store');
      expect(raw.payload_json).toContain('[REDACTED]');
    } finally {
      db.close();
    }
  });

  it('upserts durable runtime projections and returns newest sessions first', () => {
    const db = openTemporalAgentDatabase(':memory:');
    try {
      const repository = new PipelineRepository(db, () => '2026-07-28T10:10:00.000Z');
      const binding = repository.getOrCreateBinding('C:/repo', 'digest');
      repository.persistRuntimeProjection(runtimeProjection(binding.repoId));
      repository.persistRuntimeProjection(runtimeProjection(binding.repoId, {
        active: false,
        outcome: 'completed',
        endedAt: '2026-07-28T10:05:00.000Z',
        activity: [{ entryId: 'done', channel: 'system', text: 'run.completed', at: '2026-07-28T10:05:00.000Z', agentId: null }],
      }));
      repository.persistRuntimeProjection(runtimeProjection(binding.repoId, {
        sessionId: 'session-2',
        changeId: 'change-2',
        startedAt: '2026-07-28T11:00:00.000Z',
      }));

      const history = repository.loadRuntimeProjections(binding.repoId);
      expect(history.map((entry) => entry.sessionId)).toEqual(['session-2', 'session-1']);
      expect(history[1]).toMatchObject({ outcome: 'completed', active: false, changeId: 'change-1' });
      expect(history[1].reasoningVisibility).toBe('unknown');
      expect(history[1].activity).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
