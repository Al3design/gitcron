// electron/carto/screen-map/screen-tags.ts
//
// Reglas y cálculo de temas para las pantallas del catálogo (carto-05c, tarea 2.9).
// Cada pantalla lleva los temas que se leen en su código, con la evidencia guardada.

import type { ScreenFileLink, ScreenTag, ScreenTagEvidence } from '../../../types/screen-map';

export interface TagRule {
  tag: ScreenTag;
  imports: RegExp;
  paths: RegExp;
}

export const TAG_RULES: TagRule[] = [
  {
    tag: 'graphics',
    imports: /(?:^|[\/'"])(?:d3|@xyflow\/[^'"]*|reactflow|recharts|chart\.js|@visx\/[^'"]*|three|pixi|cytoscape|elkjs)(?:['"\/]|$)/,
    // La ruta entera, no solo el nombre: una carpeta `graph/` también cuenta (auditoría de 05c).
    paths: /(?:graph|chart|canvas|diagram)/i,
  },
  {
    tag: 'data',
    imports: /(?:^|[\/'"])(?:zustand|swr|@tanstack\/react-query|prisma|@prisma\/[^'"]*|drizzle|drizzle-orm|@supabase\/[^'"]*|firebase|sqlite|node:sqlite|mongoose)(?:['"\/]|$)/,
    paths: /(?:^|\/)(?:db|store|stores|models|schema)(?:\/|\.)|store\.(?:ts|js)x?$/i,
  },
  {
    tag: 'ai',
    imports: /(?:^|[\/'"])(?:openai|@anthropic-ai\/[^'"]*|ai|@ai-sdk\/[^'"]*|ollama|langchain)(?:['"\/]|$)/,
    paths: /(?:^|\/)(?:ai|assist|llm|agents?)(?:\/|-)/i,
  },
  {
    tag: 'git',
    imports: /(?:^|[\/'"])(?:simple-git|isomorphic-git|nodegit)(?:['"\/]|$)/,
    paths: /(?:^|\/)git(?:\/|-)|commit|branch|stash|history/i,
  },
  {
    tag: 'settings',
    imports: /$^/,
    paths: /(?:settings|preferences|config)/i,
  },
  {
    tag: 'content',
    imports: /(?:^|[\/'"])(?:react-markdown|remark|rehype|@mdx-js\/[^'"]*|marked)(?:['"\/]|$)/,
    paths: /(?:markdown|docs?|help)/i,
  },
  {
    tag: 'accounts',
    imports: /(?:^|[\/'"])(?:next-auth|@clerk\/[^'"]*|@auth\/[^'"]*|lucia|passport)(?:['"\/]|$)/,
    paths: /(?:auth|login|signin|signup|account|profile)/i,
  },
  {
    tag: 'payments',
    imports: /(?:^|[\/'"])(?:stripe|@stripe\/[^'"]*|mercadopago|paypal)(?:['"\/]|$)/,
    paths: /(?:payment|checkout|billing|pricing)/i,
  },
];

export function tagsForFile(path: string, content: string | null): ScreenTag[] {
  const normPath = path.replace(/\\/g, '/');
  const matched = new Set<ScreenTag>();

  for (const rule of TAG_RULES) {
    if (rule.paths.test(normPath)) {
      matched.add(rule.tag);
    }
  }

  if (content) {
    const lines = content.split('\n');
    for (const line of lines) {
      if (
        /(?:^\s*import\b|\bfrom\s*['"]|\brequire\s*\(|\bimport\s*\()/i.test(line) ||
        /^@?[a-z0-9_-]+(?:\/[a-z0-9_.-]+)*$/i.test(line.trim())
      ) {
        for (const rule of TAG_RULES) {
          if (rule.imports.source !== '$^' && rule.imports.test(line)) {
            matched.add(rule.tag);
          }
        }
      }
    }
  }

  return Array.from(matched);
}

function collectTagFiles(
  files: ScreenFileLink[],
  contentOf: (path: string) => string | null,
): { own: Map<ScreenTag, string[]>; shared: Map<ScreenTag, string[]> } {
  const own = new Map<ScreenTag, string[]>();
  const shared = new Map<ScreenTag, string[]>();

  for (const f of files) {
    if (f.provenance === 'unknown') continue;
    const content = contentOf(f.path);
    const fileTags = tagsForFile(f.path, content);
    const targetMap = f.shared ? shared : own;
    for (const tag of fileTags) {
      let list = targetMap.get(tag);
      if (!list) {
        list = [];
        targetMap.set(tag, list);
      }
      if (!list.includes(f.path)) list.push(f.path);
    }
  }

  return { own, shared };
}

/** Cómo aparece el nombre de la pantalla entre la evidencia de un tema. */
const SCREEN_NAME_EVIDENCE_PREFIX = 'pantalla: ';

export function screenTags(
  files: ScreenFileLink[],
  contentOf: (path: string) => string | null,
  screenName?: string,
): { tags: ScreenTagEvidence[]; primaryTag: ScreenTag | null } {
  const { own, shared } = collectTagFiles(files, contentOf);
  // El nombre de la pantalla también es evidencia, y propia: «Commit», «Graph», «Settings» o
  // «Profile» dicen su tema aunque sus archivos sean compartidos. Medido en la auditoría de 05c:
  // Graph, History y Commit salían «General» porque todos sus archivos eran compartidos.
  if (screenName) {
    // «Ai history» se lee como «Ai-history»: las reglas de ruta separan palabras con / o -.
    const asPath = screenName.trim().replace(/\s+/g, '-');
    for (const rule of TAG_RULES) {
      if (!rule.paths.test(asPath)) continue;
      const list = own.get(rule.tag) ?? [];
      list.unshift(`${SCREEN_NAME_EVIDENCE_PREFIX}${screenName}`);
      own.set(rule.tag, list);
    }
  }
  const allTags = new Set<ScreenTag>([...own.keys(), ...shared.keys()]);
  const evidenceList: (ScreenTagEvidence & { total: number })[] = [];

  for (const tag of allTags) {
    const ownFiles = own.get(tag) ?? [];
    const sharedFiles = shared.get(tag) ?? [];

    // Para que un tema cuente hace falta al menos un archivo propio o dos compartidos
    if (ownFiles.length === 0 && sharedFiles.length < 2) {
      continue;
    }

    // Se muestran hasta 5, pero se cuentan todos: el orden no puede depender del recorte.
    evidenceList.push({
      tag,
      files: [...ownFiles, ...sharedFiles].slice(0, 5),
      ownCount: ownFiles.length,
      total: ownFiles.length + sharedFiles.length,
    });
  }

  const tagRuleOrder = (t: ScreenTag) => TAG_RULES.findIndex((r) => r.tag === t);

  evidenceList.sort((a, b) => {
    if (b.ownCount !== a.ownCount) return b.ownCount - a.ownCount;
    if (b.total !== a.total) return b.total - a.total;
    return tagRuleOrder(a.tag) - tagRuleOrder(b.tag);
  });

  return {
    tags: evidenceList.map(({ tag, files: evidence, ownCount }) => ({ tag, files: evidence, ownCount })),
    primaryTag: evidenceList.length > 0 ? evidenceList[0].tag : null,
  };
}
