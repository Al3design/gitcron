# Descripciones de las herramientas de OpenSpec 1.14.0

Investigado el 2026-10-01 para la tarea 1.2. Una fila por id de la lista de OpenSpec 1.14.0 (50). La
implementación copia los textos tal cual (D4). Se describe qué es la herramienta, no sus características, para
que el texto no envejezca con cada versión.

Fuentes, en orden de preferencia: el comentario del adaptador de comandos dentro del paquete de OpenSpec 1.14.0
(`dist/core/command-generation/adapters/<id>.js`, que trae el enlace oficial de varias), la documentación de
herramientas de OpenSpec (`docs/supported-tools.md` del repositorio Fission-AI/OpenSpec), y la página oficial o
una nota de prensa de la herramienta.

Ninguna quedó «sin confirmar». Notas de la investigación:
- `roocode` se llama «Zoo Code» desde que Roo Code archivó su repositorio (mayo de 2026); Zoo Code es la
  continuación comunitaria. El id sigue siendo `roocode`.
- `bob` se llama «IBM Bob» desde 1.14 (antes «Bob Shell»).
- `easycode` es el de OrionStarAI (antes «DeepV Code»), según el adaptador de OpenSpec; hay otro producto con el
  mismo nombre, de Toronto, que no es éste.
- `gsd` es «Get Shit Done» en su versión de agente propio (GSD 2, construido sobre Pi); detecta la carpeta `.gsd`
  y escribe sus instrucciones en `.agents`.
- `agents` no es una herramienta: es la carpeta compartida que leen varias.
- Usan la carpeta compartida `.agents` para sus instrucciones: `codex`, `amp`, `gsd`, `antigravity` y `zed`
  (dato de AI_TOOLS de 1.14.0; importa para D2).

| id | es | en | zh | fuente |
|---|---|---|---|---|
| agents | Carpeta compartida `.agents`: las instrucciones que leen varias herramientas a la vez. | Shared `.agents` folder: instructions read by several tools at once. | 共享的 `.agents` 文件夹：多个工具同时读取的指令。 | docs/supported-tools.md de OpenSpec («Vendor-neutral skills-only target for multiple agents») |
| amazon-q | Asistente de programación con IA de Amazon Web Services, para el editor y la terminal. | Amazon Web Services' AI coding assistant for the editor and the terminal. | Amazon Web Services 的 AI 编程助手，可用于编辑器和终端。 | aws.amazon.com/q/developer |
| amp | Agente de programación Amp, para la terminal y el editor. | Amp coding agent, for the terminal and the editor. | Amp 编程智能体，可用于终端和编辑器。 | ampcode.com |
| antigravity | Entorno de desarrollo de Google centrado en agentes de IA. | Google's agent-first development environment. | Google 以 AI 智能体为中心的开发环境。 | antigravity.google |
| atomcode | Agente de programación de código abierto para la terminal, integrado con AtomGit. | Open-source terminal coding agent, integrated with AtomGit. | 开源终端编程智能体，与 AtomGit 集成。 | Adaptador de OpenSpec → github.com/atomgit-atomcode/atomcode; slashdot.org/software/p/AtomCode |
| auggie | Auggie, la versión de terminal del agente de Augment Code. | Auggie, the terminal version of Augment Code's agent. | Auggie，Augment Code 智能体的终端版本。 | augmentcode.com |
| bob | IBM Bob, el asistente de desarrollo con IA de IBM. | IBM Bob, IBM's AI development assistant. | IBM Bob，IBM 的 AI 开发助手。 | AI_TOOLS de 1.14.0 («IBM Bob»); ibm.com |
| claude | Claude Code, el agente de programación de Anthropic para la terminal y el editor. | Claude Code, Anthropic's coding agent for the terminal and the editor. | Claude Code，Anthropic 面向终端和编辑器的编程智能体。 | claude.com/product/claude-code |
| cline | Agente de programación de código abierto que funciona como extensión de VS Code. | Open-source coding agent that runs as a VS Code extension. | 以 VS Code 扩展形式运行的开源编程智能体。 | cline.bot |
| codeartsagent | CodeArts Agent, el asistente de programación con IA de Huawei Cloud. | CodeArts Agent, Huawei Cloud's AI coding assistant. | CodeArts Agent，华为云的 AI 编程助手。 | support.huaweicloud.com (CodeArts Agent) |
| codeassistant | Extensión de VS Code de la plataforma de desarrollo SourceCraft. | VS Code extension of the SourceCraft development platform. | SourceCraft 开发平台的 VS Code 扩展。 | Adaptador de OpenSpec → sourcecraft.dev |
| codebuddy | CodeBuddy Code, el agente de programación de terminal de Tencent Cloud. | CodeBuddy Code, Tencent Cloud's terminal coding agent. | CodeBuddy Code，腾讯云的终端编程智能体。 | tencentcloud.com/document/product/1256/77266 |
| codestudio | Code Studio, el entorno de desarrollo con IA de Syncfusion. | Code Studio, Syncfusion's AI development environment. | Code Studio，Syncfusion 的 AI 开发环境。 | Adaptador de OpenSpec («Syncfusion Code Studio»); help.syncfusion.com/code-studio |
| codex | Codex, el agente de programación de OpenAI para la terminal y el editor. | Codex, OpenAI's coding agent for the terminal and the editor. | Codex，OpenAI 面向终端和编辑器的编程智能体。 | github.com/openai/codex |
| command-code | Agente de programación de terminal que aprende el estilo de código de quien lo usa. | Terminal coding agent that learns its user's coding style. | 能学习使用者代码风格的终端编程智能体。 | terminaltrove.com/ai-coding-agents/commandcode |
| continue | Asistente de programación de código abierto para VS Code y JetBrains. | Open-source coding assistant for VS Code and JetBrains. | 适用于 VS Code 和 JetBrains 的开源编程助手。 | continue.dev |
| costrict | CoStrict, asistente de programación de código abierto de Sangfor, pensado para empresas. | CoStrict, Sangfor's open-source coding assistant for companies. | CoStrict，深信服面向企业的开源编程助手。 | github.com/zgsm-ai/costrict; sangfor.com |
| crush | Agente de programación de código abierto para la terminal, de Charm. | Open-source terminal coding agent by Charm. | Charm 推出的开源终端编程智能体。 | github.com/charmbracelet/crush |
| cursor | Editor de código con IA basado en VS Code. | AI code editor based on VS Code. | 基于 VS Code 的 AI 代码编辑器。 | cursor.com |
| devin | Devin Desktop, el entorno de desarrollo de Cognition que antes se llamaba Windsurf. | Devin Desktop, Cognition's development environment, formerly Windsurf. | Devin Desktop，Cognition 的开发环境，前身为 Windsurf。 | docs/supported-tools.md de OpenSpec → docs.devin.ai/desktop/devin-desktop-faq |
| dsh | DeepSeek Harness, el entorno de agentes de código abierto de DeepSeek, armado con complementos. | DeepSeek Harness, DeepSeek's open-source, plugin-based agent framework. | DeepSeek Harness，DeepSeek 基于插件的开源智能体框架。 | apidog.com/blog/what-is-deepseek-harness; docs.kanaries.net |
| easycode | EasyCode de OrionStar (antes DeepV Code), asistente de programación para la terminal y VS Code. | OrionStar's EasyCode (formerly DeepV Code), coding assistant for the terminal and VS Code. | 猎户星空的 EasyCode（原 DeepV Code），适用于终端和 VS Code 的编程助手。 | Adaptador de OpenSpec → github.com/OrionStarAI/EasyCode |
| factory | Droid, el agente de programación de Factory. | Droid, Factory's coding agent. | Droid，Factory 的编程智能体。 | factory.ai |
| forgecode | ForgeCode, agente de programación de código abierto para la terminal. | ForgeCode, open-source terminal coding agent. | ForgeCode，开源终端编程智能体。 | github.com/antinomyhq/forge |
| gemini | Gemini CLI, el agente de programación de Google para la terminal. | Gemini CLI, Google's terminal coding agent. | Gemini CLI，Google 的终端编程智能体。 | github.com/google-gemini/gemini-cli |
| github-copilot | GitHub Copilot, el asistente de programación con IA de GitHub. | GitHub Copilot, GitHub's AI coding assistant. | GitHub Copilot，GitHub 的 AI 编程助手。 | github.com/features/copilot |
| gigacode | GigaCode, el asistente de programación con IA de Sber. | GigaCode, Sber's AI coding assistant. | GigaCode，俄罗斯联邦储蓄银行（Sber）的 AI 编程助手。 | Adaptador de OpenSpec → gitverse.ru/docs/ai/ai-assistant-gigacode; sber.pro |
| grok | Grok Build, el agente de programación de terminal de xAI. | Grok Build, xAI's terminal coding agent. | Grok Build，xAI 的终端编程智能体。 | runtimewire.com/article/xai-grok-build-agentic-cli-early-beta |
| gsd | GSD («Get Shit Done»), agente de desarrollo guiado por especificaciones, construido sobre Pi. | GSD ("Get Shit Done"), a spec-driven development agent built on Pi. | GSD（"Get Shit Done"），基于 Pi 构建的规格驱动开发智能体。 | github.com/gsd-build (GSD 2); skills.sh/ctsstc/get-shit-done-skills |
| hermes | Hermes Agent, el agente de código abierto de Nous Research que escribe sus propias habilidades. | Hermes Agent, Nous Research's open-source agent that writes its own skills. | Hermes Agent，Nous Research 的开源智能体，会自行编写技能。 | landscape.jimmysong.io/projects/hermes-agent |
| iflow | iFlow CLI, asistente de IA para la terminal de un equipo vinculado a Alibaba. | iFlow CLI, a terminal AI assistant from an Alibaba-affiliated team. | iFlow CLI，阿里系团队推出的终端 AI 助手。 | platform.iflow.cn/en/cli/quickstart |
| junie | Junie, el agente de programación de JetBrains. | Junie, JetBrains' coding agent. | Junie，JetBrains 的编程智能体。 | jetbrains.com/junie |
| kilocode | Kilo Code, agente de programación de código abierto para VS Code y JetBrains. | Kilo Code, open-source coding agent for VS Code and JetBrains. | Kilo Code，适用于 VS Code 和 JetBrains 的开源编程智能体。 | kilo.ai |
| kimi | Kimi Code, el agente de programación de terminal de Moonshot AI. | Kimi Code, Moonshot AI's terminal coding agent. | Kimi Code，月之暗面（Moonshot AI）的终端编程智能体。 | github.com/MoonshotAI/kimi-cli |
| kiro | Kiro, el entorno de desarrollo de Amazon Web Services guiado por especificaciones. | Kiro, Amazon Web Services' spec-driven development environment. | Kiro，Amazon Web Services 的规格驱动开发环境。 | README de OpenSpec 1.14.0 («Kiro (AWS)»); kiro.dev |
| lingma | Lingma (Tongyi Lingma), el asistente de programación con IA de Alibaba Cloud. | Lingma (Tongyi Lingma), Alibaba Cloud's AI coding assistant. | 通义灵码（Lingma），阿里云的 AI 编程助手。 | lingma.aliyun.com |
| minimax-code | MiniMax Code, el agente de programación de terminal de MiniMax. | MiniMax Code, MiniMax's terminal coding agent. | MiniMax Code，MiniMax 的终端编程智能体。 | technode.com/2026/09/21/minimax-open-sources-minimax-code-terminal-coding-agent; agent.minimax.io/docs/cli |
| oh-my-pi | Oh My Pi, versión ampliada del agente Pi con más herramientas incluidas. | Oh My Pi, an expanded version of the Pi agent with more built-in tools. | Oh My Pi，Pi 智能体的扩展版本，内置更多工具。 | composio.dev/blog/pi-vs-omp |
| opencode | OpenCode, agente de programación de código abierto para la terminal. | OpenCode, open-source terminal coding agent. | OpenCode，开源终端编程智能体。 | opencode.ai |
| pi | Pi, agente de programación mínimo para la terminal. | Pi, a minimal terminal coding agent. | Pi，极简的终端编程智能体。 | Adaptador de OpenSpec («Pi (pi.dev)»); composio.dev/blog/pi-vs-omp |
| qoder | Qoder, la plataforma de programación con agentes de Alibaba. | Qoder, Alibaba's agentic coding platform. | Qoder，阿里巴巴的智能体编程平台。 | help.aliyun.com/en/model-studio/qoder-agent |
| qwen | Qwen Code, el agente de programación de terminal del equipo Qwen de Alibaba. | Qwen Code, the terminal coding agent from Alibaba's Qwen team. | Qwen Code，阿里巴巴通义千问团队的终端编程智能体。 | Adaptador de OpenSpec → qwenlm.github.io/qwen-code-docs |
| roocode | Zoo Code, la continuación comunitaria de Roo Code como extensión de VS Code. | Zoo Code, the community continuation of Roo Code as a VS Code extension. | Zoo Code，Roo Code 的社区延续版本，作为 VS Code 扩展。 | docs/supported-tools.md de OpenSpec → github.com/Zoo-Code-Org/Zoo-Code |
| rovodev | Rovo Dev CLI, el agente de programación de terminal de Atlassian. | Rovo Dev CLI, Atlassian's terminal coding agent. | Rovo Dev CLI，Atlassian 的终端编程智能体。 | docs/supported-tools.md de OpenSpec → support.atlassian.com/rovo/docs/use-rovo-dev-cli |
| trae | Trae, el entorno de desarrollo con IA de ByteDance. | Trae, ByteDance's AI development environment. | Trae，字节跳动的 AI 开发环境。 | trae.ai |
| veai | Veai, agente de IA para los entornos de JetBrains. | Veai, an AI agent for JetBrains IDEs. | Veai，适用于 JetBrains IDE 的 AI 智能体。 | jpoint.ru/en/partners/veai; marketplace.openide.ru/plugin/veai-ai-agent |
| vibe | Mistral Vibe, el agente de programación de terminal de Mistral AI. | Mistral Vibe, Mistral AI's terminal coding agent. | Mistral Vibe，Mistral AI 的终端编程智能体。 | docs.mistral.ai/mistral-vibe/overview |
| warp | Warp, terminal con agentes de IA integrados. | Warp, a terminal with built-in AI agents. | Warp，内置 AI 智能体的终端。 | warp.dev |
| zcode | ZCode, el entorno de desarrollo con agentes de Z.ai (antes Zhipu AI). | ZCode, the agentic development environment from Z.ai (formerly Zhipu AI). | ZCode，Z.ai（原智谱 AI）的智能体开发环境。 | techzine.eu/news/devops/142702/z-ai-takes-on-cursor-and-claude-code-with-free-zcode |
| zed | Zed Agent, el agente integrado en el editor Zed. | Zed Agent, the agent built into the Zed editor. | Zed Agent，Zed 编辑器内置的智能体。 | docs/supported-tools.md de OpenSpec → zed.dev/docs/ai/skills |
