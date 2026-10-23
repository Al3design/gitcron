import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { detectStartCommand } from '../start-command';

describe('detectStartCommand', () => {
  const root = path.resolve('/mock/project');

  it('devuelve no-package si package.json no existe o no es JSON válido', async () => {
    const resNoFile = await detectStartCommand(root, {
      readFile: async () => null,
      exists: async () => false,
    });
    expect(resNoFile).toEqual({ unsupported: 'no-package' });

    const resInvalid = await detectStartCommand(root, {
      readFile: async () => '{ invalid-json',
      exists: async () => false,
    });
    expect(resInvalid).toEqual({ unsupported: 'no-package' });
  });

  it('detecta Next si está en dependencies y el binario existe', async () => {
    const pkg = JSON.stringify({
      dependencies: { next: '^15.0.0' },
      scripts: { dev: 'next dev -p 3001' },
    });
    const res = await detectStartCommand(root, {
      readFile: async (rel) => (rel === 'package.json' ? pkg : null),
      exists: async (rel) => rel === 'node_modules/.bin/next',
    });

    expect(res).toEqual({
      executable: path.join(root, 'node_modules', '.bin', 'next'),
      args: ['dev', '-p', '{port}'],
      portViaEnv: false,
      display: 'next dev -p <puerto libre>',
      knownPorts: [3001],
    });
  });

  it('devuelve not-installed si Next está en dependencias pero falta node_modules/.bin/next', async () => {
    const pkg = JSON.stringify({
      devDependencies: { next: '^15.0.0' },
    });
    const res = await detectStartCommand(root, {
      readFile: async (rel) => (rel === 'package.json' ? pkg : null),
      exists: async () => false,
    });

    expect(res).toEqual({ unsupported: 'not-installed' });
  });

  it('detecta Vite con argumentos y strictPort', async () => {
    const pkg = JSON.stringify({
      devDependencies: { vite: '^5.0.0' },
    });
    const res = await detectStartCommand(root, {
      readFile: async (rel) => (rel === 'package.json' ? pkg : null),
      exists: async (rel) => rel === 'node_modules/.bin/vite',
    });

    expect(res).toEqual({
      executable: path.join(root, 'node_modules', '.bin', 'vite'),
      args: ['--port', '{port}', '--strictPort'],
      portViaEnv: false,
      display: 'vite --port <puerto libre>',
      knownPorts: [],
    });
  });

  it('detecta script dev con pnpm por pnpm-lock.yaml', async () => {
    const pkg = JSON.stringify({
      scripts: { dev: 'custom-dev-server' },
    });
    const res = await detectStartCommand(root, {
      readFile: async (rel) => (rel === 'package.json' ? pkg : null),
      exists: async (rel) => rel === 'pnpm-lock.yaml',
    });

    expect(res).toEqual({
      executable: 'pnpm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'pnpm run dev (custom-dev-server)',
      knownPorts: [],
    });
  });

  it('detecta script start con npm si no hay lockfile de pnpm/yarn/bun', async () => {
    const pkg = JSON.stringify({
      scripts: { start: 'node server.js' },
    });
    const res = await detectStartCommand(root, {
      readFile: async (rel) => (rel === 'package.json' ? pkg : null),
      exists: async () => false,
    });

    expect(res).toEqual({
      executable: 'npm',
      args: ['run', 'start'],
      portViaEnv: true,
      display: 'npm run start (node server.js)',
      knownPorts: [],
    });
  });

  it('devuelve no-start-command si no hay dependencias conocidas ni scripts dev/start', async () => {
    const pkg = JSON.stringify({
      name: 'simple-library',
      scripts: { test: 'vitest' },
    });
    const res = await detectStartCommand(root, {
      readFile: async (rel) => (rel === 'package.json' ? pkg : null),
      exists: async () => false,
    });

    expect(res).toEqual({ unsupported: 'no-start-command' });
  });
});
