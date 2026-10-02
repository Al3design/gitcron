import { buildCartoPanorama, type CartoPanoramaModel } from '../../../lib/carto-panorama';
import { translate, type Lang } from '../../../lib/i18n';
import type {
  CartoAIPanoramaContext,
  CartoPanoramaResult,
  CartoPanoramaText,
  CartoPanoramaFlow,
} from '../../../types/carto-ai';
import { graphSnapshot } from '../../carto/graph-engine';
import { getCartoPanorama, upsertCartoPanorama } from '../../db/carto-cache';
import { getCartoAISettings, getCartoProvider } from './index';
import { buildPanoramaPrompts } from './prompts';

function normalizeLang(lang?: string): Lang {
  return lang === 'en' || lang === 'zh' ? lang : 'es';
}

function toAIContext(model: CartoPanoramaModel, lang: Lang): CartoAIPanoramaContext {
  return {
    lang,
    structureHash: model.structureHash,
    totals: model.totals,
    groups: model.groups.map((group) => ({
      role: group.id,
      label: translate(group.labelKey, lang),
      fileCount: group.fileCount,
      keyFiles: group.keyFiles.map((file) => file.node.filePath),
    })),
    links: model.links.map((link) => ({
      fromRole: translate(`cartography.role.${link.fromRole}`, lang),
      toRole: translate(`cartography.role.${link.toRole}`, lang),
      count: link.count,
      samples: link.samples.map((sample) => `${sample.fromPath} -> ${sample.toPath}`),
    })),
  };
}

function measurePrompt(context: CartoAIPanoramaContext): number {
  const { system, user } = buildPanoramaPrompts(context);
  return system.length + user.length;
}

function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeFlows(raw: unknown): CartoPanoramaFlow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const flow = item as { title?: unknown; steps?: unknown };
      if (typeof flow.title !== 'string' || !Array.isArray(flow.steps)) return null;
      const steps = flow.steps
        .filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
        .map((step) => step.trim())
        .slice(0, 4);
      if (steps.length === 0) return null;
      return { title: flow.title.trim(), steps };
    })
    .filter((flow): flow is CartoPanoramaFlow => flow !== null)
    .slice(0, 3);
}

function parsePanoramaText(text: string, provider: string, generatedAt: string): CartoPanoramaText {
  const parsed = JSON.parse(cleanJsonText(text)) as {
    oneLine?: unknown;
    paragraph?: unknown;
    flows?: unknown;
  };
  const oneLine = typeof parsed.oneLine === 'string' ? parsed.oneLine.trim() : '';
  const paragraph = typeof parsed.paragraph === 'string' ? parsed.paragraph.trim() : '';
  const flows = normalizeFlows(parsed.flows);
  if (!oneLine || !paragraph || flows.length === 0) {
    throw new Error('La respuesta de panorama no respetó el formato esperado.');
  }
  return { oneLine, paragraph, flows, provider, generatedAt };
}

export async function panoramaRepo(
  repoPath: string,
  lang?: string,
  forceRefresh = false,
): Promise<CartoPanoramaResult> {
  const snapshot = await graphSnapshot(repoPath);
  if (!snapshot) {
    throw new Error('El índice del repo todavía no está listo. Esperá a que termine de indexar.');
  }

  const normLang = normalizeLang(lang);
  const model = buildCartoPanorama(snapshot);
  const context = toAIContext(model, normLang);
  const promptChars = measurePrompt(context);
  const key = { repoPath, structureHash: model.structureHash, lang: normLang };

  const settings = getCartoAISettings();
  if (!settings.enabled) {
    return { structureHash: model.structureHash, panorama: null, cached: false, promptChars };
  }

  if (!forceRefresh) {
    const hit = getCartoPanorama(key);
    if (hit) {
      return {
        structureHash: model.structureHash,
        panorama: {
          oneLine: hit.oneLine,
          paragraph: hit.paragraph,
          flows: hit.flows,
          provider: hit.provider,
          generatedAt: hit.generatedAt,
        },
        cached: true,
        promptChars,
      };
    }
  }

  try {
    const provider = getCartoProvider(settings, repoPath);
    const response = await provider.panorama(context);
    const panorama = parsePanoramaText(response.text, response.provider, response.generatedAt);
    upsertCartoPanorama({
      ...key,
      provider: panorama.provider,
      model: provider.modelId,
      oneLine: panorama.oneLine,
      paragraph: panorama.paragraph,
      flows: panorama.flows,
      generatedAt: panorama.generatedAt,
    });
    return { structureHash: model.structureHash, panorama, cached: false, promptChars };
  } catch (error) {
    return {
      structureHash: model.structureHash,
      panorama: null,
      cached: false,
      aiError: error instanceof Error ? error.message : String(error),
      promptChars,
    };
  }
}
