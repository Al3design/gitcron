/**
 * Catálogo de descripciones de herramientas de OpenSpec para GitCron (D4).
 *
 * Fuente: medición 1.2 en openspec/changes/actualizar-ciclo-openspec-1-14/mediciones/descripciones.md
 * investigada el 2026-10-01 sobre la lista de OpenSpec 1.14.0.
 *
 * REGLA: Los textos se copian tal cual fueron verificados en la medición.
 * Una herramienta sin descripción verificada NO se agrega a este catálogo;
 * la interfaz mostrará «sin descripción todavía» mediante i18n hasta que
 * sea investigada y documentada formalmente.
 */

import snapshot from '@/electron/pipeline/openspec-tools-snapshot.json';
import { OPENSPEC_CYCLE_TARGET_VERSION } from '@/lib/openspec-version';
import type { Lang } from '@/lib/i18n';

export interface OpenSpecToolCatalogEntry {
  es: string;
  en: string;
  zh: string;
}

export const OPENSPEC_TOOLS_CATALOG: Record<string, OpenSpecToolCatalogEntry> = {
  agents: {
    es: 'Carpeta compartida .agents: las instrucciones que leen varias herramientas a la vez.',
    en: 'Shared .agents folder: instructions read by several tools at once.',
    zh: '共享的 .agents 文件夹：多个工具同时读取的指令。',
  },
  'amazon-q': {
    es: 'Asistente de programación con IA de Amazon Web Services, para el editor y la terminal.',
    en: "Amazon Web Services' AI coding assistant for the editor and the terminal.",
    zh: 'Amazon Web Services 的 AI 编程助手，可用于编辑器和终端。',
  },
  amp: {
    es: 'Agente de programación Amp, para la terminal y el editor.',
    en: 'Amp coding agent, for the terminal and the editor.',
    zh: 'Amp 编程智能体，可用于终端和编辑器。',
  },
  antigravity: {
    es: 'Entorno de desarrollo de Google centrado en agentes de IA.',
    en: "Google's agent-first development environment.",
    zh: 'Google 以 AI 智能体为中心的开发环境。',
  },
  atomcode: {
    es: 'Agente de programación de código abierto para la terminal, integrado con AtomGit.',
    en: 'Open-source terminal coding agent, integrated with AtomGit.',
    zh: '开源终端编程智能体，与 AtomGit 集成。',
  },
  auggie: {
    es: 'Auggie, la versión de terminal del agente de Augment Code.',
    en: "Auggie, the terminal version of Augment Code's agent.",
    zh: 'Auggie，Augment Code 智能体的终端版本。',
  },
  bob: {
    es: 'IBM Bob, el asistente de desarrollo con IA de IBM.',
    en: "IBM Bob, IBM's AI development assistant.",
    zh: 'IBM Bob，IBM 的 AI 开发助手。',
  },
  claude: {
    es: 'Claude Code, el agente de programación de Anthropic para la terminal y el editor.',
    en: "Claude Code, Anthropic's coding agent for the terminal and the editor.",
    zh: 'Claude Code，Anthropic 面向终端和编辑器的编程智能体。',
  },
  cline: {
    es: 'Agente de programación de código abierto que funciona como extensión de VS Code.',
    en: 'Open-source coding agent that runs as a VS Code extension.',
    zh: '以 VS Code 扩展形式运行的开源编程智能体。',
  },
  codeartsagent: {
    es: 'CodeArts Agent, el asistente de programación con IA de Huawei Cloud.',
    en: "CodeArts Agent, Huawei Cloud's AI coding assistant.",
    zh: 'CodeArts Agent，华为云的 AI 编程助手。',
  },
  codeassistant: {
    es: 'Extensión de VS Code de la plataforma de desarrollo SourceCraft.',
    en: 'VS Code extension of the SourceCraft development platform.',
    zh: 'SourceCraft 开发平台的 VS Code 扩展。',
  },
  codebuddy: {
    es: 'CodeBuddy Code, el agente de programación de terminal de Tencent Cloud.',
    en: "CodeBuddy Code, Tencent Cloud's terminal coding agent.",
    zh: 'CodeBuddy Code，腾讯云的终端编程智能体。',
  },
  codestudio: {
    es: 'Code Studio, el entorno de desarrollo con IA de Syncfusion.',
    en: "Code Studio, Syncfusion's AI development environment.",
    zh: 'Code Studio，Syncfusion 的 AI 开发环境。',
  },
  codex: {
    es: 'Codex, el agente de programación de OpenAI para la terminal y el editor.',
    en: "Codex, OpenAI's coding agent for the terminal and the editor.",
    zh: 'Codex，OpenAI 面向终端和编辑器的编程智能体。',
  },
  'command-code': {
    es: 'Agente de programación de terminal que aprende el estilo de código de quien lo usa.',
    en: "Terminal coding agent that learns its user's coding style.",
    zh: '能学习使用者代码风格的终端编程智能体。',
  },
  continue: {
    es: 'Asistente de programación de código abierto para VS Code y JetBrains.',
    en: 'Open-source coding assistant for VS Code and JetBrains.',
    zh: '适用于 VS Code 和 JetBrains 的开源编程助手。',
  },
  costrict: {
    es: 'CoStrict, asistente de programación de código abierto de Sangfor, pensado para empresas.',
    en: "CoStrict, Sangfor's open-source coding assistant for companies.",
    zh: 'CoStrict，深信服面向企业的开源编程助手。',
  },
  crush: {
    es: 'Agente de programación de código abierto para la terminal, de Charm.',
    en: 'Open-source terminal coding agent by Charm.',
    zh: 'Charm 推出的开源终端编程智能体。',
  },
  cursor: {
    es: 'Editor de código con IA basado en VS Code.',
    en: 'AI code editor based on VS Code.',
    zh: '基于 VS Code 的 AI 代码编辑器。',
  },
  devin: {
    es: 'Devin Desktop, el entorno de desarrollo de Cognition que antes se llamaba Windsurf.',
    en: "Devin Desktop, Cognition's development environment, formerly Windsurf.",
    zh: 'Devin Desktop，Cognition 的开发环境，前身为 Windsurf。',
  },
  dsh: {
    es: 'DeepSeek Harness, el entorno de agentes de código abierto de DeepSeek, armado con complementos.',
    en: "DeepSeek Harness, DeepSeek's open-source, plugin-based agent framework.",
    zh: 'DeepSeek Harness，DeepSeek 基于插件的开源智能体框架。',
  },
  easycode: {
    es: 'EasyCode de OrionStar (antes DeepV Code), asistente de programación para la terminal y VS Code.',
    en: "OrionStar's EasyCode (formerly DeepV Code), coding assistant for the terminal and VS Code.",
    zh: '猎户星空的 EasyCode（原 DeepV Code），适用于终端和 VS Code 的编程助手。',
  },
  factory: {
    es: 'Droid, el agente de programación de Factory.',
    en: "Droid, Factory's coding agent.",
    zh: 'Droid，Factory 的编程智能体。',
  },
  forgecode: {
    es: 'ForgeCode, agente de programación de código abierto para la terminal.',
    en: 'ForgeCode, open-source terminal coding agent.',
    zh: 'ForgeCode，开源终端编程智能体。',
  },
  gemini: {
    es: 'Gemini CLI, el agente de programación de Google para la terminal.',
    en: "Gemini CLI, Google's terminal coding agent.",
    zh: 'Gemini CLI，Google 的终端编程智能体。',
  },
  'github-copilot': {
    es: 'GitHub Copilot, el asistente de programación con IA de GitHub.',
    en: "GitHub Copilot, GitHub's AI coding assistant.",
    zh: 'GitHub Copilot，GitHub 的 AI 编程助手。',
  },
  gigacode: {
    es: 'GigaCode, el asistente de programación con IA de Sber.',
    en: "GigaCode, Sber's AI coding assistant.",
    zh: 'GigaCode，俄罗斯联邦储蓄银行（Sber）的 AI 编程助手。',
  },
  grok: {
    es: 'Grok Build, el agente de programación de terminal de xAI.',
    en: "Grok Build, xAI's terminal coding agent.",
    zh: 'Grok Build，xAI 的终端编程智能体。',
  },
  gsd: {
    es: 'GSD («Get Shit Done»), agente de desarrollo guiado por especificaciones, construido sobre Pi.',
    en: 'GSD ("Get Shit Done"), a spec-driven development agent built on Pi.',
    zh: 'GSD（"Get Shit Done"），基于 Pi 构建的规格驱动开发智能体。',
  },
  hermes: {
    es: 'Hermes Agent, el agente de código abierto de Nous Research que escribe sus propias habilidades.',
    en: "Hermes Agent, Nous Research's open-source agent that writes its own skills.",
    zh: 'Hermes Agent，Nous Research 的开源智能体，会自行编写技能。',
  },
  iflow: {
    es: 'iFlow CLI, asistente de IA para la terminal de un equipo vinculado a Alibaba.',
    en: 'iFlow CLI, a terminal AI assistant from an Alibaba-affiliated team.',
    zh: 'iFlow CLI，阿里系团队推出的终端 AI 助手。',
  },
  junie: {
    es: 'Junie, el agente de programación de JetBrains.',
    en: "Junie, JetBrains' coding agent.",
    zh: 'Junie，JetBrains 的编程智能体。',
  },
  kilocode: {
    es: 'Kilo Code, agente de programación de código abierto para VS Code y JetBrains.',
    en: 'Kilo Code, open-source coding agent for VS Code and JetBrains.',
    zh: 'Kilo Code，适用于 VS Code 和 JetBrains 的开源编程智能体。',
  },
  kimi: {
    es: 'Kimi Code, el agente de programación de terminal de Moonshot AI.',
    en: "Kimi Code, Moonshot AI's terminal coding agent.",
    zh: 'Kimi Code，月之暗面（Moonshot AI）的终端编程智能体。',
  },
  kiro: {
    es: 'Kiro, el entorno de desarrollo de Amazon Web Services guiado por especificaciones.',
    en: "Kiro, Amazon Web Services' spec-driven development environment.",
    zh: 'Kiro，Amazon Web Services 的规格驱动开发环境。',
  },
  lingma: {
    es: 'Lingma (Tongyi Lingma), el asistente de programación con IA de Alibaba Cloud.',
    en: "Lingma (Tongyi Lingma), Alibaba Cloud's AI coding assistant.",
    zh: '通义灵码（Lingma），阿里云的 AI 编程助手。',
  },
  'minimax-code': {
    es: 'MiniMax Code, el agente de programación de terminal de MiniMax.',
    en: "MiniMax Code, MiniMax's terminal coding agent.",
    zh: 'MiniMax Code，MiniMax 的终端编程智能体。',
  },
  'oh-my-pi': {
    es: 'Oh My Pi, versión ampliada del agente Pi con más herramientas incluidas.',
    en: 'Oh My Pi, an expanded version of the Pi agent with more built-in tools.',
    zh: 'Oh My Pi，Pi 智能体的扩展版本，内置更多工具。',
  },
  opencode: {
    es: 'OpenCode, agente de programación de código abierto para la terminal.',
    en: 'OpenCode, open-source terminal coding agent.',
    zh: 'OpenCode，开源终端编程智能体。',
  },
  pi: {
    es: 'Pi, agente de programación mínimo para la terminal.',
    en: 'Pi, a minimal terminal coding agent.',
    zh: 'Pi，极简的终端编程智能体。',
  },
  qoder: {
    es: 'Qoder, la plataforma de programación con agentes de Alibaba.',
    en: "Qoder, Alibaba's agentic coding platform.",
    zh: 'Qoder，阿里巴巴的智能体编程平台。',
  },
  qwen: {
    es: 'Qwen Code, el agente de programación de terminal del equipo Qwen de Alibaba.',
    en: "Qwen Code, the terminal coding agent from Alibaba's Qwen team.",
    zh: 'Qwen Code，阿里巴巴通义千问团队的终端编程智能体。',
  },
  roocode: {
    es: 'Zoo Code, la continuación comunitaria de Roo Code como extensión de VS Code.',
    en: 'Zoo Code, the community continuation of Roo Code as a VS Code extension.',
    zh: 'Zoo Code，Roo Code 的社区延续版本，作为 VS Code 扩展。',
  },
  rovodev: {
    es: 'Rovo Dev CLI, el agente de programación de terminal de Atlassian.',
    en: "Rovo Dev CLI, Atlassian's terminal coding agent.",
    zh: 'Rovo Dev CLI，Atlassian 的终端编程智能体。',
  },
  trae: {
    es: 'Trae, el entorno de desarrollo con IA de ByteDance.',
    en: "Trae, ByteDance's AI development environment.",
    zh: 'Trae，字节跳动的 AI 开发环境。',
  },
  veai: {
    es: 'Veai, agente de IA para los entornos de JetBrains.',
    en: 'Veai, an AI agent for JetBrains IDEs.',
    zh: 'Veai，适用于 JetBrains IDE 的 AI 智能体。',
  },
  vibe: {
    es: 'Mistral Vibe, el agente de programación de terminal de Mistral AI.',
    en: "Mistral Vibe, Mistral AI's terminal coding agent.",
    zh: 'Mistral Vibe，Mistral AI 的终端编程智能体。',
  },
  warp: {
    es: 'Warp, terminal con agentes de IA integrados.',
    en: 'Warp, a terminal with built-in AI agents.',
    zh: 'Warp，内置 AI 智能体的终端。',
  },
  zcode: {
    es: 'ZCode, el entorno de desarrollo con agentes de Z.ai (antes Zhipu AI).',
    en: 'ZCode, the agentic development environment from Z.ai (formerly Zhipu AI).',
    zh: 'ZCode，Z.ai（原智谱 AI）的智能体开发环境。',
  },
  zed: {
    es: 'Zed Agent, el agente integrado en el editor Zed.',
    en: 'Zed Agent, the agent built into the Zed editor.',
    zh: 'Zed Agent，Zed 编辑器内置的智能体。',
  },
};

/**
 * Normaliza una versión semver para el texto de interfaz (ej. '1.14.0' -> '1.14', '1.0.0' -> '1.0').
 */
export function formatToolVersionNumber(version: string): string {
  return version.replace(/\.0$/, '');
}

/**
 * Resuelve la descripción verificada de una herramienta en el idioma solicitado.
 * Si la herramienta no tiene descripción en el catálogo, devuelve «sin descripción todavía».
 */
export function resolveToolDescription(
  toolId: string,
  lang: Lang,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const entry = OPENSPEC_TOOLS_CATALOG[toolId];
  if (!entry) {
    return t('pipeline.openspec.tool.noDescription');
  }
  return entry[lang] ?? entry.es ?? entry.en;
}

/**
 * Resuelve el texto de versión de aparición de una herramienta:
 * - «desde OpenSpec 1.0 o antes» si tiene `addedInOrEarlier`
 * - «desde OpenSpec 1.14» si tiene `addedIn`
 * - «posterior a OpenSpec 1.14» si el motor la reconoce pero no está en la lista propia
 */
export function resolveToolVersionText(
  toolId: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  cycleVersion: string = OPENSPEC_CYCLE_TARGET_VERSION,
): string {
  const toolDef = (snapshot.tools as Array<{ id: string; addedIn?: string; addedInOrEarlier?: boolean }>).find(
    (item) => item.id === toolId,
  );

  if (toolDef?.addedIn) {
    const formatted = formatToolVersionNumber(toolDef.addedIn);
    if (toolDef.addedInOrEarlier) {
      return t('pipeline.openspec.tool.sinceVersionOrEarlier', { version: formatted });
    }
    return t('pipeline.openspec.tool.sinceVersion', { version: formatted });
  }

  return t('pipeline.openspec.tool.afterCycleVersion', { version: formatToolVersionNumber(cycleVersion) });
}
