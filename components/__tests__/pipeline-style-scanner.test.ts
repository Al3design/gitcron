import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function missingClasses(source: string, readModule: (modulePath: string) => string) {
  const missing: { modulePath: string; className: string }[] = [];
  const imports = /import\s+([\w$]+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g;
  for (const match of source.matchAll(imports)) {
    const [, binding, modulePath] = match;
    const defined = new Set([...readModule(modulePath).matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
    const usages = new RegExp(`\\b${binding}\\.([a-zA-Z0-9_]+)\\b`, 'g');
    for (const usage of source.matchAll(usages)) {
      if (!defined.has(usage[1])) missing.push({ modulePath, className: usage[1] });
    }
  }
  return missing;
}

describe('Escáner de clases CSS de Pipeline', () => {
  it('todas las clases de módulo usadas están definidas en la hoja que importa cada componente', () => {
    const pipelineDir = path.resolve(__dirname, '../pipeline');
    const repoRoot = path.resolve(pipelineDir, '../..');

    // Recorrer components/pipeline/*.tsx y extraer cada styles.X
    const tsxFiles = fs
      .readdirSync(pipelineDir)
      .filter((file) => file.endsWith('.tsx'));

    const orphans: { file: string; modulePath: string; className: string }[] = [];

    for (const file of tsxFiles) {
      const filePath = path.join(pipelineDir, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      orphans.push(...missingClasses(fileContent, (modulePath) => fs.readFileSync(
        modulePath.startsWith('@/') ? path.join(repoRoot, modulePath.slice(2)) : path.resolve(pipelineDir, modulePath), 'utf8',
      )).map((missing) => ({ file, ...missing })));
    }

    expect(
      orphans,
      `Clases CSS fantasma/huérfanas encontradas en components/pipeline: ${JSON.stringify(orphans, null, 2)}`,
    ).toEqual([]);
  });

  it('una clase de otra hoja no tapa una clase inexistente en el módulo propio', () => {
    const source = `import styles from './Own.module.css';
import shared from './Shared.module.css';
const a = styles.ghost; const b = shared.real;`;
    expect(missingClasses(source, (file) => file === './Own.module.css' ? '.own {}' : '.ghost {} .real {}'))
      .toEqual([{ modulePath: './Own.module.css', className: 'ghost' }]);
  });
});
