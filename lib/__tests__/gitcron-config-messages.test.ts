import { describe, expect, it } from 'vitest';
import { translate, type Lang } from '@/lib/i18n';
import {
  configWarningLines,
  contributingConfigFiles,
  describeConfigParseCode,
  formatConfigParseError,
  lastValidNotices,
} from '@/lib/gitcron-config-messages';

const tFor = (lang: Lang) => (key: string, vars?: Record<string, string | number>) => translate(key, lang, vars);
const error = { file: 'C:/Users/ale/.config/gitcron/gitcron.json', line: 27, column: 5, code: 'CommaExpected' };

describe('mensajes del gitcron.json roto', () => {
  it('el motivo en palabras de la persona, en los tres idiomas', () => {
    expect(formatConfigParseError(error, tFor('es'))).toBe(
      'Error en C:/Users/ale/.config/gitcron/gitcron.json, línea 27, columna 5: falta una coma.',
    );
    expect(formatConfigParseError(error, tFor('en'))).toBe(
      'Error in C:/Users/ale/.config/gitcron/gitcron.json, line 27, column 5: a comma is missing.',
    );
    expect(formatConfigParseError(error, tFor('zh'))).toBe('C:/Users/ale/.config/gitcron/gitcron.json 第 27 行第 5 列出错：缺少逗号。');
  });

  it('un código sin texto propio se muestra tal cual, sin inventarle explicación', () => {
    expect(describeConfigParseCode('UnknownFutureError', tFor('es'))).toBe('UnknownFutureError');
  });

  it('sólo avisa los rotos que se siguen usando en su versión anterior, y «según» nombra los que aportan', () => {
    const files = [
      { path: 'g.json', scope: 'global' as const, exists: true, usingLastValid: true, error },
      { path: 'r.json', scope: 'repo' as const, exists: true, error },
      { path: 'x.json', scope: 'repo' as const, exists: false },
    ];
    expect(lastValidNotices(files, tFor('es'))).toEqual([
      'g.json tiene un error en la línea 27 (falta una coma). Se sigue usando la última versión válida.',
    ]);
    expect(contributingConfigFiles(files)).toEqual(['g.json']);
  });

  it('las advertencias del esquema se dicen en palabras de la persona, y con muchas se resume', () => {
    const warnings = [
      { kind: 'unknown-key' as const, segments: ['provider', 'casa', 'raro'] },
      { kind: 'wrong-type' as const, segments: ['agent', 'gitcron-commit', 'temperature'], expected: 'number' as const },
      { kind: 'model-temperature-number' as const, segments: ['provider', 'casa', 'models', 'unsloth/Qwen3.8', 'temperature'] },
      { kind: 'unknown-key' as const, segments: ['gitcron'] },
      { kind: 'unknown-key' as const, segments: ['otra'] },
    ];
    expect(configWarningLines(warnings, tFor('es'))).toEqual([
      '«provider.casa.raro»: el formato de OpenCode no lo conoce; se respeta.',
      '«agent.gitcron-commit.temperature»: se esperaba un número; se respeta como está.',
      '«provider.casa.models.unsloth/Qwen3.8.temperature»: en el formato de OpenCode es sí/no (si el modelo admite temperatura). Para fijarla, usá agent.<uso>.temperature.',
      'y 2 advertencias más.',
    ]);
    expect(configWarningLines(undefined, tFor('es'))).toEqual([]);
    expect(configWarningLines([{ kind: 'mcp-in-gitcron', segments: ['mcp'] }], tFor('es'))).toEqual([
      '«mcp» en gitcron.json: GitCron no lo lee (es de OpenCode). Los servidores MCP van en mcp.json, donde se pueden importar.',
    ]);
  });
});
