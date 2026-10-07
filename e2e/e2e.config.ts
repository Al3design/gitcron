import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import path from 'path';
import { fileURLToPath } from 'url';
import { gitcronProvider } from './gitcron-provider';
import { seedResumeFixture } from './resume-fixture';

const CONFIG_DIR = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const GITCRON_DIR = path.resolve(CONFIG_DIR, '..');
const NEXT_BIN = path.join(GITCRON_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

export default {
  targets: [
    {
      name: 'gitcron',
      engine: web({
        browser: gitcronProvider({ afterSeed: seedResumeFixture }),
        viewport: null,
        // El indicador de Next.js en modo desarrollo («N», abajo a la izquierda) tapa el botón
        // de Configuración y se lleva los clics: en las pruebas no se muestra.
        initScripts: [
          () => {
            // Hoja adoptada: React no la toca al hidratar el <html> (un <style> agregado sí se va).
            const sheet = new CSSStyleSheet();
            sheet.replaceSync('nextjs-portal { display: none !important; pointer-events: none !important; }');
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
          },
        ],
      }),
      app: {
        url: 'http://localhost:3001',
        // La pantalla en modo desarrollo; si ya hay una corriendo (la de Ale), se usa ésa.
        command: {
          executable: process.execPath,
          args: [NEXT_BIN, 'dev', '-p', '3001'],
          cwd: GITCRON_DIR,
          env: {
            PATH: process.env.PATH ?? '',
            SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
            APPDATA: process.env.APPDATA ?? '',
            LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
            USERPROFILE: process.env.USERPROFILE ?? '',
            NEXT_TELEMETRY_DISABLED: '1',
          },
          startupTimeout: 180_000,
          reuseExisting: true,
          log: '.e2e/next-dev.log',
        },
      },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
