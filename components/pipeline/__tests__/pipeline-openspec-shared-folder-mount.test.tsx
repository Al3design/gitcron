// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenSpecToolList } from '../OpenSpecReadiness';
import { useGitStore } from '@/lib/git-store';
import type { Lang } from '@/lib/i18n';

afterEach(cleanup);

describe('montaje del bloque de agentes con «por la carpeta compartida .agents» en es/en/zh (3.1)', () => {
  const cases: Array<{ lang: Lang; expectedText: string }> = [
    { lang: 'es', expectedText: 'configurada · por la carpeta compartida .agents' },
    { lang: 'en', expectedText: 'configured · by the shared .agents folder' },
    { lang: 'zh', expectedText: '已配置 · 通过共享的 .agents 文件夹' },
  ];

  for (const { lang, expectedText } of cases) {
    it(`muestra «${expectedText}» en idioma ${lang}`, () => {
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
          ]}
        />,
      );

      expect(screen.getByText('Codex')).toBeTruthy();
      expect(screen.getByText(expectedText)).toBeTruthy();
      expect(screen.queryByText(/Falta configurar/i)).toBeNull();
      expect(screen.queryByText(/Missing configuration/i)).toBeNull();
    });
  }
});
