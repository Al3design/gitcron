import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_ALIASES,
  getClaudeCodeModels,
  parseAgyModels,
  parseCodexModels,
} from '../config/tool-models';
import {
  buildAntigravityTextArgs,
  buildClaudeTextArgs,
  buildCliTextCommand,
  buildCodexTextArgs,
  CLI_EFFORT_LEVELS,
  describeCliTextCommand,
  isValidCliEffort,
} from '../cli-text-client';

const FIXTURES_DIR = path.resolve(__dirname, '../../__tests__/fixtures/modelos-en-casa');

describe('Catálogo y modelos de herramientas (tarea 4.5)', () => {
  it('Codex: ofrece sólo los 4 de visibility "list", gpt-6.1-sol de la caché no se ofrece, y gpt-5.6-sol suma ultra y gpt-5.5 no', () => {
    const debugJson = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, 'codex-0.144.4-debug-models.json'), 'utf8'),
    );
    const models = parseCodexModels(debugJson);

    // Sólo los 4 con visibility: "list" (se descartan gpt-reserve y codex-auto-review)
    expect(models).toHaveLength(4);
    const slugs = models.map((m) => m.id);
    expect(slugs).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);

    // gpt-6.1-sol no está en el catálogo vivo
    expect(slugs).not.toContain('gpt-6.1-sol');

    // gpt-5.6-sol suma ultra y viene por omisión en low
    const sol = models.find((m) => m.id === 'gpt-5.6-sol')!;
    expect(sol.defaultLevel).toBe('low');
    expect(sol.supportedLevels).toContain('ultra');
    expect(sol.supportedLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

    // gpt-5.5 no tiene ultra y llega hasta xhigh
    const gpt55 = models.find((m) => m.id === 'gpt-5.5')!;
    expect(gpt55.defaultLevel).toBe('medium');
    expect(gpt55.supportedLevels).not.toContain('ultra');
    expect(gpt55.supportedLevels).toEqual(['low', 'medium', 'high', 'xhigh']);

    // Comprobar contra la captura de caché: gpt-6.1-sol estaba en la caché pero nunca se ofrece
    const cacheJson = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, 'codex-0.144.4-models-cache.json'), 'utf8'),
    );
    const cachedSlugs = cacheJson.models.map((m: any) => m.slug);
    expect(cachedSlugs).toContain('gpt-6.1-sol');
    expect(slugs).not.toContain('gpt-6.1-sol');
  });

  it('Antigravity: lee los 14 modelos sin el primer renglón y asigna los 4 niveles a todos', () => {
    const agyText = fs.readFileSync(path.join(FIXTURES_DIR, 'agy-1.2.13-models.txt'), 'utf8');
    const models = parseAgyModels(agyText);

    expect(models).toHaveLength(14);
    expect(models[0]).toEqual({
      id: 'gemini-3.8-flash-high',
      name: 'Gemini 3.8 Flash (High)',
      supportedLevels: ['low', 'medium', 'high', 'max'],
    });
    expect(models.at(-1)).toEqual({
      id: 'gpt-oss-120b-medium',
      name: 'GPT-OSS 120B (Medium)',
      supportedLevels: ['low', 'medium', 'high', 'max'],
    });
    for (const m of models) {
      expect(m.defaultLevel).toBeUndefined();
      expect(m.supportedLevels).toEqual(['low', 'medium', 'high', 'max']);
    }
  });

  it('Claude Code: ofrece sus alias y los cinco niveles para todos sin nivel por omisión', () => {
    const models = getClaudeCodeModels();
    expect(models.map((m) => m.id)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    for (const m of models) {
      expect(m.defaultLevel).toBeUndefined();
      expect(m.supportedLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    }
  });

  describe('buildCliTextCommand con niveles y describeCliTextCommand', () => {
    it('Codex: agrega -c model_reasoning_effort=<nivel>', () => {
      const cmd = buildCliTextCommand('codex', 'gpt-5.6-sol', 'un prompt', 120_000, 'ultra');
      expect(cmd.args).toContain('-c');
      expect(cmd.args).toContain('model_reasoning_effort=ultra');
      const idxC = cmd.args.indexOf('-c');
      expect(cmd.args[idxC + 1]).toBe('model_reasoning_effort=ultra');
      expect(cmd.args.at(-4)).toBe('model_reasoning_effort=ultra');
      expect(cmd.args.at(-3)).toBe('-m');
      expect(cmd.args.at(-2)).toBe('gpt-5.6-sol');
      expect(cmd.args.at(-1)).toBe('-');

      const desc = describeCliTextCommand('codex', 'gpt-5.6-sol', 'ultra');
      expect(desc).toContain('-c model_reasoning_effort=ultra -m gpt-5.6-sol -');
    });

    it('Claude Code: agrega --effort <nivel>', () => {
      const cmd = buildCliTextCommand('claude-code', 'sonnet', 'un prompt', 120_000, 'xhigh');
      expect(cmd.args).toContain('--effort');
      const idxEffort = cmd.args.indexOf('--effort');
      expect(cmd.args[idxEffort + 1]).toBe('xhigh');

      const desc = describeCliTextCommand('claude-code', 'sonnet', 'xhigh');
      expect(desc).toContain('--effort xhigh --model sonnet');
    });

    it('Antigravity: agrega --effort <nivel>', () => {
      const cmd = buildCliTextCommand('antigravity', 'gemini-3.8-flash-high', 'un prompt', 60_000, 'max');
      expect(cmd.args).toContain('--effort');
      const idxEffort = cmd.args.indexOf('--effort');
      expect(cmd.args[idxEffort + 1]).toBe('max');

      const desc = describeCliTextCommand('antigravity', 'gemini-3.8-flash-high', 'max', 60_000);
      expect(desc).toContain('--effort max --model gemini-3.8-flash-high --print-timeout 60s');
    });

    it('con un nivel que no está en la lista o con caracteres raros, no se agrega nada', () => {
      expect(isValidCliEffort('codex', 'inventado')).toBe(false);
      expect(isValidCliEffort('codex', 'low;rm')).toBe(false);
      expect(isValidCliEffort('codex', 'LOW')).toBe(false);
      expect(isValidCliEffort('antigravity', 'ultra')).toBe(false); // ultra sólo en codex
      expect(isValidCliEffort('antigravity', 'xhigh')).toBe(false); // xhigh sólo en codex y claude-code

      const cmdCodex = buildCliTextCommand('codex', 'gpt-5.5', 'prompt', 120_000, 'ultra; rm -rf');
      expect(cmdCodex.args).not.toContain('-c');
      expect(cmdCodex.args).toEqual(buildCodexTextArgs('gpt-5.5'));

      const cmdAgy = buildCliTextCommand('antigravity', 'gemini', 'prompt', 60_000, 'ultra');
      expect(cmdAgy.args).not.toContain('--effort');
      expect(cmdAgy.args).toEqual(buildAntigravityTextArgs('gemini', 60_000));

      const cmdClaude = buildCliTextCommand('claude-code', 'haiku', 'prompt', 120_000, 'invalid!');
      expect(cmdClaude.args).not.toContain('--effort');
      expect(cmdClaude.args).toEqual(buildClaudeTextArgs('haiku'));
    });
  });
});
