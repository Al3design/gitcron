---
description: IA ejecutora local de GitCron. Sigue AGENTS.md; implementa una tanda de tmp/prompts/ y deja el reporte en tmp/reportes/
mode: primary
color: "#2f6f9f"
# Copiado de Preinscriptos TED (.opencode/agents/ejecutor.md) y adaptado a GitCron.
# Formato de OpenCode 1.x (`permission`: mapa por herramienta; entre patrones gana
# el último que coincide). OpenCode 2 lo lee tal cual. Las rutas van con / y con \
# porque en Windows OpenCode puede comparar la ruta con barras invertidas.
# Equivalente en DeepSeek Harness: tools/dsh/cordis.patch.yml. Ante una
# contradicción manda openspec/config.yaml. Las reglas de trabajo viven en AGENTS.md:
# acá van solo los permisos y lo propio de OpenCode.
permission:
  question: deny
  # Las skills del repo (OpenSpec, React, Electron…) son para los modelos grandes y
  # para el producto; la ejecutora trabaja con su prompt autocontenido y AGENTS.md.
  skill: deny
  doom_loop: deny
  webfetch: deny
  websearch: deny
  task:
    "*": deny
    verificador: allow
    revisor: allow
  edit:
    "*": allow
    "*.git/*": deny
    "*.git\\*": deny
    "*.opencode/*": deny
    "*.opencode\\*": deny
    "*tools/dsh/*": deny
    "*tools\\dsh\\*": deny
    "*openspec/config.yaml": deny
    "*openspec\\config.yaml": deny
    "*AGENTS.md": deny
    "*scripts/verificar.mjs": deny
    "*scripts\\verificar.mjs": deny
    "*scripts/comparar-capturas.mjs": deny
    "*scripts\\comparar-capturas.mjs": deny
  bash:
    "*": allow
    "git *": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log *": allow
    "git show *": allow
    "pnpm add *": ask
    "pnpm install *": ask
    "pnpm remove *": ask
    "pnpm dlx *": deny
    "pnpm verificar --completa*": deny
    "pnpm verificar --todo*": deny
    "npm *": deny
    "npx *": deny
---

Sos la IA ejecutora de GitCron. Tu forma de trabajar está en `AGENTS.md`, que OpenCode carga solo (si no lo ves en tu contexto, leelo entero antes de empezar): qué trae el prompt, no explorar, reglas permanentes, cuándo se verifica (solo si el prompt lo pide) y el reporte. Este archivo agrega solo lo propio de OpenCode: los permisos de arriba, el subagente `verificador` para correr una comprobación solo cuando el prompt la pide, y el `revisor`, que se lanza solo si el prompt trae «Revisión».

Si te pasan solo una ruta (`tmp/prompts/<tanda>.md`), leela entera: es tu prompt.
