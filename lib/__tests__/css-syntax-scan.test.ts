import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getScannedUiFiles } from '../scan-targets';
import { findUnbalancedDeclarations, type CssSyntaxViolation } from '../css-syntax';

/**
 * Verificación automática de integridad sintáctica de hojas de estilo CSS.
 *
 * ALCANCE Y SUPUESTOS (Invariante 22):
 * - Recorre todos los archivos `.css` provistos por `getScannedUiFiles()`:
 *   1. `app/globals.css`: estilos globales, temas y utilidades.
 *   2. `components/ai/AiModelPicker.module.css`: selector compartido para elegir modelo e intensidad de un uso de IA (modelos-en-casa 4.5).
 *   3. `components/ai/AiSentDetails.module.css`: detalle del pedido efectivo de un uso de IA (modelos-en-casa 4.4).
 *   4. `components/ai/AiUseLine.module.css`: la línea del modelo de cada uso de IA (modelos-en-casa 4.3).
 *   5. `components/pipeline/OpenSpecDashboard.module.css`: estilos del módulo Pipeline/SDD.
 * - Detecta declaraciones CSS con paréntesis desbalanceados en sus valores (e.g. `var(--foo))` o `color-mix(...`).
 * - Evita que errores tipográficos descarten propiedades visuales completas en el motor de renderizado.
 */
describe('css-syntax-scan - Verificación de sintaxis CSS y balance de paréntesis', () => {
  const scannedCssFiles = getScannedUiFiles().filter((f) => f.endsWith('.css'));

  it('declara explícitamente los archivos CSS que recorre (Invariante 22)', () => {
    expect(scannedCssFiles).toEqual([
      'app/globals.css',
      'components/ai/AiModelPicker.module.css',
      'components/ai/AiSentDetails.module.css',
      'components/ai/AiUseLine.module.css',
      'components/assist/AssistChat.module.css',
      'components/assist/AssistDock.module.css',
      'components/pipeline/OpenSpecDashboard.module.css',
      'components/pipeline/sdd/SddArchivedChange.module.css',
      'components/pipeline/sdd/SddChangeHeader.module.css',
      'components/pipeline/sdd/SddPrepareCommit.module.css',
      'components/pipeline/sdd/SddStartScreens.module.css',
      'components/pipeline/sdd/SddStatusBar.module.css',
      'components/pipeline/sdd/views/SddTasksView.module.css',
      'components/ui/PlainList.module.css',
      'components/ui/Row.module.css',
      'components/ui/Stack.module.css',
      'components/ui/Text.module.css',
    ]);
  });

  it('los archivos CSS de la interfaz no deben contener declaraciones con paréntesis desbalanceados', () => {
    const allViolations: Array<CssSyntaxViolation & { file: string }> = [];

    for (const relativePath of scannedCssFiles) {
      const fullPath = path.resolve(process.cwd(), relativePath);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const violations = findUnbalancedDeclarations(content);

      for (const v of violations) {
        allViolations.push({
          ...v,
          file: relativePath,
        });
      }
    }

    if (allViolations.length > 0) {
      const formattedErrors = allViolations
        .map(
          (v) =>
            `  ${v.file}:${v.line} -> [${v.property}: ${v.value}] (${v.error})\n    Línea original: ${v.raw}`
        )
        .join('\n');

      expect.fail(
        `Se encontraron ${allViolations.length} declaraciones CSS con sintaxis inválida (paréntesis desbalanceados):\n${formattedErrors}`
      );
    }

    expect(allViolations.length).toBe(0);
  });
});
