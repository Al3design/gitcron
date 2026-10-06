// electron/profile.ts
//
// Perfil aislado: con `GITCRON_PROFILE_DIR=<carpeta absoluta>`, GitCron arranca con todo lo
// de la persona sacado de esa carpeta y no de la cuenta de Windows. Sirve para las pruebas que
// usan la app de verdad (openspec/investigaciones/2026-10-06-e2e-sobre-gitcron.md): una prueba
// no puede tocar el `gitcron.json`, el baúl de claves, los repositorios abiertos ni la base de
// datos de quien la corre.
//
// - `userData` (baúl, ajustes, repositorios autorizados, base de datos, cachés) va a
//   `<perfil>/userData`. El candado de instancia única vive ahí, así que un GitCron de prueba
//   convive con el de todos los días.
// - La carpeta de usuario va a `<perfil>/home`: `~/.config/gitcron` (`gitcron.json`, `mcp.json`),
//   las configuraciones que se importan (OpenCode, Cursor, LM Studio) y lo que ven los programas
//   que GitCron lanza (Git, Codex, OpenCode), que heredan `HOME`/`USERPROFILE`/`APPDATA`.
//
// Tiene que ser lo primero que importa `main.ts`: corre al cargarse el módulo, antes de que
// otro módulo pida una ruta o se pida el candado de instancia única.

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface GitCronProfile {
  root: string;
  userData: string;
  home: string;
}

/** Lee el perfil de la variable de entorno; `null` si no hay. Rechaza una ruta relativa o la carpeta de usuario real. */
export function resolveProfile(env: Readonly<Record<string, string | undefined>>, realHome: string): GitCronProfile | null {
  const raw = env.GITCRON_PROFILE_DIR?.trim();
  if (!raw) return null;
  if (!path.isAbsolute(raw)) {
    throw new Error(`GITCRON_PROFILE_DIR tiene que ser una ruta absoluta: ${raw}`);
  }
  const root = path.resolve(raw);
  const home = path.resolve(realHome);
  // El perfil reemplaza la carpeta de usuario: si fuera ella (o la contuviera), «aislado» sería
  // la configuración real.
  if (root === home || home.startsWith(root + path.sep)) {
    throw new Error(`GITCRON_PROFILE_DIR no puede ser la carpeta de usuario ni contenerla: ${root}`);
  }
  return { root, userData: path.join(root, 'userData'), home: path.join(root, 'home') };
}

/** Apunta Electron y el entorno del proceso al perfil. */
export function applyProfile(profile: GitCronProfile, env: Record<string, string | undefined>): void {
  const roaming = path.join(profile.home, 'AppData', 'Roaming');
  const local = path.join(profile.home, 'AppData', 'Local');
  for (const dir of [profile.userData, profile.home, roaming, local]) fs.mkdirSync(dir, { recursive: true });

  app.setPath('userData', profile.userData);
  app.setPath('home', profile.home);
  // `os.homedir()` lee `USERPROFILE` en Windows y `HOME` en el resto; los programas que se
  // lanzan heredan las cuatro.
  env.HOME = profile.home;
  env.USERPROFILE = profile.home;
  env.APPDATA = roaming;
  env.LOCALAPPDATA = local;
}

const profile = resolveProfile(process.env, os.homedir());
if (profile) {
  applyProfile(profile, process.env);
  console.log(`[perfil] GitCron con perfil aislado en ${profile.root}`);
}

export const activeProfile: GitCronProfile | null = profile;
