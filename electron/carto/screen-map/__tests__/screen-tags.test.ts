import { describe, expect, it } from 'vitest';
import { TAG_RULES, screenTags, tagsForFile } from '../screen-tags';
import type { ScreenFileLink } from '../../../../types/screen-map';

describe('screen-tags', () => {
  it('declara las 8 reglas iniciales de temas', () => {
    expect(TAG_RULES).toHaveLength(8);
  });
  it('reconoce @xyflow/react como tema graphics', () => {
    const tags = tagsForFile('components/FlowChart.tsx', "import { ReactFlow } from '@xyflow/react';");
    expect(tags).toContain('graphics');
  });

  it('reconoce una ruta components/settings/... como tema settings', () => {
    const tags = tagsForFile('components/settings/GeneralPreferences.tsx', '');
    expect(tags).toContain('settings');
  });

  it('un solo archivo compartido no pone tema y dos sí', () => {
    const file1: ScreenFileLink = {
      path: 'components/SharedFlow1.tsx',
      role: 'component',
      provenance: 'static',
      shared: true,
    };
    const file2: ScreenFileLink = {
      path: 'components/SharedFlow2.tsx',
      role: 'component',
      provenance: 'static',
      shared: true,
    };

    const contentOf = (p: string) => {
      if (p.includes('Flow')) return "import { ReactFlow } from '@xyflow/react';";
      return null;
    };

    // Con un solo archivo compartido: no cuenta (no pone tema)
    const singleShared = screenTags([file1], contentOf);
    expect(singleShared.tags).toHaveLength(0);
    expect(singleShared.primaryTag).toBeNull();

    // Con dos archivos compartidos: sí cuenta
    const twoShared = screenTags([file1, file2], contentOf);
    expect(twoShared.tags).toHaveLength(1);
    expect(twoShared.tags[0].tag).toBe('graphics');
    expect(twoShared.primaryTag).toBe('graphics');
  });

  it('resuelve el tema principal con desempates por propios y por total', () => {
    // Escenario 1: más archivos propios gana
    // data tiene 1 propio; ai tiene 0 propios y 2 compartidos
    const filesA: ScreenFileLink[] = [
      { path: 'models/user.ts', role: 'data', provenance: 'static', shared: false }, // data (propio)
      { path: 'lib/ai-agent-1.ts', role: 'logic', provenance: 'static', shared: true }, // ai (compartido)
      { path: 'lib/ai-agent-2.ts', role: 'logic', provenance: 'static', shared: true }, // ai (compartido)
    ];
    const contentA = (p: string) => {
      if (p.includes('user.ts')) return "import { createStore } from 'zustand';";
      if (p.includes('ai-agent')) return "import OpenAI from 'openai';";
      return null;
    };

    const resA = screenTags(filesA, contentA);
    expect(resA.primaryTag).toBe('data');
    expect(resA.tags[0].tag).toBe('data');
    expect(resA.tags[1].tag).toBe('ai');

    // Escenario 2: empatan en propios, gana el de más archivos en total
    // settings tiene 1 propio y 0 compartidos (total 1)
    // graphics tiene 1 propio y 1 compartido (total 2)
    const filesB: ScreenFileLink[] = [
      { path: 'components/settings/Ajustes.tsx', role: 'component', provenance: 'static', shared: false }, // settings (propio)
      { path: 'components/Diagram.tsx', role: 'component', provenance: 'static', shared: false }, // graphics (propio)
      { path: 'components/SharedChart.tsx', role: 'component', provenance: 'static', shared: true }, // graphics (compartido)
    ];
    const contentB = () => null;

    const resB = screenTags(filesB, contentB);
    expect(resB.primaryTag).toBe('graphics');
    expect(resB.tags[0].tag).toBe('graphics');
    expect(resB.tags[0].files).toHaveLength(2);
    expect(resB.tags[1].tag).toBe('settings');
    expect(resB.tags[1].files).toHaveLength(1);
  });

  it('los vínculos con procedencia unknown se ignoran', () => {
    const files: ScreenFileLink[] = [
      {
        path: 'dynamic:components/settings:import(`./settings/${x}`)',
        role: 'other',
        provenance: 'unknown',
        shared: false,
        unresolved: 'import(`./settings/${x}`)',
      },
      {
        path: 'dynamic:lib/ai:import(`./ai/${x}`)',
        role: 'other',
        provenance: 'unknown',
        shared: false,
        unresolved: 'import(`./ai/${x}`)',
      },
    ];

    const res = screenTags(files, () => "import OpenAI from 'openai';");
    expect(res.tags).toHaveLength(0);
    expect(res.primaryTag).toBeNull();
  });

  it('el nombre de la pantalla es evidencia propia aunque sus archivos sean compartidos', () => {
    const shared: ScreenFileLink = { path: 'components/Toolbar.tsx', role: 'component', provenance: 'static', shared: true };
    const res = screenTags([shared], () => null, 'Commit');
    expect(res.primaryTag).toBe('git');
    expect(res.tags[0].files[0]).toBe('pantalla: Commit');
    expect(res.tags[0].ownCount).toBe(1);
  });

  it('cuenta todos los archivos propios aunque muestre solo cinco', () => {
    const own = Array.from({ length: 7 }, (_, i): ScreenFileLink => ({
      path: `components/graph/Part${i}.tsx`, role: 'component', provenance: 'static', shared: false,
    }));
    const res = screenTags(own, () => null);
    expect(res.tags[0].files).toHaveLength(5);
    expect(res.tags[0].ownCount).toBe(7);
  });

  it('un nombre con espacios se lee por palabras («Ai history» es IA antes que Git)', () => {
    const own: ScreenFileLink = { path: 'components/ai/AiHistoryView.tsx', role: 'screen', provenance: 'static', shared: false };
    const res = screenTags([own], () => null, 'Ai history');
    expect(res.primaryTag).toBe('ai');
  });
});