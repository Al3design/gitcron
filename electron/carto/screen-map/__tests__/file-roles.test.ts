import { describe, expect, it } from 'vitest';
import { roleOf } from '../file-roles';

describe('file-roles', () => {
  it('identifica estilo (.css / .scss)', () => {
    expect(roleOf('components/button.module.css')).toBe('style');
    expect(roleOf('styles/theme.scss')).toBe('style');
  });

  it('identifica textos (i18n, locales o json de textos)', () => {
    expect(roleOf('locales/es.json')).toBe('text');
    expect(roleOf('i18n/strings.ts')).toBe('text');
    expect(roleOf('content/messages.json')).toBe('text');
  });

  it('identifica datos (db, store, *-store.ts, models, schema)', () => {
    expect(roleOf('lib/assist/assist-dock-store.ts')).toBe('data');
    expect(roleOf('db/connection.ts')).toBe('data');
    expect(roleOf('models/user.ts')).toBe('data');
    expect(roleOf('schema/pipeline.ts')).toBe('data');
    expect(roleOf('store/repo-store.ts')).toBe('data');
  });

  it('identifica lógica (lib, hooks, utils, services)', () => {
    expect(roleOf('lib/utils.ts')).toBe('logic');
    expect(roleOf('hooks/use-translation.ts')).toBe('logic');
    expect(roleOf('utils/formatting.ts')).toBe('logic');
    expect(roleOf('services/git-client.ts')).toBe('logic');
  });

  it('identifica componente (.tsx / .jsx)', () => {
    expect(roleOf('components/CommitGraph.tsx')).toBe('component');
    expect(roleOf('views/Sidebar.jsx')).toBe('component');
  });

  it('identifica otros archivos (documentación, binarios, scripts de build)', () => {
    expect(roleOf('README.md')).toBe('other');
    expect(roleOf('public/logo.png')).toBe('other');
    expect(roleOf('package.json')).toBe('text'); // .json se clasifica como texto
    expect(roleOf('scripts/build.mjs')).toBe('other');
  });
});
