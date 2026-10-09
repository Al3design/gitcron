# Spec Delta

## MODIFIED Requirements

### Requirement: Selección de transporte por fuente
Pipeline SHALL preferir protocolo estructurado/versionado, luego ACP, luego CLI JSON/JSONL y finalmente hooks/filesystem como degradación, entre los transportes que exponen lo que la sesión necesita (como mínimo, elegir el modelo que la persona eligió). Un transporte preferido que no lo expone SHALL descartarse con el motivo medido. Pipeline SHALL NOT depender de un gateway orquestador para abrir sesiones directas, y SHALL NOT exponer estado de conexión con uno.

Medido el 2026-09-29 con OpenCode 2.0.20: por ACP la sesión ofrece 419 modelos y no incluye los proveedores propios de la persona (`unslothpc`, `unslothpclocal`), que `opencode models` sí lista (442); `opencode run -m <proveedor>/<modelo>#<variante> --format json` los usa. Por eso OpenCode se lanza por CLI JSON.

#### Scenario: Codex directo
- **WHEN** una sesión Codex expone JSONL o app-server
- **THEN** el adaptador directo normaliza sus eventos bajo el mismo contrato, sin intermediarios

#### Scenario: Sin estado de gateway en el renderer
- **WHEN** el renderer recibe un snapshot de Pipeline
- **THEN** no contiene ningún campo que declare conexión o desconexión con un orquestador externo

#### Scenario: Transporte preferido que no deja elegir el modelo
- **WHEN** el transporte ACP de un runtime no ofrece el modelo elegido y su CLI JSON sí
- **THEN** la sesión se abre por CLI JSON y el descarte de ACP queda anotado con su motivo
