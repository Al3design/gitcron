'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import {
  Globe, Type, Folder, Sparkles, Layers, RotateCcw, AlertCircle,
  Lock, Download, HelpCircle, Github, FileText, Check, Loader2,
  Settings, ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pkg from '../package.json';
import { useT } from '@/hooks/use-translation';
import { LANGS, type Lang } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useGitStore, type FontSize } from '@/lib/git-store';
import {
  DEFAULT_SHORTCUTS,
  defaultShortcutsMap,
  eventToShortcut,
  formatShortcut,
} from '@/lib/shortcuts';
import { ChangelogPreview } from '@/components/ChangelogPreview';

const TemporalAgentSettings = dynamic(
  () => import('@/components/TemporalAgentSettings').then((mod) => mod.TemporalAgentSettings),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-48 w-full items-center justify-center text-text-secondary">
        <Loader2 size={18} className="animate-spin text-secondary" />
      </div>
    ),
  },
);

const CartoAISettings = dynamic(
  () => import('@/components/cartography/CartoAISettings').then((mod) => mod.CartoAISettings),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-24 w-full items-center justify-center text-text-secondary">
        <Loader2 size={18} className="animate-spin text-secondary" />
      </div>
    ),
  },
);

const AgentDashboard = dynamic(
  () => import('@/components/temporal/AgentDashboard').then((mod) => mod.AgentDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-48 w-full items-center justify-center text-text-secondary">
        <Loader2 size={18} className="animate-spin text-secondary" />
      </div>
    ),
  },
);

const AiSettingsSection = dynamic(
  () => import('@/components/ai/AiSettingsSection').then((mod) => mod.AiSettingsSection),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-48 w-full items-center justify-center text-text-secondary">
        <Loader2 size={18} className="animate-spin text-secondary" />
      </div>
    ),
  },
);

const AUTO_FETCH_INTERVALS = [5, 10, 30, 60] as const;

interface AutoFetchSectionProps {
  setAutoFetchPrefs: (enabled: boolean, intervalMinutes: number) => Promise<void> | void;
}

function AutoFetchSection({ setAutoFetchPrefs }: AutoFetchSectionProps) {
  const t = useT();
  const autoFetchEnabled = useGitStore((s) => s.autoFetchEnabled);
  const autoFetchIntervalMinutes = useGitStore((s) => s.autoFetchIntervalMinutes);
  const lastFetchTime = useGitStore((s) => s.lastFetchTime);

  const lastSyncLabel = lastFetchTime
    ? new Date(lastFetchTime).toLocaleTimeString()
    : t('settings.autoFetchNever');

  return (
    <section>
      <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
        <RotateCcw size={12} /> {t('settings.autoFetch')}
      </h4>
      <p className="text-xs text-text-secondary mb-3">{t('settings.autoFetchDesc')}</p>
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setAutoFetchPrefs(!autoFetchEnabled, autoFetchIntervalMinutes)}
          className={cn(
            'px-3 py-2 rounded border text-sm flex items-center gap-2 transition-colors',
            autoFetchEnabled
              ? 'bg-secondary/15 border-secondary/50 text-secondary'
              : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
          )}
        >
          {autoFetchEnabled && <Check size={14} strokeWidth={3} />}
          <span className="font-medium">
            {autoFetchEnabled ? t('settings.autoFetchEnabled') : t('settings.autoFetchDisabled')}
          </span>
        </button>
        <span className="text-xs text-text-secondary/70 ml-2">
          {t('settings.autoFetchLastSync')}: {lastSyncLabel}
        </span>
      </div>
      <div className={cn('grid grid-cols-4 gap-2', !autoFetchEnabled && 'opacity-40 pointer-events-none')}>
        {AUTO_FETCH_INTERVALS.map((mins) => (
          <button
            key={mins}
            type="button"
            onClick={() => setAutoFetchPrefs(true, mins)}
            className={cn(
              'px-3 py-2 rounded border text-sm flex items-center justify-center gap-2 transition-colors',
              autoFetchIntervalMinutes === mins
                ? 'bg-secondary/15 border-secondary/50 text-secondary'
                : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary hover:border-border-subtle/30',
            )}
          >
            {mins} min
            {autoFetchIntervalMinutes === mins && <Check size={12} strokeWidth={3} />}
          </button>
        ))}
      </div>
    </section>
  );
}

interface ShortcutsSectionProps {
  rebindShortcut: (id: string, keys: string) => Promise<void> | void;
  resetShortcutsToDefaults: () => Promise<void> | void;
}

function ShortcutsSection({ rebindShortcut, resetShortcutsToDefaults }: ShortcutsSectionProps) {
  const t = useT();
  const shortcuts = useGitStore((s) => s.shortcuts);
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaults = useMemo(() => defaultShortcutsMap(), []);
  const merged: Record<string, string> = { ...defaults, ...(shortcuts ?? {}) };

  useEffect(() => {
    if (!editingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setEditingId(null);
        return;
      }
      const combo = eventToShortcut(e);
      if (!combo) return;
      rebindShortcut(editingId, combo);
      setEditingId(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingId, rebindShortcut]);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
          <Type size={12} /> {t('settings.shortcuts')}
        </h4>
        <button
          type="button"
          onClick={() => resetShortcutsToDefaults()}
          className="text-[length:var(--font-size-2xs)] uppercase tracking-wider font-bold text-text-secondary hover:text-secondary transition-colors"
        >
          {t('settings.shortcutsReset')}
        </button>
      </div>
      <p className="text-xs text-text-secondary mb-3">{t('settings.shortcutsDesc')}</p>
      <div className="bg-bg-base/70 border border-border-subtle/15 rounded divide-y divide-border-subtle/15 max-h-[280px] overflow-y-auto">
        {DEFAULT_SHORTCUTS.map((s) => {
          const current = merged[s.id];
          const isEditing = editingId === s.id;
          return (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="text-text-secondary">{t(s.descriptionKey)}</span>
              <button
                type="button"
                onClick={() => setEditingId(isEditing ? null : s.id)}
                className={cn(
                  'px-2 py-1 rounded font-mono text-[length:var(--font-size-2xs)] border transition-colors min-w-[100px] text-center',
                  isEditing
                    ? 'bg-secondary/15 border-secondary/50 text-secondary animate-pulse'
                    : 'bg-bg-base border-border-subtle/30 text-text-primary hover:border-secondary/40',
                )}
              >
                {isEditing ? t('settings.shortcutsCapture') : formatShortcut(current)}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface OsNotificationsSectionProps {
  setOsNotifications: (enabled: boolean) => Promise<void> | void;
}

function OsNotificationsSection({ setOsNotifications }: OsNotificationsSectionProps) {
  const t = useT();
  const osNotificationsEnabled = useGitStore((s) => s.osNotificationsEnabled);

  return (
    <section>
      <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
        <AlertCircle size={12} /> {t('settings.osNotifications')}
      </h4>
      <p className="text-xs text-text-secondary mb-3">{t('settings.osNotificationsDesc')}</p>
      <button
        type="button"
        onClick={() => setOsNotifications(!osNotificationsEnabled)}
        className={cn(
          'px-3 py-2 rounded border text-sm flex items-center gap-2 transition-colors',
          osNotificationsEnabled
            ? 'bg-secondary/15 border-secondary/50 text-secondary'
            : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
        )}
      >
        {osNotificationsEnabled && <Check size={14} strokeWidth={3} />}
        <span className="font-medium">
          {osNotificationsEnabled ? t('settings.osNotificationsEnabled') : t('settings.osNotificationsDisabled')}
        </span>
      </button>
    </section>
  );
}

const FONT_SIZE_OPTIONS: Array<{ key: FontSize; px: number }> = [
  { key: 'compact', px: 15 },
  { key: 'normal', px: 16 },
  { key: 'large', px: 17 },
];

export interface SettingsPanelProps {
  selectedSettingsSection: string;
  setSelectedSettingsSection: (section: string) => void;
  handleViewChange: (view: 'repository' | 'settings' | 'help' | 'profile') => void;

  language: Lang;
  changeLanguage: (lang: Lang) => void;

  fontSize: FontSize;
  changeFontSize: (size: FontSize) => void;

  defaultFolder: string | null;
  changeDefaultFolder: (folder: string | null) => void;
  pickDefaultFolder: () => Promise<void> | void;

  theme: string;
  changeTheme: (theme: 'light' | 'dark') => void;

  enableCronometric: boolean;
  changeEnableCronometric: (enabled: boolean) => void;

  enableCartography: boolean;
  changeEnableCartography: (enabled: boolean) => void;

  setAutoFetchPrefs: (enabled: boolean, intervalMinutes: number) => Promise<void> | void;
  setOsNotifications: (enabled: boolean) => Promise<void> | void;

  rebindShortcut: (id: string, keys: string) => Promise<void> | void;
  resetShortcutsToDefaults: () => Promise<void> | void;

  // Temporal Agent Settings callbacks:
  repoPath: string | null;
  repoName: string;
  onTemporalPrediction: (r: any) => void;
  onTemporalConfigSaved: (cfg: any) => void;

  // Updates logic:
  updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  updateInfo: { version: string; currentVersion: string; releaseDate?: string } | null;
  downloadProgress: number;
  changelogEntries: any[];
  changelogError: any;
  changelogRaw: any;
  handleDownloadUpdate: () => void;
  handleInstallUpdate: () => void;
  handleCheckForUpdate: () => void;
}

export function SettingsPanel({
  selectedSettingsSection,
  setSelectedSettingsSection,
  handleViewChange,
  language,
  changeLanguage,
  fontSize,
  changeFontSize,
  defaultFolder,
  changeDefaultFolder,
  pickDefaultFolder,
  theme,
  changeTheme,
  enableCronometric,
  changeEnableCronometric,
  enableCartography,
  changeEnableCartography,
  setAutoFetchPrefs,
  setOsNotifications,
  rebindShortcut,
  resetShortcutsToDefaults,
  repoPath,
  repoName,
  onTemporalPrediction,
  onTemporalConfigSaved,
  updateStatus,
  updateInfo,
  downloadProgress,
  changelogEntries,
  changelogError,
  changelogRaw,
  handleDownloadUpdate,
  handleInstallUpdate,
  handleCheckForUpdate,
}: SettingsPanelProps) {
  const t = useT();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-bg-base/40">
      <div className="border-b border-border-subtle/15 shrink-0">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Settings size={18} className="text-secondary shrink-0" />
            <h2 className="truncate text-[length:var(--font-size-lg)] font-bold text-text-primary">
              {selectedSettingsSection === 'language' && t('settings.language')}
              {selectedSettingsSection === 'fontSize' && t('settings.fontSize')}
              {selectedSettingsSection === 'defaultFolder' && t('settings.defaultFolder')}
              {selectedSettingsSection === 'theme' && t('settings.theme')}
              {selectedSettingsSection === 'cronometric' && 'Vista Cronométrica (Beta)'}
              {selectedSettingsSection === 'cartography' && t('settings.cartography')}
              {selectedSettingsSection === 'temporalAgent' && 'Temporal Agent (Experimental)'}
              {selectedSettingsSection === 'agentDashboard' && t('settings.agentDashboard')}
              {selectedSettingsSection === 'autoFetch' && t('settings.autoFetch')}
              {selectedSettingsSection === 'osNotifications' && t('settings.osNotifications')}
              {selectedSettingsSection === 'shortcuts' && t('settings.shortcuts')}
              {selectedSettingsSection === 'security' && t('settings.security')}
              {selectedSettingsSection === 'updates' && t('settings.checkUpdates')}
              {selectedSettingsSection === 'about' && t('settings.about')}
            </h2>
          </div>
          <button
            onClick={() => handleViewChange('repository')}
            className="shrink-0 text-text-secondary hover:text-text-primary px-3 py-1 border border-border-subtle/15 hover:border-secondary/20 rounded text-xs font-semibold tracking-wide transition-colors"
          >
            {t('common.backToRepo')}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto w-full select-text">
        <div className="mx-auto w-full max-w-4xl p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedSettingsSection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              {selectedSettingsSection === 'language' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">{t('settings.languageDesc')}</p>
                  <div className="flex gap-2">
                    {LANGS.map((l) => (
                      <button
                        key={l.code}
                        onClick={() => changeLanguage(l.code as Lang)}
                        className={cn(
                          'flex-1 px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors',
                          language === l.code
                            ? 'bg-secondary/15 border-secondary/50 text-secondary'
                            : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary hover:border-border-subtle/30',
                        )}
                      >
                        <span className="text-lg">{l.flag}</span>
                        <span className="font-semibold">{l.label}</span>
                        {language === l.code && <Check size={14} strokeWidth={3} className="ml-1" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedSettingsSection === 'fontSize' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">{t('settings.fontSizeDesc')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {FONT_SIZE_OPTIONS.map((option) => {
                      const labelKey = option.key === 'compact'
                        ? 'settings.fontCompact'
                        : option.key === 'normal'
                          ? 'settings.fontNormal'
                          : 'settings.fontLarge';
                      return (
                        <button
                          key={option.key}
                          onClick={() => changeFontSize(option.key)}
                          className={cn(
                            'px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors',
                            fontSize === option.key
                              ? 'bg-secondary/15 border-secondary/50 text-secondary'
                              : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary hover:border-border-subtle/30',
                          )}
                        >
                          <span className="font-semibold">{t(labelKey)}</span>
                          {fontSize === option.key && <Check size={14} strokeWidth={3} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedSettingsSection === 'defaultFolder' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">{t('settings.defaultFolderDesc')}</p>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex-1 px-4 py-2.5 rounded-lg border bg-bg-base/70 border-border-subtle/15 text-sm font-mono truncate"
                      title={defaultFolder ?? ''}
                    >
                      <span className={defaultFolder ? 'text-text-primary' : 'text-text-secondary/70'}>
                        {defaultFolder ?? t('settings.defaultFolderNone')}
                      </span>
                    </div>
                    <button
                      onClick={() => pickDefaultFolder()}
                      className="px-4 py-2.5 rounded-lg border bg-bg-base/70 border-border-subtle/30 text-sm text-text-primary hover:bg-border-subtle/30 transition-colors"
                    >
                      {t('settings.defaultFolderChange')}
                    </button>
                    {defaultFolder && (
                      <button
                        onClick={() => changeDefaultFolder(null)}
                        className="px-4 py-2.5 rounded-lg border bg-bg-base/70 border-border-subtle/15 text-sm text-text-secondary hover:text-error hover:border-error/30 transition-colors"
                      >
                        {t('settings.defaultFolderClear')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {selectedSettingsSection === 'theme' && (
                <div className="space-y-4">
                  <p className="text-xs text-text-secondary/70 mb-2 italic">{t('settings.themeLightWarning')}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => changeTheme('dark')}
                      className={cn(
                        'flex-1 px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors',
                        theme === 'dark'
                          ? 'bg-secondary/15 border-secondary/50 text-secondary'
                          : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {theme === 'dark' && <Check size={14} strokeWidth={3} />}
                      {t('settings.themeDark')}
                    </button>
                    <button
                      type="button"
                      onClick={() => changeTheme('light')}
                      className={cn(
                        'flex-1 px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors',
                        theme === 'light'
                          ? 'bg-secondary/15 border-secondary/50 text-secondary'
                          : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {theme === 'light' && <Check size={14} strokeWidth={3} />}
                      {t('settings.themeLight')}
                    </button>
                  </div>
                </div>
              )}

              {selectedSettingsSection === 'cronometric' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    Habilita la nueva línea de tiempo interactiva avanzada basada en Canvas espacial y HUD dinámico.
                  </p>
                  <button
                    type="button"
                    onClick={() => changeEnableCronometric(!enableCronometric)}
                    className={cn(
                      'w-full px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors font-semibold',
                      enableCronometric
                        ? 'bg-secondary/15 border-secondary/50 text-secondary'
                        : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {enableCronometric ? (
                      <>
                        <Check size={14} strokeWidth={3} />
                        Activa
                      </>
                    ) : (
                      'Inactiva (Usar vista clásica estable)'
                    )}
                  </button>
                </div>
              )}

              {selectedSettingsSection === 'cartography' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {t('settings.cartographyDesc')}
                  </p>
                  <button
                    type="button"
                    onClick={() => changeEnableCartography(!enableCartography)}
                    className={cn(
                      'w-full px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors font-semibold',
                      enableCartography
                        ? 'bg-secondary/15 border-secondary/50 text-secondary'
                        : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {enableCartography ? (
                      <>
                        <Check size={14} strokeWidth={3} />
                        {t('settings.cartographyActive')}
                      </>
                    ) : (
                      t('settings.cartographyInactive')
                    )}
                  </button>

                  {/* Capa de proveedor de IA (Fase 4): selector local/online,
                      opt-in e independiente del switch de la vista. */}
                  {enableCartography && (
                    <div className="border-t border-border-subtle/15 pt-4">
                      <CartoAISettings onNavigateToAiModels={() => setSelectedSettingsSection('aiModels')} />
                    </div>
                  )}
                </div>
              )}

              {selectedSettingsSection === 'autoFetch' && (
                <AutoFetchSection setAutoFetchPrefs={setAutoFetchPrefs} />
              )}

              {selectedSettingsSection === 'osNotifications' && (
                <OsNotificationsSection setOsNotifications={setOsNotifications} />
              )}

              {selectedSettingsSection === 'shortcuts' && (
                <ShortcutsSection
                  rebindShortcut={rebindShortcut}
                  resetShortcutsToDefaults={resetShortcutsToDefaults}
                />
              )}

              {selectedSettingsSection === 'security' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {t('settings.dataLocation')}
                  </p>
                  <button
                    onClick={() => window.api?.shellOpenPath('https://github.com/alejandropd-1/gitcron/blob/main/SECURITY.md')}
                    className="w-full text-left px-4 py-3 bg-bg-base/70 border border-border-subtle/15 hover:border-border-subtle/30 rounded-lg text-sm text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors"
                  >
                    <FileText size={14} />
                    {t('settings.viewSecurity')}
                  </button>
                </div>
              )}

              {selectedSettingsSection === 'updates' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">{t('settings.checkUpdatesDesc')}</p>
                  <div className="rounded-xl border border-border-subtle/15 bg-bg-base/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">
                          {updateInfo
                            ? t('update.availableTitle', { version: updateInfo.version })
                            : t('update.currentTitle')}
                        </p>
                        <p className="mt-0.5 text-xs text-text-secondary">
                          {updateInfo
                            ? t('update.currentVersion', { version: pkg.version })
                            : t('update.currentDesc')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {updateStatus === 'available' && (
                          <button
                            type="button"
                            onClick={handleDownloadUpdate}
                            className="px-4 py-2 rounded-lg border text-sm flex items-center gap-2 transition-colors bg-secondary/15 border-secondary/45 text-secondary hover:bg-secondary/25 font-bold"
                          >
                            <Download size={14} />
                            <span>{t('update.download')}</span>
                          </button>
                        )}
                        {updateStatus === 'downloaded' && (
                          <button
                            type="button"
                            onClick={handleInstallUpdate}
                            className="px-4 py-2 rounded-lg border text-sm font-extrabold transition-colors bg-secondary/15 border-secondary/45 text-secondary hover:bg-secondary/25"
                          >
                            UPDATE
                          </button>
                        )}
                        {(updateStatus === 'idle' || updateStatus === 'checking' || updateStatus === 'error') && (
                          <button
                            type="button"
                            onClick={handleCheckForUpdate}
                            disabled={updateStatus === 'checking'}
                            className="px-4 py-2 rounded-lg border text-sm flex items-center gap-2 transition-colors bg-bg-base border-border-subtle/15 text-text-secondary hover:border-secondary/40 hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                          >
                            {updateStatus === 'checking'
                              ? <Loader2 size={14} className="animate-spin" />
                              : <RotateCcw size={14} />
                            }
                            <span>{t('settings.checkUpdatesButton')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {updateStatus === 'downloading' && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-bg-overlay rounded-full overflow-hidden">
                          <div className="h-full bg-secondary rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                        </div>
                        <span className="text-[length:var(--font-size-xs)] font-mono text-secondary w-8 text-right">{downloadProgress}%</span>
                      </div>
                    )}
                  </div>
                  <ChangelogPreview
                    entries={changelogEntries}
                    error={changelogError}
                    isLoading={changelogRaw === null && changelogError === null}
                  />
                </div>
              )}

              {selectedSettingsSection === 'temporalAgent' && (
                <div className="space-y-4">
                  {repoPath ? (
                    <TemporalAgentSettings
                      repoPath={repoPath}
                      repoName={repoName}
                      onPrediction={onTemporalPrediction}
                      onConfigSaved={onTemporalConfigSaved}
                      onNavigateToAiModels={() => setSelectedSettingsSection('aiModels')}
                    />
                  ) : (
                    <p className="text-sm text-text-secondary">
                      Abrí un repositorio para configurar el Temporal Agent.
                    </p>
                  )}
                </div>
              )}

              {selectedSettingsSection === 'aiModels' && (
                <div className="space-y-4">
                  <AiSettingsSection repoPath={repoPath} />
                </div>
              )}

              {selectedSettingsSection === 'agentDashboard' && (
                <div className="space-y-4">
                  <AgentDashboard
                    repoPath={repoPath}
                    repoName={repoName}
                  />
                </div>
              )}

              {selectedSettingsSection === 'about' && (
                <div className="space-y-4">
                  <div className="bg-bg-base/70 border border-border-subtle/15 rounded-xl p-4 text-sm space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-border-subtle/15">
                      <span className="text-text-secondary font-semibold">GitCron</span>
                      <span className="text-secondary font-mono font-bold">v{pkg.version}</span>
                    </div>
                    <div className="flex justify-between text-xs text-text-secondary/70">
                      <span>Electron + Next.js + simple-git</span>
                    </div>
                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => window.api.shellOpenExternal('https://github.com/alejandropd-1/gitcron/releases/')}
                        className="flex items-center gap-2 text-text-secondary hover:text-secondary transition-colors text-left font-semibold"
                      >
                        <Github size={14} />
                        <span>{t('settings.viewReleases')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => window.api.shellOpenExternal('https://aledesign.dev/')}
                        className="flex items-center gap-2 text-text-secondary/70 hover:text-secondary transition-colors text-left text-xs font-semibold"
                      >
                        <Sparkles size={13} />
                        <span>{t('settings.developedBy')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
