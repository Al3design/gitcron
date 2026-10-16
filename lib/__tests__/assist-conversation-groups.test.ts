import { describe, expect, it } from 'vitest';
import { groupConversations } from '../assist/conversation-groups';
import type { AssistConversationSummary } from '@/types/assist-context';

function makeConv(
  id: string,
  overrides: Partial<AssistConversationSummary> = {},
): AssistConversationSummary {
  return {
    id,
    title: `Conversación ${id}`,
    viewId: null,
    createdAt: '2026-10-14T10:00:00Z',
    updatedAt: '2026-10-14T10:00:00Z',
    messageCount: 1,
    pinnedAt: null,
    archivedAt: null,
    changeId: null,
    ...overrides,
  };
}

describe('groupConversations', () => {
  it('retorna grupos vacíos para una lista vacía', () => {
    const res = groupConversations([]);
    expect(res).toEqual({
      pinned: [],
      byChange: [],
      general: [],
      archived: [],
    });
  });

  it('clasifica correctamente en los cuatro grupos', () => {
    const p = makeConv('p', { pinnedAt: '2026-10-14T12:00:00Z' });
    const c = makeConv('c', { changeId: 'cambio-1' });
    const g = makeConv('g');
    const a = makeConv('a', { archivedAt: '2026-10-14T13:00:00Z' });

    const res = groupConversations([p, c, g, a]);
    expect(res.pinned.map((x) => x.id)).toEqual(['p']);
    expect(res.byChange).toHaveLength(1);
    expect(res.byChange[0].changeId).toBe('cambio-1');
    expect(res.byChange[0].items.map((x) => x.id)).toEqual(['c']);
    expect(res.general.map((x) => x.id)).toEqual(['g']);
    expect(res.archived.map((x) => x.id)).toEqual(['a']);
  });

  it('una archivada con cambio va a archivadas', () => {
    const conv = makeConv('ac', {
      changeId: 'cambio-1',
      archivedAt: '2026-10-14T12:00:00Z',
    });
    const res = groupConversations([conv]);
    expect(res.archived.map((x) => x.id)).toEqual(['ac']);
    expect(res.byChange).toHaveLength(0);
  });

  it('una fijada con cambio va a fijadas', () => {
    const conv = makeConv('pc', {
      changeId: 'cambio-1',
      pinnedAt: '2026-10-14T12:00:00Z',
    });
    const res = groupConversations([conv]);
    expect(res.pinned.map((x) => x.id)).toEqual(['pc']);
    expect(res.byChange).toHaveLength(0);
  });

  it('ordena dos cambios por su conversación más reciente', () => {
    const c1Old = makeConv('c1-old', {
      changeId: 'cambio-1',
      updatedAt: '2026-10-14T08:00:00Z',
    });
    const c1New = makeConv('c1-new', {
      changeId: 'cambio-1',
      updatedAt: '2026-10-14T09:00:00Z',
    });
    const c2Old = makeConv('c2-old', {
      changeId: 'cambio-2',
      updatedAt: '2026-10-14T07:00:00Z',
    });
    const c2New = makeConv('c2-new', {
      changeId: 'cambio-2',
      updatedAt: '2026-10-14T11:00:00Z',
    });

    const res = groupConversations([c1Old, c1New, c2Old, c2New]);
    expect(res.byChange).toHaveLength(2);
    // cambio-2 tiene una conversación a las 11:00, cambio-1 a las 09:00 -> cambio-2 va primero
    expect(res.byChange[0].changeId).toBe('cambio-2');
    expect(res.byChange[0].items.map((x) => x.id)).toEqual(['c2-new', 'c2-old']);
    expect(res.byChange[1].changeId).toBe('cambio-1');
    expect(res.byChange[1].items.map((x) => x.id)).toEqual(['c1-new', 'c1-old']);
  });

  it('ordena dentro de cada grupo por pinnedAt descendente en pinned y updatedAt descendente en los demás', () => {
    const p1 = makeConv('p1', {
      pinnedAt: '2026-10-14T08:00:00Z',
      updatedAt: '2026-10-14T12:00:00Z',
    });
    const p2 = makeConv('p2', {
      pinnedAt: '2026-10-14T10:00:00Z',
      updatedAt: '2026-10-14T07:00:00Z',
    });

    const g1 = makeConv('g1', { updatedAt: '2026-10-14T05:00:00Z' });
    const g2 = makeConv('g2', { updatedAt: '2026-10-14T09:00:00Z' });

    const a1 = makeConv('a1', {
      archivedAt: '2026-10-14T01:00:00Z',
      updatedAt: '2026-10-14T04:00:00Z',
    });
    const a2 = makeConv('a2', {
      archivedAt: '2026-10-14T02:00:00Z',
      updatedAt: '2026-10-14T06:00:00Z',
    });

    const res = groupConversations([p1, p2, g1, g2, a1, a2]);
    // En pinned manda pinnedAt: p2 (10:00) antes que p1 (08:00)
    expect(res.pinned.map((x) => x.id)).toEqual(['p2', 'p1']);
    // En general manda updatedAt: g2 (09:00) antes que g1 (05:00)
    expect(res.general.map((x) => x.id)).toEqual(['g2', 'g1']);
    // En archived manda updatedAt: a2 (06:00) antes que a1 (04:00)
    expect(res.archived.map((x) => x.id)).toEqual(['a2', 'a1']);
  });
});
