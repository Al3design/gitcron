'use client';

import { AlertCircle, Check, ChevronDown, ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { ChangelogEntry, ChangelogGroup } from '@/lib/changelog';

type ChangelogPreviewProps = {
  entries: ChangelogEntry[];
  error: string | null;
  isLoading: boolean;
};

function ChangelogPreviewHeader() {
  return (
    <div className="px-4 py-3 border-b border-border-subtle/15 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <FileText size={15} className="text-secondary shrink-0" />
          <span>Cambios recientes</span>
        </h3>
        <p className="mt-0.5 text-xs text-text-secondary">
          Resumen curado desde el changelog local, sin salir de GitCron.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.api.shellOpenExternal('https://github.com/Al3design/gitcron/releases/')}
        className="shrink-0 h-8 px-3 rounded-lg border border-border-subtle/15 bg-bg-overlay/50 text-xs font-bold text-text-secondary hover:border-secondary/35 hover:text-secondary transition-colors flex items-center gap-2"
      >
        <ExternalLink size={13} />
        <span>Historial completo</span>
      </button>
    </div>
  );
}

function ChangelogStatus({ error, isLoading }: { error: string | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="p-4 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 size={14} className="animate-spin text-secondary" />
        Cargando cambios...
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-sm text-error flex items-center gap-2">
        <AlertCircle size={14} className="shrink-0" />
        {error}
      </div>
    );
  }

  return null;
}

function ChangelogGroupCard({ group }: { group: ChangelogGroup }) {
  return (
    <div className="rounded-lg border border-border-subtle/10 bg-bg-overlay/25 p-3">
      <h4 className="text-[length:var(--font-size-2xs)] uppercase font-extrabold text-text-secondary tracking-wider mb-2">
        {group.label}
      </h4>
      <ul className="space-y-2.5">
        {group.items.map((item, itemIndex) => (
          <li key={`${item.title}-${itemIndex}`} className="grid grid-cols-[16px_1fr] gap-2 text-sm">
            <Check size={13} className="mt-0.5 text-secondary" />
            <div className="min-w-0">
              <p className="font-semibold text-text-primary leading-snug">{item.title}</p>
              {item.detail && (
                <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{item.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangelogEntryDetails({ entry, entryIndex }: { entry: ChangelogEntry; entryIndex: number }) {
  return (
    <details
      open={entryIndex === 0}
      className="group [&>summary::-webkit-details-marker]:hidden"
    >
      <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 hover:bg-bg-overlay/35 transition-colors">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-secondary font-mono text-xs font-extrabold">v{entry.version}</span>
            {entry.date && (
              <span className="text-[length:var(--font-size-xs)] text-text-secondary/70 font-medium">{entry.date}</span>
            )}
          </div>
          {entry.title && (
            <p className="mt-1 text-sm font-semibold text-text-primary truncate">{entry.title}</p>
          )}
        </div>
        <ChevronDown size={15} className="text-text-secondary shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="px-4 pb-4 space-y-4">
        {entry.groups.map((group) => (
          <ChangelogGroupCard key={group.label} group={group} />
        ))}
      </div>
    </details>
  );
}

function ChangelogEntries({ entries }: { entries: ChangelogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="p-4 text-sm text-text-secondary">
        Todavía no hay cambios publicados para mostrar.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-subtle/10">
      {entries.map((entry, entryIndex) => (
        <ChangelogEntryDetails
          key={`${entry.version}-${entry.date ?? entryIndex}`}
          entry={entry}
          entryIndex={entryIndex}
        />
      ))}
    </div>
  );
}

export function ChangelogPreview({ entries, error, isLoading }: ChangelogPreviewProps) {
  return (
    <section className="rounded-xl border border-border-subtle/15 bg-bg-base/70 overflow-hidden">
      <ChangelogPreviewHeader />
      <ChangelogStatus error={error} isLoading={isLoading} />
      {!isLoading && !error && (
        <ChangelogEntries entries={entries} />
      )}
    </section>
  );
}
