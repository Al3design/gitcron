// lib/assist/conversation-groups.ts
//
// Agrupamiento y orden determinista de conversaciones del asistente contextual (tarea 2.11).
// Orden: Fijadas -> un grupo por cambio de SDD -> Generales -> Archivadas.
// Cada conversación pertenece a un único grupo.

import type { AssistConversationSummary } from '@/types/assist-context';

export interface ConversationGroups {
  pinned: AssistConversationSummary[];
  /** Un grupo por cambio, en el orden de su conversación más reciente. */
  byChange: { changeId: string; items: AssistConversationSummary[] }[];
  general: AssistConversationSummary[];
  archived: AssistConversationSummary[];
}

function sortByPinnedAtDesc(a: AssistConversationSummary, b: AssistConversationSummary): number {
  const timeA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
  const timeB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
  return timeB - timeA;
}

function sortByUpdatedAtDesc(a: AssistConversationSummary, b: AssistConversationSummary): number {
  const timeA = new Date(a.updatedAt).getTime();
  const timeB = new Date(b.updatedAt).getTime();
  return timeB - timeA;
}

export function groupConversations(list: AssistConversationSummary[]): ConversationGroups {
  const pinned: AssistConversationSummary[] = [];
  const archived: AssistConversationSummary[] = [];
  const general: AssistConversationSummary[] = [];
  const changeMap = new Map<string, AssistConversationSummary[]>();

  for (const item of list) {
    if (Boolean(item.archivedAt)) {
      archived.push(item);
    } else if (Boolean(item.pinnedAt)) {
      pinned.push(item);
    } else if (item.changeId) {
      const { changeId } = item;
      let group = changeMap.get(changeId);
      if (!group) {
        group = [];
        changeMap.set(changeId, group);
      }
      group.push(item);
    } else {
      general.push(item);
    }
  }

  pinned.sort(sortByPinnedAtDesc);
  archived.sort(sortByUpdatedAtDesc);
  general.sort(sortByUpdatedAtDesc);

  const byChange: { changeId: string; items: AssistConversationSummary[] }[] = [];
  for (const [changeId, items] of changeMap.entries()) {
    items.sort(sortByUpdatedAtDesc);
    byChange.push({ changeId, items });
  }

  byChange.sort((a, b) => {
    const timeA = a.items.length > 0 ? new Date(a.items[0].updatedAt).getTime() : 0;
    const timeB = b.items.length > 0 ? new Date(b.items[0].updatedAt).getTime() : 0;
    return timeB - timeA;
  });

  return {
    pinned,
    byChange,
    general,
    archived,
  };
}
