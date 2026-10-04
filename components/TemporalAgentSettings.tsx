'use client';

// components/TemporalAgentSettings.tsx
// Per-repo Settings panel for the Temporal Agent (Phase 0).
// Panel de configuración por repositorio para el Agente Temporal.
// Tokens de interfaz alineados con el sistema Carbon Soul (Shared / Semantics).

import { useEffect, useMemo, useState } from 'react';
import { useRotatingThoughts } from '@/hooks/use-rotating-thoughts';
import type {
  TemporalAgentConfig,
  AnalysisFrequency,
  PrivacyScope,
  PredictionResult,
} from '@/types/temporal-agent';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { Brain, Cpu } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { AiUseLine } from './ai/AiUseLine';
import { AiSentDetails } from './ai/AiSentDetails';

const COLOR_SUCCESS = 'var(--color-git-add)';
const COLOR_PRIMARY = 'var(--color-primary)';
const COLOR_WARNING = 'var(--color-warning)';

interface Props {
  repoPath: string;
  repoName: string;
  /** Capa 1: lift the fresh prediction up so the graph can draw it this session. */
  onPrediction?: (result: PredictionResult) => void;
  /** Capa 2C: notify parent when config is saved so threshold filters reactively. */
  onConfigSaved?: (config: TemporalAgentConfig) => void;
  /** Navegar a la sección Motores y modelos en Ajustes. */
  onNavigateToAiModels?: () => void;
}

export function TemporalAgentSettings({ repoPath, repoName, onPrediction, onConfigSaved, onNavigateToAiModels }: Props) {
  const t = useT();
  const language = useGitStore((s) => s.language);
  const [config, setConfig] = useState<TemporalAgentConfig | null>(null);
  const [notesMd, setNotesMd] = useState<string>('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Prediction trigger (Phase 4: provider is stubbed in main; draw is Phase 5).
  const [predicting, setPredicting] = useState(false);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // States for interactive thinking messages and progress bar
  const [animatedProgress, setAnimatedProgress] = useState(0);

  useEffect(() => {
    let alive = true;
    window.api.temporalAgent.loadConfig(repoPath, repoName).then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, [repoPath, repoName]);

  // Quitar el modelo propio del repositorio se guarda en el acto y sin arrastrar lo demás
  // que esté sin guardar en la pantalla: se parte de la configuración guardada.
  async function removeRepoModel() {
    setSaveError(null);
    try {
      const saved = await window.api.temporalAgent.loadConfig(repoPath, repoName);
      const next: TemporalAgentConfig = { ...saved, model: undefined };
      await window.api.temporalAgent.saveConfig(repoPath, next);
      patch({ model: undefined });
      onConfigSaved?.(next);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function predict() {
    setPredicting(true);
    setPredictError(null);
    setCancelled(false);
    setResult(null);
    try {
      if (config) {
        await window.api.temporalAgent.saveConfig(repoPath, config);
        onConfigSaved?.(config);
      }
      const r = await window.api.ai.predictTimelines(repoPath, repoName, language);
      if (r.success && r.data) {
        setResult(r.data);
        // Capa 1: lift the result so the graph draws it (main already persisted it).
        onPrediction?.(r.data);
      } else {
        setPredictError(r.error ?? 'Prediction failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('AbortError') || msg.includes('cancelada')) {
        setCancelled(true);
        setTimeout(() => setCancelled(false), 4000);
      } else {
        setPredictError(msg);
      }
    } finally {
      setPredicting(false);
    }
  }

  async function cancelPrediction() {
    await window.api.ai.cancelPrediction();
  }

  // Curated list of funny and thoughtful loading phrases in Spanish and English (50+ items)
  const THOUGHTS_ES = [
    'Alineando los punteros del reflog...',
    'Analizando la entropía de tus commits recientes...',
    'Evitando bucles infinitos en el continuo espacio-tiempo...',
    'Consultando las profecías de Linus Torvalds...',
    'Persuadiendo a la IA de no generar conflictos de merge...',
    'Ignorando node_modules con extrema firmeza...',
    'Buscando ramas en universos paralelos...',
    'Calculando la probabilidad de romper producción (esperemos que 0%)...',
    'Descifrando mensajes de commit misteriosos...',
    'Summoning the Garbage Collector daemon...',
    'Verificando si dejaste contraseñas en el código (por las dudas)...',
    'Preguntándole al oráculo de git qué viene ahora...',
    'Buscando la iluminación en un mar de diffs...',
    'Tratando de entender por qué esa función tiene 32 parámetros...',
    'Conectando hemisferios cuánticos del Temporal Agent...',
    'Configurando condensador de flujos temporal...',
    'Alimentando a los hámsteres que hacen girar el servidor...',
    'Negociando diplomáticamente con el recolector de basura...',
    'Buscando café virtual para el agente de IA...',
    'Desenrollando bucles infinitos con mucho cuidado...',
    'Calculando la probabilidad de que funcione a la primera (99.9% de fe)...',
    'Pidiéndole permiso a Git para ver el futuro...',
    'Ocultando los bugs debajo de la alfombra de node_modules...',
    'Preguntándole a StackOverflow si esto es legal...',
    'Optimizando la velocidad de la luz en el cable de red...',
    'Alineando planetas para evitar conflictos en main...',
    'Traduciendo pensamientos analógicos a binario...',
    'Resolviendo discusiones filosóficas entre pestañas y espacios...',
    'Buscando ese punto y coma que falta desde 2024...',
    'Ignorando advertencias de compilación para mantener la paz mental...',
    'Acelerando taquiones para viajar al próximo commit...',
    'Hablando con el router en tonos amables...',
    'Reescribiendo la historia sin que Git se dé cuenta...',
    'Explicándole a la IA por qué borrar la carpeta System32 es mala idea...',
    'Enviando pings al espacio exterior...',
    'Borrando el historial de búsqueda del compilador...',
    'Alineando el reflog con la luna llena...',
    'Despertando a los duendes del procesamiento paralelo...',
    'Preguntándole a la IA si sueña con ovejas eléctricas o con commits limpios...',
    'Desactivando temporalmente las leyes de la física...',
    'Esperando a que el café haga efecto en el procesador...',
    'Limpiando el polvo digital del repositorio...',
    'Tratando de convencer a Windows Defender de que somos inocentes...',
    'Convirtiendo cafeína en código a nivel cuántico...',
    'Calentando los núcleos del procesador con algoritmos recursivos...',
    'Buscando la salida del laberinto del git rebase...',
    'Borrando cachés con desprecio...',
    'Evitando que el becario virtual rompa el grafo...',
    'Alineando los electrones en la memoria RAM...',
    'Negociando con Git para que acepte nuestra teoría del caos...',
    'Ordenando el caos cósmico de tus ramas locales...',
    'Revisando si las constantes siguen siendo constantes...',
    'Limpiando huellas digitales del reflog...',
    'Buscando el santo grial de la refactorización perfecta...',
    'Evitando que la IA se vuelva autoconsciente antes del push...',
    'Intentando entender por qué funciona pero no sabemos cómo...',
    'Peinando los grafos del árbol de Git...',
    'Preguntándole a Ada Lovelace qué opina de tu arquitectura...',
    'Comprando tiempo en la nube cuántica...',
    'Descartando posibilidades donde todo explota en producción...',
    'Sincronizando el reloj del sistema con la era espacial...',
    'Planchando arrugas temporales en la línea de tiempo...',
    'Dándole golpecitos virtuales al servidor a ver si arranca...',
    'Traduciendo bits tristes a bits felices...',
    'Invocando al espíritu de Alan Turing...',
    'Evitando que los commits se peleen entre sí...',
    'Despejando el camino especulativo de falsos positivos...'
  ];

  const THOUGHTS_EN = [
    'Aligning reflog pointers...',
    'Analyzing entropy of your recent commits...',
    'Avoiding infinite loops in the space-time continuum...',
    'Consulting with the prophecies of Linus Torvalds...',
    'Persuading the AI not to generate merge conflicts...',
    'Ignoring node_modules with extreme resolve...',
    'Searching for branches in parallel universes...',
    'Calculating probability of breaking production (hopefully 0%)...',
    'Deciphering mysterious commit messages...',
    'Summoning the Garbage Collector daemon...',
    'Double-checking you didn\'t commit secrets (just in case)...',
    'Asking the Git oracle what comes next...',
    'Seeking enlightenment in a sea of diffs...',
    'Trying to understand why that function has 32 parameters...',
    'Connecting quantum hemispheres of the Temporal Agent...',
    'Configuring the temporal flux capacitor...',
    'Feeding the hamsters that spin the server...',
    'Diplomatically negotiating with the garbage collector...',
    'Fetching virtual coffee for the AI agent...',
    'Carefully unrolling infinite loops...',
    'Calculating the probability of it working on the first run (99.9% faith)...',
    'Asking Git permission to see the future...',
    'Hiding bugs under the node_modules rug...',
    'Asking StackOverflow if this is legal...',
    'Optimizing the speed of light in the network cable...',
    'Aligning planets to avoid conflicts in main...',
    'Translating analog thoughts to binary...',
    'Resolving philosophical arguments between tabs and spaces...',
    'Searching for that missing semicolon since 2024...',
    'Ignoring compiler warnings to maintain peace of mind...',
    'Accelerating tachyons to travel to the next commit...',
    'Talking to the router in friendly tones...',
    'Rewriting history without Git noticing...',
    'Explaining to the AI why deleting System32 is a bad idea...',
    'Sending pings to outer space...',
    'Clearing the compiler\'s search history...',
    'Aligning the reflog with the full moon...',
    'Waking up the parallel processing elves...',
    'Asking the AI if it dreams of electric sheep or clean commits...',
    'Temporarily disabling the laws of physics...',
    'Waiting for coffee to take effect on the processor...',
    'Dusting the digital shelves of the repository...',
    'Trying to convince Windows Defender that we are innocent...',
    'Converting caffeine into code at a quantum level...',
    'Warming up CPU cores with recursive algorithms...',
    'Searching for the exit of the git rebase maze...',
    'Deleting caches with disdain...',
    'Preventing the virtual intern from breaking the graph...',
    'Aligning electrons in RAM...',
    'Negotiating with Git to accept our chaos theory...',
    'Ordering the cosmic chaos of your local branches...',
    'Checking if constants are still constant...',
    'Wiping digital fingerprints from the reflog...',
    'Searching for the holy grail of perfect refactoring...',
    'Preventing the AI from becoming self-aware before the push...',
    'Trying to understand why it works but we don\'t know how...',
    'Combing the Git tree graphs...',
    'Asking Ada Lovelace what she thinks of your architecture...',
    'Buying time in the quantum cloud...',
    'Discarding possibilities where everything blows up in prod...',
    'Synchronizing system clock with the space era...',
    'Ironing out temporal wrinkles in the timeline...',
    'Tapping the virtual server to see if it boots...',
    'Translating sad bits to happy bits...',
    'Summoning the spirit of Alan Turing...',
    'Preventing commits from fighting each other...',
    'Clearing the speculative path of false positives...'
  ];

  const THOUGHTS_ZH = [
    '正在对齐 reflog 指针...',
    '正在分析最近提交的熵值...',
    '正在检查未来分支的可信度...',
    '正在读取提交信息中的线索...',
    '正在估算下一步最可能的方向...',
    '正在过滤低置信度预测...',
    '正在整理仓库时间线...',
    '正在把技术信号转成清晰说明...',
    '正在评估哪些想法更接近现实...',
    '正在避免把猜测说得太确定...',
    '正在校准 Temporal Agent 的判断...',
    '正在寻找分支历史里的模式...',
    '正在比较增量改进和突破性变化...',
    '正在准备可执行的代理提示...',
    '正在保持 Git 操作只读...',
    '正在汇总未来路线的证据...',
    '正在把复杂上下文压缩成可读结论...',
    '正在检查预测是否符合当前仓库轨迹...',
    '正在让置信度和证据保持一致...',
    '正在生成候选未来分支...'
  ];

  // El ciclo de frases vive en un hook compartido: cuando hizo falta lo mismo
  // para redactar el asunto de un commit se extrajo en vez de copiarse. Acá
  // queda sólo el vocabulario, que es lo propio de esta espera.
  //
  // `useMemo` no es decorativo: las listas se recrean en cada render, y sin
  // memoizarlas el hook vería una referencia nueva cada vez y reiniciaría la
  // rotación constantemente.
  const thoughts = useMemo(
    () => (language === 'zh' ? THOUGHTS_ZH : language === 'en' ? THOUGHTS_EN : THOUGHTS_ES),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las listas son constantes por idioma
    [language],
  );
  const currentThought = useRotatingThoughts(thoughts, predicting);

  // El avance se deriva: mientras predice manda la animación, y al terminar
  const progress = predicting ? animatedProgress : (result ? 100 : 0);

  useEffect(() => {
    if (!predicting) return;

    let value = 0;
    const progressInterval = setInterval(() => {
      value = value >= 95
        ? value + (99 - value) * 0.02
        : value + (95 - value) * 0.08;
      setAnimatedProgress(value);
    }, 300);

    return () => clearInterval(progressInterval);
  }, [predicting]);

  if (!config) return <div style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.loading')}</div>;

  function patch(p: Partial<TemporalAgentConfig>) {
    setConfig((c) => (c ? { ...c, ...p } : c));
  }
  function patchSkill(p: Partial<TemporalAgentConfig['skillProfile']>) {
    setConfig((c) => (c ? { ...c, skillProfile: { ...c.skillProfile, ...p } } : c));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      await window.api.temporalAgent.saveConfig(repoPath, config);
      const now = Date.now();
      setSavedAt(now);
      setTimeout(() => setSavedAt((ts) => (ts === now ? null : ts)), 3000);
      onConfigSaved?.(config);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function openNotes() {
    const md = await window.api.temporalAgent.getNotesMarkdown(repoPath, repoName);
    setNotesMd(md);
    setShowNotes(true);
  }

  return (
    <section style={{ color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, margin: 0 }}>Temporal Agent</h3>
        <span style={{ fontSize: 'var(--font-size-xs)', color: COLOR_PRIMARY, border: `1px solid ${COLOR_PRIMARY}`, borderRadius: 'var(--radius-full)', padding: 'var(--space-1) var(--space-2)' }}>
          {t('temporalAgent.experimental')}
        </span>
      </header>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
        {t('temporalAgent.description', { repo: repoName })}
      </p>

      {/* Enable */}
      <Row label={t('temporalAgent.enableLabel')}>
        <Toggle on={config.enabled} onChange={(v) => patch({ enabled: v })} />
      </Row>

      {/* Frequency */}
      <Row label={t('temporalAgent.frequencyLabel')}>
        <select
          value={config.frequency}
          onChange={(e) => patch({ frequency: e.target.value as AnalysisFrequency })}
          style={selectStyle}
        >
          <option value="on-demand">{t('temporalAgent.freqOnDemand')}</option>
          <option value="manual">{t('temporalAgent.freqManual')}</option>
          <option value="daily">{t('temporalAgent.freqDaily')}</option>
          <option value="weekly">{t('temporalAgent.freqWeekly')}</option>
        </select>
      </Row>

      {/* Privacy scope */}
      <Row label={t('temporalAgent.contextLabel')}>
        <select
          value={config.privacyScope}
          onChange={(e) => patch({ privacyScope: e.target.value as PrivacyScope })}
          style={selectStyle}
        >
          <option value="metadata">{t('temporalAgent.scopeMetadata')}</option>
          <option value="metadata-plus-files">{t('temporalAgent.scopeMetadataPlus')}</option>
        </select>
      </Row>
      {config.privacyScope === 'metadata-plus-files' && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: COLOR_WARNING, margin: 0 }}>
          {t('temporalAgent.filenamesWarning')}
        </p>
      )}

      {/* Skill profile */}
      <div style={cardStyle}>
        <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, margin: '0 0 var(--space-3)', color: COLOR_SUCCESS }}>
          {t('temporalAgent.focusProfileHeading')}
        </h4>
        <TagInput
          label={t('temporalAgent.focusAreas')}
          tags={config.skillProfile.focusAreas}
          color={COLOR_SUCCESS}
          onChange={(tags) => patchSkill({ focusAreas: tags })}
        />
        <TagInput
          label={t('temporalAgent.avoidTopics')}
          tags={config.skillProfile.avoidTopics}
          color={COLOR_WARNING}
          onChange={(tags) => patchSkill({ avoidTopics: tags })}
        />
        <Row label={t('temporalAgent.confidenceThreshold', { val: config.skillProfile.confidenceThreshold.toFixed(2) })}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.skillProfile.confidenceThreshold}
            onChange={(e) => patchSkill({ confidenceThreshold: Number(e.target.value) })}
            style={{ accentColor: COLOR_PRIMARY, width: 180 }}
          />
        </Row>
      </div>

      {/* El modelo elegido antes para este repositorio (`config.model`): `withRepoModel` lo
          aplica sólo cuando el uso va a OpenRouter. Se muestra como dato para poder quitarlo;
          elegir modelo es en «Motores y modelos». */}
      {config?.model && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-surface p-4">
          <span className="text-xs text-text-secondary">
            {t('temporalAgent.repoModelCustom', { model: config.model })}
          </span>
          <button
            type="button"
            onClick={() => void removeRepoModel()}
            className="rounded-md border border-border-subtle px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            {t('temporalAgent.removeRepoModel')}
          </button>
        </div>
      )}

      {/* Prediction trigger — visually distinct from save/config: this is the expensive action. */}
      {/* El borde y el degradé de IA salen de la clase compartida `.ai-panel` (D20); acá
          sólo el aire y el redondeo de las demás tarjetas. */}
      <div className="ai-panel" style={aiCardStyle}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-[200px] flex-1">
            <AiUseLine use="gitcron-temporal" repoPath={repoPath} />
          </div>
          {onNavigateToAiModels && (
            <button
              type="button"
              onClick={onNavigateToAiModels}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
            >
              <Cpu size={13} />
              <span>{t('temporalAgent.goToAiModels')}</span>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', flex: 1, minWidth: 200, lineHeight: 1.4 }}>
            {t('temporalAgent.predictDesc')}{' '}
            <strong style={{ color: COLOR_WARNING }}>{t('temporalAgent.predictCost')}</strong>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
            {predicting ? (
              <>
                <button
                  disabled
                  style={{
                    ...primaryBtn,
                    background: 'var(--color-bg-surface)',
                    color: 'var(--color-ai)',
                    border: '1px solid color-mix(in srgb, var(--color-ai) 35%, transparent)',
                    fontWeight: 600,
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-3) var(--space-5)',
                    minWidth: 160,
                    cursor: 'wait',
                  }}
                >
                  <span>
                    <span className="ai-thinking-text">{t('temporalAgent.generating')}</span>
                  </span>
                </button>
                <button
                  onClick={cancelPrediction}
                  style={{
                    ...ghostBtn,
                    color: COLOR_WARNING,
                    borderColor: 'color-mix(in srgb, var(--color-warning) 31.4%, transparent)',
                    fontSize: 'var(--font-size-xs)',
                    padding: 'var(--space-2) var(--space-4)',
                  }}
                >
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button
                onClick={predict}
                style={{
                  ...primaryBtn,
                  background: 'var(--color-ai)',
                  color: 'var(--color-bg-base)',
                  fontWeight: 700,
                  fontSize: 'var(--font-size-base)',
                  padding: 'var(--space-3) var(--space-5)',
                  border: 'none',
                  borderRadius: 'var(--radius-lg)',
                  minWidth: 180,
                  boxShadow: '0 0 14px color-mix(in srgb, var(--color-ai) 25%, transparent)',
                  cursor: 'pointer',
                }}
              >
                {t('temporalAgent.predictBtn')}
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <AiSentDetails use="gitcron-temporal" busy={predicting} />
        </div>
        {predicting && (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-xs)' }}>
              <span style={{ color: 'var(--color-ai)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontWeight: 500 }}>
                <Brain size={14} className="animate-pulse" style={{ color: 'var(--color-ai)' }} />
                <span>
                  <span className="ai-thinking-text">{currentThought}</span>
                </span>
              </span>
              <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>
                <span>
                  <span className="ai-thinking-text">{Math.round(progress)}%</span>
                </span>
              </span>
            </div>
            {/* Progress Bar Container */}
            <div style={{ width: '100%', height: 4, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, var(--color-ai), ${COLOR_SUCCESS})`,
                  borderRadius: 'var(--radius-sm)',
                  transition: 'width 0.3s cubic-bezier(0.1, 0.8, 0.25, 1)',
                }}
              />
            </div>
          </div>
        )}
        {cancelled && (
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 'var(--space-3) 0 0' }}>
            {t('temporalAgent.cancelled')}
          </p>
        )}
        {predictError && (
          <p style={{ fontSize: 'var(--font-size-xs)', color: COLOR_WARNING, margin: 'var(--space-3) 0 0' }}>Error: {predictError}</p>
        )}
        {result && (
          <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'color-mix(in srgb, var(--color-git-add) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-git-add) 18.8%, transparent)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ color: COLOR_SUCCESS, fontWeight: 'bold', fontSize: 'var(--font-size-base)' }}>✓</span>
            <span style={{ color: 'var(--color-text-primary)', fontSize: 'var(--font-size-xs)' }}>
              {language === 'en'
                ? 'Prediction completed successfully! New speculative branches have been generated in your graph.'
                : '¡Predicción completada con éxito! Se han generado las nuevas ramas especulativas en tu gráfico.'}
            </span>
          </div>
        )}
        {result && (
          <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            <div style={{ color: COLOR_SUCCESS, marginBottom: 'var(--space-1)' }}>
              {result.branches.length} branch{result.branches.length === 1 ? '' : 'es'} {t('temporalAgent.resultFrom')}{' '}
              <span style={{ color: 'var(--color-ai)' }}>{result.provider}</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
              {result.branches.map((b) => (
                <li key={b.id} style={{ marginBottom: 'var(--space-1)' }}>
                  <strong>{b.message}</strong> — {b.type}, {Math.round(b.confidence * 100)}%
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <button onClick={save} disabled={saving} style={primaryBtn}>
          {saving ? t('temporalAgent.saving') : t('temporalAgent.save')}
        </button>
        <button onClick={openNotes} style={ghostBtn}>
          {t('temporalAgent.viewNotes')}
        </button>
        {savedAt && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: COLOR_SUCCESS, fontWeight: 600 }}>
            {t('temporalAgent.savedConfirmation')}
          </span>
        )}
        {saveError && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: COLOR_WARNING }}>
            Error: {saveError}
          </span>
        )}
      </div>

      {/* Active config summary */}
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <strong style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>{t('temporalAgent.configSummaryLabel')}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-3)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.summaryStatus')}</span>
            {config.enabled ? (
              <span style={{ color: COLOR_SUCCESS, fontWeight: 'bold', background: 'color-mix(in srgb, var(--color-git-add) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-git-add) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{t('temporalAgent.summaryOn')}</span>
            ) : (
              <span style={{ color: COLOR_WARNING, fontWeight: 'bold', background: 'color-mix(in srgb, var(--color-warning) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{t('temporalAgent.summaryOff')}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.summaryScope')}</span>
            <span style={{ color: COLOR_PRIMARY, background: 'color-mix(in srgb, var(--color-primary) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-primary) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{config.privacyScope}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.summaryModel')}</span>
            <code style={{ color: COLOR_PRIMARY, fontFamily: 'JetBrains Mono, monospace', background: 'color-mix(in srgb, var(--color-primary) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-primary) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{config.model || 'default'}</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.summaryThreshold')}</span>
            <span style={{ color: COLOR_SUCCESS, background: 'color-mix(in srgb, var(--color-git-add) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-git-add) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{config.skillProfile.confidenceThreshold.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.summaryFreq')}</span>
            <span style={{ color: COLOR_PRIMARY, background: 'color-mix(in srgb, var(--color-primary) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-primary) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{config.frequency}</span>
          </div>
          {config.skillProfile.focusAreas.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: '100%' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>{t('temporalAgent.summaryFocus')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                {config.skillProfile.focusAreas.map(f => (
                  <span key={f} style={{ color: COLOR_SUCCESS, background: 'color-mix(in srgb, var(--color-git-add) 6.3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-git-add) 18.8%, transparent)', borderRadius: 'var(--radius-default)', padding: 'var(--space-1) var(--space-2)' }}>{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showNotes && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <strong style={{ fontSize: 'var(--font-size-xs)', color: COLOR_PRIMARY }}>{t('temporalAgent.notesHeading')}</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <CopyButton text={notesMd || ''} />
              <button onClick={() => setShowNotes(false)} style={ghostBtn}>
                {t('common.close')}
              </button>
            </div>
          </div>
          <pre
            style={{
              marginTop: 'var(--space-2)',
              maxHeight: 280,
              overflow: 'auto',
              fontSize: 'var(--font-size-xs)',
              lineHeight: 1.5,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {notesMd || t('temporalAgent.notesEmpty')}
          </pre>
        </div>
      )}
    </section>
  );
}

// --- small presentational helpers ------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ fontSize: 'var(--font-size-sm)' }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        width: 42,
        height: 24,
        borderRadius: 'var(--radius-full)',
        border: 'none',
        cursor: 'pointer',
        background: on ? 'var(--color-git-add)' : 'var(--color-border-subtle)',
        position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: 'var(--radius-full)',
          background: on ? 'var(--color-bg-base)' : 'var(--color-text-secondary)',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

function TagInput({
  label,
  tags,
  color,
  onChange,
}: {
  label: string;
  tags: string[];
  color: string;
  onChange: (t: string[]) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setDraft('');
  }
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 'var(--space-1)' }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              fontSize: 'var(--font-size-xs)',
              color,
              border: `1px solid ${color}`,
              borderRadius: 'var(--radius-full)',
              padding: 'var(--space-1) var(--space-2)',
              display: 'inline-flex',
              gap: 'var(--space-1)',
              alignItems: 'center',
            }}
          >
            {tag}
            <button
              onClick={() => onChange(tags.filter((x) => x !== tag))}
              style={{ background: 'none', border: 'none', color, cursor: 'pointer', padding: 0 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        placeholder={t('temporalAgent.tagPlaceholder')}
        style={{ ...selectStyle, width: '100%' }}
      />
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-1) var(--space-2)',
  fontSize: 'var(--font-size-sm)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
};

/** La tarjeta de la predicción: como las demás, sin fondo ni borde propios (los pone `.ai-panel`). */
const aiCardStyle: React.CSSProperties = {
  borderRadius: cardStyle.borderRadius,
  padding: cardStyle.padding,
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-git-add)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-4)',
  fontWeight: 600,
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
};
