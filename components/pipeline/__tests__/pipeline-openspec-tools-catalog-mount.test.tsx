// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import type { Lang } from '@/lib/i18n';
import { OpenSpecToolList } from '../OpenSpecReadiness';

afterEach(() => {
  cleanup();
  useGitStore.setState({ language: 'es' });
});

describe('Montaje de la lista explicada de herramientas OpenSpec (D4)', () => {
  const cases: Array<{
    lang: Lang;
    codexDesc: string;
    codexVersion: string;
    noDescText: string;
    futureVersionText: string;
  }> = [
    {
      lang: 'es',
      codexDesc: 'Codex, el agente de programación de OpenAI para la terminal y el editor.',
      codexVersion: 'desde OpenSpec 1.0 o antes',
      noDescText: 'sin descripción todavía',
      futureVersionText: 'posterior a OpenSpec 1.14',
    },
    {
      lang: 'en',
      codexDesc: "Codex, OpenAI's coding agent for the terminal and the editor.",
      codexVersion: 'since OpenSpec 1.0 or earlier',
      noDescText: 'no description yet',
      futureVersionText: 'later than OpenSpec 1.14',
    },
    {
      lang: 'zh',
      codexDesc: 'Codex，OpenAI 面向终端和编辑器的编程智能体。',
      codexVersion: '自 OpenSpec 1.0 或更早版本起',
      noDescText: '暂无描述',
      futureVersionText: '晚于 OpenSpec 1.14',
    },
  ];

  for (const { lang, codexDesc, codexVersion, noDescText, futureVersionText } of cases) {
    describe(`en idioma ${lang}`, () => {
      it('muestra la descripción verificada y versión para Codex, sin descripción para herramienta no descrita, y posterior a ciclo para herramienta ausente del snapshot', () => {
        useGitStore.setState({ language: lang });

        render(
          <OpenSpecToolList
            present
            tools={[
              {
                toolId: 'codex',
                label: 'Codex',
                directory: '.agents',
                configured: true,
                configuredVia: 'shared-folder',
              },
              {
                toolId: 'sin-desc-tool',
                label: 'Herramienta Sin Desc',
                directory: '.sindesc',
                configured: false,
              },
              {
                toolId: 'herramienta-del-motor-1-15',
                label: 'Motor Future Tool',
                directory: '.future',
                configured: false,
              },
            ]}
          />,
        );

        const rows = screen.getAllByRole('listitem');
        expect(rows.length).toBe(3);

        const codexRow = rows[0];
        const noDescRow = rows[1];
        const futureRow = rows[2];

        // 1. Herramienta conocida (Codex)
        expect(within(codexRow).getByText(codexDesc)).toBeTruthy();
        expect(within(codexRow).getByText(codexVersion)).toBeTruthy();

        // 2. Herramienta sin descripción en el catálogo
        expect(within(noDescRow).getByText(noDescText)).toBeTruthy();

        // 3. Herramienta del motor ausente de la lista propia
        expect(within(futureRow).getByText(futureVersionText)).toBeTruthy();
      });

      it('muestra explicaciones y versiones en la lista de selección cuando el CLI pregunta herramientas (needsTool)', () => {
        useGitStore.setState({ language: lang });

        render(
          <OpenSpecToolList
            present={false}
            tools={[]}
            needsTool
            onInitializeWith={() => undefined}
          />,
        );

        // Codex forma parte de selectableTools (del snapshot)
        const codexLabel = screen.getByText('Codex').closest('label');
        expect(codexLabel).not.toBeNull();
        if (codexLabel) {
          expect(within(codexLabel).getByText(codexDesc)).toBeTruthy();
          expect(within(codexLabel).getByText(codexVersion)).toBeTruthy();
        }
      });
    });
  }
});
