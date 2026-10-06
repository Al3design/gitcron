// Perfil aislado (electron/profile.ts): las pruebas que usan la app de verdad no pueden tocar los
// datos de quien las corre.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const setPath = vi.fn();
vi.mock('electron', () => ({ app: { setPath: (...args: unknown[]) => setPath(...args) } }));

const { applyProfile, resolveProfile } = await import('../profile');

const HOME = path.resolve(os.tmpdir(), 'casa-de-ale');

describe('perfil aislado', () => {
  const made: string[] = [];
  afterEach(() => {
    setPath.mockClear();
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sin GITCRON_PROFILE_DIR no hay perfil', () => {
    expect(resolveProfile({}, HOME)).toBeNull();
    expect(resolveProfile({ GITCRON_PROFILE_DIR: '  ' }, HOME)).toBeNull();
  });

  it('una ruta relativa se rechaza', () => {
    expect(() => resolveProfile({ GITCRON_PROFILE_DIR: 'perfil' }, HOME)).toThrow(/absoluta/);
  });

  it('la carpeta de usuario real, o una que la contenga, se rechaza', () => {
    expect(() => resolveProfile({ GITCRON_PROFILE_DIR: HOME }, HOME)).toThrow(/carpeta de usuario/);
    expect(() => resolveProfile({ GITCRON_PROFILE_DIR: path.dirname(HOME) }, HOME)).toThrow(/carpeta de usuario/);
  });

  it('datos y carpeta de usuario salen del perfil, también para los programas que se lanzan', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-perfil-'));
    made.push(root);
    const profile = resolveProfile({ GITCRON_PROFILE_DIR: root }, HOME)!;
    const env: Record<string, string | undefined> = { HOME, USERPROFILE: HOME, APPDATA: 'x', LOCALAPPDATA: 'y' };

    applyProfile(profile, env);

    expect(setPath).toHaveBeenCalledWith('userData', path.join(root, 'userData'));
    expect(setPath).toHaveBeenCalledWith('home', path.join(root, 'home'));
    expect(env.HOME).toBe(path.join(root, 'home'));
    expect(env.USERPROFILE).toBe(path.join(root, 'home'));
    expect(env.APPDATA).toBe(path.join(root, 'home', 'AppData', 'Roaming'));
    expect(env.LOCALAPPDATA).toBe(path.join(root, 'home', 'AppData', 'Local'));
    expect(fs.existsSync(path.join(root, 'userData'))).toBe(true);
    expect(fs.existsSync(env.APPDATA!)).toBe(true);
  });
});
