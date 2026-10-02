# Claude Code 2.1.284: modelos e intensidad (medido el 2026-10-02)

- No hay orden para listar modelos (`claude models` no existe: lo toma como un pedido y contesta).
- `--model <modelo>`: «an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's
  full name». Con `-p --output-format json`, `modelUsage` trae el nombre completo que respondió
  (`haiku` → `claude-haiku-4-5-20251001`).
- `--effort <level>`: «Effort level for the current session (low, medium, high, xhigh, max)». La misma
  lista para todos los modelos: `haiku` aceptó `low`, `xhigh` y `max` (32, 70 y 64 tokens de pensamiento
  para «Respondé sólo con: ok»). No dice cuál es el nivel por omisión.
- Un nivel desconocido no falla: «Warning: Unknown --effort value 'ultra' — ignoring it and using the
  default effort. Valid values: low, medium, high, xhigh, max.» y contesta igual.
