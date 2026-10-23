// electron/carto/screen-capture/capture-page.ts
//
// Captura segura de páginas en una ventana oculta y aislada de Electron (decisión 11).

import { BrowserWindow, session } from 'electron';

let partitionPermissionConfigured = false;

function ensurePartitionSession(): void {
  if (partitionPermissionConfigured) return;
  const ses = session.fromPartition('carto-capture');
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  partitionPermissionConfigured = true;
}

export async function captureUrl(
  url: string,
  options: { allowedOrigin: string; timeoutMs?: number; settleMs?: number },
): Promise<Buffer> {
  ensurePartitionSession();

  const timeoutMs = options.timeoutMs ?? 30_000;
  const settleMs = options.settleMs ?? 1500;

  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'carto-capture',
      backgroundThrottling: false,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const checkOrigin = (event: Electron.Event, targetUrl: string) => {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.origin !== options.allowedOrigin) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  };

  win.webContents.on('will-navigate', checkOrigin);
  win.webContents.on('will-redirect', checkOrigin);

  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    // El temporizador se limpia al cargar: si quedara vivo, su rechazo llegaría después sin nadie
    // que lo atienda (rechazo no manejado en el proceso principal).
    await Promise.race([
      win.loadURL(url),
      new Promise<never>((_, reject) => {
        loadTimer = setTimeout(() => reject(new Error(`Tiempo de espera agotado al cargar ${url}`)), timeoutMs);
      }),
    ]);
    if (loadTimer) clearTimeout(loadTimer);

    if (settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    const nativeImg = await win.webContents.capturePage();
    const resized = nativeImg.resize({ width: 960 });
    return resized.toJPEG(75);
  } finally {
    if (loadTimer) clearTimeout(loadTimer);
    try {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    } catch {
      // Ignorar si la ventana ya fue destruida
    }
  }
}
