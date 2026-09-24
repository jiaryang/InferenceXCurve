import {
  getInferenceCurvePointGpuCount,
  type InferenceCurveLatencyPercentiles,
  type InferenceCurveSeries
} from './inferenceCurveChart';

export interface InferenceXSyncConfig {
  id: string;
  model: string;
  scenario?: string;
  isl: number;
  osl: number;
  precision: string;
  hardware: string;
  framework: string;
  specMethod?: string;
  enabled: boolean;
}

export interface InferenceXAvailabilityRow {
  model: string;
  modelDisplay: string;
  scenario: string;
  isl: number;
  osl: number;
  precision: string;
  hardware: string;
  framework: string;
  specMethod: string;
  disagg: boolean;
  date: string;
}

export interface InferenceXSyncSummaryItem {
  configId: string;
  lineId: string;
  name: string;
  model: string;
  hardware: string;
  framework: string;
  precision: string;
  scenario: string;
  isl: number;
  osl: number;
  specMethod?: string;
  pointCount: number;
  latestDate: string;
}

export interface InferenceXSyncResult {
  checkedAt: string;
  series: InferenceCurveSeries[];
  fingerprints: Record<string, string>;
  lineIdsByConfigKey: Record<string, string>;
  matchedCounts: Record<string, number>;
  missingConfigIds: string[];
  summary: InferenceXSyncSummaryItem[];
}

const INFERENCEX_REMOTE_API_BASE = 'https://inferencex.semianalysis.com/api/v1';
const INFERENCEX_DEV_PROXY_API_BASE = '/inferencex-api/v1';
const VITE_DEV_PORTS = new Set(['5173', '5174']);
const INFERENCEX_API_BASE =
  typeof window !== 'undefined' &&
  (VITE_DEV_PORTS.has(window.location.port) ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname))
    ? INFERENCEX_DEV_PROXY_API_BASE
    : INFERENCEX_REMOTE_API_BASE;
// When the app talks to the remote API directly (i.e. not through the Vite dev
// proxy), every request is cross-origin. The InferenceX API does not send an
// Access-Control-Allow-Origin header, so the browser blocks the response and
// fetch() rejects with an opaque TypeError ("Failed to fetch"). We use this
// flag to surface a clear CORS message with workarounds instead.
const INFERENCEX_API_IS_CROSS_ORIGIN = INFERENCEX_API_BASE === INFERENCEX_REMOTE_API_BASE;
const INFERENCEX_CORS_HELP =
  'InferenceX sync is blocked by CORS: the browser could not reach ' +
  'https://inferencex.semianalysis.com directly because that API does not send an ' +
  'Access-Control-Allow-Origin header for cross-origin requests. To work around it for now, ' +
  'enable a CORS-unblocking browser extension (e.g. "Allow CORS" / "CORS Unblock") and retry, ' +
  'or route the request through a CORS proxy. (Running the app locally with `npm run dev` is ' +
  'unaffected because it uses the Vite dev proxy.)';
const NON_MTP_SPEC = 'none';
const MTP_SPEC = 'mtp';
const FIXED_SEQUENCE_SCENARIOS = new Set([
  'fixed',
  'fixed-length',
  'fixed length',
  'isl/osl',
  'single-turn',
  'single turn'
]);

const INTERACTIVITY_METRIC_KEYS = [
  'median_intvty',
  'median_interactivity'
] as const;
const INTERACTIVITY_P90_METRIC_KEYS = [
  'p90_intvty',
  'p90_interactivity'
] as const;
const THROUGHPUT_METRIC_KEYS = [
  'tput_per_gpu',
  'throughput_per_gpu',
  'token_throughput_per_gpu',
  'throughput'
] as const;
const TTFT_METRIC_KEYS = ['median_ttft'] as const;
const TTFT_P90_METRIC_KEYS = ['p90_ttft'] as const;
const E2E_METRIC_KEYS = [
  'median_e2el',
  'median_end_to_end'
] as const;
const E2E_P90_METRIC_KEYS = [
  'p90_e2el',
  'p90_end_to_end'
] as const;

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  dsr1: 'DeepSeek-R1-0528',
  gptoss120b: 'gpt-oss-120b',
  llama70b: 'Llama-3.3-70B-Instruct-FP8',
  'qwen3.5': 'Qwen-3.5-397B-A17B',
  'kimik2.5': 'Kimi-K2.5',
  'kimik2.6': 'Kimi-K2.5',
  kimik3: 'Kimi-K3',
  'minimaxm2.5': 'MiniMax-M2.5',
  'minimaxm2.7': 'MiniMax-M2.5',
  glm5: 'GLM-5',
  'glm5.1': 'GLM-5',
  'glm5.2': 'GLM-5.2',
  minimaxm3: 'MiniMax-M3',
  dsv4: 'DeepSeek-V4-Pro'
};

const MODEL_API_PARAMS: Record<string, string> = {
  // Some benchmark endpoints reject the internal availability key.
  minimaxm3: 'MiniMax-M3'
};

// Defaults point at the GLM-5.2 agentic-trace curves for B200 and MI355X.
//
// These ship disabled: the bundled `exampleSeries` splits MI355X SGLang into
// separate TP8/EP1 and TP4/EP4 curves, but sync groups only by
// model / scenario / precision / hardware / framework — parallelism is point
// metadata — so an enabled sync would merge those two curves back into one on
// first open and destroy the config comparison. Enable a config from
// `Manage Configs` when you want live API data instead of the bundled split.
const DEFAULT_SYNC_TARGETS = [
  { hardware: 'b200', framework: 'sglang' },
  { hardware: 'mi355x', framework: 'sglang' },
  { hardware: 'mi355x', framework: 'atom' }
] as const;

const DEFAULT_SYNC_CONFIG = {
  model: 'GLM-5.2',
  scenario: 'agentic-traces',
  isl: 0,
  osl: 0,
  precision: 'fp4',
  enabled: false
} as const;

type InferenceXBenchmarkRecord = Record<string, unknown>;

interface InferenceXDerivedAgenticMetrics {
  p75?: number;
  p90?: number;
}

export function createDefaultInferenceXSyncConfigs(): InferenceXSyncConfig[] {
  return DEFAULT_SYNC_TARGETS.map((target) =>
    normalizeInferenceXSyncConfig({ ...DEFAULT_SYNC_CONFIG, ...target })
  );
}

export function normalizeInferenceXSyncConfigs(value: unknown): InferenceXSyncConfig[] {
  if (!Array.isArray(value)) return createDefaultInferenceXSyncConfigs();
  const configsByLineId = new Map<string, InferenceXSyncConfig>();
  value
    .filter(isRecord)
    .map((item) => normalizeInferenceXSyncConfig(item))
    .filter((config) => config.model && config.precision && config.hardware && config.framework)
    .forEach((config) => {
      const lineId = makeInferenceXSyncLineId(config);
      const existing = configsByLineId.get(lineId);
      if (existing) {
        existing.enabled ||= config.enabled;
        return;
      }
      configsByLineId.set(lineId, config);
    });
  const configs = Array.from(configsByLineId.values());
  return configs.length > 0 ? configs : createDefaultInferenceXSyncConfigs();
}

export function normalizeInferenceXSyncConfig(value: Partial<InferenceXSyncConfig>): InferenceXSyncConfig {
  const model = getInferenceXDisplayModel(normalizeText(value.model) || DEFAULT_SYNC_CONFIG.model);
  const scenario = normalizeScenario(value.scenario);
  const isl = normalizeSequenceInteger(value.isl, scenario ? 0 : 1024);
  const osl = normalizeSequenceInteger(value.osl, scenario ? 0 : 1024);
  const precision = normalizeText(value.precision).toLowerCase() || 'fp4';
  const hardware = normalizeText(value.hardware).toLowerCase() || 'mi355x';
  const framework = normalizeText(value.framework).toLowerCase() || 'mori-sglang';
  const specMethod = normalizeSpecMethod(value.specMethod);
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : true;
  const normalized = {
    model,
    scenario,
    isl,
    osl,
    precision,
    hardware,
    framework,
    ...(!isAgenticScenario(scenario) ? { specMethod } : {}),
    enabled
  };
  const canonicalId = makeInferenceXSyncConfigId(normalized);
  const savedId = normalizeText(value.id);
  return {
    ...normalized,
    id: !isAgenticScenario(scenario) && savedId && savedId !== `${canonicalId}-agg`
      ? savedId
      : canonicalId
  };
}

export function makeInferenceXSyncConfigId(
  config: Omit<InferenceXSyncConfig, 'id' | 'enabled'>
): string {
  return `cfg-${makeInferenceXSyncLineId(config)}`;
}

export function makeInferenceXSyncLineId(
  config: Omit<InferenceXSyncConfig, 'id' | 'enabled'>
): string {
  const scenario = normalizeScenario(config.scenario);
  return [
    getInferenceXDisplayModel(config.model),
    scenario || `isl-${config.isl}`,
    scenario ? '' : `osl-${config.osl}`,
    config.precision,
    config.hardware,
    config.framework,
    !isAgenticScenario(scenario) && normalizeSpecMethod(config.specMethod) === MTP_SPEC ? MTP_SPEC : ''
  ]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

export async function fetchInferenceXAvailability(signal?: AbortSignal): Promise<InferenceXAvailabilityRow[]> {
  const value = await fetchInferenceXJson(`${INFERENCEX_API_BASE}/availability`, signal);
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(readAvailabilityRow).filter(isAvailabilityRow);
}

export async function fetchInferenceXSyncSeries(
  configs: InferenceXSyncConfig[],
  signal?: AbortSignal
): Promise<InferenceXSyncResult> {
  const enabledConfigs = configs.length
    ? normalizeInferenceXSyncConfigs(configs).filter((config) => config.enabled)
    : [];
  const checkedAt = new Date().toISOString();
  if (enabledConfigs.length === 0) {
    return {
      checkedAt,
      series: [],
      fingerprints: {},
      lineIdsByConfigKey: {},
      matchedCounts: {},
      missingConfigIds: [],
      summary: []
    };
  }

  const recordsByModel = await fetchBenchmarkRecordsByModel(enabledConfigs, signal);
  const series: InferenceCurveSeries[] = [];
  const fingerprints: Record<string, string> = {};
  const lineIdsByConfigKey: Record<string, string> = {};
  const matchedCounts: Record<string, number> = {};
  const missingConfigIds: string[] = [];
  const summary: InferenceXSyncSummaryItem[] = [];

  const preparedConfigs = enabledConfigs.map((config) => {
    const normalized = normalizeInferenceXSyncConfig(config);
    const records = recordsByModel.get(resolveModelKey(normalized.model)) ?? [];
    const matched = records.filter((record) => benchmarkRecordMatchesConfig(record, normalized));
    const latestMatched = filterLatestBenchmarkRecords(matched);
    const lineId = makeInferenceXSyncLineId(normalized);
    lineIdsByConfigKey[normalized.id] = lineId;
    matchedCounts[normalized.id] = latestMatched.length;
    return { normalized, latestMatched };
  });
  const derivedAgenticMetrics = await fetchDerivedAgenticMetrics(
    preparedConfigs.flatMap(({ latestMatched }) => latestMatched),
    signal
  );

  preparedConfigs.forEach(({ normalized, latestMatched }) => {
    if (latestMatched.length === 0) {
      missingConfigIds.push(normalized.id);
      return;
    }

    const line = benchmarkRecordsToSeries(normalized, latestMatched, derivedAgenticMetrics);
    if (!line) {
      missingConfigIds.push(normalized.id);
      return;
    }

    const fingerprint = fingerprintInferenceCurveSeries(line);
    series.push(line);
    fingerprints[normalized.id] = fingerprint;
    summary.push(makeSummaryItem(normalized, line));
  });

  return { checkedAt, series, fingerprints, lineIdsByConfigKey, matchedCounts, missingConfigIds, summary };
}

export function fingerprintInferenceCurveSeries(line: InferenceCurveSeries): string {
  const payload = JSON.stringify({
    id: line.id,
    model: line.model ?? '',
    islOsl: line.islOsl ?? '',
    precision: line.precision ?? '',
    mtp: line.mtp ?? '',
    points: line.points.map((point) => ({
      interactivity: point.interactivity,
      interactivityPercentiles: point.interactivityPercentiles ?? '',
      throughput: point.throughput,
      ttft: point.ttft ?? '',
      ttftPercentiles: point.ttftPercentiles ?? '',
      endToEnd: point.endToEnd ?? '',
      endToEndPercentiles: point.endToEndPercentiles ?? '',
      e2eNormalizedInteractivityPercentiles:
        point.e2eNormalizedInteractivityPercentiles ?? '',
      strategy: point.strategy ?? '',
      precision: point.precision ?? '',
      tp: point.tp ?? '',
      ep: point.ep ?? '',
      dp_attention: point.dp_attention ?? '',
      num_prefill_gpu: point.num_prefill_gpu ?? '',
      num_decode_gpu: point.num_decode_gpu ?? '',
      prefill_tp: point.prefill_tp ?? '',
      prefill_ep: point.prefill_ep ?? '',
      prefill_dcp_size: point.prefill_dcp_size ?? '',
      prefill_dp_attention: point.prefill_dp_attention ?? '',
      prefill_num_workers: point.prefill_num_workers ?? '',
      decode_tp: point.decode_tp ?? '',
      decode_ep: point.decode_ep ?? '',
      decode_dcp_size: point.decode_dcp_size ?? '',
      decode_dp_attention: point.decode_dp_attention ?? '',
      decode_num_workers: point.decode_num_workers ?? '',
      disagg: point.disagg ?? '',
      is_multinode: point.is_multinode ?? '',
      kv_offload: point.kv_offload ?? '',
      ...(point.spec_decoding ? { spec_decoding: point.spec_decoding } : {}),
      server_gpu_cache_hit_rate: point.server_gpu_cache_hit_rate ?? '',
      server_external_cache_hit_rate: point.server_external_cache_hit_rate ?? '',
      server_cpu_cache_hit_rate: point.server_cpu_cache_hit_rate ?? '',
      theoretical_cache_hit_rate: point.theoretical_cache_hit_rate ?? '',
      concurrency: point.concurrency ?? '',
      label: point.label ?? ''
    }))
  });
  return `${line.points.length}:${hashString(payload)}`;
}

export function formatInferenceXConfigLabel(config: InferenceXSyncConfig): string {
  return [
    getInferenceXDisplayModel(config.model),
    formatSequenceLabel(config),
    config.precision.toUpperCase(),
    `${formatHardwareLabel(config.hardware)} / ${formatFrameworkLabel(config.framework)}`,
    isAgenticScenario(config.scenario)
      ? ''
      : normalizeSpecMethod(config.specMethod) === MTP_SPEC ? 'MTP' : 'Non-MTP'
  ].filter(Boolean).join(' • ');
}

export function inferenceXAvailabilityRowMatchesConfig(
  row: InferenceXAvailabilityRow,
  config: InferenceXSyncConfig
): boolean {
  return (
    resolveModelKey(row.model) === resolveModelKey(config.model) &&
    sequenceMatches(row, config) &&
    row.precision.toLowerCase() === config.precision.toLowerCase() &&
    hardwareMatches(row.hardware, config.hardware) &&
    row.framework.toLowerCase() === config.framework.toLowerCase() &&
    (isAgenticScenario(config.scenario) ||
      normalizeSpecMethod(row.specMethod) === normalizeSpecMethod(config.specMethod))
  );
}

export function getInferenceXDisplayModel(model: string): string {
  const key = resolveModelKey(model);
  return MODEL_DISPLAY_NAMES[key] ?? normalizeText(model) ?? key;
}

function readAvailabilityRow(record: Record<string, unknown>): InferenceXAvailabilityRow | null {
  const model = readString(record, 'model');
  const scenario = readRecordScenario(record);
  const isl = readNumber(record, 'isl') ?? 0;
  const osl = readNumber(record, 'osl') ?? 0;
  const precision = readString(record, 'precision').toLowerCase();
  const hardware = readString(record, 'hardware').toLowerCase();
  const framework = readString(record, 'framework').toLowerCase();
  if (!model || (!scenario && (isl <= 0 || osl <= 0)) || !precision || !hardware || !framework) return null;
  return {
    model,
    modelDisplay: getInferenceXDisplayModel(model),
    scenario,
    isl,
    osl,
    precision,
    hardware,
    framework,
    specMethod: normalizeSpecMethod(readString(record, 'spec_method')),
    disagg: readBoolean(record, 'disagg') ?? false,
    date: readString(record, 'date')
  };
}

function isAvailabilityRow(value: InferenceXAvailabilityRow | null): value is InferenceXAvailabilityRow {
  return value !== null;
}

async function fetchBenchmarkRecordsByModel(
  configs: InferenceXSyncConfig[],
  signal?: AbortSignal
): Promise<Map<string, InferenceXBenchmarkRecord[]>> {
  const models = Array.from(new Set(configs.map((config) => resolveModelKey(config.model))));
  const entries = await Promise.all(
    models.map(async (modelKey) => {
      const modelParam = modelKeyToApiParam(modelKey);
      const url = `${INFERENCEX_API_BASE}/benchmarks?model=${encodeURIComponent(modelParam)}`;
      const value = await fetchInferenceXJson(url, signal);
      const records = Array.isArray(value) ? value.filter(isRecord) : [];
      return [modelKey, records] as const;
    })
  );
  return new Map(entries);
}

async function fetchDerivedAgenticMetrics(
  records: InferenceXBenchmarkRecord[],
  signal?: AbortSignal
): Promise<Map<number, InferenceXDerivedAgenticMetrics>> {
  const ids = Array.from(
    new Set(
      records
        .filter((record) => isAgenticScenario(readRecordScenario(record)))
        .map((record) => readNumber(record, 'id'))
        .filter((id): id is number => id !== null)
    )
  );
  if (ids.length === 0) return new Map();

  const batches: number[][] = [];
  for (let index = 0; index < ids.length; index += 200) {
    batches.push(ids.slice(index, index + 200));
  }
  const responses = (await Promise.all(
    batches.map((batch) => fetchDerivedAgenticMetricsBatch(batch, signal))
  )).flat();
  const result = new Map<number, InferenceXDerivedAgenticMetrics>();
  responses.forEach((response) => {
    if (!isRecord(response)) return;
    Object.values(response).forEach((value) => {
      if (!isRecord(value)) return;
      const id = readNumber(value, 'id');
      if (id === null) return;
      const p75 = readNumber(value, 'p75_e2e_norm_intvty');
      const p90 = readNumber(value, 'p90_e2e_norm_intvty');
      if (p75 === null && p90 === null) return;
      result.set(id, {
        ...(p75 !== null ? { p75 } : {}),
        ...(p90 !== null ? { p90 } : {})
      });
    });
  });
  return result;
}

async function fetchDerivedAgenticMetricsBatch(
  ids: number[],
  signal?: AbortSignal
): Promise<unknown[]> {
  try {
    return [await fetchInferenceXJson(
      `${INFERENCEX_API_BASE}/derived-agentic-metrics?ids=${ids.join(',')}`,
      signal
    )];
  } catch (error) {
    if (!isInferenceXServerError(error)) throw error;
    if (ids.length <= 1) return [];
    const midpoint = Math.ceil(ids.length / 2);
    const responses = await Promise.all([
      fetchDerivedAgenticMetricsBatch(ids.slice(0, midpoint), signal),
      fetchDerivedAgenticMetricsBatch(ids.slice(midpoint), signal)
    ]);
    return responses.flat();
  }
}

function isInferenceXServerError(error: unknown): boolean {
  return error instanceof Error && /^5\d{2}\b/u.test(error.message);
}

async function fetchInferenceXJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    // A blocked CORS request and a genuine network failure both surface as a
    // TypeError here; distinguish only when we know the call is cross-origin.
    if (INFERENCEX_API_IS_CROSS_ORIGIN && isLikelyCorsError(error)) {
      throw new InferenceXCorsError(INFERENCEX_CORS_HELP, { cause: error });
    }
    throw error;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 220)}` : ''}`);
  }
  return response.json() as Promise<unknown>;
}

export class InferenceXCorsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InferenceXCorsError';
  }
}

function isLikelyCorsError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  // Browsers report a blocked cross-origin fetch as a TypeError ("Failed to
  // fetch" / "Load failed"), with no way to inspect the real cause from JS.
  return error instanceof TypeError;
}

function benchmarkRecordMatchesConfig(
  record: InferenceXBenchmarkRecord,
  config: InferenceXSyncConfig
): boolean {
  const model = readString(record, 'model');
  const scenario = readRecordScenario(record);
  const isl = readNumber(record, 'isl') ?? 0;
  const osl = readNumber(record, 'osl') ?? 0;
  const precision = readString(record, 'precision').toLowerCase();
  const hardware = readString(record, 'hardware').toLowerCase();
  const framework = readString(record, 'framework').toLowerCase();
  const specMethod = normalizeSpecMethod(readString(record, 'spec_method'));
  const metrics = readMetrics(record);
  const throughput = readMetricNumber(metrics, THROUGHPUT_METRIC_KEYS);
  const metricKeySets = getXAxisMetricKeySetsForRecord(record, config);
  const hasXMetric = metricKeySets.some((keys) => readMetricNumber(metrics, keys) !== null);

  return (
    resolveModelKey(model) === resolveModelKey(config.model) &&
    sequenceValuesMatch({ scenario, isl, osl }, config) &&
    precision === config.precision.toLowerCase() &&
    hardwareMatches(hardware, config.hardware) &&
    framework === config.framework.toLowerCase() &&
    (isAgenticScenario(config.scenario) || specMethod === normalizeSpecMethod(config.specMethod)) &&
    throughput !== null &&
    hasXMetric
  );
}

function filterLatestBenchmarkRecords(records: InferenceXBenchmarkRecord[]): InferenceXBenchmarkRecord[] {
  // Agentic configs include all speculative methods. Select each branch's
  // latest snapshot across those methods, rather than combining stale MTP
  // and Non-MTP snapshots that happen to share the same serving config.
  const recordsByCurveBranch = new Map<string, InferenceXBenchmarkRecord[]>();
  records.forEach((record) => {
    const disagg = readBoolean(record, 'disagg') ?? false;
    const offloadMode = readBenchmarkCurveOffloadMode(record);
    const branchKey = `${disagg ? 'disagg' : 'aggregated'}|${offloadMode}`;
    const group = recordsByCurveBranch.get(branchKey) ?? [];
    group.push(record);
    recordsByCurveBranch.set(branchKey, group);
  });
  return Array.from(recordsByCurveBranch.values()).flatMap((group) => filterLatestCurveRecords(group));
}

function filterLatestCurveRecords(records: InferenceXBenchmarkRecord[]): InferenceXBenchmarkRecord[] {
  if (records.length <= 1) return records;
  const latestCurveDate = records
    .map((record) => readBenchmarkCurveDate(record))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!latestCurveDate) return records;

  const latestDatedRecords = records.filter(
    (record) => readBenchmarkCurveDate(record) === latestCurveDate
  );
  if (!latestDatedRecords.some((record) => isAgenticScenario(readRecordScenario(record)))) {
    return latestDatedRecords;
  }

  // Agentic snapshots can carry selected points forward from an older
  // benchmark `date`. InferenceX marks every point belonging to the current
  // snapshot with the same curve run metadata, so keep that complete run
  // instead of retaining only rows whose original benchmark date is newest.
  const latestRunRecord = latestDatedRecords.reduce((latest, record) =>
    compareBenchmarkCurveRuns(record, latest) > 0 ? record : latest
  );
  return latestDatedRecords.filter((record) =>
    benchmarkCurveRunsMatch(record, latestRunRecord)
  );
}

function readBenchmarkCurveDate(record: InferenceXBenchmarkRecord): string {
  const value = readString(record, 'curve_date') || readString(record, 'date');
  const match = value.match(/\d{4}-\d{2}-\d{2}/u);
  return match?.[0] ?? '';
}

function readBenchmarkCurveRunStartedAt(record: InferenceXBenchmarkRecord): string {
  return readString(record, 'curve_run_started_at') || readString(record, 'run_started_at');
}

function readBenchmarkCurveWorkflowRunId(record: InferenceXBenchmarkRecord): number | null {
  return readNumber(record, 'curve_workflow_run_id') ?? readNumber(record, 'workflow_run_id');
}

function compareBenchmarkCurveRuns(
  a: InferenceXBenchmarkRecord,
  b: InferenceXBenchmarkRecord
): number {
  const startedAtComparison = readBenchmarkCurveRunStartedAt(a).localeCompare(
    readBenchmarkCurveRunStartedAt(b)
  );
  if (startedAtComparison !== 0) return startedAtComparison;
  return (
    (readBenchmarkCurveWorkflowRunId(a) ?? Number.NEGATIVE_INFINITY) -
    (readBenchmarkCurveWorkflowRunId(b) ?? Number.NEGATIVE_INFINITY)
  );
}

function benchmarkCurveRunsMatch(
  a: InferenceXBenchmarkRecord,
  b: InferenceXBenchmarkRecord
): boolean {
  return (
    readBenchmarkCurveRunStartedAt(a) === readBenchmarkCurveRunStartedAt(b) &&
    readBenchmarkCurveWorkflowRunId(a) === readBenchmarkCurveWorkflowRunId(b)
  );
}

function readBenchmarkCurveOffloadMode(record: InferenceXBenchmarkRecord): 'off' | 'on' {
  const offload = readRecordOffloadConfig(record);
  return offload.key && offload.key !== 'offload-off' ? 'on' : 'off';
}

function benchmarkRecordsToSeries(
  config: InferenceXSyncConfig,
  records: InferenceXBenchmarkRecord[],
  derivedAgenticMetrics: Map<number, InferenceXDerivedAgenticMetrics>
): InferenceCurveSeries | null {
  const points = records
    .map((record) => benchmarkRecordToPoint(config, record, derivedAgenticMetrics))
    .filter((point): point is InferenceCurveSeries['points'][number] => point !== null)
    .sort(
      (a, b) =>
        compareOptionalNumbers(a.interactivity, b.interactivity) ||
        compareOptionalNumbers(
          a.e2eNormalizedInteractivityPercentiles?.p90,
          b.e2eNormalizedInteractivityPercentiles?.p90
        ) ||
        compareOptionalNumbers(a.endToEnd, b.endToEnd) ||
        compareOptionalNumbers(a.ttft, b.ttft) ||
        b.throughput - a.throughput ||
        Number(a.concurrency ?? 0) - Number(b.concurrency ?? 0)
    );
  if (points.length === 0) return null;

  const isAgentic = isAgenticScenario(config.scenario);
  const lineName = formatInferenceXLineName(config.hardware, config.framework, isAgentic ? undefined : config.specMethod);
  const islOsl = formatSequenceLabel(config);
  const model = getInferenceXDisplayModel(config.model);
  const precision = config.precision.toLowerCase();
  const mtp = normalizeSpecMethod(config.specMethod) === MTP_SPEC ? 'mtp' : 'non-mtp';
  return {
    id: makeInferenceXSyncLineId(config),
    // Dating the name is what makes refreshes comparable: each sync rebuilds the
    // name from its own benchmark date, so an archived copy keeps the old date
    // and sits next to the new line instead of being indistinguishable from it.
    name: prefixCurveName(latestPointDateFromPoints(points), 'CI', lineName),
    hwKey: makeHwKey(config),
    model,
    islOsl,
    precision,
    ...(!isAgentic ? { mtp } : {}),
    title: `${model} ${islOsl} ${precision.toUpperCase()} ${lineName}`,
    points
  };
}

function benchmarkRecordToPoint(
  config: InferenceXSyncConfig,
  record: InferenceXBenchmarkRecord,
  derivedAgenticMetrics: Map<number, InferenceXDerivedAgenticMetrics>
): InferenceCurveSeries['points'][number] | null {
  const metrics = readMetrics(record);
  const preferP90Metrics = shouldPreferP90Metrics(record, config);
  const interactivityPercentiles = preferP90Metrics
    ? readAgenticLatencyPercentiles(metrics, 'intvty')
    : undefined;
  const ttftPercentiles = preferP90Metrics
    ? readAgenticLatencyPercentiles(metrics, 'ttft')
    : undefined;
  const endToEndPercentiles = preferP90Metrics
    ? readAgenticLatencyPercentiles(metrics, 'e2el')
    : undefined;
  const benchmarkId = readNumber(record, 'id');
  const e2eNormalizedInteractivityPercentiles = benchmarkId === null
    ? undefined
    : derivedAgenticMetrics.get(benchmarkId);
  const interactivity = interactivityPercentiles?.p90 ?? readMetricNumber(
    metrics,
    preferP90Metrics ? INTERACTIVITY_P90_METRIC_KEYS : INTERACTIVITY_METRIC_KEYS
  );
  const throughput = readMetricNumber(metrics, THROUGHPUT_METRIC_KEYS);
  const ttft = ttftPercentiles?.p90 ?? readMetricNumber(
    metrics,
    preferP90Metrics ? TTFT_P90_METRIC_KEYS : TTFT_METRIC_KEYS
  );
  const endToEnd = endToEndPercentiles?.p90 ?? readMetricNumber(
    metrics,
    preferP90Metrics ? E2E_P90_METRIC_KEYS : E2E_METRIC_KEYS
  );
  if (
    throughput === null ||
    (
      interactivity === null &&
      ttft === null &&
      endToEnd === null &&
      e2eNormalizedInteractivityPercentiles === undefined
    )
  ) {
    return null;
  }

  const prefillTp = readNumber(record, 'prefill_tp');
  const prefillEp = readNumber(record, 'prefill_ep');
  const commonDcp = readNumber(metrics, 'dcp_size');
  const prefillDcp = readNumber(metrics, 'prefill_dcp_size') ?? commonDcp;
  const decodeTp = readNumber(record, 'decode_tp');
  const decodeEp = readNumber(record, 'decode_ep');
  const decodeDcp = readNumber(metrics, 'decode_dcp_size') ?? commonDcp;
  const numPrefillGpu = readNumber(record, 'num_prefill_gpu');
  const numDecodeGpu = readNumber(record, 'num_decode_gpu');
  const prefillDpa = readBoolean(record, 'prefill_dp_attention');
  const decodeDpa = readBoolean(record, 'decode_dp_attention');
  const disagg = readBoolean(record, 'disagg') ?? false;
  const totalGpu = getInferenceCurvePointGpuCount({
    throughput,
    num_prefill_gpu: numPrefillGpu ?? undefined,
    num_decode_gpu: numDecodeGpu ?? undefined,
    disagg,
    tp: decodeTp ?? undefined
  });
  const offload = readRecordOffloadConfig(record);

  const point: InferenceCurveSeries['points'][number] = {
    throughput,
    precision: config.precision.toLowerCase(),
    strategy: makeStrategyLabel(decodeTp, decodeEp, decodeDcp),
    tp: totalGpu ?? decodeTp ?? undefined,
    disagg,
    ...(preferP90Metrics ? { spec_decoding: normalizeSpecMethod(readString(record, 'spec_method')) } : {}),
    concurrency: readNumber(record, 'conc') ?? undefined,
    label: makePointLabel(
      readString(record, 'date'),
      readBenchmarkCurveDate(record),
      readString(record, 'run_url'),
      offload.label
    )
  };

  if (interactivity !== null) point.interactivity = interactivity;
  if (interactivityPercentiles) point.interactivityPercentiles = interactivityPercentiles;
  if (ttft !== null) point.ttft = ttft;
  if (ttftPercentiles) point.ttftPercentiles = ttftPercentiles;
  if (endToEnd !== null) point.endToEnd = endToEnd;
  if (endToEndPercentiles) point.endToEndPercentiles = endToEndPercentiles;
  if (e2eNormalizedInteractivityPercentiles) {
    point.e2eNormalizedInteractivityPercentiles =
      e2eNormalizedInteractivityPercentiles;
  }
  if (prefillTp !== null) point.prefill_tp = prefillTp;
  if (prefillEp !== null) point.prefill_ep = prefillEp;
  if (prefillDcp !== null) point.prefill_dcp_size = prefillDcp;
  if (decodeTp !== null) point.decode_tp = decodeTp;
  if (decodeEp !== null) point.decode_ep = decodeEp;
  if (decodeDcp !== null) point.decode_dcp_size = decodeDcp;
  if (numPrefillGpu !== null) point.num_prefill_gpu = numPrefillGpu;
  if (numDecodeGpu !== null) point.num_decode_gpu = numDecodeGpu;
  if (prefillDpa !== undefined) point.prefill_dp_attention = prefillDpa;
  if (decodeDpa !== undefined) point.decode_dp_attention = decodeDpa;
  if (prefillDpa !== undefined && prefillDpa === decodeDpa) point.dp_attention = prefillDpa;
  if (offload.label) point.kv_offload = offload.label;
  const serverGpuCacheHitRate = readNumber(metrics, 'server_gpu_cache_hit_rate');
  const serverExternalCacheHitRate = readNumber(metrics, 'server_external_cache_hit_rate');
  const serverCpuCacheHitRate = readNumber(metrics, 'server_cpu_cache_hit_rate');
  const theoreticalCacheHitRate = readNumber(metrics, 'theoretical_cache_hit_rate');
  if (serverGpuCacheHitRate !== null) point.server_gpu_cache_hit_rate = serverGpuCacheHitRate;
  if (serverExternalCacheHitRate !== null) {
    point.server_external_cache_hit_rate = serverExternalCacheHitRate;
  }
  if (serverCpuCacheHitRate !== null) point.server_cpu_cache_hit_rate = serverCpuCacheHitRate;
  if (theoreticalCacheHitRate !== null) {
    point.theoretical_cache_hit_rate = theoreticalCacheHitRate;
  }
  point.prefill_num_workers = readNumber(record, 'prefill_num_workers') ?? undefined;
  point.decode_num_workers = readNumber(record, 'decode_num_workers') ?? undefined;
  point.is_multinode = readBoolean(record, 'is_multinode') ?? undefined;

  return point;
}

function makeSummaryItem(
  config: InferenceXSyncConfig,
  line: InferenceCurveSeries
): InferenceXSyncSummaryItem {
  return {
    configId: config.id,
    lineId: line.id,
    name: line.name,
    model: getInferenceXDisplayModel(config.model),
    hardware: config.hardware,
    framework: config.framework,
    precision: config.precision,
    scenario: normalizeScenario(config.scenario),
    isl: config.isl,
    osl: config.osl,
    ...(!isAgenticScenario(config.scenario) ? { specMethod: normalizeSpecMethod(config.specMethod) } : {}),
    pointCount: line.points.length,
    latestDate: latestPointDate(line)
  };
}

/** Benchmark date carried in the point labels, newest first, or '' if absent. */
export function latestPointDate(line: InferenceCurveSeries): string {
  return latestPointDateFromPoints(line.points);
}

function latestPointDateFromPoints(points: InferenceCurveSeries['points']): string {
  return points
    .map((point) => {
      const label = String(point.label ?? '');
      return label.match(/\bcurve_date\s+(\d{4}-\d{2}-\d{2})\b/u)?.[1] ??
        label.match(/\bdate\s+(\d{4}-\d{2}-\d{2})\b/u)?.[1] ?? '';
    })
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] ?? '';
}

/**
 * Curve naming convention: `MM-DD-<source>-<name>`, so that lines sort and read
 * by when the data was taken and where it came from. The date is dropped when
 * the source data carries none.
 */
export function prefixCurveName(isoDate: string, source: 'CI' | 'local', name: string): string {
  const parts = /^\d{4}-(\d{2})-(\d{2})$/u.exec(isoDate);
  const prefix = parts ? `${parts[1]}-${parts[2]}-${source}` : source;
  return `${prefix}-${name}`;
}

function normalizeSpecMethod(value: string | undefined): string {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || ['none', 'off', 'false', 'no', 'n', '0'].includes(normalized)) return NON_MTP_SPEC;
  if (['mtp', 'on', 'true', 'yes', 'y', '1'].includes(normalized)) return MTP_SPEC;
  return normalized;
}

function normalizeScenario(value: unknown): string {
  const normalized = normalizeText(String(value ?? '')).toLowerCase().replace(/[_\s]+/gu, '-');
  if (!normalized || FIXED_SEQUENCE_SCENARIOS.has(normalized) || FIXED_SEQUENCE_SCENARIOS.has(normalized.replace(/-/gu, ' '))) {
    return '';
  }
  return normalized;
}

function shouldPreferP90Metrics(
  record: InferenceXBenchmarkRecord,
  config: InferenceXSyncConfig
): boolean {
  return isAgenticScenario(readRecordScenario(record) || config.scenario);
}

function isAgenticScenario(value: string | undefined): boolean {
  const normalized = normalizeScenario(value);
  return normalized === 'agentic' ||
    normalized.startsWith('agentic-') ||
    (normalized.includes('agentic') && normalized.includes('trace'));
}

function normalizeOffloadKey(value: string | undefined): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

function formatOffloadLabelFromKey(key: string): string {
  const normalized = normalizeOffloadKey(key);
  if (!normalized) return '';
  if (normalized === 'offload-off') return 'KV offload off';
  const parts = normalized.replace(/^offload-?/u, '').split('-').filter(Boolean);
  const target = parts[0] ?? 'on';
  const backend = parts.slice(1).join('-');
  return [
    'KV offload',
    target === 'on' ? 'on' : target.toUpperCase(),
    backend ? `via ${formatFrameworkLabel(backend)}` : ''
  ].filter(Boolean).join(' ');
}

function readRecordOffloadConfig(record: Record<string, unknown>): { key: string; label: string } {
  const metrics = readMetrics(record);
  const mode = readStringFromKeys(record, ['offload_mode', 'offload mode']) ||
    readStringFromKeys(metrics, ['offload_mode', 'offload mode']);
  const kvOffloading = readStringFromKeys(record, ['kv_offloading', 'kv offloading']) ||
    readStringFromKeys(metrics, ['kv_offloading', 'kv offloading']);
  const backend = readStringFromKeys(record, ['kv_offload_backend', 'kv offload backend']) ||
    readStringFromKeys(metrics, ['kv_offload_backend', 'kv offload backend']);
  if (!mode && !kvOffloading && !backend) return { key: '', label: '' };

  const modeEnabled = normalizeOffloadFlag(mode);
  const kvEnabled = kvOffloading ? normalizeOffloadFlag(kvOffloading) : null;
  const enabled = modeEnabled ?? kvEnabled ?? Boolean(backend);
  if (!enabled) return { key: 'offload-off', label: 'KV offload off' };

  const target = normalizeOffloadKey(kvOffloading) || normalizeOffloadKey(mode) || 'on';
  const backendKey = normalizeOffloadKey(backend);
  const key = ['offload', target, backendKey].filter(Boolean).join('-');
  return { key, label: formatOffloadLabelFromKey(key) };
}

function normalizeOffloadFlag(value: string): boolean | null {
  const normalized = normalizeOffloadKey(value);
  if (!normalized) return null;
  if (['off', 'none', 'false', 'no', 'n', '0', 'disabled', 'disable'].includes(normalized)) return false;
  if (['on', 'true', 'yes', 'y', '1', 'enabled', 'enable'].includes(normalized)) return true;
  return true;
}

function formatSequenceLabel(config: Pick<InferenceXSyncConfig, 'scenario' | 'isl' | 'osl'>): string {
  const scenario = normalizeScenario(config.scenario);
  return scenario ? formatScenarioLabel(scenario) : `ISL ${config.isl} / OSL ${config.osl}`;
}

function formatScenarioLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === 'ai') return 'AI';
      return part[0] ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
    })
    .join(' ');
}

function sequenceMatches(row: InferenceXAvailabilityRow, config: InferenceXSyncConfig): boolean {
  return sequenceValuesMatch(row, config);
}

function sequenceValuesMatch(
  row: Pick<InferenceXAvailabilityRow, 'scenario' | 'isl' | 'osl'>,
  config: Pick<InferenceXSyncConfig, 'scenario' | 'isl' | 'osl'>
): boolean {
  const configScenario = normalizeScenario(config.scenario);
  const rowScenario = normalizeScenario(row.scenario);
  if (configScenario || rowScenario) return configScenario === rowScenario;
  return row.isl === config.isl && row.osl === config.osl;
}

function compareOptionalNumbers(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

function resolveModelKey(model: string): string {
  const normalized = normalizeText(model).toLowerCase();
  if (!normalized) return '';
  // The 0813 checkpoint shares dsv4's architecture and API history. The public
  // API still accepts DeepSeek-V4-Pro, not DeepSeek-V4-Pro-0813.
  const tail = normalized.split(/[\\/]/u).filter(Boolean).at(-1) ?? normalized;
  const compact = tail.replace(/-(?:fp4|fp8|mxfp4|nvfp4)(?:-.*)?$/u, '').replace(/[^a-z0-9]/gu, '');
  if (['dsv4', 'dsv4pro', 'deepseekv4pro', 'deepseekv4pro0813'].includes(compact)) return 'dsv4';
  if (MODEL_DISPLAY_NAMES[normalized]) return normalized;
  const displayMatch = Object.entries(MODEL_DISPLAY_NAMES).find(
    ([, display]) => display.toLowerCase() === normalized
  );
  return displayMatch?.[0] ?? normalized;
}

function modelKeyToApiParam(modelKey: string): string {
  return MODEL_API_PARAMS[modelKey] ?? MODEL_DISPLAY_NAMES[modelKey] ?? modelKey;
}

function hardwareMatches(recordHardware: string, configHardware: string): boolean {
  return recordHardware.toLowerCase() === configHardware.toLowerCase();
}

function makeHwKey(config: InferenceXSyncConfig): string {
  const suffix = !isAgenticScenario(config.scenario) && normalizeSpecMethod(config.specMethod) === MTP_SPEC ? '_mtp' : '';
  return `${config.hardware.toLowerCase()}_${config.framework.toLowerCase()}${suffix}`;
}

function formatInferenceXLineName(
  hardware: string,
  framework: string,
  specMethod: string | undefined
): string {
  const suffix = normalizeSpecMethod(specMethod) === MTP_SPEC ? ' MTP' : '';
  return `${formatHardwareLabel(hardware)} (${formatFrameworkLabel(framework)}${suffix})`;
}

function formatHardwareLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join(' ');
}

function formatFrameworkLabel(value: string): string {
  const replacements: Record<string, string> = {
    mori: 'MoRI',
    sglang: 'SGLang',
    dynamo: 'Dynamo',
    trt: 'TRT',
    tensorrt: 'TRT',
    vllm: 'vLLM',
    lmcache: 'LMCache'
  };
  return value
    .toLowerCase()
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => replacements[part] ?? part.toUpperCase())
    .join(' ');
}

function makeStrategyLabel(
  tp: number | null,
  ep: number | null,
  dcp: number | null = null
): string | undefined {
  const parts: string[] = [];
  if (tp !== null) parts.push(`TP${tp}`);
  if (ep !== null) parts.push(`EP${ep}`);
  if (dcp !== null && dcp > 1) parts.push(`DCP${dcp}`);
  return parts.length > 0 ? parts.join('/') : undefined;
}

function makePointLabel(
  date: string,
  curveDate: string,
  runUrl: string,
  offloadLabel = ''
): string {
  return [
    date ? `date ${date}` : '',
    curveDate && curveDate !== date ? `curve_date ${curveDate}` : '',
    runUrl ? `run_url ${runUrl}` : '',
    offloadLabel ? offloadLabel : ''
  ].filter(Boolean).join('; ');
}

function readMetrics(record: InferenceXBenchmarkRecord): Record<string, unknown> {
  const metrics = record.metrics;
  return isRecord(metrics) ? metrics : {};
}

function readRecordScenario(record: Record<string, unknown>): string {
  return normalizeScenario(
    readStringFromKeys(record, [
      'scenario',
      'benchmark_scenario',
      'benchmark scenario',
      'scenario_type',
      'scenario type',
      'benchmark_type',
      'benchmark type',
      'workload',
      'workload_type',
      'workload type',
      'trace',
      'trace_type',
      'trace type',
      'dataset',
      'task'
    ])
  );
}

function readStringFromKeys(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) return value;
  }
  return '';
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === null || value === undefined) return '';
  return normalizeText(String(value));
}

function readMetricNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = readNumber(record, key);
    if (value !== null) return value;
  }
  return null;
}

function readAgenticLatencyPercentiles(
  metrics: Record<string, unknown>,
  metric: 'intvty' | 'ttft' | 'e2el'
): InferenceCurveLatencyPercentiles | undefined {
  const result: InferenceCurveLatencyPercentiles = {};
  const entries = [
    ['p50', `median_${metric}`],
    ['p75', `p75_${metric}`],
    ['p90', `p90_${metric}`],
    ['p95', `p95_${metric}`]
  ] as const;
  entries.forEach(([percentile, key]) => {
    const value = readNumber(metrics, key);
    if (value !== null) result[percentile] = value;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function getXAxisMetricKeySetsForRecord(
  record: InferenceXBenchmarkRecord,
  config: InferenceXSyncConfig
): readonly (readonly string[])[] {
  const useP90 = shouldPreferP90Metrics(record, config);
  return [
    useP90 ? INTERACTIVITY_P90_METRIC_KEYS : INTERACTIVITY_METRIC_KEYS,
    useP90 ? TTFT_P90_METRIC_KEYS : TTFT_METRIC_KEYS,
    useP90 ? E2E_P90_METRIC_KEYS : E2E_METRIC_KEYS
  ];
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replaceAll(',', ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return undefined;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').trim();
}

function normalizeSequenceInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim().replaceAll(',', ''))
        : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
