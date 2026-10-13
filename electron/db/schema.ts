export interface Migration {
  version: number;
  statements: string[];
}

export const LATEST_SCHEMA_VERSION = 8;

export const PREDICTION_RUN_TABLE = 'prediction_run';
export const SPECULATIVE_BRANCH_TABLE = 'speculative_branch';
export const BRANCH_DECISION_TABLE = 'branch_decision';
export const PIPELINE_REPO_TABLE = 'pipeline_repo';
export const PIPELINE_SNAPSHOT_TABLE = 'pipeline_snapshot';
export const PIPELINE_EVENT_TABLE = 'pipeline_event';
export const PIPELINE_CURSOR_TABLE = 'pipeline_cursor';
export const PIPELINE_RUNTIME_SESSION_TABLE = 'pipeline_runtime_session';
export const AI_USE_RECORD_TABLE = 'ai_use_record';
export const ASSIST_CONVERSATION_TABLE = 'assist_conversation';
export const ASSIST_MESSAGE_TABLE = 'assist_message';
export const ASSIST_MESSAGE_REFERENCE_TABLE = 'assist_message_reference';

export const TEMPORAL_AGENT_INDEXES = [
  'idx_run_repo',
  'idx_run_repo_generated',
  'idx_run_device',
  'idx_run_input_hash',
  'idx_branch_run',
  'idx_decision_branch',
  'idx_decision_device',
] as const;

const CREATE_PREDICTION_RUN_TABLE = `
CREATE TABLE prediction_run (
  id                 TEXT    PRIMARY KEY,
  repo_path          TEXT    NOT NULL,
  device_id          TEXT    NOT NULL,
  device_label       TEXT,
  provider           TEXT    NOT NULL,
  model              TEXT,
  app_version        TEXT,
  context_scope      TEXT    NOT NULL,
  input_commit_count INTEGER,
  web_trends         INTEGER NOT NULL DEFAULT 0,
  head_sha           TEXT,
  input_hash         TEXT,
  generated_at       TEXT    NOT NULL,
  created_at         TEXT    NOT NULL
) STRICT;
`;

const CREATE_SPECULATIVE_BRANCH_TABLE = `
CREATE TABLE speculative_branch (
  id           TEXT    PRIMARY KEY,
  run_id       TEXT    NOT NULL REFERENCES prediction_run(id),
  source_id    TEXT,
  message      TEXT    NOT NULL,
  description  TEXT,
  rationale    TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  confidence   REAL    NOT NULL
) STRICT;
`;

const CREATE_BRANCH_DECISION_TABLE = `
CREATE TABLE branch_decision (
  id               TEXT    PRIMARY KEY,
  branch_id        TEXT    NOT NULL REFERENCES speculative_branch(id),
  device_id        TEXT    NOT NULL,
  decision         TEXT    NOT NULL,
  materialized_ref TEXT,
  note             TEXT,
  decided_at       TEXT    NOT NULL
) STRICT;
`;

const CREATE_INDEXES = [
  'CREATE INDEX idx_run_repo           ON prediction_run(repo_path);',
  'CREATE INDEX idx_run_repo_generated ON prediction_run(repo_path, generated_at);',
  'CREATE INDEX idx_run_device         ON prediction_run(device_id);',
  'CREATE INDEX idx_run_input_hash     ON prediction_run(input_hash);',
  'CREATE INDEX idx_branch_run         ON speculative_branch(run_id);',
  'CREATE INDEX idx_decision_branch    ON branch_decision(branch_id);',
  'CREATE INDEX idx_decision_device    ON branch_decision(device_id);',
];

// ── Cartografía Fase 5 ──────────────────────────────────────────────────────
// Caché de explicaciones de nodos generadas por la IA. Reutiliza la disciplina
// de persistencia del Temporal Agent (misma DB, mismas migraciones), pero es una
// tabla aparte: una explicación por (repo, nodo, contenido, idioma). La clave por
// CONTENIDO (`content_hash`) es lo que evita re-gastar el modelo si el nodo no
// cambió, y lo que invalida la caché en cuanto su código cambia.
const CREATE_CARTO_EXPLANATION_TABLE = `
CREATE TABLE carto_explanation (
  id           TEXT    PRIMARY KEY,
  repo_path    TEXT    NOT NULL,
  node_path    TEXT    NOT NULL,
  content_hash TEXT    NOT NULL,
  lang         TEXT    NOT NULL,
  provider     TEXT    NOT NULL,
  model        TEXT,
  explanation  TEXT    NOT NULL,
  generated_at TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
) STRICT;
`;

const CREATE_CARTO_EXPLANATION_INDEXES = [
  // Clave de búsqueda/caché: misma celda lógica = mismo repo+nodo+contenido+idioma.
  'CREATE UNIQUE INDEX idx_carto_expl_key ON carto_explanation(repo_path, node_path, content_hash, lang);',
  // Para podar versiones viejas de un nodo (mismo repo+nodo+idioma, otro hash).
  'CREATE INDEX idx_carto_expl_node ON carto_explanation(repo_path, node_path, lang);',
];

// ── Cartografía Fase 8 ──────────────────────────────────────────────────────
// Texto top-down generado por IA para Panorama. La estructura que lo fundamenta
// se calcula aparte, de forma determinista y local. Esta tabla guarda sólo la
// narración del proyecto y sus recorridos guiados para un hash estructural dado.
const CREATE_CARTO_PANORAMA_TABLE = `
CREATE TABLE carto_panorama (
  id             TEXT    PRIMARY KEY,
  repo_path      TEXT    NOT NULL,
  structure_hash TEXT    NOT NULL,
  lang           TEXT    NOT NULL,
  provider       TEXT    NOT NULL,
  model          TEXT,
  one_line       TEXT    NOT NULL,
  paragraph      TEXT    NOT NULL,
  flows_json     TEXT    NOT NULL,
  generated_at   TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
) STRICT;
`;

const CREATE_CARTO_PANORAMA_INDEXES = [
  'CREATE UNIQUE INDEX idx_carto_panorama_key ON carto_panorama(repo_path, structure_hash, lang);',
  'CREATE INDEX idx_carto_panorama_repo ON carto_panorama(repo_path, lang);',
];

const CREATE_PIPELINE_TABLES = [
  `CREATE TABLE pipeline_repo (
    repo_id               TEXT PRIMARY KEY,
    canonical_path        TEXT NOT NULL UNIQUE,
    git_common_dir_digest TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  ) STRICT;`,
  `CREATE TABLE pipeline_snapshot (
    repo_id     TEXT PRIMARY KEY REFERENCES pipeline_repo(repo_id) ON DELETE CASCADE,
    sequence    INTEGER NOT NULL,
    state_json  TEXT NOT NULL,
    captured_at TEXT NOT NULL
  ) STRICT;`,
  `CREATE TABLE pipeline_event (
    repo_id      TEXT NOT NULL REFERENCES pipeline_repo(repo_id) ON DELETE CASCADE,
    event_id     TEXT NOT NULL,
    sequence     INTEGER NOT NULL,
    kind         TEXT NOT NULL,
    observed_at  TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (repo_id, event_id),
    UNIQUE (repo_id, sequence)
  ) STRICT;`,
  `CREATE TABLE pipeline_cursor (
    repo_id     TEXT NOT NULL REFERENCES pipeline_repo(repo_id) ON DELETE CASCADE,
    source_ref  TEXT NOT NULL,
    offset      INTEGER NOT NULL,
    pending     TEXT NOT NULL,
    generation  TEXT,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (repo_id, source_ref)
  ) STRICT;`,
  'CREATE INDEX idx_pipeline_event_repo_sequence ON pipeline_event(repo_id, sequence);',
];

const CREATE_PIPELINE_RUNTIME_SESSION_TABLES = [
  `CREATE TABLE pipeline_runtime_session (
    repo_id         TEXT NOT NULL REFERENCES pipeline_repo(repo_id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL,
    change_id       TEXT,
    task_id         TEXT,
    runtime         TEXT NOT NULL,
    role            TEXT NOT NULL,
    outcome         TEXT NOT NULL CHECK (outcome IN ('running', 'completed', 'failed', 'interrupted', 'unknown')),
    started_at      TEXT NOT NULL,
    ended_at        TEXT,
    projection_json TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (repo_id, session_id)
  ) STRICT;`,
  'CREATE INDEX idx_pipeline_runtime_session_repo_started ON pipeline_runtime_session(repo_id, started_at DESC);',
  'CREATE INDEX idx_pipeline_runtime_session_change ON pipeline_runtime_session(repo_id, change_id, started_at DESC);',
];

const CREATE_AI_USE_RECORD_TABLE = `
CREATE TABLE ai_use_record (
  id                     TEXT    PRIMARY KEY,
  repo_path              TEXT    NOT NULL,
  branch                 TEXT,
  device_id              TEXT    NOT NULL,
  device_label           TEXT,
  use                    TEXT    NOT NULL,
  started_at             TEXT    NOT NULL,
  ended_at               TEXT    NOT NULL,
  duration_ms            INTEGER NOT NULL,
  family                 TEXT    NOT NULL,
  provider_id            TEXT    NOT NULL,
  provider_name          TEXT    NOT NULL,
  model_id               TEXT    NOT NULL,
  reasoning_effort       TEXT,
  variant                TEXT,
  effective_request_json TEXT    NOT NULL,
  prompt_sent            TEXT    NOT NULL,
  result_status          TEXT    NOT NULL,
  result_text            TEXT,
  prompt_tokens          INTEGER,
  cached_prompt_tokens   INTEGER,
  completion_tokens      INTEGER,
  reasoning_tokens       INTEGER,
  commit_hash            TEXT,
  commit_edited          INTEGER,
  created_at             TEXT    NOT NULL
) STRICT;
`;

const CREATE_AI_USE_RECORD_INDEXES = [
  'CREATE INDEX idx_ai_use_record_repo_started ON ai_use_record(repo_path, started_at DESC);',
];

const CREATE_ASSIST_TABLES = [
  `CREATE TABLE assist_conversation (
  id            TEXT PRIMARY KEY,
  checkout_path TEXT NOT NULL,
  title         TEXT NOT NULL,
  view_id       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;`,
  `CREATE INDEX idx_assist_conversation_checkout_updated
  ON assist_conversation(checkout_path, updated_at DESC);`,
  `CREATE TABLE assist_message (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL,
  seq             INTEGER NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  text            TEXT    NOT NULL,
  provider_name   TEXT,
  model_id        TEXT,
  created_at      TEXT    NOT NULL,
  UNIQUE (conversation_id, seq)
) STRICT;`,
  `CREATE TABLE assist_message_reference (
  message_id     TEXT    NOT NULL,
  ord            INTEGER NOT NULL,
  selection_json TEXT    NOT NULL,
  head_sha       TEXT,
  status         TEXT    NOT NULL CHECK (status IN ('ok', 'stale')),
  PRIMARY KEY (message_id, ord)
) STRICT;`,
];

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      CREATE_PREDICTION_RUN_TABLE,
      CREATE_SPECULATIVE_BRANCH_TABLE,
      CREATE_BRANCH_DECISION_TABLE,
      ...CREATE_INDEXES,
    ],
  },
  {
    version: 2,
    statements: [
      CREATE_CARTO_EXPLANATION_TABLE,
      ...CREATE_CARTO_EXPLANATION_INDEXES,
    ],
  },
  {
    version: 3,
    statements: [
      CREATE_CARTO_PANORAMA_TABLE,
      ...CREATE_CARTO_PANORAMA_INDEXES,
    ],
  },
  {
    version: 4,
    statements: CREATE_PIPELINE_TABLES,
  },
  {
    version: 5,
    statements: CREATE_PIPELINE_RUNTIME_SESSION_TABLES,
  },
  {
    // `pipeline_cursor` guardaba el avance de lectura de los JSONL del kit
    // multi-agente retirado. Sin esas fuentes la tabla no tiene qué registrar.
    //
    // Se elimina en una migración nueva en vez de editar la 4: una migración ya
    // distribuida describe el estado de bases que existen allá afuera, y
    // cambiarla las dejaría en una versión que ningún paso reproduce. Una
    // instalación limpia crea la tabla en la 4 y la elimina acá, que es más
    // ruidoso pero correcto.
    version: 6,
    statements: ['DROP TABLE IF EXISTS pipeline_cursor;'],
  },
  {
    // Historial de usos de IA por repositorio (tarea 4.6 de modelos-en-casa, D19).
    // Guarda qué escribió cada IA, motor, modelo, máquina, cuándo, duración, tokens,
    // el pedido efectivo saneado y lo enviado completo, fuera del repositorio.
    version: 7,
    statements: [
      CREATE_AI_USE_RECORD_TABLE,
      ...CREATE_AI_USE_RECORD_INDEXES,
    ],
  },
  {
    // Conversaciones con la IA por repositorio (tareas 2.1 y 2.2 de retomar).
    // Guarda el historial de preguntas, respuestas, modelos y referencias de
    // contexto saneadas por ruta canónica de checkout, sin secretos ni razonamiento.
    version: 8,
    statements: CREATE_ASSIST_TABLES,
  },
];
