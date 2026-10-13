// electron/main.ts
// Proceso main de Electron: ciclo de vida de la app, splash, ventana principal,
// protocolo app:// y registro de los handlers IPC (ver electron/ipc/*).

// Primero de todo: con GITCRON_PROFILE_DIR, las rutas de la persona salen del perfil de prueba
// (ver electron/profile.ts). Tiene que cargarse antes que cualquier módulo que pida una ruta.
import './profile';
import { app, BrowserWindow, Menu, protocol, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { registerTemporalAgentHandlers } from './temporal-agent-ipc';
import { bootstrapDatabase, getDatabase, temporalAgentDatabasePath } from './db/connection';
import { sanitizeForLog } from './ipc/shared';
import { registerStorageHandlers } from './ipc/storage';
import { registerAiHandlers } from './ipc/ai';
import { registerGitHubHandlers } from './ipc/github';
import { registerGitRepoHandlers } from './ipc/git-repo';
import { registerGitOpsHandlers } from './ipc/git-ops';
import { registerGitSyncHandlers } from './ipc/git-sync';
import { registerShellHandlers } from './ipc/shell';
import { registerCartoHandlers } from './ipc/carto';
import { registerCartoGraphHandlers } from './ipc/carto-graph';
import { registerCartoAiHandlers } from './ipc/carto-ai';
import { registerCommitMessageAiHandlers } from './ipc/commit-message-ai';
import { readLegacySources, registerAiUseHandlers } from './ipc/ai-use';
import { registerAiConfigHandlers } from './ipc/ai-config';
import { registerAiUseHistoryHandlers } from './ipc/ai-use-history';
import { registerAssistConversationHandlers } from './ipc/assist-conversations';
import { migrateGitCronConfigIfMissing } from './ai/config/gitcron-config-migration';
import { getDefaultConfigPath } from './ai/config/gitcron-config';
import { initModelCatalogLifecycle } from './ai/config/model-catalog';
import { activeConfigPath } from './ai/use-resolution';
import { getStoredEnvVar } from './ai/key-store';
import { closeAllGraphs } from './carto/graph-engine';
import { registerWatcherHandlers, closeAllRepoWatchers } from './ipc/watchers';
import { authorizedRepoStore } from './ipc/authorized-repos';
import { registerPipelineHandlers } from './ipc/pipeline';
import { PipelineControlBus } from './pipeline/control/control-bus';
import { registerPipelineControlHandlers } from './ipc/pipeline-control';
import { registerPipelineArchiveHandlers } from './ipc/pipeline-archive';
import { registerPipelineSyncHandlers } from './ipc/pipeline-sync';
import { registerPipelineTaskHandlers } from './ipc/pipeline-tasks';
import { registerPipelineSpecHandlers } from './ipc/pipeline-specs';
import { registerOpenSpecIpcHandlers } from './ipc/pipeline-openspec';
import { registerPipelineRuntimeHandlers } from './ipc/pipeline-runtime';
import { RuntimeSessionHub } from './pipeline/runtime/runtime-session-hub';
import { PipelineRepository } from './pipeline/pipeline-repository';
import { DefaultRuntimeSessionEvidenceCollector } from './pipeline/runtime/runtime-session-evidence';
import {
  registerAppWindowHandlers, setupAutoUpdater,
  silentCheckForUpdates, stopUpdateCheckTimer,
} from './ipc/app-window';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
const getMainWindow = () => mainWindow;

function createSplash(): BrowserWindow {
  const publicDir = path.join(__dirname, '../../public');
  const resourcesDir = isDev ? publicDir : process.resourcesPath;
  const iconPath = path.join(resourcesDir, 'gitcron-icon.png');
  const iconUrl = fs.existsSync(iconPath)
    ? pathToFileURL(iconPath).toString()
    : '';

  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background:radial-gradient(circle at 50% 22%, #173557 0%, #06192d 38%, #020f1e 100%);
  border:1px solid #3c495a55; border-radius:18px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  height:100vh; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  color:#d9e7fc; overflow:hidden; -webkit-app-region:drag;
  box-shadow:0 26px 80px rgba(0,0,0,.45);
}
.stage { position:relative; width:150px; height:118px; display:flex; align-items:center; justify-content:center; }
.tile {
  position:absolute; width:16px; height:16px; border-radius:4px;
  background:linear-gradient(135deg, rgba(163,241,133,.95), rgba(94,216,255,.72));
  box-shadow:0 0 18px rgba(163,241,133,.28);
  opacity:.18; animation:tilePulse 1.6s ease-in-out infinite;
}
.tile:nth-child(1){ left:14px; top:18px; animation-delay:0s; }
.tile:nth-child(2){ right:22px; top:10px; width:12px; height:12px; animation-delay:.15s; }
.tile:nth-child(3){ left:34px; bottom:18px; width:10px; height:10px; animation-delay:.3s; }
.tile:nth-child(4){ right:12px; bottom:28px; animation-delay:.45s; }
.tile:nth-child(5){ left:8px; top:66px; width:9px; height:9px; animation-delay:.6s; }
.tile:nth-child(6){ right:48px; bottom:8px; width:11px; height:11px; animation-delay:.75s; }
.tile:nth-child(7){ left:60px; top:2px; width:8px; height:8px; animation-delay:.9s; }
.tile:nth-child(8){ right:68px; top:74px; width:9px; height:9px; animation-delay:1.05s; }
.mark {
  width:70px; height:70px; border-radius:16px;
  display:flex; align-items:center; justify-content:center;
  background:rgba(2,15,30,.42); border:1px solid rgba(163,241,133,.32);
  box-shadow:0 18px 42px rgba(0,0,0,.28), 0 0 34px rgba(163,241,133,.18);
  position:relative; z-index:2; overflow:hidden;
}
.mark::after {
  content:""; position:absolute; inset:-40%; transform:rotate(20deg);
  background:linear-gradient(90deg, transparent, rgba(255,255,255,.14), transparent);
  animation:sheen 2.2s ease-in-out infinite;
}
.icon { width:52px; height:52px; border-radius:12px; object-fit:cover; position:relative; z-index:1; }
.fallback { font-size:38px; font-weight:900; color:#a3f185; position:relative; z-index:1; }
.logo { font-size:34px; font-weight:800; color:#a3f185; letter-spacing:0; margin-top:2px; }
.sub  { font-size:12px; color:#9eacc0; margin-top:6px; letter-spacing:0.5px; }
.bar  { width:200px; height:3px; background:#172d45; border-radius:4px; margin-top:28px; overflow:hidden; }
.fill {
  height:100%; background:linear-gradient(90deg,#a3f185,#68b24f);
  border-radius:4px; animation:load 1.4s ease-in-out infinite;
}
@keyframes load { 0%{width:0%; transform:translateX(-18px)} 55%{width:100%; transform:translateX(0)} 100%{width:100%; transform:translateX(18px)} }
@keyframes tilePulse { 0%,100%{ opacity:.12; transform:translateY(4px) scale(.74); } 45%{ opacity:.78; transform:translateY(0) scale(1); } }
@keyframes sheen { 0%,35%{ transform:translateX(-70%) rotate(20deg); opacity:0; } 55%{ opacity:1; } 80%,100%{ transform:translateX(70%) rotate(20deg); opacity:0; } }
</style></head>
<body>
  <div class="stage">
    <span class="tile"></span><span class="tile"></span><span class="tile"></span><span class="tile"></span>
    <span class="tile"></span><span class="tile"></span><span class="tile"></span><span class="tile"></span>
    <div class="mark">
      ${iconUrl ? `<img class="icon" src="${iconUrl}" alt="GitCron">` : '<div class="fallback">G</div>'}
    </div>
  </div>
  <div class="logo">GitCron</div>
  <div class="sub">Advanced Git Client</div>
  <div class="bar"><div class="fill"></div></div>
</body></html>`;

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return splash;
}

function createWindow() {
  // Remove the default native menu bar (File / Edit / View / Window).
  // GitCron uses a custom in-app topbar for all actions.
  // On macOS we keep a minimal menu so Cmd+Q and system clipboard shortcuts work.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // Resolve the app icon.
  const publicDir = path.join(__dirname, '../../public');
  const resourcesDir = isDev ? publicDir : process.resourcesPath;
  const icoPath = path.join(resourcesDir, 'favicon.ico');
  const pngPath = path.join(resourcesDir, 'gitcron-icon.png');
  const iconPath = fs.existsSync(icoPath) ? icoPath : pngPath;
  const iconExists = fs.existsSync(iconPath);

  // Show splash while the renderer loads.
  const splashStartedAt = Date.now();
  const splash = createSplash();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    backgroundColor: '#020f1e',
    show: false,        // hidden until ready-to-show
    ...(iconExists ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // sandbox: true removed — it prevents contextBridge.exposeInMainWorld
      // from working correctly in ASAR-packaged builds (window.api stays undefined).
      // contextIsolation + nodeIntegration:false is the canonical Electron security model.
      webSecurity: true,
    },
  });

  const port = process.env.PORT || '3001';
  const url = isDev
    ? `http://localhost:${port}`
    : 'app://./index.html';   // served via custom protocol registered in app.on('ready')

  // ── Navigation hardening ────────────────────────────────────────────
  // Defense-in-depth: even with contextIsolation + a strict CSP, a renderer
  // compromise (or a stray <a target="_blank">) must never be able to steer
  // the app window to a foreign origin or spawn an arbitrary popup. We pin the
  // window to its own origin and route every external link through the OS
  // browser via the already-validated shell:open-external path.
  const isInternalUrl = (target: string): boolean => {
    if (isDev) return target.startsWith(`http://localhost:${port}`);
    return target.startsWith('app://');
  };

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) {
      void shell.openExternal(target);
    }
    return { action: 'deny' };
  });

  const blockForeignNavigation = (event: Electron.Event, target: string) => {
    if (!isInternalUrl(target)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  };
  mainWindow.webContents.on('will-navigate', blockForeignNavigation);
  mainWindow.webContents.on('will-redirect', blockForeignNavigation);

  if (isDev) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const label = level >= 2 ? 'error' : level === 1 ? 'warn' : 'log';
      console[label](`[renderer:${label}] ${sourceId}:${line} ${message}`);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer:gone]', details);
    });
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('[renderer:preload-error]', preloadPath, sanitizeForLog(error));
    });
  }

  mainWindow.loadURL(url);

  // Avisar al renderer cada vez que la ventana cambia de estado.
  //
  // El botón de maximizar mostraba un ícono fijo porque sólo conocía el
  // resultado de su propio clic. La ventana también se maximiza y se restaura
  // por fuera del botón —doble clic en la barra de título, `Win`+flechas,
  // arrastrarla contra un borde—, y sin estos eventos el ícono quedaba
  // afirmando un estado que ya no era cierto.
  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);

  // Close splash and show main window maximized once ready. Keep the splash
  // visible for a short minimum so startup never flashes through partial UI.
  mainWindow.once('ready-to-show', () => {
    const showMainWindow = () => {
      if (!mainWindow) return;
      if (!splash.isDestroyed()) splash.destroy();
      mainWindow.maximize();
      mainWindow.show();
      // Silent update check 3 s after the app is visible (not in dev).
      if (!isDev) {
        setTimeout(() => silentCheckForUpdates(), 3000);
      }
    };
    const remainingSplashMs = Math.max(0, 1000 - (Date.now() - splashStartedAt));
    setTimeout(showMainWindow, remainingSplashMs);
  });

  // DevTools toggle in dev only: Ctrl+Shift+I (Win/Linux) or Cmd+Option+I (macOS).
  if (isDev) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      const trigger = process.platform === 'darwin'
        ? input.meta && input.alt && input.key === 'I'
        : input.control && input.shift && input.key === 'I';
      if (trigger) mainWindow?.webContents.toggleDevTools();
    });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function bootstrapTemporalAgentHistoryDatabase(): void {
  try {
    bootstrapDatabase(temporalAgentDatabasePath(app.getPath('userData')));
  } catch (error) {
    console.error('[temporal-agent-db] bootstrap error:', sanitizeForLog(error));
  }
}

// ── IPC handler registration ──────────────────────────────────────────
// Each module owns one domain. Registration happens at startup, before the
// renderer loads, so every channel is available from the first invoke.
registerTemporalAgentHandlers();   // Temporal Agent: per-repo config/notes storage (no secrets, no network).
registerStorageHandlers();         // storage:* (safeStorage-encrypted key/value)
registerAiHandlers();              // ai:* + git:materialize-idea
registerGitHubHandlers();          // github:* (Octokit + OAuth device flow)
registerGitRepoHandlers();         // git:open/init/clone + fs:pick-folder/exists
registerGitOpsHandlers();          // git:* local operations
registerGitSyncHandlers();         // git push/pull/fetch (network)
registerShellHandlers();           // shell:* + terminal:open + fs:delete-file
registerCartoHandlers();           // carto:* handlers generales (sin canales activos en Fase 10)
registerCartoGraphHandlers(getMainWindow); // carto:graph-* (CodeGraph embebido, local, solo lectura)
registerCartoAiHandlers();         // carto:ai-* (proveedor de IA local/online; opt-in; secretos sólo en main)
registerCommitMessageAiHandlers(); // commit-ai:* (redactar el asunto del commit con un modelo local; nunca solo)
registerAiUseHandlers();           // ai-use:* (qué modelo usa cada uso de texto según gitcron.json; «usar lo que tenías»)
registerAiConfigHandlers();        // ai-config:* (ajustes de motores y modelos de IA, tarea 6.1)
registerAiUseHistoryHandlers();    // ai-use-history:* (historial de usos de IA por repositorio, D19)
registerAssistConversationHandlers(); // assist-conversation:* (conversaciones con la IA por repositorio, retomar 2.2)
const notifyPipelineRepoChanged = registerPipelineHandlers(getMainWindow); // pipeline:* read-only
const pipelineControlBus = new PipelineControlBus();
registerPipelineControlHandlers(pipelineControlBus); // pipeline:control:*
const pipelineRuntimeHistory = {
  persistRuntimeProjection(projection: Parameters<PipelineRepository['persistRuntimeProjection']>[0]) {
    new PipelineRepository(getDatabase(app.getPath('userData'))).persistRuntimeProjection(projection);
  },
  loadRuntimeProjections(repoId: string, limit?: number) {
    return new PipelineRepository(getDatabase(app.getPath('userData'))).loadRuntimeProjections(repoId, limit);
  },
};
// Sesiones de runtime vivas (F03 → F04). Es la única superficie de Pipeline que
// puede abrir procesos, por eso va en su propio módulo de canales.
const pipelineRuntimeHub = new RuntimeSessionHub(
  pipelineControlBus,
  (repoPath) => {
    getMainWindow()?.webContents.send('pipeline:runtime:updated', {
      repoPath,
      projection: pipelineRuntimeHub.get(repoPath),
    });
  },
  undefined,
  undefined,
  pipelineRuntimeHistory,
  new DefaultRuntimeSessionEvidenceCollector(),
);
registerPipelineRuntimeHandlers(pipelineRuntimeHub); // pipeline:runtime:*
registerPipelineArchiveHandlers(getMainWindow);  // pipeline:archive-change (escribe: fuera del módulo read-only)
registerPipelineSyncHandlers(getMainWindow);     // pipeline:sync-preview, pipeline:sync-execute (Alternativa B)
registerPipelineTaskHandlers();    // pipeline:set-task-checked, add-task, edit-task, move-task, remove-task (autoría y estado)
registerPipelineSpecHandlers();    // pipeline:read-specification (sólo lee; fuera del snapshot por peso)
registerOpenSpecIpcHandlers({ getUserDataDir: () => app.getPath('userData') }); // pipeline:openspec:* (sólo diagnóstico y lectura)
registerWatcherHandlers(getMainWindow, notifyPipelineRepoChanged);          // repo:watch/unwatch
registerAppWindowHandlers(getMainWindow, isDev); // app:* + window:*

// Single-instance lock: if a second instance is launched (e.g. user
// double-clicks the icon while the app is already open), focus the
// existing window and quit the new instance immediately.
// Register a custom 'app://' protocol so that Next.js absolute asset paths
// (/_next/static/...) resolve correctly when the app is loaded from the
// filesystem. Without this, file:// treats them as root-relative and they 404.
// Must be called before app is ready.
if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } },
  ]);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  /**
   * Primer arranque sin gitcron.json: se crea con lo que GitCron ya usa (D10, tarea
   * 3.7). Si existe, no se toca. Un fallo no impide abrir la app: se registra y se
   * sigue, como hasta ahora, sin el archivo.
   */
  function migrateGitCronConfigOnStartup(): void {
    try {
      const result = migrateGitCronConfigIfMissing({
        configPath: getDefaultConfigPath(),
        readSources: readLegacySources,
      });
      if (result.created) console.info('[gitcron-config] creado', result.path);
    } catch (error) {
      console.warn('[gitcron-config] no se pudo crear el archivo inicial:', error instanceof Error ? error.message : error);
    }
  }

  void app.whenReady().then(() => {
    // Register the 'app://' protocol to serve the Next.js static export.
    // app://./index.html → out/index.html
    // app://./_next/static/... → out/_next/static/...
    if (!isDev) {
      const outDir = path.resolve(path.join(__dirname, '../out'));
      const indexHtml = path.join(outDir, 'index.html');
      protocol.handle('app', (request) => {
        const url = request.url.replace('app://.', '');
        const clean = decodeURIComponent(url.split('?')[0]);
        const candidate = path.resolve(path.join(outDir, clean));
        // Containment: never serve a file resolved outside out/ (blocks `../`
        // traversal from a compromised renderer). Anything escaping the export
        // root, or any non-file path, falls back to the SPA entry point.
        const rel = path.relative(outDir, candidate);
        const inside = candidate === outDir
          || (!rel.startsWith('..') && !path.isAbsolute(rel));
        const resolved = inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
          ? candidate
          : indexHtml;
        return net.fetch(pathToFileURL(resolved).toString());
      });
    }
    bootstrapTemporalAgentHistoryDatabase();
    migrateGitCronConfigOnStartup();
    initModelCatalogLifecycle(() => ({
      configPath: activeConfigPath(),
      stored: getStoredEnvVar,
    }));
    createWindow();
    if (!isDev) setupAutoUpdater(getMainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}

app.on('before-quit', async () => {
  stopUpdateCheckTimer();
  await closeAllRepoWatchers();
  closeAllGraphs();
  authorizedRepoStore.clear();
  // Cerrar el hub antes de salir: un proceso de runtime que sobreviva a la app
  // sigue escribiendo en el working tree sin nadie mirando.
  await pipelineRuntimeHub.disposeAll();
});
