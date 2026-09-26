import './styles.css';
import { getTheme, THEME_CHANGE_EVENT, type Theme } from './theme';

import { strFromU8, unzipSync } from 'fflate';

import { exampleSeries } from './exampleData';
import {
  fetchInferenceXTcoPrices,
  INFERENCEX_TCO_CACHE_KEY,
  INFERENCEX_TCO_REPOSITORY,
  readInferenceXTcoPriceSnapshot,
  shouldRefreshInferenceXTcoPrices,
  type InferenceXTcoPriceSnapshot
} from './inferenceXTcoSync';
import {
  createDefaultInferenceXSyncConfigs,
  fetchInferenceXAvailability,
  fetchInferenceXSyncSeries,
  fingerprintInferenceCurveSeries,
  formatInferenceXConfigLabel,
  getInferenceXDisplayModel,
  inferenceXAvailabilityRowMatchesConfig,
  latestPointDate,
  makeInferenceXSyncLineId,
  prefixCurveName,
  normalizeInferenceXSyncConfig,
  normalizeInferenceXSyncConfigs,
  type InferenceXAvailabilityRow,
  type InferenceXSyncConfig,
  type InferenceXSyncResult,
  type InferenceXSyncSummaryItem
} from './inferenceXSync';
import {
  DEFAULT_CHART_WATERMARK,
  getAvailablePrecisions,
  getInferenceCurveColorSourceSeries,
  getInferenceCurvePointDcp,
  getInferenceCurvePointGpuCount,
  getInferenceCurveTcoHardware,
  getInferenceCurveTitle,
  getInferenceCurveXAxisLabel,
  getInferenceCurveYAxisLabel,
  INFERENCE_CURVE_MARGIN,
  INFERENCE_CURVE_TCO_COSTS,
  prepareInferenceCurveSeries,
  renderInferenceCurveChart,
  resetInferenceCurveZoom,
  resolveInferenceCurveColors,
  type InferenceCurveChartOptions,
  type InferenceCurveE2ENormalizedInteractivityPercentile,
  type InferenceCurveE2ENormalizedInteractivityPercentiles,
  type InferenceCurveLatencyPercentile,
  type InferenceCurveLatencyPercentiles,
  type InferenceCurveLineLabelOffset,
  type InferenceCurveSeries,
  type InferenceCurveXAxisMetric,
  type InferenceCurveYAxisMetric,
  type InferenceCurveTcoCostMode
} from './inferenceCurveChart';

const app = document.querySelector<HTMLDivElement>('#inferencex-workspace-root')!;
if (!app) throw new Error('Missing #inferencex-workspace-root');

type CsvExportMode = 'all' | 'visible';
type SeriesField =
  | 'id'
  | 'name'
  | 'model'
  | 'islOsl'
  | 'precision'
  | 'mtp'
  | 'marker'
  | 'title'
  | 'note'
  | 'color'
  | 'lineStyle';
type PointRow = Record<string, string>;

interface AppState {
  theme: Theme;
  chartMetric: InferenceCurveXAxisMetric;
  chartYMetric: InferenceCurveYAxisMetric;
  tcoCostMode: InferenceCurveTcoCostMode;
  tcoCustomCosts: Record<string, number>;
  latencyPercentile: InferenceCurveLatencyPercentile;
  activeSeriesIds: Set<string>;
  activeSeriesIdsByView: Map<string, Set<string>>;
  knownSeriesIdsByView: Map<string, Set<string>>;
  selectedPrecisions: Set<string>;
  modelFilter: string;
  scenarioFilter: string;
  islOslFilter: string;
  mtpFilter: string;
  mergeParallelism: boolean;
  enforceEndToEndPareto: boolean;
  showNonOptimalPoints: boolean;
  hidePointLabels: boolean;
  showConcurrencyLabels: boolean;
  useAdvancedLabels: boolean;
  showGradientLabels: boolean;
  showLineLabels: boolean;
  lineLabelOffsets: Record<string, InferenceCurveLineLabelOffset>;
  showGoalDirection: boolean;
  showOffloadRings: boolean;
  highContrast: boolean;
  logY: boolean;
  search: string;
  watermark: string;
}

interface TableColumn {
  key: string;
  label: string;
  required?: boolean;
  numeric?: boolean;
}

interface SeriesDraft {
  id: string;
  hwKey?: string;
  name: string;
  model: string;
  islOsl: string;
  precision: string;
  mtp: string;
  marker: string;
  title: string;
  note: string;
  color: string;
  lineStyle: string;
  renderOrder: number;
  collapsed: boolean;
  points: PointRow[];
}

interface PendingImportDraft {
  selected: boolean;
  sourceDraft: SeriesDraft;
  draft: SeriesDraft;
}

interface ImportBatchSettings {
  idSuffix: string;
  nameSuffix: string;
  titleSuffix: string;
  lineStyle: string;
  marker: string;
  colorMode: 'auto' | 'custom';
  color: string;
}

interface PendingMergeLine {
  selected: boolean;
  main: boolean;
  draftIndex: number;
  draftId: string;
}

interface PendingMergeGroup {
  key: string;
  label: string;
  lines: PendingMergeLine[];
}

interface PersistedAppState {
  theme?: Theme;
  chartMetric?: InferenceCurveXAxisMetric;
  chartYMetric?: InferenceCurveYAxisMetric;
  tcoCostMode?: InferenceCurveTcoCostMode;
  tcoCustomCosts?: Record<string, number>;
  latencyPercentile?: InferenceCurveLatencyPercentile;
  activeSeriesIds?: string[];
  activeSeriesIdsByView?: Record<string, string[]>;
  knownSeriesIdsByView?: Record<string, string[]>;
  selectedPrecisions?: string[];
  modelFilter?: string;
  scenarioFilter?: string;
  islOslFilter?: string;
  mtpFilter?: string;
  mergeParallelism?: boolean;
  enforceEndToEndPareto?: boolean;
  showNonOptimalPoints?: boolean;
  hidePointLabels?: boolean;
  showConcurrencyLabels?: boolean;
  useAdvancedLabels?: boolean;
  showGradientLabels?: boolean;
  showLineLabels?: boolean;
  lineLabelOffsets?: Record<string, InferenceCurveLineLabelOffset>;
  showGoalDirection?: boolean;
  showOffloadRings?: boolean;
  highContrast?: boolean;
  logY?: boolean;
  search?: string;
  watermark?: string;
}

type InferenceXSyncStatus =
  | 'idle'
  | 'checking'
  | 'updates-available'
  | 'up-to-date'
  | 'updating'
  | 'error';

type InferenceXSyncAddDraft = Omit<InferenceXSyncConfig, 'id' | 'enabled'>;

interface PersistedInferenceXSyncState {
  configs?: InferenceXSyncConfig[];
  fingerprints?: Record<string, string>;
  lineIdsByConfigKey?: Record<string, string>;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
  status?: InferenceXSyncStatus;
  availableUpdateCount?: number;
  lastError?: string;
  keepHistory?: boolean;
}

interface InferenceXSyncState {
  configs: InferenceXSyncConfig[];
  fingerprints: Record<string, string>;
  lineIdsByConfigKey: Record<string, string>;
  lastCheckedAt: string;
  lastUpdatedAt: string;
  status: InferenceXSyncStatus;
  availableUpdateCount: number;
  lastError: string;
  keepHistory: boolean;
  stagedResult: InferenceXSyncResult | null;
  changedConfigIds: Set<string>;
  missingConfigIds: Set<string>;
  manageOpen: boolean;
  availabilityRows: InferenceXAvailabilityRow[];
  availabilityLoaded: boolean;
  availabilityLoading: boolean;
  addDraft: InferenceXSyncAddDraft;
  addShapeSelection: string;
  addPrecisionSelection: string;
  addFrameworkSelection: string;
  addSpecMethodSelection: string;
}

interface PersistedAppData {
  version: 1;
  savedAt: string;
  currentSeries: InferenceCurveSeries[];
  seriesDrafts: SeriesDraft[];
  state: PersistedAppState;
  inferenceXSync?: PersistedInferenceXSyncState;
}

interface InitialDataState {
  currentSeries: InferenceCurveSeries[];
  seriesDrafts: SeriesDraft[];
  state: AppState;
  inferenceXSync: InferenceXSyncState;
  loadedFromStorage: boolean;
}

interface StoredSnapshot {
  id: string;
  name: string;
  savedAt: string;
  data: PersistedAppData;
}

interface ColorPreset {
  name: string;
  value: string;
}

interface LineStyleOption {
  value: string;
  label: string;
  dasharray: string | null;
}

interface ParsedPointMetadata {
  num_prefill_gpu?: number;
  num_decode_gpu?: number;
  prefill_tp?: number;
  prefill_ep?: number;
  prefill_dp_attention?: boolean;
  decode_dp_attention?: boolean;
}

interface ParsedStrategyMetadata {
  decode_tp?: number;
  decode_ep?: number;
}

interface GitHubRunRef {
  owner: string;
  repo: string;
  runId: string;
}

interface GitHubArtifact {
  id: number;
  name: string;
  expired: boolean;
  created_at?: string;
  archive_download_url: string;
}

interface GitHubArtifactsResponse {
  artifacts: GitHubArtifact[];
}

interface ImportedPointRow {
  interactivity?: number;
  throughput: number;
  model: string;
  islOsl: string;
  precision: string;
  mtp: string;
  hardware: string;
  framework: string;
  specMethod: string;
  lineName: string;
  title: string;
  point: InferenceCurveSeries['points'][number];
}

const ALL_VALUE = '__all__';
const CUSTOM_VALUE = '__custom__';
const CUSTOM_LINE_STYLE = '__custom_line_style__';
const MTP_VALUE = 'mtp';
const NON_MTP_VALUE = 'non-mtp';
const FIXED_SEQUENCE_SCENARIO = 'fixed-sequence';
const AGENTIC_SCENARIO = 'agentic';
const LATENCY_PERCENTILES: InferenceCurveLatencyPercentile[] = ['p50', 'p75', 'p90', 'p95'];
const DEFAULT_LATENCY_PERCENTILE: InferenceCurveLatencyPercentile = 'p90';
const DEFAULT_MODEL = 'Default Model';
const DEFAULT_ISL_OSL = 'Default Scenario';
const DEFAULT_PRECISION = 'default';
const DEFAULT_LINE_STYLE = 'solid';
// Bumped to v2 when the bundled defaults switched from DeepSeek-R1-0528 to the
// GLM-5.2 agentic curves. Browsers holding a v1 payload (old series plus
// DeepSeek sync configs that were still enabled) would otherwise keep
// overriding the new defaults on every load.
const LOCAL_STORAGE_KEY = 'inferencex-curve:user-data:v2';
const TOKEN_STORAGE_KEY = 'inferencex-curve:github-token:v1';
// Snapshots live outside LOCAL_STORAGE_KEY so that Reset All, which wipes the
// working data, leaves the saved history alone.
const SNAPSHOT_STORAGE_KEY = 'inferencex-curve:snapshots:v1';
const ACTIVE_SNAPSHOT_STORAGE_KEY = 'inferencex-curve:active-snapshot:v1';
// Each snapshot is a full copy of the working data, so the 5 MB localStorage
// budget is the real limit; this cap keeps us from silently walking into it.
const MAX_SNAPSHOTS = 20;
const MAX_SNAPSHOT_NAME_LENGTH = 60;
// Past versions of a synced line to keep before the oldest is dropped.
const MAX_SYNC_ARCHIVES = 5;
// Curves a view starts with: the newest SGLang run of each of these, read off
// the `MM-DD-<CI|local>-<hardware> SGLang` name prefix so that a newer run
// takes over by itself. Everything else (local B200, ATOM, older runs) stays in
// the legend to be switched on by hand. Names rather than ids, because Merge
// Parallelism gives a merged curve a derived id but keeps the shared name.
// Declared up here, like the two below, because createInitialDataState reads
// them during module init, long before the code that uses them further down.
const DEFAULT_VISIBLE_RUNS = new Set(['CI|B200', 'CI|MI355X', 'local|MI355X']);
const DEFAULT_RUN_NAME = /^(\d{2}-\d{2})-(CI|local)-(B200|MI355X)\s+SGLang\b/u;
const SYNC_ARCHIVE_SEPARATOR = '::archived-';
// A trailing parallelism token such as `TP8/EP1`, `TEP4` or `DPA8`. Used only as
// a fallback for series that carry no hardware key, so the grouping still works
// on imported data while lines without such a token stay on their own. Up here
// for the same reason as above: merging now runs during module init.
const PARALLELISM_NAME_SUFFIX = /\s+(?:DPA|DEP|TEP|PP|DP|TP|EP)\d+(?:\s*\/\s*(?:DPA|DEP|TEP|PP|DP|TP|EP)\d+)*$/iu;
const LOCAL_SAVE_DEBOUNCE_MS = 350;
const AUTO_RENDER_DEBOUNCE_MS = 400;
const MAX_WATERMARK_LENGTH = 64;
const INFERENCEX_UNOFFICIAL_RUN_REMOTE_API_BASE = 'https://inferencex.semianalysis.com/api';
const INFERENCEX_UNOFFICIAL_RUN_DEV_PROXY_API_BASE = '/inferencex-api';
const VITE_DEV_PORTS = new Set(['5173', '5174']);
const EXPORT_PADDING = 32;
const EXPORT_TITLE_HEIGHT = 62;
const EXPORT_LAYOUT_GAP = 16;
const EXPORT_IMAGE_SCALE = 2;
// Horizontal legend (rendered below the chart) layout metrics.
const EXPORT_LEGEND_PAD_X = 16;
const EXPORT_LEGEND_PAD_Y = 10;
const EXPORT_LEGEND_SWATCH = 30;
const EXPORT_LEGEND_SWATCH_GAP = 8;
const EXPORT_LEGEND_ITEM_GAP = 26;
const EXPORT_LEGEND_ROW_H = 20;
const EXPORT_LEGEND_CHAR_W = 6.4;

const DB_MODEL_TO_DISPLAY: Record<string, string> = {
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
  minimaxm3: 'MiniMax-M3',
  dsv4: 'DeepSeek-V4-Pro'
};

const MODEL_PREFIX_ALIASES: Record<string, string> = {
  gptoss: 'gptoss120b',
  dsv4pro: 'dsv4'
};

const MODEL_PATH_TO_DB_KEY: Record<string, string> = {
  'nvidia/deepseek-r1-0528-fp4-v2': 'dsr1',
  'nvidia/deepseek-r1-0528-fp4': 'dsr1',
  'deepseek-ai/deepseek-r1-0528': 'dsr1',
  'deepseek-ai/deepseek-r1': 'dsr1',
  'amd/deepseek-r1-0528-mxfp4': 'dsr1',
  'amd/deepseek-r1-0528-mxfp4-preview': 'dsr1',
  '/mnt/lustre01/models/deepseek-r1-0528-fp4-v2': 'dsr1',
  '/models/deepseek-r1': 'dsr1',
  '/models/deepseek-r1-0528-mxfp4-preview': 'dsr1',
  'deepseek-r1-0528': 'dsr1',
  'deepseek-r1-0528-fp4-v2': 'dsr1',
  'deepseek-r1-0528-nvfp4-v2': 'dsr1',
  'dsr1-0528-fp8': 'dsr1',
  'dsr1-0528-nvfp4-v2': 'dsr1',
  'dsr1-fp8': 'dsr1',
  'openai/gpt-oss-120b': 'gptoss120b',
  '/mnt/lustre01/models/gpt-oss-120b': 'gptoss120b',
  'nvidia/llama-3.3-70b-instruct-fp8': 'llama70b',
  'nvidia/llama-3.3-70b-instruct-fp4': 'llama70b',
  'amd/llama-3.3-70b-instruct-fp8-kv': 'llama70b',
  'amd/llama-3.3-70b-instruct-mxfp4-preview': 'llama70b',
  'qwen/qwen3.5-397b-a17b': 'qwen3.5',
  'qwen/qwen3.5-397b-a17b-fp8': 'qwen3.5',
  'moonshotai/kimi-k2.5': 'kimik2.5',
  'moonshotai/kimi-k3': 'kimik3',
  'minimaxai/minimax-m2.5': 'minimaxm2.5',
  'minimaxai/minimax-m3': 'minimaxm3',
  'zai-org/glm-5-fp8': 'glm5',
  'amd/glm-5.1-mxfp4': 'glm5.1',
  'deepseek-ai/deepseek-v4-pro': 'dsv4'
};

const MODEL_KEY_PRECISION_SUFFIX = /-(?:fp4|fp8|mxfp4|nvfp4)(?:-.*)?$/iu;

const pointColumns: TableColumn[] = [
  { key: 'concurrency', label: 'Concurrency', numeric: true },
  { key: 'shape', label: 'Marker' },
  { key: 'interactivity', label: 'Interactivity', numeric: true },
  {
    key: 'e2eNormalizedInteractivity',
    label: 'E2E Normalized Interactivity',
    numeric: true
  },
  { key: 'throughput', label: 'Throughput/GPU', required: true, numeric: true },
  { key: 'ttft', label: 'TTFT (s)', numeric: true },
  { key: 'endToEnd', label: 'End-to-end (s)', numeric: true },
  { key: 'num_prefill_gpu', label: 'Prefill GPUs', numeric: true },
  { key: 'num_decode_gpu', label: 'Decode GPUs', numeric: true },
  { key: 'prefill_tp', label: 'Prefill TP', numeric: true },
  { key: 'prefill_ep', label: 'Prefill EP', numeric: true },
  { key: 'prefill_dcp_size', label: 'Prefill DCP', numeric: true },
  { key: 'prefill_dp_attention', label: 'Prefill DPA' },
  { key: 'decode_tp', label: 'Decode TP', numeric: true },
  { key: 'decode_ep', label: 'Decode EP', numeric: true },
  { key: 'decode_dcp_size', label: 'Decode DCP', numeric: true },
  { key: 'decode_dp_attention', label: 'Decode DPA' },
  { key: 'label', label: 'Note' }
];

type LatencyMetricKey = 'interactivity' | 'ttft' | 'endToEnd';

const latencyMetricColumns: Record<
  LatencyMetricKey,
  { label: string; rowKeys: Record<InferenceCurveLatencyPercentile, string> }
> = {
  interactivity: {
    label: 'Interactivity',
    rowKeys: {
      p50: 'interactivityP50',
      p75: 'interactivityP75',
      p90: 'interactivityP90',
      p95: 'interactivityP95'
    }
  },
  ttft: {
    label: 'TTFT (s)',
    rowKeys: { p50: 'ttftP50', p75: 'ttftP75', p90: 'ttftP90', p95: 'ttftP95' }
  },
  endToEnd: {
    label: 'End-to-end (s)',
    rowKeys: {
      p50: 'endToEndP50',
      p75: 'endToEndP75',
      p90: 'endToEndP90',
      p95: 'endToEndP95'
    }
  }
};

const latencyPercentilePointKeys = Object.values(latencyMetricColumns).flatMap((metric) =>
  Object.values(metric.rowKeys)
);

const E2E_NORMALIZED_INTERACTIVITY_PERCENTILES: InferenceCurveE2ENormalizedInteractivityPercentile[] = [
  'p75',
  'p90'
];
const e2eNormalizedInteractivityRowKeys: Record<
  InferenceCurveE2ENormalizedInteractivityPercentile,
  string
> = {
  p75: 'e2eNormalizedInteractivityP75',
  p90: 'e2eNormalizedInteractivityP90'
};
const e2eNormalizedInteractivityPointKeys = Object.values(
  e2eNormalizedInteractivityRowKeys
);

const hiddenPointKeys = [
  'strategy',
  'tp',
  'dp_attention',
  'prefill_num_workers',
  'decode_num_workers',
  'disagg',
  'is_multinode',
  'kv_offload',
  'spec_decoding',
  'server_gpu_cache_hit_rate',
  'server_external_cache_hit_rate',
  'server_cpu_cache_hit_rate',
  'theoretical_cache_hit_rate'
] as const;
const knownPointKeys = new Set([
  ...pointColumns.map((column) => column.key),
  ...latencyPercentilePointKeys,
  ...e2eNormalizedInteractivityPointKeys,
  ...hiddenPointKeys
]);
const xMetricPointKeys: InferenceCurveXAxisMetric[] = [
  'interactivity',
  'e2eNormalizedInteractivity',
  'endToEnd',
  'ttft'
];
const pointConfigSplitKeys = [
  'num_prefill_gpu',
  'num_decode_gpu',
  'prefill_tp',
  'prefill_ep',
  'prefill_dcp_size',
  'prefill_dp_attention',
  'decode_tp',
  'decode_ep',
  'decode_dcp_size',
  'decode_dp_attention',
  ...hiddenPointKeys.filter((key) => !key.includes('cache_hit_rate'))
] as const;
// Point columns whose data-panel display is normalized to two decimal places.
const DECIMAL_DISPLAY_KEYS = new Set([
  'interactivity',
  'throughput',
  'ttft',
  'endToEnd',
  'e2eNormalizedInteractivity',
  ...latencyPercentilePointKeys,
  ...e2eNormalizedInteractivityPointKeys
]);

const pointShapeOptions = [
  { value: '', label: 'Default', symbol: '●' },
  { value: 'circle', label: 'Circle', symbol: '●' },
  { value: 'square', label: 'Square', symbol: '■' },
  { value: 'triangle', label: 'Triangle', symbol: '▲' },
  { value: 'diamond', label: 'Diamond', symbol: '◆' },
  { value: 'star', label: 'Star', symbol: '★' },
  { value: 'plus', label: 'Plus', symbol: '✚' },
  { value: 'cross', label: 'Cross', symbol: '✕' }
];

const colorPresets: ColorPreset[] = [
  { name: 'Green', value: '#22c55e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Lime', value: '#84cc16' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' }
];

const colorInputFallbacks = [
  '#7edc54',
  '#45bf64',
  '#009f6a',
  '#00826b',
  '#ff7059',
  '#a33b00',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#edc949',
  '#af7aa1',
  '#9c755f',
  '#bab0ab'
];

const lineStyleOptions: LineStyleOption[] = [
  { value: 'solid', label: 'Solid', dasharray: null },
  { value: 'dashed', label: 'Dashed', dasharray: '8 5' },
  { value: 'dotted', label: 'Dotted', dasharray: '2 5' },
  { value: 'dashdot', label: 'Dash Dot', dasharray: '8 4 2 4' },
  { value: 'long-dash', label: 'Long Dash', dasharray: '12 5' }
];

const chartMetricOptions: { value: InferenceCurveXAxisMetric; label: string }[] = [
  { value: 'e2eNormalizedInteractivity', label: 'E2E Normalized Interactivity' },
  { value: 'interactivity', label: 'Interactivity' },
  { value: 'endToEnd', label: 'End-to-end' },
  { value: 'ttft', label: 'TTFT' }
];
const fixedLengthChartMetrics = new Set<InferenceCurveXAxisMetric>([
  'interactivity',
  'endToEnd',
  'ttft'
]);
function createInitialDataState(
  persisted: PersistedAppData | null = loadPersistedAppData()
): InitialDataState {
  const defaultSeries = structuredClone(exampleSeries);
  if (!persisted) {
    return {
      currentSeries: defaultSeries,
      seriesDrafts: draftsFromSeriesForRestore(defaultSeries),
      state: createInitialState(defaultSeries),
      inferenceXSync: createInferenceXSyncState(),
      loadedFromStorage: false
    };
  }

  const restoredDrafts = persisted.seriesDrafts.length
    ? persisted.seriesDrafts
    : draftsFromSeriesForRestore(persisted.currentSeries);
  const savedHardware = new Map(persisted.currentSeries.map((line) => [line.id, line.hwKey]));
  restoredDrafts.forEach((draft) => {
    draft.hwKey ||= savedHardware.get(draft.id);
  });
  let restoredSeries = persisted.currentSeries;
  try {
    const draftSeries = draftsToSeriesAllowEmpty(restoredDrafts);
    if (draftSeries.length > 0 || persisted.currentSeries.length === 0) {
      restoredSeries = draftSeries;
    }
  } catch {
    restoredSeries = persisted.currentSeries;
  }

  return {
    currentSeries: restoredSeries,
    seriesDrafts: restoredDrafts.length ? restoredDrafts : [makeRestoredEmptySeriesDraft(0)],
    state: restoreAppState(createInitialState(restoredSeries), persisted.state, restoredSeries),
    inferenceXSync: createInferenceXSyncState(persisted.inferenceXSync),
    loadedFromStorage: true
  };
}

function loadPersistedAppData(): PersistedAppData | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    return parsePersistedAppData(JSON.parse(raw));
  } catch (error) {
    console.warn('Could not load saved browser data.', error);
    return null;
  }
}

function parsePersistedAppData(data: unknown): PersistedAppData | null {
  if (!isRecord(data) || data.version !== 1) return null;
  return {
    version: 1,
    savedAt: readPersistedText(data, 'savedAt'),
    currentSeries: Array.isArray(data.currentSeries) ? readNativeSeries(data.currentSeries) : [],
    seriesDrafts: restorePersistedSeriesDrafts(data.seriesDrafts),
    state: restorePersistedState(data.state),
    inferenceXSync: restorePersistedInferenceXSyncState(data.inferenceXSync)
  };
}

function createInferenceXSyncState(saved?: PersistedInferenceXSyncState): InferenceXSyncState {
  const configs = normalizeInferenceXSyncConfigs(saved?.configs);
  const addConfig = configs[0] ?? createDefaultInferenceXSyncConfigs()[0]!;
  const restoredStatus = saved?.status === 'updates-available' ? 'idle' : (saved?.status ?? 'idle');
  return {
    configs,
    fingerprints: saved?.fingerprints ?? {},
    lineIdsByConfigKey: saved?.lineIdsByConfigKey ?? {},
    lastCheckedAt: saved?.lastCheckedAt ?? '',
    lastUpdatedAt: saved?.lastUpdatedAt ?? '',
    status: restoredStatus,
    availableUpdateCount: restoredStatus === 'idle' ? 0 : (saved?.availableUpdateCount ?? 0),
    lastError: saved?.lastError ?? '',
    keepHistory: saved?.keepHistory ?? true,
    stagedResult: null,
    changedConfigIds: new Set(),
    missingConfigIds: new Set(),
    manageOpen: false,
    availabilityRows: [],
    availabilityLoaded: false,
    availabilityLoading: false,
    addDraft: createInferenceXSyncAddDraft(addConfig),
    addShapeSelection: ALL_VALUE,
    addPrecisionSelection: ALL_VALUE,
    addFrameworkSelection: ALL_VALUE,
    addSpecMethodSelection: ALL_VALUE
  };
}

function restorePersistedInferenceXSyncState(value: unknown): PersistedInferenceXSyncState | undefined {
  if (!isRecord(value)) return undefined;
  return {
    configs: normalizeInferenceXSyncConfigs(value.configs),
    fingerprints: readPersistedStringRecord(value.fingerprints),
    lineIdsByConfigKey: readPersistedStringRecord(value.lineIdsByConfigKey),
    lastCheckedAt: readPersistedText(value, 'lastCheckedAt'),
    lastUpdatedAt: readPersistedText(value, 'lastUpdatedAt'),
    status: readPersistedInferenceXSyncStatus(value.status),
    availableUpdateCount: readPersistedNumber(value, 'availableUpdateCount', 0),
    lastError: readPersistedText(value, 'lastError'),
    keepHistory: typeof value.keepHistory === 'boolean' ? value.keepHistory : undefined
  };
}

function createInferenceXSyncAddDraft(config: InferenceXSyncConfig): InferenceXSyncAddDraft {
  return {
    model: config.model,
    scenario: config.scenario,
    isl: config.isl,
    osl: config.osl,
    precision: config.precision,
    hardware: config.hardware,
    framework: config.framework,
    specMethod: config.specMethod
  };
}

function draftsFromSeriesForRestore(series: InferenceCurveSeries[]): SeriesDraft[] {
  return series.length > 0 ? seriesToDrafts(series) : [makeRestoredEmptySeriesDraft(0)];
}

function makeRestoredEmptySeriesDraft(index: number): SeriesDraft {
  return {
    id: `line-${index + 1}`,
    name: `Line ${index + 1}`,
    model: DEFAULT_MODEL,
    islOsl: DEFAULT_ISL_OSL,
    precision: DEFAULT_PRECISION,
    mtp: NON_MTP_VALUE,
    marker: '',
    title: '',
    note: '',
    color: '',
    lineStyle: DEFAULT_LINE_STYLE,
    renderOrder: index,
    collapsed: true,
    points: [makeEmptyPointRow()]
  };
}

function restorePersistedSeriesDrafts(value: unknown): SeriesDraft[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((draft, index) => {
    const restored: SeriesDraft = {
      id: readPersistedText(draft, 'id', `line-${index + 1}`),
      name: readPersistedText(draft, 'name', `Line ${index + 1}`),
      model: getInferenceXDisplayModel(readPersistedText(draft, 'model', DEFAULT_MODEL)),
      hwKey: readPersistedText(draft, 'hwKey') || undefined,
      islOsl: readPersistedText(draft, 'islOsl', DEFAULT_ISL_OSL),
      precision: readPersistedText(draft, 'precision', DEFAULT_PRECISION),
      mtp: normalizeMtpValue(readPersistedText(draft, 'mtp', NON_MTP_VALUE)),
      marker: normalizePointShapeValue(readPersistedText(draft, 'marker')),
      title: readPersistedText(draft, 'title'),
      note: readPersistedText(draft, 'note'),
      color: readPersistedText(draft, 'color'),
      lineStyle: readPersistedText(draft, 'lineStyle', DEFAULT_LINE_STYLE) || DEFAULT_LINE_STYLE,
      renderOrder: readPersistedNumber(draft, 'renderOrder', index),
      collapsed: typeof draft.collapsed === 'boolean' ? draft.collapsed : true,
      points: restorePersistedPointRows(draft.points)
    };
    if (isAgenticTraceSequence(restored.islOsl)) {
      if (!readPersistedText(draft, 'mtp')) restored.mtp = '';
      restored.points.forEach((row) => {
        if (!isEmptyPointRow(row) && !row.spec_decoding && readPersistedText(draft, 'mtp')) {
          row.spec_decoding = restored.mtp === MTP_VALUE ? 'mtp' : 'none';
        }
        (Object.keys(latencyMetricColumns) as LatencyMetricKey[]).forEach((metric) => {
          const p90Key = latencyMetricColumns[metric].rowKeys.p90;
          if (!row[p90Key] && row[metric]) row[p90Key] = row[metric];
        });
      });
    }
    return restored;
  });
}

function restorePersistedPointRows(value: unknown): PointRow[] {
  if (!Array.isArray(value)) return [makeEmptyPointRow()];
  const rows = value.filter(isRecord).map((point) => {
    const row = makeEmptyPointRow();
    [
      ...pointColumns.map((column) => column.key),
      ...latencyPercentilePointKeys,
      ...e2eNormalizedInteractivityPointKeys,
      ...hiddenPointKeys
    ].forEach((key) => {
      row[key] = formatPointFieldValue(point[key]);
    });
    row.shape = normalizePointShapeValue(row.shape);
    return row;
  });
  return rows.length ? rows : [makeEmptyPointRow()];
}

function restorePersistedState(value: unknown): PersistedAppState {
  if (!isRecord(value)) return {};
  return {
    theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : undefined,
    chartMetric: normalizeChartMetric(value.chartMetric),
    chartYMetric: value.chartYMetric === 'totalTokensPerDollar' ? 'totalTokensPerDollar' : 'throughput',
    tcoCostMode: normalizeTcoCostMode(value.tcoCostMode),
    tcoCustomCosts: normalizeTcoCustomCosts(value.tcoCustomCosts),
    latencyPercentile: normalizeLatencyPercentile(value.latencyPercentile),
    activeSeriesIds: readPersistedStringArray(value.activeSeriesIds),
    activeSeriesIdsByView: readPersistedActiveSeriesByView(value.activeSeriesIdsByView),
    knownSeriesIdsByView: readPersistedActiveSeriesByView(value.knownSeriesIdsByView),
    selectedPrecisions: readPersistedStringArray(value.selectedPrecisions),
    modelFilter: readPersistedText(value, 'modelFilter')
      ? getInferenceXDisplayModel(readPersistedText(value, 'modelFilter')) : undefined,
    scenarioFilter: readPersistedText(value, 'scenarioFilter') || undefined,
    islOslFilter: readPersistedText(value, 'islOslFilter') || undefined,
    mtpFilter: readPersistedText(value, 'mtpFilter') || undefined,
    mergeParallelism: readPersistedBoolean(value.mergeParallelism),
    enforceEndToEndPareto: readPersistedBoolean(value.enforceEndToEndPareto),
    showNonOptimalPoints: readPersistedBoolean(value.showNonOptimalPoints),
    hidePointLabels: readPersistedBoolean(value.hidePointLabels),
    showConcurrencyLabels: readPersistedBoolean(value.showConcurrencyLabels),
    useAdvancedLabels: readPersistedBoolean(value.useAdvancedLabels),
    showGradientLabels: readPersistedBoolean(value.showGradientLabels),
    showLineLabels: readPersistedBoolean(value.showLineLabels),
    lineLabelOffsets: readPersistedLineLabelOffsets(value.lineLabelOffsets),
    showGoalDirection: readPersistedBoolean(value.showGoalDirection),
    showOffloadRings: readPersistedBoolean(value.showOffloadRings),
    highContrast: readPersistedBoolean(value.highContrast),
    logY: readPersistedBoolean(value.logY),
    search: readPersistedText(value, 'search'),
    watermark: Object.prototype.hasOwnProperty.call(value, 'watermark')
      ? normalizeWatermarkText(String(value.watermark ?? ''))
      : undefined
  };
}

function restoreAppState(defaults: AppState, saved: PersistedAppState, series: InferenceCurveSeries[]): AppState {
  const ids = new Set(series.map((line) => line.id));
  const activeSeriesIds = (saved.activeSeriesIds ?? []).filter((id) => ids.has(id));
  const activeSeriesIdsByView = new Map(
    Object.entries(saved.activeSeriesIdsByView ?? {}).map(([key, values]) => [
      key,
      new Set(values.filter((id) => ids.has(id)))
    ])
  );
  // Kept unfiltered: an id that has since disappeared still records that the
  // view had seen it, and merged ids are derived so they never appear in `ids`.
  const knownSeriesIdsByView = new Map(
    Object.entries(saved.knownSeriesIdsByView ?? {}).map(([key, values]) => [key, new Set(values)])
  );
  const precisionValues = new Set(getAvailablePrecisions(series));
  const selectedPrecisions = (saved.selectedPrecisions ?? []).filter((precision) =>
    precisionValues.has(precision)
  );

  return {
    theme: getTheme(),
    chartMetric: saved.chartMetric ?? defaults.chartMetric,
    chartYMetric: saved.chartYMetric ?? defaults.chartYMetric,
    tcoCostMode: saved.tcoCostMode ?? defaults.tcoCostMode,
    tcoCustomCosts: saved.tcoCustomCosts ?? defaults.tcoCustomCosts,
    latencyPercentile: saved.latencyPercentile ?? defaults.latencyPercentile,
    activeSeriesIds:
      activeSeriesIds.length > 0 || series.length === 0
        ? new Set(activeSeriesIds)
        : new Set(defaults.activeSeriesIds),
    activeSeriesIdsByView,
    knownSeriesIdsByView,
    selectedPrecisions:
      selectedPrecisions.length > 0 || precisionValues.size === 0
        ? new Set(selectedPrecisions)
        : new Set(defaults.selectedPrecisions),
    modelFilter: saved.modelFilter ?? defaults.modelFilter,
    scenarioFilter:
      saved.scenarioFilter ??
      (saved.islOslFilter ? getScenarioForSequence(saved.islOslFilter) : defaults.scenarioFilter),
    islOslFilter: saved.islOslFilter ?? defaults.islOslFilter,
    mtpFilter: saved.mtpFilter ?? defaults.mtpFilter,
    mergeParallelism: saved.mergeParallelism ?? defaults.mergeParallelism,
    enforceEndToEndPareto: saved.enforceEndToEndPareto ?? defaults.enforceEndToEndPareto,
    showNonOptimalPoints: saved.showNonOptimalPoints ?? defaults.showNonOptimalPoints,
    hidePointLabels: saved.hidePointLabels ?? defaults.hidePointLabels,
    showConcurrencyLabels: saved.showConcurrencyLabels ?? defaults.showConcurrencyLabels,
    useAdvancedLabels: saved.useAdvancedLabels ?? defaults.useAdvancedLabels,
    showGradientLabels: saved.showGradientLabels ?? defaults.showGradientLabels,
    showLineLabels: saved.showLineLabels ?? defaults.showLineLabels,
    lineLabelOffsets: saved.lineLabelOffsets ?? defaults.lineLabelOffsets,
    showGoalDirection: saved.showGoalDirection ?? defaults.showGoalDirection,
    showOffloadRings: saved.showOffloadRings ?? defaults.showOffloadRings,
    highContrast: saved.highContrast ?? defaults.highContrast,
    logY: saved.logY ?? defaults.logY,
    search: saved.search ?? defaults.search,
    watermark: saved.watermark ?? defaults.watermark
  };
}

function serializeAppState(): PersistedAppState {
  return {
    theme: state.theme,
    chartMetric: state.chartMetric,
    chartYMetric: state.chartYMetric,
    tcoCostMode: state.tcoCostMode,
    tcoCustomCosts: state.tcoCustomCosts,
    latencyPercentile: state.latencyPercentile,
    activeSeriesIds: Array.from(state.activeSeriesIds),
    activeSeriesIdsByView: serializeSeriesIdsByView(state.activeSeriesIdsByView),
    knownSeriesIdsByView: serializeSeriesIdsByView(state.knownSeriesIdsByView),
    selectedPrecisions: Array.from(state.selectedPrecisions),
    modelFilter: state.modelFilter,
    scenarioFilter: state.scenarioFilter,
    islOslFilter: state.islOslFilter,
    mtpFilter: state.mtpFilter,
    mergeParallelism: state.mergeParallelism,
    enforceEndToEndPareto: state.enforceEndToEndPareto,
    showNonOptimalPoints: state.showNonOptimalPoints,
    hidePointLabels: state.hidePointLabels,
    showConcurrencyLabels: state.showConcurrencyLabels,
    useAdvancedLabels: state.useAdvancedLabels,
    showGradientLabels: state.showGradientLabels,
    showLineLabels: state.showLineLabels,
    lineLabelOffsets: state.lineLabelOffsets,
    showGoalDirection: state.showGoalDirection,
    showOffloadRings: state.showOffloadRings,
    highContrast: state.highContrast,
    logY: state.logY,
    search: state.search,
    watermark: state.watermark
  };
}

function serializeSeriesIdsByView(byView: Map<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  byView.forEach((ids, key) => {
    result[key] = Array.from(ids);
  });
  return result;
}

function serializeInferenceXSyncState(): PersistedInferenceXSyncState {
  return {
    configs: inferenceXSync.configs,
    fingerprints: inferenceXSync.fingerprints,
    lineIdsByConfigKey: inferenceXSync.lineIdsByConfigKey,
    lastCheckedAt: inferenceXSync.lastCheckedAt,
    lastUpdatedAt: inferenceXSync.lastUpdatedAt,
    keepHistory: inferenceXSync.keepHistory,
    status:
      inferenceXSync.status === 'checking' ||
      inferenceXSync.status === 'updating' ||
      inferenceXSync.status === 'updates-available'
        ? 'idle'
        : inferenceXSync.status,
    availableUpdateCount: inferenceXSync.status === 'updates-available' ? 0 : inferenceXSync.availableUpdateCount,
    lastError: inferenceXSync.lastError
  };
}

function getSeriesForPersistence(): InferenceCurveSeries[] {
  try {
    const parsedSeries = draftsToSeriesAllowEmpty(seriesDrafts);
    if (parsedSeries.length > 0 || currentSeries.length === 0) return parsedSeries;
  } catch {
    return currentSeries;
  }
  return currentSeries;
}

function scheduleLocalSave(): void {
  skipNextBeforeUnloadSave = false;
  if (localSaveTimer !== null) window.clearTimeout(localSaveTimer);
  localSaveTimer = window.setTimeout(() => {
    localSaveTimer = null;
    saveLocalDataNow();
  }, LOCAL_SAVE_DEBOUNCE_MS);
}

function captureAppData(): PersistedAppData {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    currentSeries: getSeriesForPersistence(),
    seriesDrafts,
    state: serializeAppState(),
    inferenceXSync: serializeInferenceXSyncState()
  };
}

function saveLocalDataNow(): void {
  skipNextBeforeUnloadSave = false;
  if (localSaveTimer !== null) {
    window.clearTimeout(localSaveTimer);
    localSaveTimer = null;
  }

  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(captureAppData()));
    localStorageWarningShown = false;
  } catch (error) {
    if (!localStorageWarningShown) {
      console.warn('Could not save browser data.', error);
      localStorageWarningShown = true;
    }
  }
}

function loadStoredGitHubToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch (error) {
    console.warn('Could not read saved GitHub token.', error);
    return '';
  }
}

function persistGitHubToken(): void {
  try {
    const token = githubTokenEl.value.trim();
    if (githubTokenRememberEl.checked && token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Could not save GitHub token.', error);
  }
}

function restoreStoredGitHubToken(): void {
  const token = loadStoredGitHubToken();
  if (token) {
    githubTokenEl.value = token;
    githubTokenRememberEl.checked = true;
  }
}

function resetStoredAppData(): void {
  if (localSaveTimer !== null) {
    window.clearTimeout(localSaveTimer);
    localSaveTimer = null;
  }
  skipNextBeforeUnloadSave = true;
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorageWarningShown = false;
  } catch (error) {
    console.warn('Could not clear saved browser data.', error);
  }
}

function loadSnapshots(): StoredSnapshot[] {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const data = parsePersistedAppData(entry.data);
      if (!data) return [];
      const id = typeof entry.id === 'string' && entry.id ? entry.id : createSnapshotId();
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Untitled';
      return [{ id, name, savedAt: readPersistedText(entry, 'savedAt'), data }];
    });
  } catch (error) {
    console.warn('Could not load saved snapshots.', error);
    return [];
  }
}

/** Returns an error message, or '' when the write succeeded. */
function writeSnapshots(list: StoredSnapshot[]): string {
  try {
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(list));
    return '';
  } catch (error) {
    console.warn('Could not save snapshots.', error);
    // A full quota is the expected failure: every snapshot carries a complete
    // copy of the chart data, so a handful of large datasets fills 5 MB.
    return isQuotaExceeded(error)
      ? 'Browser storage is full. Delete an older snapshot and try again.'
      : 'Could not save the snapshot in this browser.';
  }
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

function loadActiveSnapshotId(available: StoredSnapshot[]): string {
  try {
    const id = window.localStorage.getItem(ACTIVE_SNAPSHOT_STORAGE_KEY) ?? '';
    return available.some((snapshot) => snapshot.id === id) ? id : '';
  } catch {
    return '';
  }
}

function persistActiveSnapshotId(): void {
  try {
    if (activeSnapshotId) {
      window.localStorage.setItem(ACTIVE_SNAPSHOT_STORAGE_KEY, activeSnapshotId);
    } else {
      window.localStorage.removeItem(ACTIVE_SNAPSHOT_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Could not save the selected snapshot.', error);
  }
}

function createSnapshotId(): string {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatSnapshotTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function defaultSnapshotName(): string {
  const count = currentSeries.length;
  const stamp = formatSnapshotTimestamp(new Date().toISOString());
  return `${stamp} - ${count} line${count === 1 ? '' : 's'}`;
}

function resetImportState(): void {
  pendingImportDrafts = [];
  pendingImportSettings = createImportBatchSettings();
  renderImportPreview();
  githubActionUrlEl.value = '';
  githubImportProgressEl.hidden = true;
  githubImportProgressEl.classList.remove('indeterminate');
  githubImportProgressFillEl.style.width = '0%';
  importDataFileInputEl.value = '';
}

function readPersistedText(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  if (value === null || value === undefined) return fallback;
  return normalizeCellText(String(value));
}

function normalizeWatermarkText(value: string): string {
  return value.replace(/\u00a0/g, ' ').slice(0, MAX_WATERMARK_LENGTH);
}

function readPersistedStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map((item) => normalizeCellText(String(item))).filter(Boolean);
  return values.length ? values : undefined;
}

function readPersistedActiveSeriesByView(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string[]> = {};
  Object.entries(value).forEach(([key, ids]) => {
    if (!Array.isArray(ids)) return;
    const [model, ...filters] = key.split('|');
    let canonicalKey = key;
    try {
      canonicalKey = [encodeURIComponent(getInferenceXDisplayModel(decodeURIComponent(model!))), ...filters].join('|');
    } catch {
      // Keep legacy keys with invalid percent escapes unchanged.
    }
    result[canonicalKey] = [...new Set([
      ...(result[canonicalKey] ?? []),
      ...ids.map((id) => normalizeCellText(String(id))).filter(Boolean)
    ])];
  });
  return Object.keys(result).length ? result : undefined;
}

function readPersistedStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (typeof item !== 'string') return;
    const normalizedKey = normalizeCellText(key);
    const normalizedValue = normalizeCellText(item);
    if (normalizedKey && normalizedValue) result[normalizedKey] = normalizedValue;
  });
  return Object.keys(result).length ? result : undefined;
}

function readPersistedInferenceXSyncStatus(value: unknown): InferenceXSyncStatus | undefined {
  if (
    value === 'idle' ||
    value === 'checking' ||
    value === 'updates-available' ||
    value === 'up-to-date' ||
    value === 'updating' ||
    value === 'error'
  ) {
    return value;
  }
  return undefined;
}

function readPersistedBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readPersistedLineLabelOffsets(
  value: unknown
): Record<string, InferenceCurveLineLabelOffset> | undefined {
  if (!isRecord(value)) return undefined;
  const offsets: Record<string, InferenceCurveLineLabelOffset> = {};
  Object.entries(value).forEach(([seriesId, entry]) => {
    if (!isRecord(entry)) return;
    const { pointIndex, dx, dy } = entry;
    if (
      typeof pointIndex !== 'number' ||
      !Number.isFinite(pointIndex) ||
      typeof dx !== 'number' ||
      !Number.isFinite(dx) ||
      typeof dy !== 'number' ||
      !Number.isFinite(dy)
    ) {
      return;
    }
    offsets[seriesId] = { pointIndex, dx, dy };
  });
  return offsets;
}

function readPersistedNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

const initialData = createInitialDataState();
let currentSeries: InferenceCurveSeries[] = initialData.currentSeries;
let seriesDrafts: SeriesDraft[] = initialData.seriesDrafts;
let snapshots: StoredSnapshot[] = loadSnapshots();
let activeSnapshotId = loadActiveSnapshotId(snapshots);
// Signature of the working data as of the last snapshot save or load, so that
// switching snapshots only interrupts with a confirm when work would be lost.
let loadedSnapshotSignature = '';
let pendingImportDrafts: PendingImportDraft[] = [];
let pendingImportSettings: ImportBatchSettings = createImportBatchSettings();
let pendingMergeGroups: PendingMergeGroup[] = [];
let state: AppState = initialData.state;
let tcoPriceSnapshot = loadCachedTcoPrices();
let tcoPriceLoading = false;
let tcoPriceError = '';
let inferenceXSync: InferenceXSyncState = initialData.inferenceXSync;
let localSaveTimer: number | null = null;
let autoRenderTimer: number | null = null;
let localStorageWarningShown = false;
let skipNextBeforeUnloadSave = false;
let draggedSeriesIndex: number | null = null;
let pendingActiveSeriesIds = new Set<string>();

sortSeriesDraftsByLayer();
normalizeDraftRenderOrderFromPanelOrder();
syncCurrentSeriesOrderFromDrafts();
reconcileFiltersForSeries(currentSeries);
reconcileActiveSeriesForChart();

app.innerHTML = `
  <main class="container page">
    <section class="filter-card no-export">
      <label>
        <span>Model</span>
        <select id="model-filter"></select>
      </label>
      <label>
        <span>Scenario</span>
        <select id="scenario-filter"></select>
      </label>
      <label>
        <span>ISL / OSL</span>
        <select id="isl-osl-filter"></select>
      </label>
      <label>
        <span>Precision</span>
        <select id="precision-filter"></select>
      </label>
      <label id="mtp-filter-control">
        <span>MTP</span>
        <select id="mtp-filter"></select>
      </label>
      <label id="latency-percentile-control" hidden>
        <span>Latency Percentile</span>
        <select id="latency-percentile-filter"></select>
      </label>
    </section>
    <section class="metric-row no-export">
      <div id="metric-switch" class="metric-switch" role="group" aria-label="X-axis metric"></div>
      <label class="chart-y-metric-control">
        <span>Y axis</span>
        <select id="chart-y-metric">
          <option value="throughput">Throughput / GPU</option>
          <option value="totalTokensPerDollar">Total Tokens per Dollar</option>
        </select>
      </label>
    </section>

    <section id="tco-controls" class="tco-controls no-export" hidden></section>

    <section class="chart-card">
      <div class="chart-card-toolbar no-export">
        <div id="watermark-menu" class="watermark-menu">
          <button
            id="watermark-menu-toggle"
            class="tool-button"
            type="button"
            title="Chart options"
            aria-label="Chart options"
            aria-expanded="false"
            aria-controls="watermark-menu-panel"
          >
            ${renderIcon('sliders')}
          </button>
          <div id="watermark-menu-panel" class="watermark-menu-panel" hidden>
            <label class="watermark-control">
              <span>Watermark</span>
              <input
                id="chart-watermark"
                type="text"
                value="${escapeAttribute(state.watermark)}"
                maxlength="${MAX_WATERMARK_LENGTH}"
                placeholder="${escapeAttribute(DEFAULT_CHART_WATERMARK)}"
                aria-label="Chart watermark text"
              />
            </label>
            <div class="watermark-panel-actions">
              <button id="reset-watermark" class="action-button watermark-reset-button" type="button">
                ${renderIcon('refresh')}
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>
        <button id="download-png" class="tool-button" type="button" title="Download PNG" aria-label="Download PNG">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
        </button>
        <button id="download-csv" class="tool-button" type="button" title="Download CSV" aria-label="Download CSV">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 4h16v16H4zM8 4v16m8-16v16M4 10h16M4 16h16"/></svg>
        </button>
        <button id="download-visible-csv" class="tool-button" type="button" title="Download Visible CSV" aria-label="Download Visible CSV">
          ${renderIcon('filter')}
        </button>
        <button id="reset-zoom" class="tool-button" type="button" title="Reset zoom" aria-label="Reset zoom">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
        </button>
      </div>

      <figcaption class="chart-caption">
        <h2 id="chart-title">Token Throughput per GPU vs. Interactivity</h2>
        <p id="chart-subtitle"></p>
      </figcaption>

      <div class="chart-layout">
        <div class="chart-main">
          <div id="chart"></div>
          <p class="chart-instructions no-export">Shift+Scroll to zoom • Drag to pan • Double-click to reset • Hover a point for details</p>
        </div>
        <aside id="legend" class="legend-shell no-export"></aside>
      </div>
    </section>

    <section class="data-card">
      <div class="data-card-header">
        <div>
          <h2>Line Projects</h2>
          <p>Edit shared line fields once, then paste point rows from Excel. Changes are auto-saved in this browser.</p>
        </div>
        <div class="data-header-controls">
          <div class="data-header-actions">
            <button id="render-data" type="button" class="primary action-button" title="Render chart (Ctrl/Cmd+Enter)">
              ${renderIcon('play')}
              <span>Render Chart</span>
            </button>
            <div class="data-action-group" aria-label="Line actions">
              <button id="add-series" class="action-button" type="button">
                ${renderIcon('plus')}
                <span>Add Line</span>
              </button>
              <button
                id="import-data-file"
                class="action-button has-help-tip"
                type="button"
                aria-label="Import CSV downloaded from this app, or JSON and ZIP artifacts from GitHub CI"
              >
                ${renderIcon('upload')}
                <span>Import File</span>
                <span class="help-tip-bubble" aria-hidden="true">
                  <strong class="help-tip-title">Import local benchmark files.</strong>
                  <span class="help-tip-row">
                    Use <code>.csv</code> / <code>.tsv</code> files exported from this app with Download CSV.
                  </span>
                  <span class="help-tip-row">
                    Use <code>.json</code>, <code>.jsonl</code>, <code>.ndjson</code>, or <code>.zip</code> files downloaded from GitHub Actions CI artifacts.
                  </span>
                  <span class="help-tip-note">
                    Imports open in a review step first; current chart data changes only after Add Selected.
                  </span>
                </span>
              </button>
              <button id="merge-lines" class="action-button" type="button">
                ${renderIcon('merge')}
                <span>Merge Lines</span>
              </button>
            </div>
            <input
              id="import-data-file-input"
              type="file"
              accept=".csv,.tsv,.json,.jsonl,.ndjson,.zip"
              multiple
              hidden
            />
            <div class="data-action-group snapshot-group" aria-label="Snapshots">
              <label class="snapshot-select-wrap">
                ${renderIcon('history')}
                <select id="snapshot-select" aria-label="Saved snapshots"></select>
              </label>
              <button
                id="snapshot-save"
                class="action-button has-help-tip"
                type="button"
                aria-label="Save the current data and settings as a snapshot"
              >
                ${renderIcon('save')}
                <span>Save Snapshot</span>
                <span class="help-tip-bubble" aria-hidden="true">
                  <strong class="help-tip-title">Keep a named copy you can switch back to.</strong>
                  <span class="help-tip-row">
                    A snapshot stores every line plus the current filters, toggles and metric.
                  </span>
                  <span class="help-tip-note">
                    Saved in this browser only, and kept when you press Reset All.
                  </span>
                </span>
              </button>
              <button id="snapshot-rename" class="action-button" type="button">
                ${renderIcon('pencil')}
                <span>Rename</span>
              </button>
              <button id="snapshot-delete" class="action-button danger" type="button">
                ${renderIcon('trash')}
                <span>Delete</span>
              </button>
            </div>
            <div class="data-action-group data-action-group-muted" aria-label="Data actions">
              <button id="reset-data" class="action-button" type="button">
                ${renderIcon('refresh')}
                <span>Reset All</span>
              </button>
              <button id="clear-data" class="action-button danger" type="button">
                ${renderIcon('trash')}
                <span>Clear Data</span>
              </button>
            </div>
          </div>
          <p id="status" class="status data-header-status" role="status"></p>
        </div>
      </div>

      <div class="action-import-panel">
        <label class="action-import-url">
          <span>GitHub Actions Run URL</span>
          <input
            id="github-action-url"
            type="text"
            placeholder="https://github.com/owner/repo/actions/runs/123456789"
          />
        </label>
        <div class="action-import-token">
          <div class="action-import-field-label">
            <label for="github-token">Token</label>
            <span
              class="help-tip"
              tabindex="0"
              role="note"
              aria-label="GitHub token permissions help"
            >
              ${renderIcon('help')}
              <span class="help-tip-bubble">
                <strong class="help-tip-title">Artifact downloads need a token.</strong>
                <span class="help-tip-row">
                  Your own / org repo &mdash; fine-grained PAT
                  (<strong>Actions: Read-only</strong>).
                </span>
                <span class="help-tip-row">
                  Someone else&rsquo;s private repo &mdash; classic PAT with
                  <code>repo</code> scope.
                </span>
                <span class="help-tip-note">
                  &ldquo;Remember&rdquo; saves it in plain text, in this browser only.
                </span>
              </span>
            </span>
            <label class="action-import-remember">
              <input id="github-token-remember" type="checkbox" />
              <span>Remember</span>
            </label>
          </div>
          <input
            id="github-token"
            type="password"
            autocomplete="off"
            placeholder="Optional"
          />
        </div>
        <button id="import-action-data" class="action-button" type="button">
          ${renderIcon('download-cloud')}
          <span>Import Action Data</span>
        </button>
        <div id="github-import-progress" class="import-progress" role="progressbar" hidden>
          <div id="github-import-progress-fill" class="import-progress-fill"></div>
        </div>
        <p id="github-import-status" class="action-import-status" role="status"></p>
        <div id="github-import-preview" class="import-preview"></div>
      </div>

      <div id="inferencex-sync" class="inferencex-sync-panel"></div>

      <div id="merge-preview" class="merge-preview"></div>

      <div id="series-editor" class="series-editor"></div>
    </section>
  </main>
  <aside class="quick-toolbar no-export" aria-label="Quick actions">
    <button id="quick-render" class="quick-tool-button" type="button" title="Render chart (Ctrl/Cmd+Enter)" aria-label="Render chart">
      ${renderIcon('redraw')}
    </button>
    <button id="quick-top" class="quick-tool-button" type="button" title="Back to top" aria-label="Back to top">
      ${renderIcon('arrow-up')}
    </button>
  </aside>
`;

const chartEl = document.querySelector<HTMLElement>('#chart')!;
const legendEl = document.querySelector<HTMLElement>('#legend')!;
const chartSubtitleEl = document.querySelector<HTMLParagraphElement>('#chart-subtitle')!;
const watermarkMenuEl = document.querySelector<HTMLElement>('#watermark-menu')!;
const watermarkMenuToggleEl = document.querySelector<HTMLButtonElement>('#watermark-menu-toggle')!;
const watermarkMenuPanelEl = document.querySelector<HTMLElement>('#watermark-menu-panel')!;
const chartWatermarkEl = document.querySelector<HTMLInputElement>('#chart-watermark')!;
const modelFilterEl = document.querySelector<HTMLSelectElement>('#model-filter')!;
const scenarioFilterEl = document.querySelector<HTMLSelectElement>('#scenario-filter')!;
const islOslFilterEl = document.querySelector<HTMLSelectElement>('#isl-osl-filter')!;
const precisionFilterEl = document.querySelector<HTMLSelectElement>('#precision-filter')!;
const mtpFilterEl = document.querySelector<HTMLSelectElement>('#mtp-filter')!;
const latencyPercentileControlEl = document.querySelector<HTMLElement>('#latency-percentile-control')!;
const latencyPercentileFilterEl = document.querySelector<HTMLSelectElement>('#latency-percentile-filter')!;
const metricSwitchEl = document.querySelector<HTMLElement>('#metric-switch')!;
const chartTitleEl = document.querySelector<HTMLHeadingElement>('#chart-title')!;
const seriesEditorEl = document.querySelector<HTMLElement>('#series-editor')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const githubActionUrlEl = document.querySelector<HTMLInputElement>('#github-action-url')!;
const githubTokenEl = document.querySelector<HTMLInputElement>('#github-token')!;
const githubTokenRememberEl = document.querySelector<HTMLInputElement>('#github-token-remember')!;
const importActionDataEl = document.querySelector<HTMLButtonElement>('#import-action-data')!;
const importDataFileEl = document.querySelector<HTMLButtonElement>('#import-data-file')!;
const importDataFileInputEl = document.querySelector<HTMLInputElement>('#import-data-file-input')!;
const githubImportStatusEl = document.querySelector<HTMLParagraphElement>('#github-import-status')!;
const githubImportProgressEl = document.querySelector<HTMLElement>('#github-import-progress')!;
const githubImportProgressFillEl = document.querySelector<HTMLElement>('#github-import-progress-fill')!;
const githubImportPreviewEl = document.querySelector<HTMLElement>('#github-import-preview')!;
const inferenceXSyncEl = document.querySelector<HTMLElement>('#inferencex-sync')!;
const mergeLinesEl = document.querySelector<HTMLButtonElement>('#merge-lines')!;
const mergePreviewEl = document.querySelector<HTMLElement>('#merge-preview')!;
const snapshotSelectEl = document.querySelector<HTMLSelectElement>('#snapshot-select')!;
const snapshotSaveEl = document.querySelector<HTMLButtonElement>('#snapshot-save')!;
const snapshotRenameEl = document.querySelector<HTMLButtonElement>('#snapshot-rename')!;
const snapshotDeleteEl = document.querySelector<HTMLButtonElement>('#snapshot-delete')!;

renderFilterControls();
renderInferenceXSyncPanel();
renderSeriesEditor();
renderSnapshotControls();
renderAll();
if (initialData.loadedFromStorage) {
  setStatus('Loaded saved browser data');
}

document.querySelector('#render-data')?.addEventListener('click', renderDraftData);
document.querySelector('#quick-render')?.addEventListener('click', renderDraftData);
document.querySelector('#quick-top')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.querySelector('#reset-data')?.addEventListener('click', () => {
  clearAutoRenderTimer();
  currentSeries = structuredClone(exampleSeries);
  seriesDrafts = seriesToDrafts(currentSeries);
  inferenceXSync = createInferenceXSyncState();
  sortSeriesDraftsByLayer();
  normalizeDraftRenderOrderFromPanelOrder();
  syncCurrentSeriesOrderFromDrafts();
  state = createInitialState(currentSeries);
  syncWatermarkControl();
  renderFilterControls();
  renderInferenceXSyncPanel();
  renderSeriesEditor();
  renderAll();
  resetImportState();
  resetStoredAppData();
  loadedSnapshotSignature = '';
  setActiveSnapshot('');
  setStatus('All settings and data restored to the default example');
  setImportStatus('');
  clearMergePreview();
});

function setActiveSnapshot(id: string): void {
  activeSnapshotId = id;
  persistActiveSnapshotId();
  renderSnapshotControls();
}

function renderSnapshotControls(): void {
  const atLimit = snapshots.length >= MAX_SNAPSHOTS;
  const placeholder = snapshots.length === 0 ? 'No snapshots yet' : 'Working data';
  snapshotSelectEl.innerHTML = [
    `<option value="">${placeholder}</option>`,
    ...snapshots.map((snapshot) => {
      const stamp = formatSnapshotTimestamp(snapshot.savedAt);
      const label = stamp ? `${snapshot.name} \u00b7 ${stamp}` : snapshot.name;
      return `<option value="${escapeAttribute(snapshot.id)}">${escapeHtml(label)}</option>`;
    })
  ].join('');
  snapshotSelectEl.value = activeSnapshotId;
  snapshotSelectEl.disabled = snapshots.length === 0;
  snapshotRenameEl.disabled = !activeSnapshotId;
  snapshotDeleteEl.disabled = !activeSnapshotId;
  snapshotSaveEl.disabled = atLimit;
  snapshotSaveEl.title = atLimit
    ? `Snapshot limit reached (${MAX_SNAPSHOTS}). Delete one first.`
    : '';
}

/** Ignores savedAt so that two captures of untouched data compare equal. */
function snapshotDataSignature(data: PersistedAppData): string {
  const { savedAt: _savedAt, ...rest } = data;
  return JSON.stringify(rest);
}

function findSnapshot(id: string): StoredSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.id === id);
}

function readSnapshotName(promptText: string, fallback: string): string | null {
  const entered = window.prompt(promptText, fallback);
  if (entered === null) return null;
  return entered.trim().slice(0, MAX_SNAPSHOT_NAME_LENGTH) || fallback;
}

function applySnapshot(snapshot: StoredSnapshot): void {
  // structuredClone keeps later edits from mutating the stored copy in place.
  const bundle = createInitialDataState(structuredClone(snapshot.data));
  clearAutoRenderTimer();
  currentSeries = bundle.currentSeries;
  seriesDrafts = bundle.seriesDrafts;
  state = bundle.state;
  inferenceXSync = bundle.inferenceXSync;
  syncWatermarkControl();
  renderFilterControls();
  renderInferenceXSyncPanel();
  renderSeriesEditor();
  renderAll();
  resetImportState();
  setImportStatus('');
  clearMergePreview();

  // Capture after rendering: the payload round-trips through the draft editor,
  // so the restored data is not always byte-identical to what was stored.
  loadedSnapshotSignature = snapshotDataSignature(captureAppData());
  setActiveSnapshot(snapshot.id);
  saveLocalDataNow();
  setStatus(`Loaded snapshot "${snapshot.name}"`);
}

function workingDataIsUnsaved(): boolean {
  return snapshotDataSignature(captureAppData()) !== loadedSnapshotSignature;
}

snapshotSelectEl.addEventListener('change', () => {
  const id = snapshotSelectEl.value;
  if (!id) {
    setActiveSnapshot('');
    return;
  }
  const snapshot = findSnapshot(id);
  if (!snapshot) {
    renderSnapshotControls();
    return;
  }
  if (
    workingDataIsUnsaved() &&
    !window.confirm(
      `Load snapshot "${snapshot.name}"? The current lines and settings will be replaced.`
    )
  ) {
    snapshotSelectEl.value = activeSnapshotId;
    return;
  }
  applySnapshot(snapshot);
});

snapshotSaveEl.addEventListener('click', () => {
  if (snapshots.length >= MAX_SNAPSHOTS) {
    setStatus(`Snapshot limit reached (${MAX_SNAPSHOTS}). Delete one first.`);
    return;
  }
  const name = readSnapshotName('Snapshot name', defaultSnapshotName());
  if (name === null) return;

  const data = captureAppData();
  const snapshot: StoredSnapshot = {
    id: createSnapshotId(),
    name,
    savedAt: data.savedAt,
    data
  };
  const next = [snapshot, ...snapshots];
  const error = writeSnapshots(next);
  if (error) {
    setStatus(error);
    return;
  }
  snapshots = next;
  loadedSnapshotSignature = snapshotDataSignature(data);
  setActiveSnapshot(snapshot.id);
  setStatus(`Saved snapshot "${name}"`);
});

snapshotRenameEl.addEventListener('click', () => {
  const snapshot = findSnapshot(activeSnapshotId);
  if (!snapshot) return;
  const name = readSnapshotName('Snapshot name', snapshot.name);
  if (name === null || name === snapshot.name) return;

  const next = snapshots.map((entry) =>
    entry.id === snapshot.id ? { ...entry, name } : entry
  );
  const error = writeSnapshots(next);
  if (error) {
    setStatus(error);
    return;
  }
  snapshots = next;
  renderSnapshotControls();
  setStatus(`Renamed snapshot to "${name}"`);
});

snapshotDeleteEl.addEventListener('click', () => {
  const snapshot = findSnapshot(activeSnapshotId);
  if (!snapshot) return;
  if (!window.confirm(`Delete snapshot "${snapshot.name}"? The chart on screen stays as it is.`)) {
    return;
  }

  const next = snapshots.filter((entry) => entry.id !== snapshot.id);
  const error = writeSnapshots(next);
  if (error) {
    setStatus(error);
    return;
  }
  snapshots = next;
  setActiveSnapshot('');
  setStatus(`Deleted snapshot "${snapshot.name}"`);
});

document.querySelector('#clear-data')?.addEventListener('click', () => {
  clearAutoRenderTimer();
  currentSeries = [];
  seriesDrafts = [makeEmptySeriesDraft(0)];
  inferenceXSync.stagedResult = null;
  inferenceXSync.changedConfigIds = new Set();
  inferenceXSync.availableUpdateCount = 0;
  normalizeDraftRenderOrderFromPanelOrder();
  setDefaultFiltersForSeries(currentSeries);
  state.search = '';
  renderFilterControls();
  renderInferenceXSyncPanel();
  renderSeriesEditor();
  renderAll();
  setStatus('Data cleared');
  setImportStatus('');
  pendingImportDrafts = [];
  pendingImportSettings = createImportBatchSettings();
  renderImportPreview();
  clearMergePreview();
  scheduleLocalSave();
});

document.querySelector('#add-series')?.addEventListener('click', () => {
  commitSeriesDom();
  const nextIndex = seriesDrafts.length + 1;
  const defaultMtp = getDefaultDraftMtp();
  const defaultIsMtp = defaultMtp === MTP_VALUE;
  const draft = {
    id: `line-${nextIndex}${defaultIsMtp ? '-mtp' : ''}`,
    name: `Line ${nextIndex}${defaultIsMtp ? ' MTP' : ''}`,
    model: getDefaultDraftModel(),
    islOsl: getDefaultDraftIslOsl(),
    precision: getDefaultDraftPrecision(),
    mtp: defaultMtp,
    marker: '',
    title: '',
    note: '',
    color: '',
    lineStyle: DEFAULT_LINE_STYLE,
    renderOrder: getNextDraftRenderOrder(),
    collapsed: true,
    points: [makeEmptyPointRow()]
  };
  seriesDrafts.push(draft);
  queueSeriesActiveByDraft(draft, seriesDrafts.length - 1);
  sortSeriesDraftsByLayer();
  normalizeDraftRenderOrderFromPanelOrder();
  renderSeriesEditor();
  clearMergePreview();
  scheduleLocalSave();
  markChartDirty();
});

mergeLinesEl.addEventListener('click', openMergePreview);
restoreStoredGitHubToken();
githubTokenRememberEl.addEventListener('change', persistGitHubToken);
githubTokenEl.addEventListener('input', persistGitHubToken);
importActionDataEl.addEventListener('click', () => {
  void importGitHubActionData();
});
importDataFileEl.addEventListener('click', () => importDataFileInputEl.click());
importDataFileInputEl.addEventListener('change', () => {
  void importDataFiles(importDataFileInputEl.files);
});
githubImportPreviewEl.addEventListener('input', handleImportPreviewInput);
githubImportPreviewEl.addEventListener('change', handleImportPreviewInput);
githubImportPreviewEl.addEventListener('click', handleImportPreviewClick);
inferenceXSyncEl.addEventListener('click', handleInferenceXSyncClick);
inferenceXSyncEl.addEventListener('change', handleInferenceXSyncChange);
mergePreviewEl.addEventListener('input', handleMergePreviewInput);
mergePreviewEl.addEventListener('change', handleMergePreviewInput);
mergePreviewEl.addEventListener('click', handleMergePreviewClick);
metricSwitchEl.addEventListener('click', handleMetricSwitchClick);

watermarkMenuToggleEl.addEventListener('click', toggleWatermarkPanel);
chartWatermarkEl.addEventListener('input', handleWatermarkInput);
document.querySelector('#reset-watermark')?.addEventListener('click', resetWatermark);
document.querySelector('#download-png')?.addEventListener('click', downloadPng);
document.querySelector('#download-csv')?.addEventListener('click', () => downloadCsv('all'));
document.querySelector('#download-visible-csv')?.addEventListener('click', () => downloadCsv('visible'));
document.querySelector('#reset-zoom')?.addEventListener('click', resetInferenceCurveZoom);
window.addEventListener('resize', () => {
  if (!app.hidden) renderAll();
});
window.addEventListener(THEME_CHANGE_EVENT, () => {
  state.theme = getTheme();
  if (app.hidden) return;
  refreshEditorTheme();
  renderAll();
});
window.addEventListener('keydown', handleGlobalKeydown);
document.addEventListener('click', handleDocumentClick);
document.addEventListener('keydown', handleDocumentKeydown);
window.addEventListener('beforeunload', () => {
  if (skipNextBeforeUnloadSave) return;
  commitSeriesDom();
  saveLocalDataNow();
});
window.addEventListener('inferencex-workspace-deactivate', () => {
  clearAutoRenderTimer();
  commitSeriesDom();
  saveLocalDataNow();
});
window.addEventListener('inferencex-workspace-activate', () => {
  refreshEditorTheme();
  renderAll();
});
void initializeInferenceXSync();
void refreshInferenceXTcoPrices();

function toggleWatermarkPanel(): void {
  setWatermarkPanelOpen(watermarkMenuPanelEl.hidden);
}

function setWatermarkPanelOpen(open: boolean): void {
  watermarkMenuPanelEl.hidden = !open;
  watermarkMenuToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) return;
  syncWatermarkControl();
  window.setTimeout(() => chartWatermarkEl.select(), 0);
}

function handleDocumentClick(event: MouseEvent): void {
  if (watermarkMenuPanelEl.hidden) return;
  const target = event.target;
  if (target instanceof Node && watermarkMenuEl.contains(target)) return;
  setWatermarkPanelOpen(false);
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || watermarkMenuPanelEl.hidden) return;
  setWatermarkPanelOpen(false);
  watermarkMenuToggleEl.focus();
}

function handleWatermarkInput(): void {
  const nextWatermark = normalizeWatermarkText(chartWatermarkEl.value);
  if (chartWatermarkEl.value !== nextWatermark) chartWatermarkEl.value = nextWatermark;
  if (state.watermark === nextWatermark) return;
  state.watermark = nextWatermark;
  renderAll();
  scheduleLocalSave();
}

function resetWatermark(): void {
  if (state.watermark === DEFAULT_CHART_WATERMARK) return;
  state.watermark = DEFAULT_CHART_WATERMARK;
  syncWatermarkControl();
  renderAll();
  scheduleLocalSave();
  setStatus('Watermark reset to default');
}

function syncWatermarkControl(): void {
  chartWatermarkEl.value = state.watermark;
}

function renderDraftData(): void {
  clearAutoRenderTimer();
  try {
    commitSeriesDom();
    normalizeDraftRenderOrderFromPanelOrder();
    currentSeries = draftsToSeries(seriesDrafts);
    syncCurrentSeriesOrderFromDrafts();
    reconcileFiltersForSeries(currentSeries);
    reconcileActiveSeriesForChart();
    activatePendingSeriesForCurrentView();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    setStatus(`${currentSeries.length} lines rendered from ${countPointRows(seriesDrafts)} point rows`);
    scheduleLocalSave();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Invalid line data', true);
  }
}

function autoRenderDraftData(): void {
  try {
    commitSeriesDom();
    normalizeDraftRenderOrderFromPanelOrder();
    currentSeries = draftsToSeries(seriesDrafts);
    syncCurrentSeriesOrderFromDrafts();
    reconcileFiltersForSeries(currentSeries);
    reconcileActiveSeriesForChart();
    activatePendingSeriesForCurrentView();
    renderFilterControls();
    renderAll();
    setStatus(`${currentSeries.length} lines auto-rendered from ${countPointRows(seriesDrafts)} point rows`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Invalid line data', true);
  }
}

function scheduleAutoRender(): void {
  if (autoRenderTimer !== null) window.clearTimeout(autoRenderTimer);
  autoRenderTimer = window.setTimeout(() => {
    autoRenderTimer = null;
    autoRenderDraftData();
  }, AUTO_RENDER_DEBOUNCE_MS);
}

function clearAutoRenderTimer(): void {
  if (autoRenderTimer === null) return;
  window.clearTimeout(autoRenderTimer);
  autoRenderTimer = null;
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (app.hidden) return;
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  renderDraftData();
}

function handleMetricSwitchClick(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-chart-metric]');
  if (!button || !metricSwitchEl.contains(button)) return;
  const metric = normalizeChartMetric(button.dataset.chartMetric);
  if (!metric || metric === state.chartMetric || !isChartMetricAvailable(metric)) return;
  commitSeriesDom();
  state.chartMetric = metric;
  reconcileLatencyPercentile();
  renderFilterControls();
  renderSeriesEditor();
  renderAll();
  scheduleLocalSave();
}

function normalizeTcoCostMode(value: unknown): InferenceCurveTcoCostMode {
  return value === 'rental' || value === 'custom' ? value : 'hyperscaler';
}

function loadCachedTcoPrices(): InferenceXTcoPriceSnapshot | null {
  try {
    return readInferenceXTcoPriceSnapshot(JSON.parse(window.localStorage.getItem(INFERENCEX_TCO_CACHE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

async function refreshInferenceXTcoPrices(force = false): Promise<void> {
  if (tcoPriceLoading || (!force && !shouldRefreshInferenceXTcoPrices(tcoPriceSnapshot))) return;
  tcoPriceLoading = true;
  tcoPriceError = '';
  renderTcoControls();
  try {
    const snapshot = await fetchInferenceXTcoPrices();
    tcoPriceSnapshot = snapshot;
    try {
      window.localStorage.setItem(INFERENCEX_TCO_CACHE_KEY, JSON.stringify(snapshot));
    } catch {
      tcoPriceError = 'Prices updated for this session, but the browser could not save the price cache.';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not fetch upstream prices.';
    tcoPriceError = `${message} Using ${tcoPriceSnapshot ? 'cached' : 'bundled'} presets; custom prices are unchanged.`;
  } finally {
    tcoPriceLoading = false;
    renderAll();
  }
}

function normalizeTcoCustomCosts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, cost]) =>
    typeof cost === 'number' && Number.isFinite(cost) && cost > 0
  )) as Record<string, number>;
}

function getTcoHourlyCosts(): Record<string, number> {
  if (state.tcoCostMode === 'custom') return state.tcoCustomCosts;
  const mode = state.tcoCostMode;
  return Object.fromEntries(Object.entries(tcoPriceSnapshot?.costs ?? INFERENCE_CURVE_TCO_COSTS).map(([hardware, costs]) =>
    [hardware, costs[mode]]
  ));
}

function getTcoCostModeLabel(): string {
  if (state.tcoCostMode === 'custom') return 'Custom GPU Cost';
  return state.tcoCostMode === 'rental' ? 'Rental' : 'Owning at Large Hyperscaler Volume';
}

function renderTcoControls(): void {
  const selector = document.querySelector<HTMLSelectElement>('#chart-y-metric')!;
  selector.value = state.chartYMetric;
  selector.onchange = () => {
    state.chartYMetric = selector.value === 'totalTokensPerDollar' ? 'totalTokensPerDollar' : 'throughput';
    renderAll();
    scheduleLocalSave();
  };
  const panel = document.querySelector<HTMLElement>('#tco-controls')!;
  panel.hidden = state.chartYMetric !== 'totalTokensPerDollar';
  if (panel.hidden) return;
  const lines = getFilteredSeriesForChart();
  const costs = getTcoHourlyCosts();
  const priceSourceUrl = `${INFERENCEX_TCO_REPOSITORY}/blob/${tcoPriceSnapshot?.revision ?? 'e41635bf390819d5af61ed4e8935f87b298e36d4'}/packages/constants/src/gpu-keys.ts`;
  const priceSourceTitle = tcoPriceSnapshot?.sourceTitle ?? 'SemiAnalysis July 2026 Pricing Surveys & AI Cloud TCO Model';
  const lastChecked = tcoPriceSnapshot
    ? `Last checked: ${new Date(tcoPriceSnapshot.checkedAt).toLocaleString()}`
    : 'Bundled prices: September 20, 2026';
  const hardwareLabels = new Map(lines.map((line) => {
    const hardware = getInferenceCurveTcoHardware(line);
    return [hardware, hardware.startsWith('line:') ? line.name : hardware.toUpperCase()];
  }));
  const missingLines = lines.filter((line) => {
    const cost = costs[getInferenceCurveTcoHardware(line)];
    return state.activeSeriesIds.has(line.id) && !(Number.isFinite(cost) && cost > 0);
  });
  panel.innerHTML = `
    <div class="tco-heading">
      <label>Cost basis
        <select id="tco-cost-mode">
          <option value="hyperscaler" ${state.tcoCostMode === 'hyperscaler' ? 'selected' : ''}>Owning at Large Hyperscaler Volume</option>
          <option value="rental" ${state.tcoCostMode === 'rental' ? 'selected' : ''}>Rental</option>
          <option value="custom" ${state.tcoCostMode === 'custom' ? 'selected' : ''}>Custom</option>
        </select>
      </label>
      <span>Total input + output tokens / GPU / second × 3600 ÷ $ / GPU-hour</span>
    </div>
    <div class="tco-rates">
      ${[...hardwareLabels].map(([hardware, label]) => `
        <label><span>${escapeHtml(label)} <small>($/GPU-hour)</small></span>
          <input type="number" min="0.000001" step="any" placeholder="Set cost"
            aria-label="${escapeAttribute(label)} hourly GPU cost"
            data-tco-hardware="${escapeAttribute(hardware)}"
            value="${costs[hardware] ?? ''}" ${state.tcoCostMode === 'custom' ? '' : 'readonly'} />
        </label>
      `).join('')}
    </div>
    <div class="tco-price-sync">
      <button type="button" class="series-action-button" id="refresh-tco-prices" ${tcoPriceLoading ? 'disabled' : ''}>${tcoPriceLoading ? 'Checking Prices…' : 'Refresh Prices'}</button>
      <span>${escapeHtml(lastChecked)} · Auto-check every 24 hours on page load</span>
    </div>
    <p>Preset source: <a href="${escapeAttribute(priceSourceUrl)}" target="_blank" rel="noopener noreferrer">InferenceX published prices</a> · ${escapeHtml(priceSourceTitle)}. Custom prices are saved in this browser.</p>
    ${tcoPriceError ? `<p class="tco-missing" role="status">${escapeHtml(tcoPriceError)}</p>` : ''}
    ${missingLines.length ? `<p class="tco-missing" role="status">${missingLines.length} active line(s) have no GPU cost and are omitted from this chart. Select Custom and enter a positive hourly cost.</p>` : ''}
  `;
  panel.querySelector<HTMLButtonElement>('#refresh-tco-prices')!.onclick = () => { void refreshInferenceXTcoPrices(true); };
  panel.querySelector<HTMLSelectElement>('#tco-cost-mode')!.onchange = (event) => {
    const mode = normalizeTcoCostMode((event.target as HTMLSelectElement).value);
    if (mode === 'custom') state.tcoCustomCosts = { ...costs, ...state.tcoCustomCosts };
    state.tcoCostMode = mode;
    renderAll();
    scheduleLocalSave();
  };
  panel.querySelectorAll<HTMLInputElement>('input[data-tco-hardware]').forEach((input) => {
    input.onchange = () => {
      const cost = input.valueAsNumber;
      if (!Number.isFinite(cost) || cost <= 0) {
        input.setCustomValidity('Enter a finite hourly GPU cost greater than zero.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');
      state.tcoCustomCosts[input.dataset.tcoHardware!] = cost;
      renderAll();
      scheduleLocalSave();
    };
  });
}

function getChartOptions(): InferenceCurveChartOptions {
  const latencyPercentile = isAgenticTraceView(currentSeries)
    ? state.latencyPercentile
    : undefined;
  return {
    xMetric: state.chartMetric,
    yMetric: state.chartYMetric,
    tcoHourlyCosts: getTcoHourlyCosts(),
    yLabel: getInferenceCurveYAxisLabel(state.chartYMetric),
    ...(latencyPercentile ? { latencyPercentile } : {}),
    activeSeriesIds: state.activeSeriesIds,
    selectedPrecisions: Array.from(state.selectedPrecisions),
    enforceEndToEndPareto: shouldEnforceEndToEndPareto(),
    showNonOptimalPoints: state.showNonOptimalPoints,
    hidePointLabels: state.hidePointLabels,
    showConcurrencyLabels: state.showConcurrencyLabels,
    useAdvancedLabels: state.useAdvancedLabels,
    showGradientLabels: state.showGradientLabels,
    showLineLabels: state.showLineLabels,
    lineLabelOffsets: state.lineLabelOffsets,
    onLineLabelMove: handleLineLabelMove,
    showGoalIndicators: state.showGoalDirection,
    showOffloadRings: state.showOffloadRings,
    highContrast: state.highContrast,
    logY: state.logY,
    theme: state.theme,
    title: getChartTitle(),
    subtitle: getChartSubtitle(),
    watermark: state.watermark,
    xLabel: getInferenceCurveXAxisLabel(state.chartMetric, undefined, latencyPercentile)
  };
}

function handleLineLabelMove(
  seriesId: string,
  offset: InferenceCurveLineLabelOffset | null
): void {
  if (offset) {
    state.lineLabelOffsets = { ...state.lineLabelOffsets, [seriesId]: offset };
    // The chart already moved the label as the pointer went; re-rendering here
    // would only redraw it where it already is.
    scheduleLocalSave();
    return;
  }
  if (!(seriesId in state.lineLabelOffsets)) return;
  const { [seriesId]: _removed, ...rest } = state.lineLabelOffsets;
  state.lineLabelOffsets = rest;
  // Resetting does need a redraw: automatic placement has to run again.
  renderAll();
  scheduleLocalSave();
}

function renderAll(): void {
  if (app.hidden) return;
  renderTcoControls();
  chartTitleEl.textContent = getChartTitle();
  chartSubtitleEl.textContent = getChartSubtitle();
  renderInferenceCurveChart(chartEl, getFilteredSeriesForChart(), getChartOptions());
  renderLegend();
}

function renderInferenceXSyncPanel(): void {
  const enabledCount = inferenceXSync.configs.filter((config) => config.enabled).length;
  const hasStagedUpdate = inferenceXSync.stagedResult !== null && inferenceXSync.availableUpdateCount > 0;
  const changedSummary = getInferenceXChangedSummaryItems();

  inferenceXSyncEl.innerHTML = `
    <div class="inferencex-sync-head">
      <div>
        <strong>InferenceX Sync</strong>
        <span>${enabledCount}/${inferenceXSync.configs.length} configs enabled</span>
      </div>
      <div class="inferencex-sync-actions">
        <label class="inferencex-sync-keep" title="Keep the outgoing version of every changed line, named by its benchmark date, so refreshes can be compared instead of overwriting each other.">
          <input type="checkbox" data-sync-action="keep-history" ${inferenceXSync.keepHistory ? 'checked' : ''} />
          <span>Keep History</span>
        </label>
        <button
          type="button"
          class="series-action-button"
          data-sync-action="check"
          ${inferenceXSync.status === 'checking' || inferenceXSync.status === 'updating' ? 'disabled' : ''}
        >
          ${renderIcon('refresh')}
          <span>Check Updates</span>
        </button>
        <button
          type="button"
          class="primary action-button"
          data-sync-action="update"
          ${hasStagedUpdate || inferenceXSync.status === 'updating' ? '' : 'disabled'}
        >
          ${renderIcon('download-cloud')}
          <span>Update</span>
        </button>
        <button type="button" class="series-action-button" data-sync-action="manage">
          ${renderIcon('target')}
          <span>${inferenceXSync.manageOpen ? 'Close Configs' : 'Manage Configs'}</span>
        </button>
      </div>
    </div>
    <div class="inferencex-sync-status-row">
      <p class="inferencex-sync-status${inferenceXSync.status === 'error' ? ' error' : ''}" role="status">
        ${escapeHtml(formatInferenceXSyncStatus())}
      </p>
      <p class="inferencex-sync-meta">
        Last checked: ${escapeHtml(formatDateTimeShort(inferenceXSync.lastCheckedAt))}
        · Last updated: ${escapeHtml(formatDateTimeShort(inferenceXSync.lastUpdatedAt))}
      </p>
    </div>
    ${renderInferenceXSyncUpdateSummary(changedSummary)}
    ${inferenceXSync.manageOpen ? renderInferenceXSyncManager() : ''}
  `;
}

function renderInferenceXSyncUpdateSummary(items: InferenceXSyncSummaryItem[]): string {
  if (inferenceXSync.status === 'error' && inferenceXSync.lastError) {
    return `<div class="inferencex-sync-summary error">${escapeHtml(inferenceXSync.lastError)}</div>`;
  }
  if (inferenceXSync.status !== 'updates-available' || items.length === 0) return '';

  const visible = items
    .slice(0, 8)
    .map(
      (item) =>
        `${item.name} ${item.precision.toUpperCase()} ${formatInferenceXSummarySequenceLabel(item)}${item.latestDate ? ` (${item.latestDate})` : ''}`
    );
  const hiddenCount = Math.max(0, items.length - visible.length);
  const suffix = hiddenCount > 0 ? `; +${hiddenCount} more` : '';
  return `
    <div class="inferencex-sync-summary">
      ${inferenceXSync.availableUpdateCount} line updates staged: ${escapeHtml(visible.join('; '))}${escapeHtml(suffix)}.
    </div>
  `;
}

function renderInferenceXSyncManager(): string {
  const configRows = inferenceXSync.configs
    .map((config, index) => renderInferenceXSyncConfigRow(config, index))
    .join('');
  return `
    <div class="inferencex-sync-manager">
      <div class="inferencex-sync-manager-head">
        <div>
          <strong>Sync Configs</strong>
          <span>${inferenceXSync.availabilityLoaded ? `${inferenceXSync.availabilityRows.length} API combinations loaded` : 'Availability loads when this panel opens'}</span>
        </div>
        <div class="inferencex-sync-manager-actions">
          <button
            type="button"
            class="series-action-button"
            data-sync-action="reload-availability"
            ${inferenceXSync.availabilityLoading ? 'disabled' : ''}
          >
            ${renderIcon('refresh')}
            <span>${inferenceXSync.availabilityLoading ? 'Loading' : 'Reload Options'}</span>
          </button>
          <button type="button" class="series-action-button danger" data-sync-action="reset-configs">
            ${renderIcon('trash')}
            <span>Reset to Default Configs</span>
          </button>
        </div>
      </div>
      <div class="inferencex-sync-config-list">
        ${configRows}
      </div>
      ${renderInferenceXSyncAddConfig()}
    </div>
  `;
}

function renderInferenceXSyncConfigRow(config: InferenceXSyncConfig, index: number): string {
  const warning =
    inferenceXSync.availabilityLoaded &&
    !inferenceXSync.availabilityRows.some((row) => inferenceXAvailabilityRowMatchesConfig(row, config));
  const missing = inferenceXSync.missingConfigIds.has(config.id);
  return `
    <div class="inferencex-sync-config-row${config.enabled ? '' : ' disabled'}">
      <label class="inferencex-sync-enable">
        <input
          type="checkbox"
          data-sync-config-index="${index}"
          data-sync-config-field="enabled"
          ${config.enabled ? 'checked' : ''}
        />
        <span>Enabled</span>
      </label>
      <div class="inferencex-sync-config-main">
        <strong>${escapeHtml(formatInferenceXConfigLabel(config))}</strong>
        <code>${escapeHtml(makeInferenceXSyncLineId(config))}</code>
        ${warning ? '<small class="warning">Not present in current API availability</small>' : ''}
        ${missing ? '<small class="warning">No benchmark rows matched during the last check</small>' : ''}
      </div>
      <button
        type="button"
        class="series-action-button danger"
        data-sync-action="remove-config"
        data-sync-config-index="${index}"
      >
        ${renderIcon('trash')}
        <span>Remove</span>
      </button>
    </div>
  `;
}

function renderInferenceXSyncAddConfig(): string {
  const options = getInferenceXAddOptions();
  const isAgentic = inferenceXSync.addShapeSelection !== ALL_VALUE &&
    isAgenticTraceSequence(inferenceXSync.addDraft.scenario ?? '');
  return `
    <div class="inferencex-sync-add">
      <label>
        <span>Model</span>
        <select data-sync-add-field="model">
          ${renderSimpleOptions(options.models, inferenceXSync.addDraft.model)}
        </select>
      </label>
      <label>
        <span>Scenario</span>
        <select data-sync-add-field="shape">
          ${renderInferenceXShapeOptions(options.shapes, inferenceXSync.addShapeSelection)}
        </select>
      </label>
      <label>
        <span>Precision</span>
        <select data-sync-add-field="precision">
          ${renderInferenceXAllOptions(options.precisions, inferenceXSync.addPrecisionSelection)}
        </select>
      </label>
      <label>
        <span>GPU</span>
        <select data-sync-add-field="hardware">
          ${renderSimpleOptions(options.hardware, inferenceXSync.addDraft.hardware)}
        </select>
      </label>
      <label>
        <span>Framework</span>
        <select data-sync-add-field="framework">
          ${renderInferenceXAllOptions(options.frameworks, inferenceXSync.addFrameworkSelection)}
        </select>
      </label>
      ${isAgentic ? '' : `<label>
        <span>MTP</span>
        <select data-sync-add-field="specMethod">
          ${renderInferenceXSpecMethodOptions(options.specMethods, inferenceXSync.addSpecMethodSelection)}
        </select>
      </label>`}
      <button type="button" class="primary action-button" data-sync-action="add-config">
        ${renderIcon('plus')}
        <span>Add Config</span>
      </button>
    </div>
  `;
}

function renderSimpleOptions(values: string[], selected: string): string {
  return values
    .map(
      (value) =>
        `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`
    )
    .join('');
}

function renderInferenceXSpecMethodOptions(values: string[], selected: string): string {
  return renderInferenceXAllOptions(values, selected, formatInferenceXSpecMethodLabel);
}

interface InferenceXSequenceOption {
  scenario: string;
  isl: number;
  osl: number;
}

function renderInferenceXShapeOptions(shapes: InferenceXSequenceOption[], selected: string): string {
  return [
    `<option value="${ALL_VALUE}" ${selected === ALL_VALUE ? 'selected' : ''}>All</option>`,
    ...shapes.map((shape) => {
      const value = makeInferenceXShapeValue(shape);
      return `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(formatInferenceXSequenceOptionLabel(shape))}</option>`;
    })
  ].join('');
}

function renderInferenceXAllOptions(
  values: string[],
  selected: string,
  formatLabel: (value: string) => string = (value) => value
): string {
  return [
    `<option value="${ALL_VALUE}" ${selected === ALL_VALUE ? 'selected' : ''}>All</option>`,
    ...values.map(
      (value) =>
        `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(formatLabel(value))}</option>`
    )
  ].join('');
}

function formatInferenceXSpecMethodLabel(value: string): string {
  if (value === MTP_VALUE) return 'MTP';
  if (value === 'none') return 'Non-MTP';
  return value;
}

function makeInferenceXShapeValue(shape: InferenceXSequenceOption): string {
  return shape.scenario ? `scenario:${shape.scenario}` : `${shape.isl}|${shape.osl}`;
}

function parseInferenceXShapeValue(value: string): InferenceXSequenceOption | null {
  if (value.startsWith('scenario:')) {
    const scenario = value.slice('scenario:'.length).trim();
    return scenario ? { scenario, isl: 0, osl: 0 } : null;
  }
  const [isl, osl] = value.split('|').map((part) => Number(part));
  return Number.isFinite(isl) && Number.isFinite(osl) ? { scenario: '', isl, osl } : null;
}

function formatInferenceXSequenceOptionLabel(shape: InferenceXSequenceOption): string {
  return shape.scenario ? formatScenarioLabel(shape.scenario) : `${shape.isl} / ${shape.osl}`;
}

function formatInferenceXSummarySequenceLabel(item: Pick<InferenceXSyncSummaryItem, 'scenario' | 'isl' | 'osl'>): string {
  return item.scenario ? formatScenarioLabel(item.scenario) : `${item.isl}/${item.osl}`;
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

function getInferenceXAddOptions(): {
  models: string[];
  shapes: InferenceXSequenceOption[];
  precisions: string[];
  hardware: string[];
  frameworks: string[];
  specMethods: string[];
} {
  const rows = getInferenceXOptionRows();
  const modelRows = rows.filter((row) => row.modelDisplay === inferenceXSync.addDraft.model);
  const modelScopedRows = modelRows.length ? modelRows : rows;
  const hardwareRows = modelScopedRows.filter((row) => row.hardware === inferenceXSync.addDraft.hardware);
  const hardwareScopedRows = hardwareRows.length ? hardwareRows : modelScopedRows;
  const targetRows =
    inferenceXSync.addFrameworkSelection === ALL_VALUE
      ? hardwareScopedRows
      : hardwareScopedRows.filter((row) => row.framework === inferenceXSync.addDraft.framework);
  const targetScopedRows = targetRows.length ? targetRows : hardwareScopedRows;
  const sequenceRows =
    inferenceXSync.addShapeSelection === ALL_VALUE
      ? targetScopedRows
      : targetScopedRows.filter((row) => inferenceXAvailabilityRowMatchesSequence(row, inferenceXSync.addDraft));
  const sequenceScopedRows = sequenceRows.length ? sequenceRows : targetScopedRows;
  const precisionRows =
    inferenceXSync.addPrecisionSelection === ALL_VALUE
      ? sequenceScopedRows
      : sequenceScopedRows.filter((row) => row.precision === inferenceXSync.addDraft.precision);
  const precisionScopedRows = precisionRows.length ? precisionRows : sequenceScopedRows;
  return {
    models: uniqueSorted(rows.map((row) => row.modelDisplay)),
    shapes: uniqueShapes(targetScopedRows),
    precisions: uniqueSorted(sequenceScopedRows.map((row) => row.precision)),
    hardware: uniqueSorted(modelScopedRows.map((row) => row.hardware)),
    frameworks: uniqueSorted(hardwareScopedRows.map((row) => row.framework)),
    specMethods: uniqueSorted(precisionScopedRows.map((row) => row.specMethod))
  };
}

function getInferenceXOptionRows(): InferenceXAvailabilityRow[] {
  if (inferenceXSync.availabilityRows.length > 0) return inferenceXSync.availabilityRows;
  return inferenceXSync.configs.map((config) => ({
    model: config.model,
    modelDisplay: getInferenceXDisplayModel(config.model),
    scenario: config.scenario ?? '',
    isl: config.isl,
    osl: config.osl,
    precision: config.precision,
    hardware: config.hardware,
    framework: config.framework,
    specMethod: config.specMethod ?? 'none',
    disagg: true,
    date: ''
  }));
}

function uniqueShapes(rows: InferenceXAvailabilityRow[]): InferenceXSequenceOption[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = row.scenario ? `scenario:${row.scenario}` : `${row.isl}|${row.osl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({ scenario: row.scenario, isl: row.isl, osl: row.osl }))
    .sort(
      (a, b) =>
        Number(Boolean(a.scenario)) - Number(Boolean(b.scenario)) ||
        b.isl - a.isl ||
        b.osl - a.osl ||
        a.scenario.localeCompare(b.scenario)
    );
}

function formatInferenceXSyncStatus(): string {
  if (inferenceXSync.status === 'checking') return 'Checking InferenceX for latest benchmark rows...';
  if (inferenceXSync.status === 'updating') return 'Applying staged InferenceX data...';
  if (inferenceXSync.status === 'updates-available') {
    return `${inferenceXSync.availableUpdateCount} line update${inferenceXSync.availableUpdateCount === 1 ? '' : 's'} available. Click Update to apply.`;
  }
  if (inferenceXSync.status === 'up-to-date') return 'No updates available.';
  if (inferenceXSync.status === 'error') return 'Fetch failed. Existing chart data was kept.';
  return 'Ready. Check Updates will compare the enabled configs with the public InferenceX API.';
}

function formatDateTimeShort(value: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function handleInferenceXSyncClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sync-action]');
  if (!button) return;
  const action = button.dataset.syncAction;

  if (action === 'check') {
    void checkInferenceXUpdates({ automatic: false });
  } else if (action === 'update') {
    applyStagedInferenceXSyncUpdate();
  } else if (action === 'manage') {
    inferenceXSync.manageOpen = !inferenceXSync.manageOpen;
    renderInferenceXSyncPanel();
    if (inferenceXSync.manageOpen) void ensureInferenceXAvailabilityLoaded();
  } else if (action === 'reload-availability') {
    void loadInferenceXAvailability();
  } else if (action === 'reset-configs') {
    resetInferenceXSyncConfigs();
  } else if (action === 'add-config') {
    addInferenceXSyncConfig();
  } else if (action === 'remove-config') {
    removeInferenceXSyncConfig(Number(button.dataset.syncConfigIndex));
  }
}

function handleInferenceXSyncChange(event: Event): void {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (input.dataset.syncAction === 'keep-history' && input instanceof HTMLInputElement) {
    inferenceXSync.keepHistory = input.checked;
    scheduleLocalSave();
    return;
  }

  const configIndex = Number(input.dataset.syncConfigIndex);
  const configField = input.dataset.syncConfigField;
  if (Number.isInteger(configIndex) && configField === 'enabled') {
    const config = inferenceXSync.configs[configIndex];
    if (!config || !(input instanceof HTMLInputElement)) return;
    config.enabled = input.checked;
    clearInferenceXStagedUpdate();
    renderInferenceXSyncPanel();
    scheduleLocalSave();
    return;
  }

  const addField = input.dataset.syncAddField;
  if (addField) {
    updateInferenceXAddDraft(addField, input.value);
    renderInferenceXSyncPanel();
  }
}

async function initializeInferenceXSync(): Promise<void> {
  if (!initialData.loadedFromStorage) {
    await loadInitialInferenceXSyncData();
    return;
  }
  await checkInferenceXUpdates({ automatic: true });
}

async function loadInitialInferenceXSyncData(): Promise<void> {
  // With every sync config disabled the bundled `exampleSeries` is the intended
  // chart, so skip the fetch rather than reporting "no matching rows".
  if (!inferenceXSync.configs.some((config) => config.enabled)) {
    inferenceXSync.status = 'idle';
    inferenceXSync.lastError = '';
    renderInferenceXSyncPanel();
    setStatus('Showing bundled GLM-5.2 data; InferenceX sync is off by default');
    return;
  }

  inferenceXSync.status = 'checking';
  inferenceXSync.lastError = '';
  renderInferenceXSyncPanel();
  try {
    const result = await fetchInferenceXSyncSeries(inferenceXSync.configs);
    if (result.series.length === 0) {
      inferenceXSync.status = 'error';
      inferenceXSync.lastError = 'No benchmark rows matched the default InferenceX sync configs.';
      renderInferenceXSyncPanel();
      setStatus('Using bundled example data; InferenceX sync returned no matching rows.', true);
      scheduleLocalSave();
      return;
    }
    applyInferenceXSyncResult(result, { initial: true });
    setStatus(`Loaded ${result.series.length} lines from InferenceX public API`);
  } catch (error) {
    inferenceXSync.status = 'error';
    inferenceXSync.lastError = error instanceof Error ? error.message : 'Could not fetch InferenceX data.';
    inferenceXSync.availableUpdateCount = 0;
    inferenceXSync.stagedResult = null;
    renderInferenceXSyncPanel();
    setStatus('Using bundled example data; InferenceX sync failed.', true);
    scheduleLocalSave();
  }
}

async function checkInferenceXUpdates({ automatic }: { automatic: boolean }): Promise<void> {
  if (inferenceXSync.status === 'checking' || inferenceXSync.status === 'updating') return;
  inferenceXSync.status = 'checking';
  inferenceXSync.lastError = '';
  renderInferenceXSyncPanel();

  try {
    const result = await fetchInferenceXSyncSeries(inferenceXSync.configs);
    const changedConfigIds = getChangedInferenceXSyncConfigIds(result);
    inferenceXSync.lastCheckedAt = result.checkedAt;
    inferenceXSync.lineIdsByConfigKey = { ...inferenceXSync.lineIdsByConfigKey, ...result.lineIdsByConfigKey };
    inferenceXSync.missingConfigIds = new Set(result.missingConfigIds);
    inferenceXSync.changedConfigIds = new Set(changedConfigIds);
    inferenceXSync.availableUpdateCount = changedConfigIds.length;
    inferenceXSync.stagedResult = changedConfigIds.length > 0 ? result : null;
    inferenceXSync.status = changedConfigIds.length > 0 ? 'updates-available' : 'up-to-date';
    renderInferenceXSyncPanel();
    if (!automatic) {
      setStatus(
        changedConfigIds.length > 0
          ? `InferenceX check found ${changedConfigIds.length} line update${changedConfigIds.length === 1 ? '' : 's'}.`
          : 'InferenceX data is up to date.'
      );
    }
    scheduleLocalSave();
  } catch (error) {
    inferenceXSync.status = 'error';
    inferenceXSync.lastError = error instanceof Error ? error.message : 'Could not fetch InferenceX data.';
    inferenceXSync.availableUpdateCount = 0;
    inferenceXSync.stagedResult = null;
    inferenceXSync.changedConfigIds = new Set();
    renderInferenceXSyncPanel();
    if (!automatic) setStatus('InferenceX check failed. Existing chart data was kept.', true);
    scheduleLocalSave();
  }
}

function applyStagedInferenceXSyncUpdate(): void {
  if (!inferenceXSync.stagedResult || inferenceXSync.availableUpdateCount === 0) {
    setStatus('No staged InferenceX update to apply.', true);
    return;
  }

  try {
    inferenceXSync.status = 'updating';
    renderInferenceXSyncPanel();
    const updatedCount = inferenceXSync.availableUpdateCount;
    applyInferenceXSyncResult(inferenceXSync.stagedResult, { initial: false });
    setStatus(`Applied ${updatedCount} InferenceX line update${updatedCount === 1 ? '' : 's'}.`);
  } catch (error) {
    inferenceXSync.status = 'error';
    inferenceXSync.lastError = error instanceof Error ? error.message : 'Could not apply InferenceX update.';
    renderInferenceXSyncPanel();
    setStatus(inferenceXSync.lastError, true);
  }
}

function applyInferenceXSyncResult(result: InferenceXSyncResult, options: { initial: boolean }): void {
  if (result.series.length === 0) throw new Error('No InferenceX lines to apply.');

  clearAutoRenderTimer();
  const appliedAt = new Date().toISOString();
  const syncLineIds = new Set(result.series.map((line) => line.id));
  const legacyLineIdsByLineId = new Map<string, string[]>();
  const replacedSyncLineIds = new Set(syncLineIds);
  result.summary.forEach((item) => {
    const legacyLineIds = isAgenticTraceSequence(item.scenario)
      ? [`${item.lineId}-agg`, `${item.lineId}-mtp`, `${item.lineId}-mtp-agg`]
      : [`${item.lineId}-agg`];
    if (item.model === 'DeepSeek-V4-Pro') {
      [item.lineId, ...legacyLineIds].forEach((id) => {
        legacyLineIds.push(id.replace('deepseek-v4-pro-', 'deepseek-v4-pro-0813-'));
      });
    }
    legacyLineIdsByLineId.set(item.lineId, legacyLineIds);
    legacyLineIds.forEach((id) => replacedSyncLineIds.add(id));
  });
  const changedLineIds = new Set(getInferenceXChangedSummaryItems().map((item) => item.lineId));
  const collapsedById = new Map(seriesDrafts.map((draft) => [draft.id, draft.collapsed]));
  const archivedLineIds = new Set<string>();

  if (options.initial) {
    currentSeries = result.series.map((line, index) => ({ ...line, renderOrder: result.series.length - index - 1 }));
    seriesDrafts = seriesToDrafts(currentSeries);
    state = createInitialState(currentSeries);
  } else {
    commitSeriesDom();
    const existingSeries = draftsToSeriesAllowEmpty(seriesDrafts);
    const existingDraftById = new Map(seriesDrafts.map((draft) => [draft.id, draft]));
    const existingLineById = new Map(existingSeries.map((line) => [line.id, line]));
    let nextRenderOrder = getNextDraftRenderOrder() + result.series.length;
    const styledSyncSeries = result.series.map((line) => {
      const candidateIds = [line.id, ...(legacyLineIdsByLineId.get(line.id) ?? [])];
      const existingDraft = candidateIds.map((id) => existingDraftById.get(id)).find(Boolean);
      const existingLine = candidateIds.map((id) => existingLineById.get(id)).find(Boolean);
      const styled = applyExistingSyncLineStyle(line, existingDraft, existingLine);
      if (existingDraft || existingLine) return styled;
      nextRenderOrder -= 1;
      return { ...styled, renderOrder: nextRenderOrder };
    });
    const archived = inferenceXSync.keepHistory
      ? archiveReplacedSyncLines(styledSyncSeries, changedLineIds, existingLineById, legacyLineIdsByLineId)
      : [];
    archived.forEach((line) => archivedLineIds.add(line.id));
    currentSeries = [
      ...pruneSyncArchives([
        ...existingSeries.filter((line) => !replacedSyncLineIds.has(line.id)),
        ...archived
      ]),
      ...styledSyncSeries
    ];
    seriesDrafts = seriesToDrafts(currentSeries);
    seriesDrafts.forEach((draft) => {
      const candidateIds = [draft.id, ...(legacyLineIdsByLineId.get(draft.id) ?? [])];
      const collapsed = candidateIds.map((id) => collapsedById.get(id)).find((value) => value !== undefined);
      if (collapsed !== undefined) draft.collapsed = collapsed;
    });
    const newSyncSeries = styledSyncSeries.filter((line) => !existingLineById.has(line.id));
    activateSeriesForChart(newSyncSeries);
    changedLineIds.forEach((id) => state.activeSeriesIds.add(id));
  }

  inferenceXSync.fingerprints = { ...inferenceXSync.fingerprints, ...result.fingerprints };
  inferenceXSync.lineIdsByConfigKey = { ...inferenceXSync.lineIdsByConfigKey, ...result.lineIdsByConfigKey };
  inferenceXSync.lastCheckedAt = result.checkedAt;
  inferenceXSync.lastUpdatedAt = appliedAt;
  inferenceXSync.availableUpdateCount = 0;
  inferenceXSync.stagedResult = null;
  inferenceXSync.changedConfigIds = new Set();
  inferenceXSync.missingConfigIds = new Set(result.missingConfigIds);
  inferenceXSync.status = 'up-to-date';
  inferenceXSync.lastError = '';

  sortSeriesDraftsByLayer();
  normalizeDraftRenderOrderFromPanelOrder();
  syncCurrentSeriesOrderFromDrafts();
  reconcileFiltersForSeries(currentSeries);
  reconcileActiveSeriesForChart();
  // Archives exist to be compared on demand. Adding every past version to the
  // chart on each refresh would crowd out the lines the update was about.
  archivedLineIds.forEach((id) => state.activeSeriesIds.delete(id));
  saveActiveSeriesForCurrentView();
  renderFilterControls();
  renderInferenceXSyncPanel();
  renderSeriesEditor();
  renderAll();
  clearMergePreview();
  scheduleLocalSave();
  if (archivedLineIds.size > 0) {
    setStatus(
      `Kept ${archivedLineIds.size} previous line version${archivedLineIds.size === 1 ? '' : 's'} for comparison. Turn them on in the legend.`
    );
  }
}

/**
 * Keeps the outgoing version of every line the refresh actually changed, so a
 * sync becomes a comparison instead of an overwrite.
 */
function archiveReplacedSyncLines(
  incoming: InferenceCurveSeries[],
  changedLineIds: Set<string>,
  existingLineById: Map<string, InferenceCurveSeries>,
  legacyLineIdsByLineId: Map<string, string[]>
): InferenceCurveSeries[] {
  const archives: InferenceCurveSeries[] = [];
  incoming.forEach((line) => {
    if (!changedLineIds.has(line.id)) return;
    const candidateIds = [line.id, ...(legacyLineIdsByLineId.get(line.id) ?? [])];
    const previous = candidateIds.map((id) => existingLineById.get(id)).find(Boolean);
    if (!previous || isSyncArchiveLine(previous)) return;

    const stamp = latestPointDate(previous) || new Date().toISOString().slice(0, 10);
    const id = `${previous.id}${SYNC_ARCHIVE_SEPARATOR}${stamp}`;
    if (existingLineById.has(id)) return;

    archives.push({
      ...previous,
      id,
      // Lines synced before this feature have no date in their name; give them
      // one now so the archive is still identifiable.
      name: hasCurveNamePrefix(previous.name) ? previous.name : prefixCurveName(stamp, 'CI', previous.name),
      // A distinct hwKey keeps Merge Parallelism from folding an archive back
      // into the live line, which would erase the difference being compared.
      hwKey: previous.hwKey ? `${previous.hwKey}${SYNC_ARCHIVE_SEPARATOR}${stamp}` : undefined,
      lineStyle: 'dotted',
      note: `Previous version kept on ${formatDateTimeShort(new Date().toISOString())}. ${previous.note ?? ''}`.trim(),
      renderOrder: (previous.renderOrder ?? 0) - 0.5
    });
  });
  return archives;
}

/** Drops the oldest archives once a line has more than MAX_SYNC_ARCHIVES kept. */
function pruneSyncArchives(lines: InferenceCurveSeries[]): InferenceCurveSeries[] {
  const keptByBase = new Map<string, number>();
  const dropped = new Set<string>();
  // Newest stamp first, so the survivors are the most recent versions.
  [...lines]
    .filter(isSyncArchiveLine)
    .sort((a, b) => b.id.localeCompare(a.id))
    .forEach((line) => {
      const base = line.id.split(SYNC_ARCHIVE_SEPARATOR)[0] ?? line.id;
      const kept = keptByBase.get(base) ?? 0;
      if (kept >= MAX_SYNC_ARCHIVES) dropped.add(line.id);
      else keptByBase.set(base, kept + 1);
    });
  return dropped.size === 0 ? lines : lines.filter((line) => !dropped.has(line.id));
}

function isSyncArchiveLine(line: InferenceCurveSeries): boolean {
  return line.id.includes(SYNC_ARCHIVE_SEPARATOR);
}

function hasCurveNamePrefix(name: string | undefined): boolean {
  return /^\d{2}-\d{2}-(?:CI|local)-/u.test(name ?? '');
}

function applyExistingSyncLineStyle(
  line: InferenceCurveSeries,
  draft: SeriesDraft | undefined,
  existingLine: InferenceCurveSeries | undefined
): InferenceCurveSeries {
  const styled: InferenceCurveSeries = { ...line };
  const color = draft?.color ?? existingLine?.color ?? '';
  const lineStyle = draft?.lineStyle ?? existingLine?.lineStyle ?? '';
  const marker = draft?.marker ?? String(existingLine?.marker ?? '');
  const note = draft?.note ?? existingLine?.note ?? '';
  const renderOrder = draft
    ? draft.renderOrder
    : existingLine?.renderOrder;

  if (color.trim()) styled.color = color.trim();
  if (lineStyle.trim()) styled.lineStyle = lineStyle.trim();
  if (marker.trim()) styled.marker = marker.trim();
  if (note.trim()) styled.note = note.trim();
  if (typeof renderOrder === 'number' && Number.isFinite(renderOrder)) styled.renderOrder = renderOrder;
  return styled;
}

function getChangedInferenceXSyncConfigIds(result: InferenceXSyncResult): string[] {
  const currentLineById = new Map(getCurrentSeriesForFingerprint().map((line) => [line.id, line]));
  return result.summary
    .filter((item) => {
      const latestFingerprint = result.fingerprints[item.configId];
      if (!latestFingerprint) return false;
      const storedFingerprint = inferenceXSync.fingerprints[item.configId];
      if (storedFingerprint) return storedFingerprint !== latestFingerprint;
      const currentLine = currentLineById.get(item.lineId);
      return currentLine ? fingerprintInferenceCurveSeries(currentLine) !== latestFingerprint : true;
    })
    .map((item) => item.configId);
}

function getCurrentSeriesForFingerprint(): InferenceCurveSeries[] {
  try {
    return draftsToSeriesAllowEmpty(seriesDrafts);
  } catch {
    return currentSeries;
  }
}

function getInferenceXChangedSummaryItems(): InferenceXSyncSummaryItem[] {
  if (!inferenceXSync.stagedResult) return [];
  return inferenceXSync.stagedResult.summary.filter((item) => inferenceXSync.changedConfigIds.has(item.configId));
}

async function ensureInferenceXAvailabilityLoaded(): Promise<void> {
  if (inferenceXSync.availabilityLoaded || inferenceXSync.availabilityLoading) return;
  await loadInferenceXAvailability();
}

async function loadInferenceXAvailability(): Promise<void> {
  inferenceXSync.availabilityLoading = true;
  inferenceXSync.lastError = '';
  renderInferenceXSyncPanel();
  try {
    inferenceXSync.availabilityRows = await fetchInferenceXAvailability();
    inferenceXSync.availabilityLoaded = true;
    alignInferenceXAddDraft();
  } catch (error) {
    inferenceXSync.lastError = error instanceof Error ? error.message : 'Could not load InferenceX availability.';
    inferenceXSync.status = 'error';
  } finally {
    inferenceXSync.availabilityLoading = false;
    renderInferenceXSyncPanel();
  }
}

function updateInferenceXAddDraft(field: string, value: string): void {
  if (field === 'model') {
    inferenceXSync.addDraft.model = value;
  } else if (field === 'shape') {
    inferenceXSync.addShapeSelection = value;
    if (value !== ALL_VALUE) {
      const sequence = parseInferenceXShapeValue(value);
      if (sequence) {
        inferenceXSync.addDraft.scenario = sequence.scenario || undefined;
        inferenceXSync.addDraft.isl = sequence.isl;
        inferenceXSync.addDraft.osl = sequence.osl;
      }
    }
  } else if (field === 'precision') {
    inferenceXSync.addPrecisionSelection = value;
    if (value !== ALL_VALUE) {
      inferenceXSync.addDraft.precision = value;
    }
  } else if (field === 'hardware') {
    inferenceXSync.addDraft.hardware = value;
  } else if (field === 'framework') {
    inferenceXSync.addFrameworkSelection = value;
    if (value !== ALL_VALUE) {
      inferenceXSync.addDraft.framework = value;
    }
  } else if (field === 'specMethod') {
    inferenceXSync.addSpecMethodSelection = value;
    if (value !== ALL_VALUE) {
      inferenceXSync.addDraft.specMethod = value;
    }
  }
  alignInferenceXAddDraft(field);
}

function alignInferenceXAddDraft(preferredField = ''): void {
  const rows = getInferenceXOptionRows();
  if (rows.length === 0) return;
  const modelRows = rows.filter((row) => row.modelDisplay === inferenceXSync.addDraft.model);
  const scopedRows = modelRows.length ? modelRows : rows;
  const candidate = pickBestInferenceXAddRow(scopedRows, preferredField);
  if (!candidate) return;
  inferenceXSync.addDraft = {
    model: candidate.modelDisplay,
    scenario: candidate.scenario || undefined,
    isl: candidate.isl,
    osl: candidate.osl,
    precision: candidate.precision,
    hardware: candidate.hardware,
    framework: candidate.framework,
    specMethod: candidate.specMethod
  };
  if (inferenceXSync.addShapeSelection !== ALL_VALUE) {
    inferenceXSync.addShapeSelection = makeInferenceXShapeValue(candidate);
  }
  if (inferenceXSync.addPrecisionSelection !== ALL_VALUE) {
    inferenceXSync.addPrecisionSelection = candidate.precision;
  }
  if (inferenceXSync.addFrameworkSelection !== ALL_VALUE) {
    inferenceXSync.addFrameworkSelection = candidate.framework;
  }
  if (inferenceXSync.addSpecMethodSelection !== ALL_VALUE) {
    inferenceXSync.addSpecMethodSelection = candidate.specMethod;
  }
  if (inferenceXSync.addShapeSelection !== ALL_VALUE && isAgenticTraceSequence(candidate.scenario)) {
    inferenceXSync.addSpecMethodSelection = ALL_VALUE;
    delete inferenceXSync.addDraft.specMethod;
  }
}

function pickBestInferenceXAddRow(
  rows: InferenceXAvailabilityRow[],
  preferredField: string
): InferenceXAvailabilityRow | undefined {
  const desired = normalizeInferenceXSyncConfig({ ...inferenceXSync.addDraft, enabled: true });
  const shouldScoreShape = inferenceXSync.addShapeSelection !== ALL_VALUE;
  const shouldScorePrecision = inferenceXSync.addPrecisionSelection !== ALL_VALUE;
  const shouldScoreFramework = inferenceXSync.addFrameworkSelection !== ALL_VALUE;
  const shouldScoreSpecMethod = inferenceXSync.addSpecMethodSelection !== ALL_VALUE;
  const rowScore = (row: InferenceXAvailabilityRow): number => {
    let score = 0;
    if (row.hardware === desired.hardware) score += preferredField === 'hardware' ? 1000 : 90;
    if (shouldScoreFramework && row.framework === desired.framework) {
      score += preferredField === 'framework' ? 1000 : 80;
    }
    if (shouldScoreShape && inferenceXAvailabilityRowMatchesSequence(row, desired)) {
      score += preferredField === 'shape' ? 1000 : 70;
    }
    if (shouldScorePrecision && row.precision === desired.precision) {
      score += preferredField === 'precision' ? 1000 : 50;
    }
    if (shouldScoreSpecMethod && !isAgenticTraceSequence(row.scenario) && row.specMethod === desired.specMethod) {
      score += preferredField === 'specMethod' ? 1000 : 30;
    }
    return score;
  };

  return [...rows].sort((a, b) => rowScore(b) - rowScore(a) || compareInferenceXAvailabilityRows(a, b))[0];
}

function compareInferenceXAvailabilityRows(
  a: InferenceXAvailabilityRow,
  b: InferenceXAvailabilityRow
): number {
  return (
    b.date.localeCompare(a.date) ||
    a.hardware.localeCompare(b.hardware) ||
    a.framework.localeCompare(b.framework) ||
    a.scenario.localeCompare(b.scenario) ||
    b.isl - a.isl ||
    b.osl - a.osl ||
    a.precision.localeCompare(b.precision) ||
    a.specMethod.localeCompare(b.specMethod) ||
    Number(b.disagg) - Number(a.disagg)
  );
}

function addInferenceXSyncConfig(): void {
  const configs = createInferenceXConfigsFromAddDraft();
  if (configs.length === 0) {
    inferenceXSync.lastError = 'No matching InferenceX availability rows were found for that config.';
    inferenceXSync.status = 'error';
    renderInferenceXSyncPanel();
    return;
  }

  const existingLineIds = new Set(inferenceXSync.configs.map((existing) => makeInferenceXSyncLineId(existing)));
  const newConfigs = configs.filter((config) => !existingLineIds.has(makeInferenceXSyncLineId(config)));
  if (newConfigs.length === 0) {
    inferenceXSync.lastError =
      configs.length === 1
        ? 'That InferenceX sync config already exists.'
        : 'All matching InferenceX sync configs already exist.';
    inferenceXSync.status = 'error';
    renderInferenceXSyncPanel();
    return;
  }

  inferenceXSync.configs.push(...newConfigs);
  clearInferenceXStagedUpdate();
  inferenceXSync.status = 'idle';
  inferenceXSync.lastError = '';
  renderInferenceXSyncPanel();
  scheduleLocalSave();
  setStatus(
    `Added ${newConfigs.length} InferenceX sync config${newConfigs.length === 1 ? '' : 's'}. Checking updates...`
  );
  void checkInferenceXUpdates({ automatic: false });
}

function createInferenceXConfigsFromAddDraft(): InferenceXSyncConfig[] {
  if (
    inferenceXSync.addShapeSelection !== ALL_VALUE &&
    inferenceXSync.addPrecisionSelection !== ALL_VALUE &&
    inferenceXSync.addFrameworkSelection !== ALL_VALUE &&
    inferenceXSync.addSpecMethodSelection !== ALL_VALUE
  ) {
    return [
      normalizeInferenceXSyncConfig({
        ...inferenceXSync.addDraft,
        scenario: inferenceXSync.addDraft.scenario,
        framework: inferenceXSync.addFrameworkSelection,
        specMethod: inferenceXSync.addSpecMethodSelection,
        enabled: true
      })
    ];
  }

  const seenLineIds = new Set<string>();
  return getInferenceXOptionRows()
    .filter((row) => inferenceXAvailabilityRowMatchesAddDraft(row))
    .map((row) =>
      normalizeInferenceXSyncConfig({
        ...inferenceXSync.addDraft,
        scenario: row.scenario || undefined,
        isl: row.isl,
        osl: row.osl,
        precision: row.precision,
        framework: row.framework,
        specMethod: row.specMethod,
        enabled: true
      })
    )
    .filter((config) => {
      const lineId = makeInferenceXSyncLineId(config);
      if (seenLineIds.has(lineId)) return false;
      seenLineIds.add(lineId);
      return true;
    });
}

function inferenceXAvailabilityRowMatchesAddDraft(row: InferenceXAvailabilityRow): boolean {
  const draft = inferenceXSync.addDraft;
  return (
    row.modelDisplay === draft.model &&
    (
      inferenceXSync.addShapeSelection === ALL_VALUE ||
      inferenceXAvailabilityRowMatchesSequence(row, draft)
    ) &&
    (
      inferenceXSync.addPrecisionSelection === ALL_VALUE ||
      row.precision === inferenceXSync.addPrecisionSelection
    ) &&
    row.hardware === draft.hardware &&
    (
      inferenceXSync.addFrameworkSelection === ALL_VALUE ||
      row.framework === inferenceXSync.addFrameworkSelection
    ) &&
    (isAgenticTraceSequence(row.scenario) || inferenceXSync.addSpecMethodSelection === ALL_VALUE ||
      row.specMethod === inferenceXSync.addSpecMethodSelection)
  );
}

function inferenceXAvailabilityRowMatchesSequence(
  row: Pick<InferenceXAvailabilityRow, 'scenario' | 'isl' | 'osl'>,
  draft: Pick<InferenceXSyncAddDraft, 'scenario' | 'isl' | 'osl'>
): boolean {
  const rowScenario = row.scenario.trim();
  const draftScenario = (draft.scenario ?? '').trim();
  if (rowScenario || draftScenario) return rowScenario === draftScenario;
  return row.isl === draft.isl && row.osl === draft.osl;
}

function removeInferenceXSyncConfig(index: number): void {
  if (!Number.isInteger(index)) return;
  if (inferenceXSync.configs.length <= 1) {
    inferenceXSync.lastError = 'At least one InferenceX sync config is required.';
    inferenceXSync.status = 'error';
    renderInferenceXSyncPanel();
    return;
  }
  const [removed] = inferenceXSync.configs.splice(index, 1);
  if (removed) {
    delete inferenceXSync.fingerprints[removed.id];
    delete inferenceXSync.lineIdsByConfigKey[removed.id];
  }
  clearInferenceXStagedUpdate();
  inferenceXSync.status = 'idle';
  inferenceXSync.lastError = '';
  renderInferenceXSyncPanel();
  scheduleLocalSave();
}

function resetInferenceXSyncConfigs(): void {
  inferenceXSync.configs = createDefaultInferenceXSyncConfigs();
  inferenceXSync.addDraft = createInferenceXSyncAddDraft(inferenceXSync.configs[0]!);
  inferenceXSync.addShapeSelection = ALL_VALUE;
  inferenceXSync.addPrecisionSelection = ALL_VALUE;
  inferenceXSync.addFrameworkSelection = ALL_VALUE;
  inferenceXSync.addSpecMethodSelection = ALL_VALUE;
  clearInferenceXStagedUpdate();
  inferenceXSync.status = 'idle';
  inferenceXSync.lastError = '';
  renderInferenceXSyncPanel();
  scheduleLocalSave();
}

function clearInferenceXStagedUpdate(): void {
  inferenceXSync.stagedResult = null;
  inferenceXSync.changedConfigIds = new Set();
  inferenceXSync.availableUpdateCount = 0;
  inferenceXSync.missingConfigIds = new Set();
}

function renderFilterControls(): void {
  reconcileFiltersForSeries(currentSeries);

  const models = uniqueSorted(currentSeries.map(getSeriesModel));
  const scenarios = getAvailableScenarios(getModelFilteredSeries());
  const islOslValues = sortIslOslValues(getModelScenarioFilteredSeries().map(getSeriesIslOsl));
  const mtpValues = getAvailableMtpFilters(getModelSequenceFilteredSeries());
  const precisions = getAvailablePrecisions(getModelSequenceMtpFilteredSeries());
  ensureSelectedPrecisions(precisions);

  modelFilterEl.innerHTML = renderSelectOptions(models, state.modelFilter, 'All Models');
  scenarioFilterEl.innerHTML = renderScenarioFilterOptions(scenarios);
  islOslFilterEl.innerHTML = renderIslOslFilterOptions(islOslValues);
  islOslFilterEl.disabled = state.scenarioFilter === AGENTIC_SCENARIO;
  precisionFilterEl.innerHTML = renderPrecisionFilterOptions(precisions);
  mtpFilterEl.innerHTML = renderMtpFilterOptions(mtpValues);
  document.querySelector<HTMLElement>('#mtp-filter-control')!.hidden = state.scenarioFilter === AGENTIC_SCENARIO;
  latencyPercentileControlEl.hidden = !isAgenticTraceView(currentSeries);
  latencyPercentileControlEl.parentElement?.classList.toggle(
    'has-latency-percentile',
    !latencyPercentileControlEl.hidden
  );
  latencyPercentileFilterEl.innerHTML = renderLatencyPercentileOptions();
  metricSwitchEl.innerHTML = renderMetricSwitchOptions();

  modelFilterEl.onchange = () => {
    saveActiveSeriesForCurrentView();
    state.modelFilter = modelFilterEl.value;
    reconcileFiltersForSeries(currentSeries);
    resetSelectionsForSeries(getModelSequenceMtpFilteredSeries());
    restoreActiveSeriesForCurrentView();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    scheduleLocalSave();
  };
  scenarioFilterEl.onchange = () => {
    saveActiveSeriesForCurrentView();
    state.scenarioFilter = scenarioFilterEl.value;
    state.islOslFilter = getDefaultSequenceForScenario(getModelFilteredSeries(), state.scenarioFilter);
    reconcileFiltersForSeries(currentSeries);
    resetSelectionsForSeries(getModelSequenceMtpFilteredSeries());
    restoreActiveSeriesForCurrentView();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    scheduleLocalSave();
  };
  islOslFilterEl.onchange = () => {
    saveActiveSeriesForCurrentView();
    state.islOslFilter = islOslFilterEl.value;
    reconcileFiltersForSeries(currentSeries);
    resetSelectionsForSeries(getModelSequenceMtpFilteredSeries());
    restoreActiveSeriesForCurrentView();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    scheduleLocalSave();
  };
  precisionFilterEl.onchange = () => {
    saveActiveSeriesForCurrentView();
    const precision = precisionFilterEl.value;
    const availablePrecisions = getAvailablePrecisions(getModelSequenceMtpFilteredSeries());
    state.selectedPrecisions =
      precision === ALL_VALUE ? new Set(availablePrecisions) : new Set([precision]);
    restoreActiveSeriesForCurrentView();
    reconcileLatencyPercentile();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    scheduleLocalSave();
  };
  mtpFilterEl.onchange = () => {
    saveActiveSeriesForCurrentView();
    state.mtpFilter = mtpFilterEl.value;
    reconcileFiltersForSeries(currentSeries);
    restoreActiveSeriesForCurrentView();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    scheduleLocalSave();
  };
  latencyPercentileFilterEl.onchange = () => {
    const percentile = normalizeLatencyPercentile(latencyPercentileFilterEl.value);
    if (!percentile || percentile === state.latencyPercentile) return;
    commitSeriesDom();
    state.latencyPercentile = percentile;
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    scheduleLocalSave();
  };
}

function renderScenarioFilterOptions(scenarios: string[]): string {
  return scenarios
    .map(
      (scenario) =>
        `<option value="${escapeAttribute(scenario)}" ${state.scenarioFilter === scenario ? 'selected' : ''}>${escapeHtml(formatScenarioFilterLabel(scenario))}</option>`
    )
    .join('');
}

function renderIslOslFilterOptions(values: string[]): string {
  if (state.scenarioFilter === AGENTIC_SCENARIO) {
    return '<option value="Agentic Traces" selected>Agentic Traces</option>';
  }
  return values
    .map(
      (value) =>
        `<option value="${escapeAttribute(value)}" ${state.islOslFilter === value ? 'selected' : ''}>${escapeHtml(formatIslOslLabel(value))}</option>`
    )
    .join('');
}

function renderSelectOptions(values: string[], selected: string, allLabel: string): string {
  return [
    `<option value="${ALL_VALUE}" ${selected === ALL_VALUE ? 'selected' : ''}>${allLabel}</option>`,
    ...values.map(
      (value) =>
        `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`
    )
  ].join('');
}

function renderPrecisionFilterOptions(precisions: string[]): string {
  const selected = getPrecisionFilterValue(precisions);
  const options = [
    `<option value="${ALL_VALUE}" ${selected === ALL_VALUE ? 'selected' : ''}>All Precision</option>`
  ];
  if (selected === CUSTOM_VALUE) {
    options.push(`<option value="${CUSTOM_VALUE}" selected disabled>Custom</option>`);
  }
  options.push(
    ...precisions.map(
      (precision) =>
        `<option value="${escapeAttribute(precision)}" ${selected === precision ? 'selected' : ''}>${escapeHtml(formatPrecisionLabel(precision))}</option>`
    )
  );
  return options.join('');
}

function renderMtpFilterOptions(values: string[]): string {
  return [
    `<option value="${ALL_VALUE}" ${state.mtpFilter === ALL_VALUE ? 'selected' : ''}>All MTP</option>`,
    ...values.map(
      (value) =>
        `<option value="${escapeAttribute(value)}" ${state.mtpFilter === value ? 'selected' : ''}>${escapeHtml(formatMtpFilterLabel(value))}</option>`
    )
  ].join('');
}

function renderLatencyPercentileOptions(): string {
  const available = getAvailableLatencyPercentiles(
    getFilteredSeriesForChart(),
    state.chartMetric
  );
  return LATENCY_PERCENTILES.map((percentile) => {
    const enabled = available.has(percentile);
    return `<option value="${percentile}" ${state.latencyPercentile === percentile ? 'selected' : ''} ${enabled ? '' : 'disabled'}>${percentile.toUpperCase()}</option>`;
  }).join('');
}

function renderMetricSwitchOptions(): string {
  return getAvailableChartMetricOptions()
    .map(
      (option) => `
        <button
          type="button"
          class="metric-switch-button${state.chartMetric === option.value ? ' active' : ''}"
          data-chart-metric="${option.value}"
          aria-pressed="${state.chartMetric === option.value ? 'true' : 'false'}"
        >${escapeHtml(option.label)}</button>
      `
    )
    .join('');
}

function renderSeriesEditor(): void {
  const previewColors = resolveInferenceCurveColors(draftsToPreviewSeries(seriesDrafts), state.highContrast, state.theme);
  const entries = getFilteredDraftEntries();
  seriesEditorEl.innerHTML =
    entries.length > 0
      ? entries
          .map(({ draft, index }) =>
            renderSeriesCard(draft, index, previewColors.get(getDraftSeriesId(draft, index)) ?? '')
          )
          .join('')
      : renderEmptySeriesFilter();
  attachSeriesEditorEvents();
}

function refreshEditorTheme(): void {
  // Theme preferences are saved separately. Keep the existing table cells and
  // event handlers, including any edits, instead of rebuilding the data editor.
  const colors = resolveInferenceCurveColors(draftsToPreviewSeries(seriesDrafts), state.highContrast, state.theme);
  getFilteredDraftEntries().forEach(({ draft, index }) => {
    const color = draft.color.trim() || colors.get(getDraftSeriesId(draft, index))
      || colorInputFallbacks[index % colorInputFallbacks.length]!;
    syncColorPicker(index, color, draft.color);
  });
  renderMergePreview();
}

function renderSeriesCard(series: SeriesDraft, seriesIndex: number, autoColor: string): string {
  const color = series.color.trim() || autoColor || colorInputFallbacks[seriesIndex % colorInputFallbacks.length]!;
  const pointCount = countPointRows([series]);
  const collapsed = series.collapsed;
  return `
    <section
      class="series-card${collapsed ? ' collapsed' : ''}"
      data-series-card
      data-series-index="${seriesIndex}"
      data-series-id="${escapeAttribute(getDraftSeriesId(series, seriesIndex))}"
    >
      <div class="series-card-head">
        <div class="series-card-title">
          <button
            class="series-drag-handle"
            type="button"
            draggable="true"
            data-series-drag-handle
            data-series-index="${seriesIndex}"
            title="Drag to reorder layer"
            aria-label="Drag to reorder layer"
          >
            ${renderIcon('grip-vertical')}
          </button>
          <span class="series-swatch" style="background:${escapeAttribute(color)}"></span>
          <div>
            <h3>${escapeHtml(series.name || `Line ${seriesIndex + 1}`)}</h3>
            <p>${escapeHtml(formatLineMeta(series, seriesIndex))}</p>
          </div>
        </div>
        <div class="series-card-actions">
          <button class="series-action-button" type="button" data-series-action="copy-series" data-series-index="${seriesIndex}">
            ${renderIcon('copy')}
            <span>Copy</span>
          </button>
          <button
            class="series-action-button has-help-tip"
            type="button"
            data-series-action="copy-split-series"
            data-series-index="${seriesIndex}"
            aria-label="Copy this line and split points by matching config fields"
          >
            ${renderIcon('split')}
            <span>Copy & Split</span>
            <span class="help-tip-bubble" aria-hidden="true">
              <strong class="help-tip-title">Copy and split by config.</strong>
              <span class="help-tip-row">
                Groups points by Prefill/Decode GPUs, TP, EP, DCP, DPA, KV Offload, and hidden strategy fields.
              </span>
              <span class="help-tip-row">
                Ignores concurrency, interactivity, throughput, point marker, and note.
              </span>
              <span class="help-tip-note">
                Missing config values are grouped as blank, so rows missing the same fields stay together.
              </span>
            </span>
          </button>
          <button class="series-action-button" type="button" data-series-action="add-row" data-series-index="${seriesIndex}">
            ${renderIcon('table-plus')}
            <span>Add Row</span>
          </button>
          <button class="series-action-button" type="button" data-series-action="clear-empty" data-series-index="${seriesIndex}">
            ${renderIcon('eraser')}
            <span>Clear Empty</span>
          </button>
          <button class="series-action-button danger" type="button" data-series-action="remove-series" data-series-index="${seriesIndex}">
            ${renderIcon('trash')}
            <span>Remove</span>
          </button>
        </div>
      </div>

      <div class="series-fields">
        ${renderSeriesInput(seriesIndex, 'id', 'Line ID', series.id, true)}
        ${renderSeriesInput(seriesIndex, 'name', 'Name', series.name, true)}
        ${renderSeriesInput(seriesIndex, 'model', 'Model', series.model, true)}
        ${renderSeriesInput(seriesIndex, 'islOsl', 'ISL / OSL or Agentic Scenario', series.islOsl, true)}
        ${renderSeriesInput(seriesIndex, 'precision', 'Precision', series.precision, true)}
        ${renderSeriesMtpField(seriesIndex, series.mtp)}
        ${renderSeriesInput(seriesIndex, 'title', 'Title', series.title)}
        ${renderLineMarkerField(seriesIndex, series.marker)}
        ${renderLineStyleField(seriesIndex, series.lineStyle)}
        ${renderColorField(seriesIndex, series.color, color)}
        ${renderSeriesNoteField(seriesIndex, series.note)}
      </div>

      ${collapsed ? renderCollapsedPointSummary(seriesIndex, pointCount) : renderPointTable(series, seriesIndex, pointCount)}
    </section>
  `;
}

function formatLineMeta(series: SeriesDraft, seriesIndex: number): string {
  return [
    `Layer ${getDraftLayerLabel(series, seriesIndex)}`,
    series.model,
    series.precision.toUpperCase(),
    formatIslOslLabel(series.islOsl),
    isAgenticTraceSequence(series.islOsl) ? '' : formatMtpFilterLabel(getDraftMtpFilter(series))
  ]
    .filter(Boolean)
    .join(' • ');
}

function renderEmptySeriesFilter(): string {
  return `
    <div class="series-empty">
      No line projects match the current filters.
    </div>
  `;
}

function renderSeriesInput(
  seriesIndex: number,
  field: SeriesField,
  label: string,
  value: string,
  required = false
): string {
  return `
    <label class="${getSeriesFieldClassName(field)}">
      <span>${label}${required ? ' *' : ''}</span>
      <input
        type="text"
        data-series-index="${seriesIndex}"
        data-series-field="${field}"
        value="${escapeAttribute(value)}"
        ${required ? 'required' : ''}
      />
    </label>
  `;
}

function getSeriesFieldClassName(field: SeriesField): string {
  const fieldClass = field.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`);
  return `series-field series-field-${fieldClass}`;
}

function renderSeriesNoteField(seriesIndex: number, value: string): string {
  const hasNote = Boolean(value.trim());
  return `
    <details class="series-field series-field-note" ${hasNote ? 'open' : ''}>
      <summary>
        <span>Line Note</span>
        <span class="series-note-state">${hasNote ? 'Added' : 'Empty'}</span>
      </summary>
      <textarea
        data-series-index="${seriesIndex}"
        data-series-field="note"
        rows="1"
        aria-label="Line Note"
        placeholder="Editor-only notes about this line"
      >${escapeHtml(value)}</textarea>
    </details>
  `;
}

function renderSeriesMtpField(seriesIndex: number, value: string): string {
  if (isAgenticTraceSequence(seriesDrafts[seriesIndex]?.islOsl ?? '')) return '';
  const selectedValue = normalizeMtpValue(value);
  return `
    <label class="series-field series-field-mtp">
      <span>MTP</span>
      <select data-series-index="${seriesIndex}" data-series-field="mtp">
        ${[MTP_VALUE, NON_MTP_VALUE]
          .map(
            (option) =>
              `<option value="${option}" ${selectedValue === option ? 'selected' : ''}>${formatMtpFilterLabel(option)}</option>`
          )
          .join('')}
      </select>
    </label>
  `;
}

function renderLineMarkerField(seriesIndex: number, value: string): string {
  const selectedValue = normalizePointShapeValue(value);
  return `
    <label class="series-field series-field-marker">
      <span>Marker</span>
      <select data-series-index="${seriesIndex}" data-series-field="marker">
        ${renderPointShapeOptions(selectedValue, 'Precision')}
      </select>
    </label>
  `;
}

function renderLineStyleField(seriesIndex: number, lineStyle: string): string {
  const styleValue = lineStyle.trim() || DEFAULT_LINE_STYLE;
  const selectedValue = getLineStyleSelectValue(styleValue);
  const isCustom = selectedValue === CUSTOM_LINE_STYLE;
  const selectedOption =
    lineStyleOptions.find((option) => option.value === selectedValue) ??
    ({ value: CUSTOM_LINE_STYLE, label: 'Custom', dasharray: styleValue || '8 4' } satisfies LineStyleOption);
  return `
    <label class="series-field line-style-field">
      <span>Line Type</span>
      <div class="line-style-controls">
        <details class="line-style-menu" data-line-style-menu data-series-index="${seriesIndex}">
          <summary>
            ${renderLineStyleSample(selectedOption)}
            <span>${escapeHtml(selectedOption.label)}</span>
          </summary>
          <div class="line-style-menu-list">
          ${lineStyleOptions
            .map(
              (option) =>
                `<button type="button" class="${selectedValue === option.value ? 'selected' : ''}" data-line-style-option="${escapeAttribute(option.value)}" data-series-index="${seriesIndex}">
                  ${renderLineStyleSample(option)}
                  <span>${escapeHtml(option.label)}</span>
                </button>`
            )
            .join('')}
            <button type="button" class="${selectedValue === CUSTOM_LINE_STYLE ? 'selected' : ''}" data-line-style-option="${CUSTOM_LINE_STYLE}" data-series-index="${seriesIndex}">
              ${renderLineStyleSample({ value: CUSTOM_LINE_STYLE, label: 'Custom', dasharray: styleValue || '8 4' })}
              <span>Custom</span>
            </button>
          </div>
        </details>
        ${
          isCustom
            ? `<input
                type="text"
                data-line-style-custom="true"
                data-series-index="${seriesIndex}"
                value="${escapeAttribute(styleValue)}"
                placeholder="8 4 2 4"
              />`
            : ''
        }
      </div>
    </label>
  `;
}

function renderLineStyleSample(option: LineStyleOption): string {
  return `
    <svg class="line-style-sample" viewBox="0 0 56 12" aria-hidden="true">
      <line
        x1="3"
        y1="6"
        x2="53"
        y2="6"
        ${option.dasharray ? `stroke-dasharray="${escapeAttribute(option.dasharray)}"` : ''}
      ></line>
    </svg>
  `;
}

function renderColorField(seriesIndex: number, color: string, autoColor: string): string {
  const colorValue = color.trim();
  const isAuto = colorValue.length === 0;
  const resolvedColor = autoColor || colorInputFallbacks[seriesIndex % colorInputFallbacks.length]!;
  const pickerColor = toColorInputValue(colorValue || resolvedColor, seriesIndex);
  return `
    <label class="series-field color-field">
      <span>Color</span>
      <div class="color-controls ${isAuto ? 'auto' : 'custom'}" data-color-controls="true">
        <button
          type="button"
          class="color-auto-button${isAuto ? ' active' : ''}"
          data-series-index="${seriesIndex}"
          data-color-auto="true"
          aria-pressed="${isAuto ? 'true' : 'false'}"
          title="Resolved color: ${escapeAttribute(resolvedColor)}"
        >
          <span
            class="color-auto-swatch"
            data-color-auto-swatch="true"
            style="background:${escapeAttribute(resolvedColor)}"
            aria-hidden="true"
          ></span>
          <span>Auto</span>
        </button>
        <input
          type="color"
          data-color-picker="true"
          data-series-index="${seriesIndex}"
          value="${escapeAttribute(pickerColor)}"
          aria-label="Pick custom color"
          title="Pick custom color"
        />
        <div class="color-presets" aria-label="Standard colors">
          ${colorPresets
            .map((preset) => {
              const selected = colorValue.toLowerCase() === preset.value.toLowerCase();
              return `
                <button
                  type="button"
                  class="color-preset${selected ? ' selected' : ''}"
                  data-series-index="${seriesIndex}"
                  data-color-preset="${escapeAttribute(preset.value)}"
                  title="${escapeAttribute(preset.name)}"
                  aria-label="${escapeAttribute(preset.name)}"
                  style="--swatch-color:${escapeAttribute(preset.value)}"
                ></button>
              `;
            })
            .join('')}
        </div>
      </div>
    </label>
  `;
}

function renderCollapsedPointSummary(seriesIndex: number, pointCount: number): string {
  return `
    <div class="point-table-collapsed">
      ${renderPointDataToggle(seriesIndex, pointCount, true)}
    </div>
  `;
}

function getEditorPointColumns(): TableColumn[] {
  if (!isAgenticTraceView(currentSeries)) {
    return pointColumns.filter((column) => column.key !== 'e2eNormalizedInteractivity');
  }
  const percentileLabel = state.latencyPercentile.toUpperCase();
  return pointColumns.flatMap((column) => {
    if (column.key === 'e2eNormalizedInteractivity') {
      if (!isE2ENormalizedInteractivityPercentile(state.latencyPercentile)) return [];
      return [{
        ...column,
        key: e2eNormalizedInteractivityRowKeys[state.latencyPercentile],
        label: `${percentileLabel} ${column.label}`
      }];
    }
    if (!isLatencyMetricKey(column.key)) return column;
    const metric = latencyMetricColumns[column.key];
    return {
      ...column,
      key: metric.rowKeys[state.latencyPercentile],
      label: `${percentileLabel} ${metric.label}`
    };
  });
}

function isLatencyMetricKey(key: string): key is LatencyMetricKey {
  return Object.prototype.hasOwnProperty.call(latencyMetricColumns, key);
}

function getPointColumnCssKey(key: string): string {
  if (e2eNormalizedInteractivityPointKeys.includes(key)) {
    return 'e2eNormalizedInteractivity';
  }
  for (const [metricKey, metric] of Object.entries(latencyMetricColumns)) {
    if (Object.values(metric.rowKeys).includes(key)) return metricKey;
  }
  return key;
}

function renderPointTable(series: SeriesDraft, seriesIndex: number, pointCount: number): string {
  const editorPointColumns = getEditorPointColumns();
  return `
    <div class="point-table-expanded-head">
      ${renderPointDataToggle(seriesIndex, pointCount, false)}
    </div>
    <div class="table-wrap point-table-wrap">
      <table class="data-table point-table" aria-label="${escapeAttribute(series.name || `Line ${seriesIndex + 1}`)} point data">
        <thead>
          <tr>
            <th class="row-num">#</th>
            <th class="point-actions-head">Actions</th>
            ${editorPointColumns
              .map(
                (column) =>
                  `<th class="point-cell-${getPointColumnCssKey(column.key)}" title="${column.required ? 'Required' : 'Optional'}">${column.label}${column.required ? ' *' : ''}</th>`
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${series.points.map((row, rowIndex) => renderPointRow(row, seriesIndex, rowIndex)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPointDataToggle(seriesIndex: number, pointCount: number, collapsed: boolean): string {
  return `
    <button
      type="button"
      class="point-data-toggle"
      data-series-action="toggle-data"
      data-series-index="${seriesIndex}"
      aria-expanded="${collapsed ? 'false' : 'true'}"
    >
      <span class="point-data-toggle-main">
        ${renderIcon(collapsed ? 'chevron-right' : 'chevron-down')}
        <span>${collapsed ? 'Show' : 'Hide'} ${pointCount} Point Rows</span>
      </span>
      <span class="point-data-toggle-meta">${collapsed ? 'Data hidden' : 'Data visible'}</span>
    </button>
  `;
}

function renderIcon(name: string): string {
  const paths: Record<string, string> = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.4 6.6L4 9"/><path d="M5.5 15A7 7 0 0 0 17.6 17.4L20 15"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
    split: '<path d="M4 7h4a4 4 0 0 1 4 4v6"/><path d="M4 17h4a4 4 0 0 0 4-4V7"/><path d="M16 7h4"/><path d="M16 17h4"/><path d="m17 4 3 3-3 3"/><path d="m17 14 3 3-3 3"/>',
    'table-plus': '<path d="M4 5h10"/><path d="M4 11h10"/><path d="M4 17h7"/><path d="M8 5v12"/><path d="M16 15h6"/><path d="M19 12v6"/>',
    eraser: '<path d="m7 21-4-4 10-10 6 6-8 8z"/><path d="m13 7 4-4 4 4-4 4"/><path d="M3 21h18"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 15h10l1-15"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    merge: '<path d="M8 7h3a5 5 0 0 1 5 5v5"/><path d="m13 14 3 3 3-3"/><path d="M8 17h3a5 5 0 0 0 5-5V7"/><path d="m13 10 3-3 3 3"/><path d="M4 7h4"/><path d="M4 17h4"/>',
    'download-cloud': '<path d="M12 13v8"/><path d="m8 17 4 4 4-4"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>',
    filter: '<path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/>',
    redraw: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    'arrow-up': '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'grip-vertical': '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2.5 2-2.5 3.5"/><path d="M12 17h.01"/>',
    sliders: '<path d="M4 7h16"/><path d="M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 8v4l3 2"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
  };
  return `
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${paths[name] ?? ''}
      </g>
    </svg>
  `;
}

function formatPointCellDisplay(key: string, value: string | undefined): string {
  const raw = value ?? '';
  if (!DECIMAL_DISPLAY_KEYS.has(key)) return raw;
  const parsed = parseNumber(raw);
  return parsed === null ? raw : parsed.toFixed(2);
}

function renderPointRow(row: PointRow, seriesIndex: number, rowIndex: number): string {
  const editorPointColumns = getEditorPointColumns();
  return `
    <tr>
      <td class="row-num">${rowIndex + 1}</td>
      <td class="point-actions-cell">
        <button
          type="button"
          class="point-action-button"
          data-point-action="copy"
          data-series-index="${seriesIndex}"
          data-row="${rowIndex}"
          title="Copy point"
          aria-label="Copy point ${rowIndex + 1}"
        >
          ${renderIcon('copy')}
        </button>
        <button
          type="button"
          class="point-action-button danger"
          data-point-action="delete"
          data-series-index="${seriesIndex}"
          data-row="${rowIndex}"
          title="Delete point"
          aria-label="Delete point ${rowIndex + 1}"
        >
          ${renderIcon('trash')}
        </button>
      </td>
      ${editorPointColumns
        .map((column, colIndex) =>
          column.key === 'shape'
            ? renderPointShapeCell(row, seriesIndex, rowIndex, colIndex)
            : `
              <td
                contenteditable="true"
                data-series-index="${seriesIndex}"
                data-row="${rowIndex}"
                data-col="${colIndex}"
                data-key="${column.key}"
                class="point-cell point-cell-${getPointColumnCssKey(column.key)}${column.required ? ' required-cell' : ''}"
              >${escapeHtml(formatPointCellDisplay(column.key, row[column.key]))}</td>
            `
        )
        .join('')}
    </tr>
  `;
}

function renderPointShapeCell(row: PointRow, seriesIndex: number, rowIndex: number, colIndex: number): string {
  const selectedValue = normalizePointShapeValue(row.shape ?? '');
  return `
    <td class="point-cell point-cell-shape" data-series-index="${seriesIndex}" data-row="${rowIndex}" data-col="${colIndex}" data-key="shape">
      <select
        data-point-field="shape"
        data-series-index="${seriesIndex}"
        data-row="${rowIndex}"
        data-key="shape"
        aria-label="Point marker"
      >
        ${pointShapeOptions
          .map((option) => renderPointShapeOption(option, selectedValue, 'Default'))
          .join('')}
      </select>
    </td>
  `;
}

function renderPointShapeOptions(selectedValue: string, defaultLabel: string): string {
  return pointShapeOptions
    .map((option) => renderPointShapeOption(option, selectedValue, defaultLabel))
    .join('');
}

function renderPointShapeOption(
  option: (typeof pointShapeOptions)[number],
  selectedValue: string,
  defaultLabel: string
): string {
  const label = option.value ? option.label : defaultLabel;
  return `<option value="${escapeAttribute(option.value)}" ${selectedValue === option.value ? 'selected' : ''}>${escapeHtml(`${option.symbol} ${label}`)}</option>`;
}

function attachSeriesEditorEvents(): void {
  attachSeriesDragEvents();

  seriesEditorEl
    .querySelectorAll<HTMLTextAreaElement>('textarea[data-series-field="note"]')
    .forEach(autoResizeSeriesNote);

  seriesEditorEl
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input[data-series-field], select[data-series-field], textarea[data-series-field]'
    )
    .forEach((input) => {
    input.addEventListener('input', () => {
      const seriesIndex = Number(input.dataset.seriesIndex);
      const field = input.dataset.seriesField as SeriesField;
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;
      draft[field] = normalizeCellText(input.value);
      if (field === 'color') {
        syncColorPicker(seriesIndex, draft.color || getEditorResolvedColor(seriesIndex), draft.color);
      }
      if (field === 'note' && input instanceof HTMLTextAreaElement) {
        autoResizeSeriesNote(input);
        const stateLabel = input.closest('.series-field-note')?.querySelector<HTMLElement>('.series-note-state');
        if (stateLabel) stateLabel.textContent = draft.note ? 'Added' : 'Empty';
      }
      scheduleLocalSave();
      if (field !== 'note') markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLButtonElement>('button[data-line-style-option]').forEach((button) => {
    button.addEventListener('click', () => {
      commitSeriesDom();
      const seriesIndex = Number(button.dataset.seriesIndex);
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;
      const option = button.dataset.lineStyleOption ?? DEFAULT_LINE_STYLE;
      draft.lineStyle =
        option === CUSTOM_LINE_STYLE
          ? getLineStyleSelectValue(draft.lineStyle) === CUSTOM_LINE_STYLE
            ? draft.lineStyle
            : '8 4'
          : option;
      renderSeriesEditor();
      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLInputElement>('input[data-line-style-custom]').forEach((input) => {
    input.addEventListener('input', () => {
      const seriesIndex = Number(input.dataset.seriesIndex);
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;
      draft.lineStyle = normalizeCellText(input.value) || '8 4';
      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLInputElement>('input[data-color-picker]').forEach((input) => {
    input.addEventListener('input', () => {
      const seriesIndex = Number(input.dataset.seriesIndex);
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;
      draft.color = input.value;
      syncSeriesSwatch(seriesIndex, input.value);
      syncPresetSelection(seriesIndex, input.value);
      syncColorMode(seriesIndex, 'custom', input.value);
      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLButtonElement>('button[data-color-auto]').forEach((button) => {
    button.addEventListener('click', () => {
      const seriesIndex = Number(button.dataset.seriesIndex);
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;
      draft.color = '';
      renderSeriesEditor();
      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLButtonElement>('button[data-color-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const seriesIndex = Number(button.dataset.seriesIndex);
      const color = button.dataset.colorPreset ?? '';
      const draft = seriesDrafts[seriesIndex];
      if (!draft || !color) return;
      draft.color = color;
      const picker = getColorPicker(seriesIndex);
      if (picker) picker.value = toColorInputValue(color, seriesIndex);
      syncSeriesSwatch(seriesIndex, color);
      syncPresetSelection(seriesIndex, color);
      syncColorMode(seriesIndex, 'custom', color);
      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLButtonElement>('button[data-series-action]').forEach((button) => {
    button.addEventListener('click', () => {
      commitSeriesDom();
      const seriesIndex = Number(button.dataset.seriesIndex);
      const action = button.dataset.seriesAction;
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;

      if (action === 'toggle-data') {
        draft.collapsed = !draft.collapsed;
      } else if (action === 'copy-series') {
        const copy = copySeriesDraft(draft);
        copy.renderOrder = getNextDraftRenderOrder();
        seriesDrafts.push(copy);
        queueSeriesActiveByDraft(copy, seriesDrafts.length - 1);
        setStatus(`Copied ${draft.name || `Line ${seriesIndex + 1}`}`);
      } else if (action === 'copy-split-series') {
        const splitDrafts = splitSeriesDraftByPointConfig(draft);
        if (splitDrafts.length === 0) {
          setStatus(`No point rows to split in ${draft.name || `Line ${seriesIndex + 1}`}.`, true);
          return;
        }
        placeDraftsOnTop(splitDrafts);
        splitDrafts.forEach((splitDraft) => {
          seriesDrafts.push(splitDraft);
          queueSeriesActiveByDraft(splitDraft, seriesDrafts.length - 1);
        });
        setStatus(`Copied and split ${draft.name || `Line ${seriesIndex + 1}`} into ${splitDrafts.length} lines.`);
      } else if (action === 'add-row') {
        draft.points.push(makeEmptyPointRow());
        draft.collapsed = false;
      } else if (action === 'clear-empty') {
        draft.points = draft.points.filter((row) => !isEmptyPointRow(row));
        if (draft.points.length === 0) draft.points.push(makeEmptyPointRow());
      } else if (action === 'remove-series') {
        if (seriesDrafts.length === 1) {
          setStatus('At least one line is required.', true);
          return;
        }
        seriesDrafts.splice(seriesIndex, 1);
      }

      if (action !== 'toggle-data') clearMergePreview();
      sortSeriesDraftsByLayer();
      normalizeDraftRenderOrderFromPanelOrder();
      syncCurrentSeriesOrderFromDrafts();
      renderSeriesEditor();
      scheduleLocalSave();
      if (action !== 'toggle-data') markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLSelectElement>('select[data-point-field]').forEach((select) => {
    select.addEventListener('change', () => {
      const seriesIndex = Number(select.dataset.seriesIndex);
      const rowIndex = Number(select.dataset.row);
      const key = select.dataset.key!;
      ensurePointRow(seriesIndex, rowIndex);
      seriesDrafts[seriesIndex]!.points[rowIndex]![key] = normalizeCellText(select.value);
      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLButtonElement>('button[data-point-action]').forEach((button) => {
    button.addEventListener('click', () => {
      commitSeriesDom();
      const seriesIndex = Number(button.dataset.seriesIndex);
      const rowIndex = Number(button.dataset.row);
      const action = button.dataset.pointAction;
      const draft = seriesDrafts[seriesIndex];
      if (!draft || !Number.isInteger(rowIndex)) return;

      if (action === 'copy') {
        ensurePointRow(seriesIndex, rowIndex);
        draft.points.splice(rowIndex + 1, 0, structuredClone(draft.points[rowIndex]!));
        renderSeriesEditor();
        focusPointCell(seriesIndex, rowIndex + 1, 0);
        setStatus(`Copied point ${rowIndex + 1} in ${draft.name || `Line ${seriesIndex + 1}`}`);
      } else if (action === 'delete') {
        if (draft.points.length <= 1) {
          draft.points = [makeEmptyPointRow()];
        } else {
          draft.points.splice(rowIndex, 1);
        }
        renderSeriesEditor();
        focusPointCell(seriesIndex, Math.min(rowIndex, draft.points.length - 1), 0);
        setStatus(`Deleted point ${rowIndex + 1} in ${draft.name || `Line ${seriesIndex + 1}`}`);
      }

      scheduleLocalSave();
      markChartDirty();
    });
  });

  seriesEditorEl.querySelectorAll<HTMLTableCellElement>('td[contenteditable="true"]').forEach((cell) => {
    cell.addEventListener('input', () => {
      const seriesIndex = Number(cell.dataset.seriesIndex);
      const rowIndex = Number(cell.dataset.row);
      const key = cell.dataset.key!;
      ensurePointRow(seriesIndex, rowIndex);
      seriesDrafts[seriesIndex]!.points[rowIndex]![key] = normalizeCellText(cell.textContent ?? '');
      scheduleLocalSave();
      markChartDirty();
    });
    cell.addEventListener('paste', handlePointTablePaste);
    cell.addEventListener('keydown', handlePointTableKeydown);
  });
}

function autoResizeSeriesNote(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function attachSeriesDragEvents(): void {
  seriesEditorEl.querySelectorAll<HTMLElement>('[data-series-drag-handle]').forEach((handle) => {
    handle.addEventListener('dragstart', (event) => {
      commitSeriesDom();
      const seriesIndex = Number(handle.dataset.seriesIndex);
      if (!Number.isInteger(seriesIndex)) return;
      draggedSeriesIndex = seriesIndex;
      event.dataTransfer?.setData('text/plain', String(seriesIndex));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      handle.closest<HTMLElement>('[data-series-card]')?.classList.add('dragging');
    });
    handle.addEventListener('dragend', clearSeriesDragState);
  });

  seriesEditorEl.querySelectorAll<HTMLElement>('[data-series-card]').forEach((card) => {
    card.addEventListener('dragover', (event) => {
      if (draggedSeriesIndex === null) return;
      const targetIndex = Number(card.dataset.seriesIndex);
      if (!Number.isInteger(targetIndex) || targetIndex === draggedSeriesIndex) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      setSeriesDropPosition(card, getSeriesDropPosition(event, card));
    });

    card.addEventListener('dragleave', (event) => {
      const related = event.relatedTarget;
      if (!(related instanceof Node) || !card.contains(related)) clearSeriesDropPosition(card);
    });

    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetIndex = Number(card.dataset.seriesIndex);
      const sourceIndex = draggedSeriesIndex ?? Number(event.dataTransfer?.getData('text/plain'));
      const position = getSeriesDropPosition(event, card);
      clearSeriesDragState();
      if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) return;
      if (!moveSeriesDraftInPanelOrder(sourceIndex, targetIndex, position)) return;
      syncCurrentSeriesOrderFromDrafts();
      renderSeriesEditor();
      renderAll();
      setStatus('Line layer order updated');
      scheduleLocalSave();
    });
  });
}

function getSeriesDropPosition(event: DragEvent, card: HTMLElement): 'before' | 'after' {
  const rect = card.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function setSeriesDropPosition(card: HTMLElement, position: 'before' | 'after'): void {
  clearSeriesDropPosition(card);
  card.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function clearSeriesDropPosition(card: HTMLElement): void {
  card.classList.remove('drop-before', 'drop-after');
}

function clearSeriesDragState(): void {
  draggedSeriesIndex = null;
  seriesEditorEl.querySelectorAll<HTMLElement>('[data-series-card]').forEach((card) => {
    card.classList.remove('dragging', 'drop-before', 'drop-after');
  });
}

function handlePointTablePaste(event: ClipboardEvent): void {
  const target = event.currentTarget as HTMLTableCellElement;
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text.includes('\t') && !text.includes('\n')) return;

  event.preventDefault();
  commitSeriesDom();

  const seriesIndex = Number(target.dataset.seriesIndex);
  const startRow = Number(target.dataset.row);
  const startCol = Number(target.dataset.col);
  const matrix = parseDelimitedRows(text);
  if (matrix.length === 0) return;

  const headerMap = detectPointHeaderMap(matrix[0]!);
  if (headerMap) {
    matrix.slice(1).forEach((values, offset) => {
      const rowIndex = startRow + offset;
      ensurePointRow(seriesIndex, rowIndex);
      values.forEach((value, sourceCol) => {
        const targetKey = headerMap.get(sourceCol);
        if (!targetKey) return;
        seriesDrafts[seriesIndex]!.points[rowIndex]![targetKey] = value;
      });
    });
  } else {
    const editorPointColumns = getEditorPointColumns();
    matrix.forEach((values, rowOffset) => {
      const rowIndex = startRow + rowOffset;
      ensurePointRow(seriesIndex, rowIndex);
      values.forEach((value, colOffset) => {
        const colIndex = startCol + colOffset;
        const column = editorPointColumns[colIndex];
        if (!column) return;
        seriesDrafts[seriesIndex]!.points[rowIndex]![column.key] = value;
      });
    });
  }

  renderSeriesEditor();
  focusPointCell(seriesIndex, startRow, startCol);
  scheduleLocalSave();
  markChartDirty();
}

function handlePointTableKeydown(event: KeyboardEvent): void {
  const cell = event.currentTarget as HTMLTableCellElement;
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return;
  if (event.key !== 'Tab' && event.key !== 'Enter') return;

  event.preventDefault();
  const seriesIndex = Number(cell.dataset.seriesIndex);
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const nextRow = event.key === 'Enter' ? row + 1 : row;
  const nextCol = event.key === 'Tab' ? col + (event.shiftKey ? -1 : 1) : col;
  const boundedCol = Math.max(0, Math.min(getEditorPointColumns().length - 1, nextCol));
  ensurePointRow(seriesIndex, nextRow);
  renderSeriesEditor();
  focusPointCell(seriesIndex, nextRow, boundedCol);
  scheduleLocalSave();
}

function focusPointCell(seriesIndex: number, rowIndex: number, colIndex: number): void {
  const cell = seriesEditorEl.querySelector<HTMLTableCellElement>(
    `td[data-series-index="${seriesIndex}"][data-row="${rowIndex}"][data-col="${colIndex}"]`
  );
  const select = cell?.querySelector<HTMLSelectElement>('select[data-point-field]');
  (select ?? cell)?.focus();
}

function commitSeriesDom(): void {
  seriesEditorEl
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input[data-series-field], select[data-series-field], textarea[data-series-field]'
    )
    .forEach((input) => {
      const seriesIndex = Number(input.dataset.seriesIndex);
      const field = input.dataset.seriesField as SeriesField;
      const draft = seriesDrafts[seriesIndex];
      if (!draft) return;
      draft[field] = normalizeCellText(input.value);
    });

  seriesEditorEl.querySelectorAll<HTMLButtonElement>('button[data-line-style-option].selected').forEach((button) => {
    const seriesIndex = Number(button.dataset.seriesIndex);
    const draft = seriesDrafts[seriesIndex];
    if (!draft) return;
    const option = button.dataset.lineStyleOption ?? DEFAULT_LINE_STYLE;
    draft.lineStyle =
      option === CUSTOM_LINE_STYLE
        ? normalizeCellText(getLineStyleCustomInput(seriesIndex)?.value ?? '') || '8 4'
        : option;
  });

  seriesEditorEl.querySelectorAll<HTMLTableCellElement>('td[contenteditable="true"]').forEach((cell) => {
    const seriesIndex = Number(cell.dataset.seriesIndex);
    const row = Number(cell.dataset.row);
    const key = cell.dataset.key!;
    ensurePointRow(seriesIndex, row);
    const text = normalizeCellText(cell.textContent ?? '');
    // Keep the precise stored value when a two-decimal cell still shows its
    // formatted display (i.e. the user did not actually edit it).
    const stored = seriesDrafts[seriesIndex]!.points[row]![key];
    if (DECIMAL_DISPLAY_KEYS.has(key) && text === formatPointCellDisplay(key, stored)) return;
    seriesDrafts[seriesIndex]!.points[row]![key] = text;
  });

  seriesEditorEl.querySelectorAll<HTMLSelectElement>('select[data-point-field]').forEach((select) => {
    const seriesIndex = Number(select.dataset.seriesIndex);
    const row = Number(select.dataset.row);
    const key = select.dataset.key!;
    ensurePointRow(seriesIndex, row);
    seriesDrafts[seriesIndex]!.points[row]![key] = normalizeCellText(select.value);
  });
}

function renderLegend(): void {
  const previousListScrollTop = legendEl.querySelector<HTMLElement>('.legend-list')?.scrollTop ?? 0;
  const filteredSeries = getFilteredSeriesForChart();
  const colorSeries = getChartColorSourceSeries(filteredSeries);
  const prepared = prepareInferenceCurveSeries(
    filteredSeries,
    state.highContrast,
    state.theme,
    colorSeries,
    state.chartMetric,
    shouldEnforceEndToEndPareto(),
    undefined,
    'maximize',
    state.latencyPercentile,
    state.chartYMetric,
    getTcoHourlyCosts()
  );
  const query = state.search.trim().toLowerCase();
  const visibleItems = prepared.filter(
    (series) =>
      !query ||
      series.name.toLowerCase().includes(query) ||
      (series.title && series.title.toLowerCase().includes(query))
  );
  const activeCount = prepared.filter((series) => state.activeSeriesIds.has(series.id)).length;
  const precisionKey = renderPrecisionKey();

  legendEl.innerHTML = `
    <div class="legend-container">
      <div class="legend-search">
        <input id="legend-search" type="text" value="${escapeAttribute(state.search)}" placeholder="Search..." />
        ${state.search ? '<button id="legend-clear" type="button" aria-label="Clear search">×</button>' : ''}
      </div>
      <ul class="legend-list">
        ${visibleItems
          .map((series) => {
            const active = state.activeSeriesIds.has(series.id);
            return `
              <li class="${active ? '' : 'inactive'}">
                <label title="${escapeAttribute(series.title ?? series.name)}">
                  <input type="checkbox" data-series="${escapeAttribute(series.id)}" ${active ? 'checked' : ''} />
                  <svg class="legend-line" viewBox="0 0 34 12" aria-hidden="true">
                    <line
                      x1="2"
                      y1="6"
                      x2="32"
                      y2="6"
                      stroke="${escapeAttribute(series.color)}"
                      stroke-width="3"
                      stroke-linecap="round"
                      ${series.lineDasharray ? `stroke-dasharray="${escapeAttribute(series.lineDasharray)}"` : ''}
                    ></line>
                  </svg>
                  <span class="legend-text">${escapeHtml(series.name)}</span>
                </label>
                <span class="legend-row-actions">
                  <button class="legend-only" type="button" data-series-only="${escapeAttribute(series.id)}" title="Show only this line">
                    Only
                  </button>
                  <button
                    class="legend-locate"
                    type="button"
                    data-series-locate="${escapeAttribute(series.id)}"
                    title="Locate in data panel"
                    aria-label="Locate ${escapeAttribute(series.name)} in data panel"
                  >
                    ${renderIcon('target')}
                  </button>
                </span>
              </li>
            `;
          })
          .join('')}
      </ul>
      <div class="legend-bottom">
        ${
          precisionKey || activeCount < prepared.length
            ? `<div class="legend-line-toolbar">
                <div class="legend-line-toolbar-precision">${precisionKey}</div>
                <button
                  id="show-all-lines"
                  class="legend-line-action"
                  type="button"
                  ${activeCount < prepared.length ? '' : 'disabled aria-hidden="true" tabindex="-1"'}
                >
                  Show all lines
                </button>
              </div>`
            : ''
        }
        ${renderSwitch('logY', 'Log Scale', state.logY)}
        ${renderSwitch('showNonOptimalPoints', 'Optimal Only', !state.showNonOptimalPoints)}
        ${renderSwitch('mergeParallelism', 'Merge Parallelism', state.mergeParallelism,
          'Match the published InferenceX view: fold every parallelism config for the same hardware and framework into one curve, leaving TP/EP as point labels.')}
        ${renderSwitch('showGoalDirection', 'Better Direction', state.showGoalDirection)}
        ${
          state.scenarioFilter === AGENTIC_SCENARIO
            ? renderSwitch(
                'enforceEndToEndPareto',
                'E2E Pareto Gate',
                state.enforceEndToEndPareto,
                'Agentic only: restrict non-E2E Pareto curves to points that are also optimal on end-to-end latency. Turn off to compute each metric independently.'
              )
            : ''
        }
        ${renderSwitch('hidePointLabels', 'Hide Labels', state.hidePointLabels)}
        ${renderSwitch('highContrast', 'High Contrast', state.highContrast)}
        ${renderSwitch('showConcurrencyLabels', 'Only Concurrency Labels', state.showConcurrencyLabels)}
        ${renderSwitch('useAdvancedLabels', 'Parallelism Labels', state.useAdvancedLabels,
          'DCP: P = Prefill, D = Decode, ? = not provided. Disaggregated labels list Prefill then Decode.')}
        ${renderSwitch('showGradientLabels', 'Gradient Labels', state.showGradientLabels,
          'Color and label strategies including phase DCP: P = Prefill, D = Decode, ? = not provided.')}
        ${renderSwitch('showLineLabels', 'Line Labels', state.showLineLabels,
          'Name each curve on the plot. Drag a label to move it out of the way; a leader line keeps it tied to its curve. Double-click a label to put it back.')}
        ${renderSwitch('showOffloadRings', 'Offload Rings', state.showOffloadRings)}
      </div>
    </div>
  `;

  legendEl.querySelector('#legend-search')?.addEventListener('input', (event) => {
    state.search = (event.currentTarget as HTMLInputElement).value;
    renderLegend();
    scheduleLocalSave();
  });
  legendEl.querySelector('#legend-clear')?.addEventListener('click', () => {
    state.search = '';
    renderLegend();
    scheduleLocalSave();
  });
  legendEl.querySelectorAll<HTMLInputElement>('input[data-series]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.series!;
      if (input.checked) {
        state.activeSeriesIds.add(id);
      } else if (state.activeSeriesIds.size > 1) {
        state.activeSeriesIds.delete(id);
      } else {
        input.checked = true;
      }
      saveActiveSeriesForCurrentView();
      renderAll();
      scheduleLocalSave();
    });
  });
  legendEl.querySelectorAll<HTMLButtonElement>('button[data-series-only]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.seriesOnly;
      if (!id) return;
      state.activeSeriesIds = new Set([id]);
      saveActiveSeriesForCurrentView();
      renderAll();
      scheduleLocalSave();
    });
  });
  legendEl.querySelectorAll<HTMLButtonElement>('button[data-series-locate]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.seriesLocate;
      if (!id) return;
      locateSeriesInEditor(id);
    });
  });
  legendEl.querySelectorAll<HTMLInputElement>('input[data-switch]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.switch as keyof AppState;
      if (key === 'showNonOptimalPoints') {
        state.showNonOptimalPoints = !input.checked;
      } else if (key === 'mergeParallelism') {
        const previouslyActive = getFilteredSeriesForChart().filter((line) =>
          state.activeSeriesIds.has(line.id)
        );
        saveActiveSeriesForCurrentView();
        state.mergeParallelism = input.checked;
        carryActiveSeriesAcrossGrouping(previouslyActive);
      } else if (key === 'showConcurrencyLabels') {
        state.showConcurrencyLabels = input.checked;
        if (input.checked) {
          state.hidePointLabels = false;
          state.useAdvancedLabels = false;
        }
      } else if (key === 'useAdvancedLabels') {
        state.useAdvancedLabels = input.checked;
        if (input.checked) {
          state.hidePointLabels = false;
          state.showConcurrencyLabels = false;
        }
      } else if (typeof state[key] === 'boolean') {
        (state[key] as boolean) = input.checked;
      }
      renderAll();
      scheduleLocalSave();
    });
  });
  legendEl.querySelectorAll<HTMLInputElement>('input[data-precision]').forEach((input) => {
    input.addEventListener('change', () => {
      saveActiveSeriesForCurrentView();
      const precision = input.dataset.precision!;
      if (input.checked) {
        state.selectedPrecisions.add(precision);
      } else if (state.selectedPrecisions.size > 1) {
        state.selectedPrecisions.delete(precision);
      } else {
        input.checked = true;
      }
      restoreActiveSeriesForCurrentView();
      renderFilterControls();
      renderSeriesEditor();
      renderAll();
      clearMergePreview();
      scheduleLocalSave();
    });
  });
  legendEl.querySelector('#show-all-lines')?.addEventListener('click', () => {
    const nextSeries = getFilteredSeriesForChart();
    state.activeSeriesIds = new Set(nextSeries.map((series) => series.id));
    saveActiveSeriesForCurrentView();
    renderAll();
    scheduleLocalSave();
  });

  const nextList = legendEl.querySelector<HTMLElement>('.legend-list');
  if (nextList) nextList.scrollTop = previousListScrollTop;
}

function locateSeriesInEditor(seriesId: string): void {
  const card = Array.from(seriesEditorEl.querySelectorAll<HTMLElement>('[data-series-card]')).find(
    (element) => element.dataset.seriesId === seriesId
  );
  if (!card) {
    setStatus('Line is not visible in the current data panel.', true);
    return;
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('located');
  void card.offsetWidth;
  card.classList.add('located');
  const focusTarget = card.querySelector<HTMLElement>('[data-series-drag-handle]');
  focusTarget?.focus({ preventScroll: true });
  window.setTimeout(() => {
    card.classList.remove('located');
  }, 1800);
}

function renderSwitch(key: string, label: string, checked: boolean, title = ''): string {
  return `
    <label class="legend-switch"${title ? ` title="${escapeAttribute(title)}"` : ''}>
      <input type="checkbox" data-switch="${key}" ${checked ? 'checked' : ''} />
      <span class="switch-track"></span>
      <span>${label}</span>
    </label>
  `;
}

function renderPrecisionKey(): string {
  const precisions = getAvailablePrecisions(getModelSequenceMtpFilteredSeries());
  if (precisions.length < 2) return '';
  const shapes = ['●', '■', '▲', '◆'];
  return `
    <div class="precision-key">
      ${precisions
        .slice(0, shapes.length)
        .map((precision, index) => {
          const selected = state.selectedPrecisions.has(precision);
          return `
            <label class="${selected ? '' : 'inactive'}">
              <input type="checkbox" data-precision="${escapeAttribute(precision)}" ${selected ? 'checked' : ''} />
              <b>${shapes[index]}</b>
              <span>${escapeHtml(precision.toUpperCase())}</span>
            </label>
          `;
        })
        .join('')}
    </div>
  `;
}

function getFilteredDraftEntries(): { draft: SeriesDraft; index: number }[] {
  return getSortedDraftEntries()
    .filter(({ draft }) => {
      const modelMatches =
        state.modelFilter === ALL_VALUE || getDraftModel(draft) === state.modelFilter;
      const islOslMatches =
        state.islOslFilter === ALL_VALUE || getDraftIslOsl(draft) === state.islOslFilter;
      const precisionMatches =
        state.selectedPrecisions.size === 0 || state.selectedPrecisions.has(getDraftPrecision(draft));
      const mtpMatches =
        isAgenticTraceSequence(draft.islOsl) || state.mtpFilter === ALL_VALUE || getDraftMtpFilter(draft) === state.mtpFilter;
      return modelMatches && islOslMatches && precisionMatches && mtpMatches;
    });
}

function getSortedDraftEntries(): { draft: SeriesDraft; index: number }[] {
  return seriesDrafts
    .map((draft, index) => ({ draft, index }))
    .sort(
      (a, b) =>
        getDraftRenderOrder(b.draft, b.index) - getDraftRenderOrder(a.draft, a.index) ||
        a.index - b.index
    );
}

function sortSeriesDraftsByLayer(): void {
  seriesDrafts = getSortedDraftEntries().map(({ draft }) => draft);
}

function normalizeDraftRenderOrderFromPanelOrder(): void {
  const topOrder = Math.max(0, seriesDrafts.length - 1);
  seriesDrafts.forEach((draft, index) => {
    draft.renderOrder = topOrder - index;
  });
}

function moveSeriesDraftInPanelOrder(
  sourceIndex: number,
  targetIndex: number,
  position: 'before' | 'after'
): boolean {
  if (sourceIndex === targetIndex) return false;
  const entries = getSortedDraftEntries();
  const sourcePosition = entries.findIndex((entry) => entry.index === sourceIndex);
  const targetPosition = entries.findIndex((entry) => entry.index === targetIndex);
  if (sourcePosition < 0 || targetPosition < 0) return false;

  const [source] = entries.splice(sourcePosition, 1);
  if (!source) return false;
  let insertPosition = targetPosition;
  if (sourcePosition < targetPosition) insertPosition -= 1;
  if (position === 'after') insertPosition += 1;
  entries.splice(Math.max(0, Math.min(entries.length, insertPosition)), 0, source);

  seriesDrafts = entries.map((entry) => entry.draft);
  normalizeDraftRenderOrderFromPanelOrder();
  return true;
}

function getDraftRenderOrder(draft: SeriesDraft, fallback: number): number {
  return typeof draft.renderOrder === 'number' && Number.isFinite(draft.renderOrder)
    ? draft.renderOrder
    : fallback;
}

function getDraftLayerLabel(draft: SeriesDraft, fallback: number): string {
  return String(Math.max(1, Math.round(getDraftRenderOrder(draft, fallback) + 1)));
}

function getNextDraftRenderOrder(): number {
  const orders = seriesDrafts.map((draft, index) => getDraftRenderOrder(draft, index));
  return orders.length > 0 ? Math.max(...orders) + 1 : 0;
}

function placeDraftsOnTop(drafts: SeriesDraft[]): void {
  const start = getNextDraftRenderOrder();
  drafts.forEach((draft, index) => {
    draft.renderOrder = start + drafts.length - index - 1;
  });
}

function syncCurrentSeriesOrderFromDrafts(): void {
  const seriesById = new Map(currentSeries.map((line) => [line.id, line]));
  const used = new Set<string>();
  const ordered: InferenceCurveSeries[] = [];
  seriesDrafts.forEach((draft, index) => {
    const id = draft.id.trim() || `line-${index + 1}`;
    const line = seriesById.get(id);
    if (!line) return;
    used.add(id);
    ordered.push({ ...line, renderOrder: getDraftRenderOrder(draft, index) });
  });
  const rest = currentSeries.filter((line) => !used.has(line.id));
  currentSeries = [...ordered, ...rest];
}

function getLineStyleSelectValue(lineStyle: string): string {
  const normalized = normalizeLineStyleValue(lineStyle);
  return lineStyleOptions.some((option) => option.value === normalized) ? normalized : CUSTOM_LINE_STYLE;
}

function normalizeLineStyleValue(lineStyle: string): string {
  return lineStyle.trim().toLowerCase().replace(/[_\s]+/gu, '-');
}

function draftsToPreviewSeries(drafts: SeriesDraft[]): InferenceCurveSeries[] {
  return drafts.map((draft, index) => {
    const line: InferenceCurveSeries = {
      id: getDraftSeriesId(draft, index),
      name: draft.name.trim() || `Line ${index + 1}`,
      hwKey: draft.hwKey,
      model: draft.model.trim() || getDefaultDraftModel(),
      islOsl: draft.islOsl.trim() || getDefaultDraftIslOsl(),
      precision: draft.precision.trim() || getDefaultDraftPrecision(),
      mtp: isAgenticTraceSequence(draft.islOsl) ? undefined : getDraftMtpFilter(draft),
      marker: normalizePointShapeValue(draft.marker),
      renderOrder: getDraftRenderOrder(draft, index),
      points: []
    };
    if (draft.title.trim()) line.title = draft.title.trim();
    if (draft.color.trim()) line.color = draft.color.trim();
    if (draft.lineStyle.trim()) line.lineStyle = draft.lineStyle.trim();
    return line;
  });
}

function getDraftSeriesId(draft: SeriesDraft, index: number): string {
  return draft.id.trim() || `line-${index + 1}`;
}

function getEditorResolvedColor(seriesIndex: number): string {
  const draft = seriesDrafts[seriesIndex];
  if (!draft) return colorInputFallbacks[seriesIndex % colorInputFallbacks.length]!;

  const previewColors = resolveInferenceCurveColors(draftsToPreviewSeries(seriesDrafts), state.highContrast, state.theme);
  return (
    previewColors.get(getDraftSeriesId(draft, seriesIndex)) ??
    colorInputFallbacks[seriesIndex % colorInputFallbacks.length]!
  );
}

function seriesToDrafts(series: InferenceCurveSeries[]): SeriesDraft[] {
  const drafts = series.map((line, index) => ({
    id: line.id,
    name: line.name,
    hwKey: line.hwKey,
    model: getSeriesModel(line),
    islOsl: getSeriesIslOsl(line),
    precision: getSeriesPrecision(line),
    mtp: isAgenticTraceSequence(getSeriesIslOsl(line)) && !line.mtp ? '' : getSeriesMtpFilter(line),
    marker: normalizePointShapeValue(String(line.marker ?? '')),
    title: line.title ?? '',
    note: line.note ?? '',
    color: line.color ?? '',
    lineStyle: line.lineStyle ?? DEFAULT_LINE_STYLE,
    renderOrder: getSeriesRenderOrder(line, index),
    collapsed: true,
    points: line.points.map((point) => {
      const labelMetadata = parsePointMetadataLabel(point.label);
      const strategyMetadata = parsePointStrategy(point.strategy);
      const dcp = getInferenceCurvePointDcp(point);
      const row: PointRow = {
        interactivity: formatPointFieldValue(point.interactivity),
        throughput: String(point.throughput),
        ttft: formatPointFieldValue(point.ttft),
        endToEnd: formatPointFieldValue(point.endToEnd),
        shape: normalizePointShapeValue(formatPointFieldValue(point.shape)),
        strategy: point.strategy ?? '',
        tp: formatPointFieldValue(point.tp),
        num_prefill_gpu: formatPointFieldValue(point.num_prefill_gpu ?? labelMetadata.num_prefill_gpu),
        num_decode_gpu: formatPointFieldValue(point.num_decode_gpu ?? labelMetadata.num_decode_gpu),
        prefill_tp: formatPointFieldValue(point.prefill_tp ?? labelMetadata.prefill_tp),
        prefill_ep: formatPointFieldValue(point.prefill_ep ?? labelMetadata.prefill_ep),
        prefill_dcp_size: formatPointFieldValue(dcp.prefill),
        prefill_dp_attention: formatPointFieldValue(
          point.prefill_dp_attention ?? point.dp_attention ?? labelMetadata.prefill_dp_attention
        ),
        decode_tp: formatPointFieldValue(point.decode_tp ?? strategyMetadata.decode_tp),
        decode_ep: formatPointFieldValue(point.decode_ep ?? strategyMetadata.decode_ep),
        decode_dcp_size: formatPointFieldValue(dcp.decode),
        decode_dp_attention: formatPointFieldValue(
          point.decode_dp_attention ?? point.dp_attention ?? labelMetadata.decode_dp_attention
        ),
        dp_attention: formatPointFieldValue(point.dp_attention),
        prefill_num_workers: formatPointFieldValue(point.prefill_num_workers),
        decode_num_workers: formatPointFieldValue(point.decode_num_workers),
        disagg: formatPointFieldValue(point.disagg),
        is_multinode: formatPointFieldValue(point.is_multinode),
        kv_offload: formatPointFieldValue(point.kv_offload),
        spec_decoding: formatPointFieldValue(point.spec_decoding ?? (
          isAgenticTraceSequence(getSeriesIslOsl(line)) && line.mtp
            ? getSeriesMtpFilter(line) === MTP_VALUE ? 'mtp' : 'none'
            : undefined
        )),
        server_gpu_cache_hit_rate: formatPointFieldValue(point.server_gpu_cache_hit_rate),
        server_external_cache_hit_rate: formatPointFieldValue(
          point.server_external_cache_hit_rate
        ),
        server_cpu_cache_hit_rate: formatPointFieldValue(point.server_cpu_cache_hit_rate),
        theoretical_cache_hit_rate: formatPointFieldValue(
          point.theoretical_cache_hit_rate
        ),
        concurrency: formatPointFieldValue(point.concurrency),
        label: point.label ?? ''
      };
      writePercentilesToDraftRow(
        row,
        'interactivity',
        point.interactivityPercentiles,
        isAgenticTraceSequence(getSeriesIslOsl(line)) ? point.interactivity : undefined
      );
      writePercentilesToDraftRow(
        row,
        'ttft',
        point.ttftPercentiles,
        isAgenticTraceSequence(getSeriesIslOsl(line)) ? point.ttft : undefined
      );
      writePercentilesToDraftRow(
        row,
        'endToEnd',
        point.endToEndPercentiles,
        isAgenticTraceSequence(getSeriesIslOsl(line)) ? point.endToEnd : undefined
      );
      writeE2ENormalizedInteractivityToDraftRow(
        row,
        point.e2eNormalizedInteractivityPercentiles
      );
      return row;
    })
  }));
  return drafts.length ? drafts : [makeEmptySeriesDraft(0)];
}

function writePercentilesToDraftRow(
  row: PointRow,
  metric: LatencyMetricKey,
  percentiles: InferenceCurveLatencyPercentiles | undefined,
  legacyP90Value: unknown
): void {
  LATENCY_PERCENTILES.forEach((percentile) => {
    const value = percentiles?.[percentile] ??
      (percentiles === undefined && percentile === 'p90' ? legacyP90Value : undefined);
    row[latencyMetricColumns[metric].rowKeys[percentile]] = formatPointFieldValue(value);
  });
}

function readPercentilesFromDraftRow(
  row: PointRow,
  metric: LatencyMetricKey
): InferenceCurveLatencyPercentiles | undefined {
  const percentiles: InferenceCurveLatencyPercentiles = {};
  LATENCY_PERCENTILES.forEach((percentile) => {
    const value = parseNumber(row[latencyMetricColumns[metric].rowKeys[percentile]]);
    if (value !== null) percentiles[percentile] = value;
  });
  return Object.keys(percentiles).length > 0 ? percentiles : undefined;
}

function writeE2ENormalizedInteractivityToDraftRow(
  row: PointRow,
  percentiles: InferenceCurveE2ENormalizedInteractivityPercentiles | undefined
): void {
  E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
    row[e2eNormalizedInteractivityRowKeys[percentile]] = formatPointFieldValue(
      percentiles?.[percentile]
    );
  });
}

function readE2ENormalizedInteractivityFromDraftRow(
  row: PointRow
): InferenceCurveE2ENormalizedInteractivityPercentiles | undefined {
  const percentiles: InferenceCurveE2ENormalizedInteractivityPercentiles = {};
  E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
    const value = parseNumber(row[e2eNormalizedInteractivityRowKeys[percentile]]);
    if (value !== null) percentiles[percentile] = value;
  });
  return Object.keys(percentiles).length > 0 ? percentiles : undefined;
}

function draftsToSeries(drafts: SeriesDraft[]): InferenceCurveSeries[] {
  const result = draftsToSeriesInternal(drafts);
  if (result.length === 0) throw new Error('No valid line data.');
  return result;
}

function draftsToSeriesAllowEmpty(drafts: SeriesDraft[]): InferenceCurveSeries[] {
  return draftsToSeriesInternal(drafts);
}

function draftsToSeriesInternal(drafts: SeriesDraft[]): InferenceCurveSeries[] {
  const result: InferenceCurveSeries[] = [];
  drafts.forEach((draft, seriesIndex) => {
    const isAgentic = isAgenticTraceSequence(draft.islOsl);
    const points = draft.points
      .map((row, pointIndex) => {
        if (isEmptyPointRow(row)) return null;
        const interactivityPercentiles = isAgentic
          ? readPercentilesFromDraftRow(row, 'interactivity')
          : undefined;
        const ttftPercentiles = isAgentic ? readPercentilesFromDraftRow(row, 'ttft') : undefined;
        const endToEndPercentiles = isAgentic
          ? readPercentilesFromDraftRow(row, 'endToEnd')
          : undefined;
        const e2eNormalizedInteractivityPercentiles = isAgentic
          ? readE2ENormalizedInteractivityFromDraftRow(row)
          : undefined;
        const interactivity = interactivityPercentiles?.p90 ?? parseNumber(row.interactivity);
        const throughput = parseNumber(row.throughput);
        const ttft = ttftPercentiles?.p90 ?? parseNumber(row.ttft);
        const endToEnd = endToEndPercentiles?.p90 ?? parseNumber(row.endToEnd);
        const hasXMetric =
          interactivity !== null ||
          ttft !== null ||
          endToEnd !== null ||
          interactivityPercentiles !== undefined ||
          ttftPercentiles !== undefined ||
          endToEndPercentiles !== undefined ||
          e2eNormalizedInteractivityPercentiles !== undefined;
        if (throughput === null || !hasXMetric) {
          throw new Error(
            `Line ${seriesIndex + 1}, row ${pointIndex + 1}: Throughput/GPU and at least one X-axis metric must be numbers.`
          );
        }
        const point: InferenceCurveSeries['points'][number] = {
          throughput,
          precision: draft.precision.trim() || undefined,
          strategy: (row.strategy ?? '').trim() || undefined,
          tp: parseNumber(row.tp) ?? undefined,
          concurrency: parseNumber(row.concurrency) ?? undefined,
          label: row.label.trim() || undefined
        };
        if (interactivity !== null) point.interactivity = interactivity;
        if (interactivityPercentiles) point.interactivityPercentiles = interactivityPercentiles;
        const pointShape = normalizePointShapeValue(row.shape);
        if (pointShape) point.shape = pointShape;
        const numPrefillGpu = parseNumber(row.num_prefill_gpu);
        const numDecodeGpu = parseNumber(row.num_decode_gpu);
        const prefillTp = parseNumber(row.prefill_tp);
        const prefillEp = parseNumber(row.prefill_ep);
        const prefillDcp = parseNumber(row.prefill_dcp_size);
        const prefillDpAttention = parseBoolean(row.prefill_dp_attention) ?? parseBoolean(row.dp_attention);
        const decodeTp = parseNumber(row.decode_tp);
        const decodeEp = parseNumber(row.decode_ep);
        const decodeDcp = parseNumber(row.decode_dcp_size);
        const decodeDpAttention = parseBoolean(row.decode_dp_attention) ?? parseBoolean(row.dp_attention);
        const prefillNumWorkers = parseNumber(row.prefill_num_workers);
        const decodeNumWorkers = parseNumber(row.decode_num_workers);
        const disagg = parseBoolean(row.disagg);
        const isMultinode = parseBoolean(row.is_multinode);
        const kvOffload = (row.kv_offload ?? '').trim();
        const serverGpuCacheHitRate = parseNumber(row.server_gpu_cache_hit_rate);
        const serverExternalCacheHitRate = parseNumber(row.server_external_cache_hit_rate);
        const serverCpuCacheHitRate = parseNumber(row.server_cpu_cache_hit_rate);
        const theoreticalCacheHitRate = parseNumber(row.theoretical_cache_hit_rate);
        if (ttft !== null) point.ttft = ttft;
        if (ttftPercentiles) point.ttftPercentiles = ttftPercentiles;
        if (endToEnd !== null) point.endToEnd = endToEnd;
        if (endToEndPercentiles) point.endToEndPercentiles = endToEndPercentiles;
        if (e2eNormalizedInteractivityPercentiles) {
          point.e2eNormalizedInteractivityPercentiles =
            e2eNormalizedInteractivityPercentiles;
        }
        if (numPrefillGpu !== null) point.num_prefill_gpu = numPrefillGpu;
        if (numDecodeGpu !== null) point.num_decode_gpu = numDecodeGpu;
        if (prefillTp !== null) point.prefill_tp = prefillTp;
        if (prefillEp !== null) point.prefill_ep = prefillEp;
        if (prefillDcp !== null) point.prefill_dcp_size = prefillDcp;
        if (prefillDpAttention !== null) point.prefill_dp_attention = prefillDpAttention;
        if (decodeTp !== null) point.decode_tp = decodeTp;
        if (decodeEp !== null) point.decode_ep = decodeEp;
        if (decodeDcp !== null) point.decode_dcp_size = decodeDcp;
        if (decodeDpAttention !== null) point.decode_dp_attention = decodeDpAttention;
        if (prefillNumWorkers !== null) point.prefill_num_workers = prefillNumWorkers;
        if (decodeNumWorkers !== null) point.decode_num_workers = decodeNumWorkers;
        if (
          prefillDpAttention !== null &&
          decodeDpAttention !== null &&
          prefillDpAttention === decodeDpAttention
        ) {
          point.dp_attention = prefillDpAttention;
        }
        if (disagg !== null) point.disagg = disagg;
        if (isMultinode !== null) point.is_multinode = isMultinode;
        if (kvOffload) point.kv_offload = kvOffload;
        if (row.spec_decoding?.trim()) point.spec_decoding = row.spec_decoding.trim();
        if (serverGpuCacheHitRate !== null) {
          point.server_gpu_cache_hit_rate = serverGpuCacheHitRate;
        }
        if (serverExternalCacheHitRate !== null) {
          point.server_external_cache_hit_rate = serverExternalCacheHitRate;
        }
        if (serverCpuCacheHitRate !== null) {
          point.server_cpu_cache_hit_rate = serverCpuCacheHitRate;
        }
        if (theoreticalCacheHitRate !== null) {
          point.theoretical_cache_hit_rate = theoreticalCacheHitRate;
        }
        point.tp =
          getInferenceCurvePointGpuCount(point) ?? parseNumber(row.tp) ?? decodeTp ?? undefined;
        point.strategy =
          (row.strategy ?? '').trim() || makeStrategyLabel(decodeTp, decodeEp, decodeDcp);
        return point;
      })
      .filter((point): point is NonNullable<typeof point> => point !== null);

    if (points.length === 0) return;

    const lineId = draft.id.trim();
    const lineName = draft.name.trim();
    const model = draft.model.trim() ? getInferenceXDisplayModel(draft.model) : '';
    const islOsl = draft.islOsl.trim();
    const precision = draft.precision.trim();
    if (!lineId || !lineName) {
      throw new Error(`Line ${seriesIndex + 1}: Line ID and Name are required.`);
    }
    if (!model || !islOsl || !precision) {
      throw new Error(`Line ${seriesIndex + 1}: Model, Scenario, and Precision are required.`);
    }

    const line: InferenceCurveSeries = {
      id: lineId,
      name: lineName,
      hwKey: draft.hwKey,
      model,
      islOsl,
      precision,
      mtp: isAgentic ? undefined : getDraftMtpFilter(draft),
      marker: normalizePointShapeValue(draft.marker),
      renderOrder: getDraftRenderOrder(draft, seriesIndex),
      points
    };
    if (draft.color.trim()) line.color = draft.color.trim();
    if (draft.lineStyle.trim()) line.lineStyle = draft.lineStyle.trim();
    if (draft.title.trim()) line.title = draft.title.trim();
    if (draft.note.trim()) line.note = draft.note.trim();
    result.push(line);
  });

  return result;
}

function parseDelimitedRows(text: string): string[][] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => line.split('\t').map((cell) => normalizeCellText(cell)));
}

function detectPointHeaderMap(headerRow: string[]): Map<number, string> | null {
  const aliases = new Map<string, string>([
    ['interactivity', 'interactivity'],
    ['interactivity (tok/s/user)', 'interactivity'],
    ['p90 interactivity', 'interactivity'],
    ['p90 interactivity (tok/s/user)', 'interactivity'],
    ['median_intvty', 'interactivity'],
    ['median_interactivity', 'interactivity'],
    ['metrics.median_intvty', 'interactivity'],
    ['metrics.median_interactivity', 'interactivity'],
    ['p90_intvty', 'interactivity'],
    ['p90_interactivity', 'interactivity'],
    ['metrics.p90_intvty', 'interactivity'],
    ['metrics.p90_interactivity', 'interactivity'],
    ['tok/s/user', 'interactivity'],
    ['x', 'interactivity'],
    ['交互性', 'interactivity'],
    ['throughput', 'throughput'],
    ['throughput/gpu', 'throughput'],
    ['throughput per gpu', 'throughput'],
    ['token throughput per gpu', 'throughput'],
    ['token throughput per gpu (tok/s/gpu)', 'throughput'],
    ['tok/s/gpu', 'throughput'],
    ['y', 'throughput'],
    ['吞吐量', 'throughput'],
    ['gpu吞吐量', 'throughput'],
    ['ttft', 'ttft'],
    ['ttft (s)', 'ttft'],
    ['time to first token', 'ttft'],
    ['time to first token (s)', 'ttft'],
    ['p90 ttft', 'ttft'],
    ['p90 ttft (s)', 'ttft'],
    ['p90 time to first token', 'ttft'],
    ['p90 time to first token (s)', 'ttft'],
    ['median_ttft', 'ttft'],
    ['p90_ttft', 'ttft'],
    ['metrics.median_ttft', 'ttft'],
    ['metrics.p90_ttft', 'ttft'],
    ['end-to-end', 'endToEnd'],
    ['end-to-end (s)', 'endToEnd'],
    ['end-to-end latency', 'endToEnd'],
    ['end-to-end latency (s)', 'endToEnd'],
    ['endtoend', 'endToEnd'],
    ['end_to_end', 'endToEnd'],
    ['median_e2el', 'endToEnd'],
    ['p90_e2el', 'endToEnd'],
    ['p90_end_to_end', 'endToEnd'],
    ['metrics.median_e2el', 'endToEnd'],
    ['metrics.p90_e2el', 'endToEnd'],
    ['metrics.p90_end_to_end', 'endToEnd'],
    ['e2e', 'endToEnd'],
    ['e2e latency', 'endToEnd'],
    ['e2e latency (s)', 'endToEnd'],
    ['e2el', 'endToEnd'],
    ['p90 end-to-end latency', 'endToEnd'],
    ['p90 end-to-end latency (s)', 'endToEnd'],
    ['marker', 'shape'],
    ['point marker', 'shape'],
    ['point shape', 'shape'],
    ['shape', 'shape'],
    ['形状', 'shape'],
    ['点形状', 'shape'],
    ['precision', 'precision'],
    ['精度', 'precision'],
    ['strategy', 'strategy'],
    ['parallelism', 'strategy'],
    ['策略', 'strategy'],
    ['tp', 'tp'],
    ['prefill gpus', 'num_prefill_gpu'],
    ['prefill gpu', 'num_prefill_gpu'],
    ['prefill_gpus', 'num_prefill_gpu'],
    ['num_prefill_gpu', 'num_prefill_gpu'],
    ['num prefill gpu', 'num_prefill_gpu'],
    ['预填充gpu', 'num_prefill_gpu'],
    ['decode gpus', 'num_decode_gpu'],
    ['decode gpu', 'num_decode_gpu'],
    ['decode_gpus', 'num_decode_gpu'],
    ['num_decode_gpu', 'num_decode_gpu'],
    ['num decode gpu', 'num_decode_gpu'],
    ['解码gpu', 'num_decode_gpu'],
    ['prefill tp', 'prefill_tp'],
    ['prefill_tp', 'prefill_tp'],
    ['预填充tp', 'prefill_tp'],
    ['prefill ep', 'prefill_ep'],
    ['prefill_ep', 'prefill_ep'],
    ['预填充ep', 'prefill_ep'],
    ['prefill dcp', 'prefill_dcp_size'],
    ['prefill_dcp_size', 'prefill_dcp_size'],
    ['预填充dcp', 'prefill_dcp_size'],
    ['decode tp', 'decode_tp'],
    ['decode_tp', 'decode_tp'],
    ['解码tp', 'decode_tp'],
    ['decode ep', 'decode_ep'],
    ['decode_ep', 'decode_ep'],
    ['解码ep', 'decode_ep'],
    ['decode dcp', 'decode_dcp_size'],
    ['decode_dcp_size', 'decode_dcp_size'],
    ['dcp', 'decode_dcp_size'],
    ['dcp_size', 'decode_dcp_size'],
    ['解码dcp', 'decode_dcp_size'],
    ['prefill dpa', 'prefill_dp_attention'],
    ['prefill dp attention', 'prefill_dp_attention'],
    ['prefill_dp_attention', 'prefill_dp_attention'],
    ['prefill dpa attention', 'prefill_dp_attention'],
    ['预填充dpa', 'prefill_dp_attention'],
    ['decode dpa', 'decode_dp_attention'],
    ['decode dp attention', 'decode_dp_attention'],
    ['decode_dp_attention', 'decode_dp_attention'],
    ['decode dpa attention', 'decode_dp_attention'],
    ['解码dpa', 'decode_dp_attention'],
    ['dpa', 'dp_attention'],
    ['dp attention', 'dp_attention'],
    ['dp_attention', 'dp_attention'],
    ['prefill workers', 'prefill_num_workers'],
    ['prefill worker', 'prefill_num_workers'],
    ['prefill_num_workers', 'prefill_num_workers'],
    ['decode workers', 'decode_num_workers'],
    ['decode worker', 'decode_num_workers'],
    ['decode_num_workers', 'decode_num_workers'],
    ['disagg', 'disagg'],
    ['disaggregated', 'disagg'],
    ['multi-node', 'is_multinode'],
    ['multi node', 'is_multinode'],
    ['multinode', 'is_multinode'],
    ['is_multinode', 'is_multinode'],
    ['multi_node', 'is_multinode'],
    ['kv offload', 'kv_offload'],
    ['kv_offload', 'kv_offload'],
    ['kv offloading', 'kv_offload'],
    ['kv_offloading', 'kv_offload'],
    ['offload', 'kv_offload'],
    ['offload mode', 'kv_offload'],
    ['offload_mode', 'kv_offload'],
    ['chip cache hit rate', 'server_gpu_cache_hit_rate'],
    ['gpu cache hit rate', 'server_gpu_cache_hit_rate'],
    ['server_gpu_cache_hit_rate', 'server_gpu_cache_hit_rate'],
    ['external cache hit rate', 'server_external_cache_hit_rate'],
    ['server_external_cache_hit_rate', 'server_external_cache_hit_rate'],
    ['cpu cache hit rate', 'server_cpu_cache_hit_rate'],
    ['server_cpu_cache_hit_rate', 'server_cpu_cache_hit_rate'],
    ['theoretical cache hit rate', 'theoretical_cache_hit_rate'],
    ['theoretical_cache_hit_rate', 'theoretical_cache_hit_rate'],
    ['concurrency', 'concurrency'],
    ['conc', 'concurrency'],
    ['并发', 'concurrency'],
    ['note', 'label'],
    ['label', 'label'],
    ['备注', 'label']
  ]);

  (Object.keys(latencyMetricColumns) as LatencyMetricKey[]).forEach((metric) => {
    LATENCY_PERCENTILES.forEach((percentile) => {
      const rowKey = latencyMetricColumns[metric].rowKeys[percentile];
      getLatencyPercentileImportAliases(metric, percentile).forEach((alias) => {
        aliases.set(normalizeHeaderName(alias), rowKey);
      });
    });
  });
  E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
    const rowKey = e2eNormalizedInteractivityRowKeys[percentile];
    getE2ENormalizedInteractivityImportAliases(percentile).forEach((alias) => {
      aliases.set(normalizeHeaderName(alias), rowKey);
    });
  });

  const map = new Map<number, string>();
  headerRow.forEach((value, sourceIndex) => {
    const normalized = normalizeHeaderName(value);
    const key = aliases.get(normalized);
    if (key && knownPointKeys.has(key)) map.set(sourceIndex, key);
  });
  return map.size > 0 ? map : null;
}

function normalizeHeaderName(value: string): string {
  return value.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function makeEmptySeriesDraft(index: number): SeriesDraft {
  return {
    id: `line-${index + 1}`,
    name: `Line ${index + 1}`,
    model: getDefaultDraftModel(),
    islOsl: getDefaultDraftIslOsl(),
    precision: getDefaultDraftPrecision(),
    mtp: NON_MTP_VALUE,
    marker: '',
    title: '',
    note: '',
    color: '',
    lineStyle: DEFAULT_LINE_STYLE,
    renderOrder: index,
    collapsed: true,
    points: [makeEmptyPointRow()]
  };
}

function copySeriesDraft(source: SeriesDraft): SeriesDraft {
  const copy = structuredClone(source);
  copy.id = makeUniqueLineId(`${source.id.trim() || 'line'}-copy`);
  copy.name = `${source.name.trim() || 'Line'} Copy`;
  copy.renderOrder = getNextDraftRenderOrder();
  copy.collapsed = true;
  return copy;
}

function splitSeriesDraftByPointConfig(source: SeriesDraft): SeriesDraft[] {
  const pointGroups = new Map<string, PointRow[]>();
  source.points
    .filter((row) => !isEmptyPointRow(row))
    .forEach((row) => {
      const key = getPointConfigSplitKey(row);
      const group = pointGroups.get(key) ?? [];
      group.push(structuredClone(row));
      pointGroups.set(key, group);
    });

  const baseId = source.id.trim() || 'line';
  const baseName = source.name.trim() || 'Line';
  return Array.from(pointGroups.values()).map((points, index) => {
    const splitDraft = structuredClone(source);
    splitDraft.id = makeUniqueLineId(`${baseId}-${index + 1}`);
    splitDraft.name = `${baseName} ${index + 1}`;
    splitDraft.collapsed = true;
    splitDraft.points = points.sort(comparePointRowsForMerge);
    return splitDraft;
  });
}

function getPointConfigSplitKey(row: PointRow): string {
  return JSON.stringify(
    pointConfigSplitKeys.map((key) => [key, normalizePointConfigSplitValue(key, row[key])])
  );
}

function normalizePointConfigSplitValue(key: string, value: string | undefined): string {
  if (key === 'prefill_dp_attention' || key === 'decode_dp_attention' || key === 'dp_attention') {
    const parsedBoolean = parseBoolean(value);
    if (parsedBoolean !== null) return String(parsedBoolean);
  }

  if (key !== 'strategy') {
    const parsedNumber = parseNumber(value);
    if (parsedNumber !== null) return String(parsedNumber);
  }

  return normalizeMergeKeyPart(value ?? '');
}

function makeUniqueLineId(baseId: string): string {
  const normalizedBase = baseId.trim() || 'line-copy';
  const existing = new Set(seriesDrafts.map((draft) => draft.id.trim()).filter(Boolean));
  if (!existing.has(normalizedBase)) return normalizedBase;

  let index = 2;
  let nextId = `${normalizedBase}-${index}`;
  while (existing.has(nextId)) {
    index += 1;
    nextId = `${normalizedBase}-${index}`;
  }
  return nextId;
}

function makeEmptyPointRow(): PointRow {
  return Object.fromEntries([
    ...pointColumns.map((column) => [column.key, '']),
    ...latencyPercentilePointKeys.map((key) => [key, '']),
    ...e2eNormalizedInteractivityPointKeys.map((key) => [key, '']),
    ...hiddenPointKeys.map((key) => [key, ''])
  ]);
}

function ensurePointRow(seriesIndex: number, rowIndex: number): void {
  const draft = seriesDrafts[seriesIndex];
  if (!draft) return;
  while (draft.points.length <= rowIndex) draft.points.push(makeEmptyPointRow());
}

function isEmptyPointRow(row: PointRow): boolean {
  return [
    ...pointColumns.map((column) => column.key),
    ...latencyPercentilePointKeys,
    ...e2eNormalizedInteractivityPointKeys
  ].every(
    (key) => !row[key]?.trim()
  );
}

function pointHasAnyXAxisMetric(point: Record<string, unknown>): boolean {
  if (xMetricPointKeys.some((key) => {
    const value = point[key];
    return typeof value === 'number' && Number.isFinite(value);
  })) return true;
  return [
    'interactivityPercentiles',
    'ttftPercentiles',
    'endToEndPercentiles',
    'e2eNormalizedInteractivityPercentiles'
  ].some(
    (key) => readNativeLatencyPercentiles(point[key]) !== undefined
  );
}

function countPointRows(drafts: SeriesDraft[]): number {
  return drafts.reduce((count, draft) => count + draft.points.filter((row) => !isEmptyPointRow(row)).length, 0);
}

function parseNumber(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim().replaceAll(',', '');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | undefined): boolean | null {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return null;
}

function parsePointMetadataLabel(label: string | undefined): ParsedPointMetadata {
  const prefillMatch = label?.match(/\bprefill\s+TP\s*(\d+(?:\.\d+)?)\s+EP\s*(\d+(?:\.\d+)?)/iu);
  const legacyDpAttention = parseBooleanFromText(label, /\bDPA\s*:?\s*(true|false|1|0|yes|no)\b/iu);
  return {
    num_prefill_gpu: parseNumberFromText(label, /\bprefill\s+GPUs?\s*:?\s*(\d+(?:\.\d+)?)/iu),
    num_decode_gpu: parseNumberFromText(label, /\bdecode\s+GPUs?\s*:?\s*(\d+(?:\.\d+)?)/iu),
    prefill_tp: prefillMatch ? Number(prefillMatch[1]) : undefined,
    prefill_ep: prefillMatch ? Number(prefillMatch[2]) : undefined,
    prefill_dp_attention: legacyDpAttention,
    decode_dp_attention: legacyDpAttention
  };
}

function parsePointStrategy(strategy: string | undefined): ParsedStrategyMetadata {
  return {
    decode_tp: parseNumberFromText(strategy, /\bTP\s*(\d+(?:\.\d+)?)/iu),
    decode_ep: parseNumberFromText(strategy, /\bEP\s*(\d+(?:\.\d+)?)/iu)
  };
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

function parseNumberFromText(value: string | undefined, pattern: RegExp): number | undefined {
  const match = value?.match(pattern);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanFromText(value: string | undefined, pattern: RegExp): boolean | undefined {
  const match = value?.match(pattern);
  if (!match) return undefined;
  return parseBoolean(match[1] ?? '') ?? undefined;
}

function formatPointFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  return '';
}

function normalizeCellText(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim();
}

function normalizePointShapeValue(value: string | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[_\s]+/gu, '-');
  if (!normalized || normalized === 'default' || normalized === 'auto') return '';
  if (['circle', 'round', 'dot'].includes(normalized)) return 'circle';
  if (['square', 'box'].includes(normalized)) return 'square';
  if (['triangle', 'tri'].includes(normalized)) return 'triangle';
  if (['diamond', 'rhombus'].includes(normalized)) return 'diamond';
  if (['star', 'asterisk'].includes(normalized)) return 'star';
  if (['plus', '+'].includes(normalized)) return 'plus';
  if (['cross', 'x'].includes(normalized)) return 'cross';
  return '';
}

function normalizeChartMetric(value: unknown): InferenceCurveXAxisMetric | undefined {
  if (typeof value !== 'string') return undefined;
  return chartMetricOptions.some((option) => option.value === value)
    ? (value as InferenceCurveXAxisMetric)
    : undefined;
}

function normalizeLatencyPercentile(value: unknown): InferenceCurveLatencyPercentile | undefined {
  return typeof value === 'string' && LATENCY_PERCENTILES.includes(value as InferenceCurveLatencyPercentile)
    ? (value as InferenceCurveLatencyPercentile)
    : undefined;
}

function isE2ENormalizedInteractivityPercentile(
  value: InferenceCurveLatencyPercentile
): value is InferenceCurveE2ENormalizedInteractivityPercentile {
  return E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.includes(
    value as InferenceCurveE2ENormalizedInteractivityPercentile
  );
}

function getAvailableLatencyPercentiles(
  series: InferenceCurveSeries[],
  metric: InferenceCurveXAxisMetric = state.chartMetric
): Set<InferenceCurveLatencyPercentile> {
  const available = new Set<InferenceCurveLatencyPercentile>();
  series.forEach((line) => {
    line.points.forEach((point) => {
      if (metric === 'e2eNormalizedInteractivity') {
        E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
          const value = point.e2eNormalizedInteractivityPercentiles?.[percentile];
          if (typeof value === 'number' && Number.isFinite(value)) available.add(percentile);
        });
        return;
      }
      LATENCY_PERCENTILES.forEach((percentile) => {
        if (
          hasPointLatencyPercentile(point.interactivityPercentiles, point.interactivity, percentile) ||
          hasPointLatencyPercentile(point.ttftPercentiles, point.ttft, percentile) ||
          hasPointLatencyPercentile(point.endToEndPercentiles, point.endToEnd, percentile)
        ) {
          available.add(percentile);
        }
      });
    });
  });
  return available;
}

function hasPointLatencyPercentile(
  percentiles: InferenceCurveLatencyPercentiles | undefined,
  legacyP90Value: unknown,
  percentile: InferenceCurveLatencyPercentile
): boolean {
  if (percentiles && typeof percentiles === 'object') {
    return typeof percentiles[percentile] === 'number' && Number.isFinite(percentiles[percentile]);
  }
  return percentile === 'p90' && typeof legacyP90Value === 'number' && Number.isFinite(legacyP90Value);
}

function reconcileLatencyPercentile(): void {
  if (!isAgenticTraceView(currentSeries)) return;
  const available = getAvailableLatencyPercentiles(
    getFilteredSeriesForChart(),
    state.chartMetric
  );
  if (available.has(state.latencyPercentile)) return;
  state.latencyPercentile = available.has(DEFAULT_LATENCY_PERCENTILE)
    ? DEFAULT_LATENCY_PERCENTILE
    : LATENCY_PERCENTILES.find((percentile) => available.has(percentile)) ?? DEFAULT_LATENCY_PERCENTILE;
  scheduleLocalSave();
}

function getAvailableChartMetricOptions(series: InferenceCurveSeries[] = currentSeries): typeof chartMetricOptions {
  return isAgenticTraceView(series)
    ? chartMetricOptions
    : chartMetricOptions.filter((option) => fixedLengthChartMetrics.has(option.value));
}

function isChartMetricAvailable(metric: InferenceCurveXAxisMetric, series: InferenceCurveSeries[] = currentSeries): boolean {
  return getAvailableChartMetricOptions(series).some((option) => option.value === metric);
}

function ensureChartMetricForCurrentView(series: InferenceCurveSeries[] = currentSeries): void {
  if (isChartMetricAvailable(state.chartMetric, series)) return;
  state.chartMetric = 'interactivity';
}

function isAgenticTraceView(series: InferenceCurveSeries[]): boolean {
  if (state.scenarioFilter === AGENTIC_SCENARIO) return true;
  if (state.scenarioFilter === FIXED_SEQUENCE_SCENARIO) return false;
  const scenarios = getAvailableScenarios(filterSeriesByModel(series, state.modelFilter));
  return scenarios.length === 1 && scenarios[0] === AGENTIC_SCENARIO;
}

function isAgenticTraceSequence(value: string): boolean {
  const normalized = normalizeScenarioKey(value);
  return normalized === 'agentic' ||
    normalized.startsWith('agentic-') ||
    (normalized.includes('agentic') && normalized.includes('trace'));
}

function getScenarioForSequence(value: string): string {
  return isAgenticTraceSequence(value) ? AGENTIC_SCENARIO : FIXED_SEQUENCE_SCENARIO;
}

function getAvailableScenarios(series: InferenceCurveSeries[]): string[] {
  const available = new Set(series.map((line) => getScenarioForSequence(getSeriesIslOsl(line))));
  return [FIXED_SEQUENCE_SCENARIO, AGENTIC_SCENARIO].filter((scenario) => available.has(scenario));
}

function getDefaultSequenceForScenario(series: InferenceCurveSeries[], scenario: string): string {
  return sortIslOslValues(
    filterSeriesByScenario(series, scenario).map(getSeriesIslOsl)
  )[0] ?? (scenario === AGENTIC_SCENARIO ? 'Agentic Traces' : ALL_VALUE);
}

function formatScenarioFilterLabel(value: string): string {
  return value === AGENTIC_SCENARIO ? 'Agentic Traces' : 'Fixed Sequence Length';
}

function normalizeScenarioKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function resetSelectionsForSeries(series: InferenceCurveSeries[]): void {
  state.selectedPrecisions = firstPrecisionSelection(series);
}

function activateSeriesForChart(series: InferenceCurveSeries[]): void {
  series.forEach((line) => {
    state.activeSeriesIds.add(line.id);
  });
  saveActiveSeriesForCurrentView();
}

function revealImportedSeries(series: InferenceCurveSeries[]): void {
  const models = uniqueSorted(series.map(getSeriesModel));
  const scenarios = getAvailableScenarios(series);
  const mtpValues = getAvailableMtpFilters(series);

  state.modelFilter = models.length === 1 ? models[0]! : ALL_VALUE;
  state.scenarioFilter = scenarios[0] ?? FIXED_SEQUENCE_SCENARIO;
  const scenarioSeries = filterSeriesByScenario(series, state.scenarioFilter);
  state.islOslFilter = getDefaultSequenceForScenario(scenarioSeries, state.scenarioFilter);
  state.mtpFilter = mtpValues.length === 1 ? mtpValues[0]! : ALL_VALUE;
  state.selectedPrecisions = new Set(getAvailablePrecisions(scenarioSeries));
  reconcileFiltersForSeries(currentSeries);
  activateSeriesForChart(
    filterSeriesByModelScenarioAndSequence(
      series,
      state.modelFilter,
      state.scenarioFilter,
      state.islOslFilter
    )
  );
}

function queueSeriesActiveByDraft(draft: SeriesDraft, index: number): void {
  pendingActiveSeriesIds.add(getDraftSeriesId(draft, index));
}

function activatePendingSeriesForCurrentView(): void {
  if (pendingActiveSeriesIds.size === 0) return;
  const visibleIds = getCurrentViewSeriesIds();
  let changed = false;
  pendingActiveSeriesIds.forEach((id) => {
    if (!visibleIds.has(id)) return;
    state.activeSeriesIds.add(id);
    changed = true;
  });
  pendingActiveSeriesIds = new Set();
  if (changed) saveActiveSeriesForCurrentView();
}

function getActiveSeriesViewKey(): string {
  const precisionKey = Array.from(state.selectedPrecisions).sort((a, b) => a.localeCompare(b)).join(',');
  // Merging rewrites series ids, so each grouping mode needs its own saved
  // selection - otherwise switching modes restores ids that no longer exist.
  return [
    state.modelFilter,
    state.scenarioFilter,
    state.islOslFilter,
    state.mtpFilter,
    precisionKey,
    state.mergeParallelism ? 'merged' : 'split'
  ]
    .map((value) => encodeURIComponent(value || ''))
    .join('|');
}

function getCurrentViewSeriesIds(): Set<string> {
  return new Set(getFilteredSeriesForChart().map((line) => line.id));
}

function saveActiveSeriesForCurrentView(): void {
  const visibleIds = getCurrentViewSeriesIds();
  const activeIds = Array.from(state.activeSeriesIds).filter((id) => visibleIds.has(id));
  const key = getActiveSeriesViewKey();
  state.activeSeriesIdsByView.set(key, new Set(activeIds));
  // Recording what the view could see, not just what was on, is what lets the
  // next restore tell a line the user switched off from one that did not exist
  // yet. Rewriting it wholesale also drops ids that have since disappeared.
  state.knownSeriesIdsByView.set(key, new Set(visibleIds));
}

/** Falls back to everything, so imported datasets are not hidden by this. */
function pickDefaultVisibleSeries(series: InferenceCurveSeries[]): InferenceCurveSeries[] {
  const candidates = series.flatMap((line) => {
    // A merged archive's id is derived, but it inherits the archive's hwKey.
    if (line.id.includes(SYNC_ARCHIVE_SEPARATOR) || line.hwKey?.includes(SYNC_ARCHIVE_SEPARATOR)) return [];
    const match = DEFAULT_RUN_NAME.exec(line.name ?? '');
    if (!match) return [];
    const run = `${match[2]}|${match[3]}`;
    return DEFAULT_VISIBLE_RUNS.has(run) ? [{ line, run, date: match[1]! }] : [];
  });

  const newest = new Map<string, string>();
  candidates.forEach(({ run, date }) => {
    if (date > (newest.get(run) ?? '')) newest.set(run, date);
  });
  // Every parallelism config of the newest run, so Merge Parallelism off shows
  // TP8 and TP4 alike rather than an arbitrary one of them.
  const preferred = candidates.filter(({ run, date }) => newest.get(run) === date).map(({ line }) => line);
  return preferred.length > 0 ? preferred : series;
}

function restoreActiveSeriesForCurrentView(): void {
  const visible = getFilteredSeriesForChart();
  const visibleIds = new Set(visible.map((line) => line.id));
  if (visibleIds.size === 0) {
    state.activeSeriesIds = new Set();
    return;
  }

  const key = getActiveSeriesViewKey();
  const savedIds = state.activeSeriesIdsByView.get(key);
  if (savedIds) {
    // Series this view has never seen are additions to the dataset rather than
    // lines the user switched off, so they start visible. Saves written before
    // the known set existed fall back to the active set, which turns every
    // other visible line back on once and is then recorded accurately.
    const known = state.knownSeriesIdsByView.get(key) ?? savedIds;
    const restored = new Set([
      ...Array.from(savedIds).filter((id) => visibleIds.has(id)),
      ...Array.from(visibleIds).filter((id) => !known.has(id))
    ]);
    // A saved view whose ids have all gone stale must not leave an empty chart.
    if (restored.size > 0) {
      state.activeSeriesIds = restored;
      return;
    }
    const carried = Array.from(state.activeSeriesIds).filter((id) => visibleIds.has(id));
    if (carried.length > 0) {
      state.activeSeriesIds = new Set(carried);
      return;
    }
  }

  // A view opened for the first time starts at the default set. Carrying the
  // previous selection over by id cannot work here anyway: Merge Parallelism
  // gives a merged curve a derived id, so intersecting would quietly drop it.
  state.activeSeriesIds = new Set(pickDefaultVisibleSeries(visible).map((line) => line.id));
}

function reconcileActiveSeriesForChart(): void {
  restoreActiveSeriesForCurrentView();
}

function reconcileFiltersForSeries(series: InferenceCurveSeries[]): void {
  const models = new Set(series.map(getSeriesModel));
  const sortedModels = uniqueSorted(series.map(getSeriesModel));
  if (state.modelFilter !== ALL_VALUE && !models.has(state.modelFilter)) {
    state.modelFilter = sortedModels[0] ?? ALL_VALUE;
  }

  const modelFiltered = filterSeriesByModel(series, state.modelFilter);
  const scenarios = getAvailableScenarios(modelFiltered);
  if (!scenarios.includes(state.scenarioFilter)) {
    state.scenarioFilter = scenarios[0] ?? FIXED_SEQUENCE_SCENARIO;
  }

  const scenarioFiltered = filterSeriesByScenario(modelFiltered, state.scenarioFilter);
  const islOslValues = new Set(scenarioFiltered.map(getSeriesIslOsl));
  const sortedIslOslValues = sortIslOslValues(scenarioFiltered.map(getSeriesIslOsl));
  if (state.scenarioFilter === AGENTIC_SCENARIO) {
    state.islOslFilter = sortedIslOslValues[0] ?? 'Agentic Traces';
  } else if (!islOslValues.has(state.islOslFilter)) {
    state.islOslFilter = sortedIslOslValues[0] ?? ALL_VALUE;
  }

  const sequenceFiltered = filterSeriesByModelScenarioAndSequence(
    series,
    state.modelFilter,
    state.scenarioFilter,
    state.islOslFilter
  );
  const mtpValues = new Set(getAvailableMtpFilters(sequenceFiltered));
  const sortedMtpValues = sortMtpValues(Array.from(mtpValues));
  if (state.scenarioFilter === AGENTIC_SCENARIO) {
    state.mtpFilter = ALL_VALUE;
  } else if (state.mtpFilter !== ALL_VALUE && !mtpValues.has(state.mtpFilter)) {
    state.mtpFilter = sortedMtpValues[0] ?? ALL_VALUE;
  }

  ensureSelectedPrecisions(getAvailablePrecisions(getModelSequenceMtpFilteredSeries()));
  ensureChartMetricForCurrentView(series);
  reconcileLatencyPercentile();
}

function ensureSelectedPrecisions(precisions: string[]): void {
  const available = new Set(precisions);
  const selected = Array.from(state.selectedPrecisions).filter((precision) => available.has(precision));
  state.selectedPrecisions = selected.length > 0 ? new Set(selected) : firstPrecisionSet(precisions);
}

function createInitialState(series: InferenceCurveSeries[]): AppState {
  const modelFilter = uniqueSorted(series.map(getSeriesModel))[0] ?? ALL_VALUE;
  const modelFiltered = filterSeriesByModel(series, modelFilter);
  const scenarioFilter = getAvailableScenarios(modelFiltered)[0] ?? FIXED_SEQUENCE_SCENARIO;
  const islOslFilter = getDefaultSequenceForScenario(modelFiltered, scenarioFilter);
  const sequenceFiltered = filterSeriesByModelScenarioAndSequence(
    series,
    modelFilter,
    scenarioFilter,
    islOslFilter
  );
  const mtpFilter = scenarioFilter === AGENTIC_SCENARIO
    ? ALL_VALUE
    : getAvailableMtpFilters(sequenceFiltered)[0] ?? ALL_VALUE;
  const visibleSeries = filterSeriesByMtp(sequenceFiltered, mtpFilter);

  return {
    theme: getTheme(),
    chartMetric: 'interactivity',
    chartYMetric: 'throughput',
    tcoCostMode: 'hyperscaler',
    tcoCustomCosts: {},
    latencyPercentile: DEFAULT_LATENCY_PERCENTILE,
    activeSeriesIds: new Set(pickDefaultVisibleSeries(visibleSeries).map((line) => line.id)),
    activeSeriesIdsByView: new Map(),
    knownSeriesIdsByView: new Map(),
    selectedPrecisions: firstPrecisionSelection(visibleSeries),
    modelFilter,
    scenarioFilter,
    islOslFilter,
    mtpFilter,
    // Matches the published InferenceX chart, which keys a curve on hardware and
    // framework and leaves parallelism as a point label.
    mergeParallelism: true,
    enforceEndToEndPareto: false,
    showNonOptimalPoints: false,
    hidePointLabels: true,
    showConcurrencyLabels: false,
    useAdvancedLabels: false,
    showGradientLabels: false,
    showLineLabels: true,
    lineLabelOffsets: {},
    showGoalDirection: true,
    showOffloadRings: true,
    highContrast: false,
    logY: false,
    search: '',
    watermark: DEFAULT_CHART_WATERMARK
  };
}

function setDefaultFiltersForSeries(series: InferenceCurveSeries[]): void {
  const defaults = createInitialState(series);
  state.modelFilter = defaults.modelFilter;
  state.scenarioFilter = defaults.scenarioFilter;
  state.islOslFilter = defaults.islOslFilter;
  state.mtpFilter = defaults.mtpFilter;
  state.chartMetric = defaults.chartMetric;
  state.latencyPercentile = defaults.latencyPercentile;
  state.activeSeriesIds = defaults.activeSeriesIds;
  state.activeSeriesIdsByView = defaults.activeSeriesIdsByView;
  state.knownSeriesIdsByView = defaults.knownSeriesIdsByView;
  state.selectedPrecisions = defaults.selectedPrecisions;
}

function firstPrecisionSelection(series: InferenceCurveSeries[]): Set<string> {
  return firstPrecisionSet(getAvailablePrecisions(series));
}

function firstPrecisionSet(precisions: string[]): Set<string> {
  const [first] = precisions;
  return first ? new Set([first]) : new Set();
}

function filterSeriesByModel(series: InferenceCurveSeries[], modelFilter: string): InferenceCurveSeries[] {
  return series.filter((line) => modelFilter === ALL_VALUE || getSeriesModel(line) === modelFilter);
}

function filterSeriesByScenario(series: InferenceCurveSeries[], scenarioFilter: string): InferenceCurveSeries[] {
  return series.filter((line) => getScenarioForSequence(getSeriesIslOsl(line)) === scenarioFilter);
}

function filterSeriesByModelScenarioAndSequence(
  series: InferenceCurveSeries[],
  modelFilter: string,
  scenarioFilter: string,
  islOslFilter: string
): InferenceCurveSeries[] {
  return filterSeriesByScenario(filterSeriesByModel(series, modelFilter), scenarioFilter).filter(
    (line) => scenarioFilter === AGENTIC_SCENARIO || getSeriesIslOsl(line) === islOslFilter
  );
}

function filterSeriesByMtp(series: InferenceCurveSeries[], mtpFilter: string): InferenceCurveSeries[] {
  return series.filter((line) =>
    isAgenticTraceSequence(getSeriesIslOsl(line)) || mtpFilter === ALL_VALUE || getSeriesMtpFilter(line) === mtpFilter
  );
}

function getModelFilteredSeries(): InferenceCurveSeries[] {
  return filterSeriesByModel(currentSeries, state.modelFilter);
}

function getModelScenarioFilteredSeries(): InferenceCurveSeries[] {
  return filterSeriesByScenario(getModelFilteredSeries(), state.scenarioFilter);
}

function getModelSequenceFilteredSeries(): InferenceCurveSeries[] {
  return filterSeriesByModelScenarioAndSequence(
    currentSeries,
    state.modelFilter,
    state.scenarioFilter,
    state.islOslFilter
  );
}

function getModelSequenceMtpFilteredSeries(): InferenceCurveSeries[] {
  return filterSeriesByMtp(getModelSequenceFilteredSeries(), state.mtpFilter);
}

function getFilteredSeriesForChart(): InferenceCurveSeries[] {
  const filtered = getModelSequenceMtpFilteredSeries().filter((series) =>
    state.selectedPrecisions.has(getSeriesPrecision(series))
  );
  return state.mergeParallelism ? mergeSeriesByParallelism(filtered) : filtered;
}

// InferenceX groups a published curve by hardware and framework alone, with
// parallelism carried as point metadata, so one accelerator is one line and
// TP8 / TEP4 only show up as point labels. The bundled series instead keep each
// parallelism config on its own line so configs can be compared against each
// other. Merging here reproduces the published shape without touching the data.
function mergeSeriesByParallelism(series: InferenceCurveSeries[]): InferenceCurveSeries[] {
  const groups = new Map<string, InferenceCurveSeries[]>();
  series.forEach((line) => {
    const key = getParallelismMergeKey(line);
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  });

  return Array.from(groups, ([key, members]) => {
    if (members.length === 1) return members[0]!;
    const ordered = [...members].sort(
      (a, b) =>
        (a.renderOrder ?? 0) - (b.renderOrder ?? 0) || seriesName(a).localeCompare(seriesName(b))
    );
    const lead = ordered[0]!;
    return {
      ...lead,
      id: `merged|${key}`,
      name: commonWordPrefix(ordered.map(seriesName)) || lead.name,
      title: commonWordPrefix(ordered.map((line) => line.title ?? '')) || lead.title,
      note: `Merged ${ordered.length} parallelism configs: ${ordered.map(seriesName).join(', ')}`,
      points: ordered
        .flatMap(seriesPoints)
        .sort(
          (a, b) =>
            (a.interactivity ?? Number.POSITIVE_INFINITY) - (b.interactivity ?? Number.POSITIVE_INFINITY) ||
            b.throughput - a.throughput ||
            Number(a.concurrency ?? 0) - Number(b.concurrency ?? 0)
        )
    };
  });
}

// Switching grouping mode rewrites series ids, so the selection cannot be
// carried over by id. Merged lines reuse the exact point objects of their
// members, which makes point identity a reliable bridge in both directions.
function carryActiveSeriesAcrossGrouping(previouslyActive: InferenceCurveSeries[]): void {
  const activePoints = new Set<InferenceCurveSeries['points'][number]>();
  previouslyActive.forEach((line) => seriesPoints(line).forEach((point) => activePoints.add(point)));
  const visible = getFilteredSeriesForChart();
  const carried = visible.filter((line) => seriesPoints(line).some((point) => activePoints.has(point)));
  state.activeSeriesIds = new Set((carried.length > 0 ? carried : visible).map((line) => line.id));
  saveActiveSeriesForCurrentView();
}

function getParallelismMergeKey(line: InferenceCurveSeries): string {
  const scope = (suffix: string): string =>
    [line.model, line.islOsl, line.precision, line.mtp, suffix]
      .map((part) => encodeURIComponent(part ?? ''))
      .join('|');

  const hwKey = line.hwKey?.trim().toLowerCase();
  if (hwKey) return `hw|${scope(hwKey)}`;

  const name = seriesName(line).trim();
  const base = name.replace(PARALLELISM_NAME_SUFFIX, '').trim();
  // Only merge on names that actually ended in a parallelism token, otherwise
  // unrelated imported lines would be folded together.
  if (base && base !== name) return `name|${scope(base.toLowerCase())}`;
  return `id|${encodeURIComponent(line.id)}`;
}

// Grouping runs during module init on series rehydrated from browser storage or
// a CSV import, where the declared types are not actually enforced. A missing
// name or point list must not throw: that would reject the `./main` import and
// leave the workspace blank until storage is cleared by hand.
function seriesName(line: InferenceCurveSeries): string {
  return typeof line.name === 'string' ? line.name : '';
}

function seriesPoints(line: InferenceCurveSeries): InferenceCurveSeries['points'] {
  return Array.isArray(line.points) ? line.points : [];
}

function commonWordPrefix(values: string[]): string {
  const wordLists = values.map((value) => String(value ?? '').trim().split(/\s+/u).filter(Boolean));
  const first = wordLists[0];
  if (!first) return '';
  let shared = 0;
  while (shared < first.length && wordLists.every((words) => words[shared] === first[shared])) shared += 1;
  return first.slice(0, shared).join(' ');
}

function shouldEnforceEndToEndPareto(): boolean {
  return state.enforceEndToEndPareto && state.scenarioFilter === AGENTIC_SCENARIO;
}

function getChartColorSourceSeries(series: InferenceCurveSeries[]): InferenceCurveSeries[] {
  return getInferenceCurveColorSourceSeries(
    series,
    state.activeSeriesIds,
    Array.from(state.selectedPrecisions),
    state.chartMetric,
    state.latencyPercentile
  );
}

function getPrecisionFilterValue(precisions: string[]): string {
  if (precisions.length > 0 && precisions.every((precision) => state.selectedPrecisions.has(precision))) {
    return ALL_VALUE;
  }
  if (state.selectedPrecisions.size === 1) {
    const [value] = Array.from(state.selectedPrecisions);
    if (value && precisions.includes(value)) return value;
  }
  return CUSTOM_VALUE;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function sortIslOslValues(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => {
    const aLengths = parseIslOslLengths(a);
    const bLengths = parseIslOslLengths(b);
    if (aLengths && bLengths) {
      return bLengths.isl - aLengths.isl || bLengths.osl - aLengths.osl || a.localeCompare(b);
    }
    if (aLengths) return -1;
    if (bLengths) return 1;
    return a.localeCompare(b);
  });
}

function getAvailableMtpFilters(series: InferenceCurveSeries[]): string[] {
  return sortMtpValues(series.map(getSeriesMtpFilter));
}

function sortMtpValues(values: string[]): string[] {
  const order = new Map([
    [MTP_VALUE, 0],
    [NON_MTP_VALUE, 1]
  ]);
  return Array.from(new Set(values)).sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b)
  );
}

function parseIslOslLengths(value: string): { isl: number; osl: number } | null {
  const labelled = value.match(/ISL\s*([\d,]+)\s*\/\s*OSL\s*([\d,]+)/iu);
  const simple = value.match(/([\d,]+)\s*\/\s*([\d,]+)/u);
  const match = labelled ?? simple;
  if (!match) return null;

  const isl = Number(match[1]!.replaceAll(',', ''));
  const osl = Number(match[2]!.replaceAll(',', ''));
  return Number.isFinite(isl) && Number.isFinite(osl) ? { isl, osl } : null;
}

function getSeriesModel(series: InferenceCurveSeries): string {
  return getInferenceXDisplayModel(String(series.model ?? DEFAULT_MODEL));
}

function getSeriesIslOsl(series: InferenceCurveSeries): string {
  return String(series.islOsl ?? DEFAULT_ISL_OSL);
}

function getSeriesPrecision(series: InferenceCurveSeries): string {
  const firstPointPrecision = series.points.find((point) => point.precision)?.precision;
  return String(series.precision ?? firstPointPrecision ?? DEFAULT_PRECISION);
}

function getSeriesRenderOrder(series: InferenceCurveSeries, fallback: number): number {
  return typeof series.renderOrder === 'number' && Number.isFinite(series.renderOrder)
    ? series.renderOrder
    : fallback;
}

function getSeriesMtpFilter(series: InferenceCurveSeries): string {
  return getExplicitMtpValue(series.mtp) ?? inferMtpFilterFromTokens(`${series.id} ${series.name} ${series.title ?? ''}`);
}

function getDraftModel(draft: SeriesDraft): string {
  return getInferenceXDisplayModel(draft.model.trim() || DEFAULT_MODEL);
}

function getDraftIslOsl(draft: SeriesDraft): string {
  return draft.islOsl.trim() || DEFAULT_ISL_OSL;
}

function getDraftPrecision(draft: SeriesDraft): string {
  return draft.precision.trim() || DEFAULT_PRECISION;
}

function getDraftMtpFilter(draft: SeriesDraft): string {
  return getExplicitMtpValue(draft.mtp) ?? inferMtpFilterFromTokens(`${draft.id} ${draft.name} ${draft.title}`);
}

function getExplicitMtpValue(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return normalizeMtpValue(value);
}

function normalizeMtpValue(value: string | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return NON_MTP_VALUE;
  if (['none', 'non-mtp', 'non mtp', 'non_mtp', 'no-mtp', 'off', 'false', 'no', 'n', '0'].includes(normalized)) {
    return NON_MTP_VALUE;
  }
  if (['mtp', 'spec-mtp', 'spec_mtp', 'on', 'true', 'yes', 'y', '1'].includes(normalized)) {
    return MTP_VALUE;
  }
  return hasMtpToken(normalized) ? MTP_VALUE : NON_MTP_VALUE;
}

function inferMtpFilterFromTokens(value: string): string {
  return hasMtpToken(value) ? MTP_VALUE : NON_MTP_VALUE;
}

function hasMtpToken(value: string): boolean {
  return /(^|[^a-z0-9])mtp([^a-z0-9]|$)/iu.test(value);
}

function formatPrecisionLabel(precision: string): string {
  return precision === DEFAULT_PRECISION ? 'Default' : precision.toUpperCase();
}

function formatMtpFilterLabel(value: string): string {
  if (value === MTP_VALUE) return 'MTP';
  if (value === NON_MTP_VALUE) return 'Non-MTP';
  return value;
}

function getChartTitle(): string {
  const title = getInferenceCurveTitle(
    state.chartMetric,
    undefined,
    isAgenticTraceView(currentSeries) ? state.latencyPercentile : undefined
  );
  return state.chartYMetric === 'totalTokensPerDollar'
    ? title.replace('Token Throughput per GPU', 'Total Tokens per Dollar') : title;
}

function getChartSubtitle(): string {
  const precisions = getAvailablePrecisions(getModelSequenceMtpFilteredSeries());
  const precision = getPrecisionFilterValue(precisions);
  const precisionLabel =
    precision === ALL_VALUE
      ? 'All Precision'
      : precision === CUSTOM_VALUE
        ? Array.from(state.selectedPrecisions).map(formatPrecisionLabel).join(', ')
        : formatPrecisionLabel(precision);

  return [
    state.modelFilter === ALL_VALUE ? 'All Models' : formatModelLabel(state.modelFilter),
    precisionLabel || 'No Precision',
    state.chartYMetric === 'totalTokensPerDollar' ? `TCO: ${getTcoCostModeLabel()}` : '',
    formatScenarioFilterLabel(state.scenarioFilter),
    state.scenarioFilter === AGENTIC_SCENARIO ? '' : formatIslOslLabel(state.islOslFilter),
    state.scenarioFilter === AGENTIC_SCENARIO
      ? ''
      : state.mtpFilter === ALL_VALUE ? 'All MTP' : formatMtpFilterLabel(state.mtpFilter)
  ].filter(Boolean).join(' • ');
}

function formatModelLabel(model: string): string {
  return model.replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function formatIslOslLabel(value: string): string {
  const labelled = value.match(/ISL\s*([\d,]+)\s*\/\s*OSL\s*([\d,]+)/iu);
  const simple = value.match(/([\d,]+)\s*\/\s*([\d,]+)/u);
  const match = labelled ?? simple;
  if (!match) return value;

  return `${formatTokenLength(match[1]!)} / ${formatTokenLength(match[2]!)}`;
}

function formatTokenLength(value: string): string {
  const parsed = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(parsed)) return value;
  if (parsed < 1024) return String(parsed);

  const inK = parsed / 1024;
  const compact = Number.isInteger(inK) ? String(inK) : inK.toFixed(1).replace(/\.0$/u, '');
  return `${compact}K`;
}

function getDefaultDraftModel(): string {
  if (state.modelFilter !== ALL_VALUE) return state.modelFilter;
  return uniqueSorted(currentSeries.map(getSeriesModel))[0] ?? DEFAULT_MODEL;
}

function getDefaultDraftIslOsl(): string {
  if (state.islOslFilter !== ALL_VALUE) return state.islOslFilter;
  return sortIslOslValues(currentSeries.map(getSeriesIslOsl))[0] ?? DEFAULT_ISL_OSL;
}

function getDefaultDraftPrecision(): string {
  const precisions = getAvailablePrecisions(getModelSequenceMtpFilteredSeries());
  const precision = getPrecisionFilterValue(precisions);
  if (precision !== ALL_VALUE && precision !== CUSTOM_VALUE) return precision;
  return precisions[0] ?? DEFAULT_PRECISION;
}

function getDefaultDraftMtp(): string {
  if (state.scenarioFilter === AGENTIC_SCENARIO) return '';
  if (state.mtpFilter !== ALL_VALUE) return state.mtpFilter;
  return getAvailableMtpFilters(getModelSequenceFilteredSeries())[0] ?? NON_MTP_VALUE;
}

function openMergePreview(): void {
  commitSeriesDom();
  pendingMergeGroups = buildPendingMergeGroups();
  renderMergePreview();
  if (pendingMergeGroups.length === 0) {
    setStatus('No merge candidates in the current filtered line list.', true);
    return;
  }
  setStatus(`Found ${pendingMergeGroups.length} merge candidate groups. Select the exact lines to merge.`);
}

function buildPendingMergeGroups(): PendingMergeGroup[] {
  const groups = new Map<string, PendingMergeGroup>();
  getFilteredDraftEntries()
    .filter(({ draft }) => countPointRows([draft]) > 0)
    .forEach(({ draft, index }) => {
      const key = getMergeGroupKey(draft);
      const group =
        groups.get(key) ??
        ({
          key,
          label: getMergeGroupLabel(draft),
          lines: []
        } satisfies PendingMergeGroup);
      group.lines.push({
        selected: false,
        main: false,
        draftIndex: index,
        draftId: getDraftSeriesId(draft, index)
      });
      groups.set(key, group);
    });

  return Array.from(groups.values()).filter((group) => group.lines.length > 1);
}

function renderMergePreview(): void {
  const previousListScrollTop =
    mergePreviewEl.querySelector<HTMLElement>('.merge-preview-list')?.scrollTop ?? 0;

  if (pendingMergeGroups.length === 0) {
    mergePreviewEl.innerHTML = '';
    return;
  }

  const selectedLineCount = pendingMergeGroups.reduce(
    (count, group) => count + group.lines.filter((line) => line.selected).length,
    0
  );
  const readyGroupCount = pendingMergeGroups.filter((group) => getSelectedMergeLines(group).length >= 2).length;
  const previewColors = resolveInferenceCurveColors(draftsToPreviewSeries(seriesDrafts), state.highContrast, state.theme);

  mergePreviewEl.innerHTML = `
    <div class="merge-preview-head">
      <div>
        <strong>Review Merge</strong>
        <span>${readyGroupCount} ready groups / ${pendingMergeGroups.length} candidates, ${selectedLineCount} selected lines</span>
      </div>
      <div class="merge-preview-actions">
        <button type="button" class="series-action-button" data-merge-action="select-none">
          ${renderIcon('x')}
          <span>Select None</span>
        </button>
        <button type="button" class="series-action-button danger" data-merge-action="cancel">
          ${renderIcon('trash')}
          <span>Cancel</span>
        </button>
        <button type="button" class="primary action-button" data-merge-action="merge-selected" ${readyGroupCount === 0 ? 'disabled' : ''}>
          ${renderIcon('merge')}
          <span>Merge Selected</span>
        </button>
      </div>
    </div>
    <div class="merge-preview-list">
      ${pendingMergeGroups
        .map((group, groupIndex) => renderMergePreviewGroup(group, groupIndex, previewColors))
        .join('')}
    </div>
  `;

  const nextList = mergePreviewEl.querySelector<HTMLElement>('.merge-preview-list');
  if (nextList) nextList.scrollTop = previousListScrollTop;
}

function renderMergePreviewGroup(
  group: PendingMergeGroup,
  groupIndex: number,
  previewColors: Map<string, string>
): string {
  const selectedCount = group.lines.filter((line) => line.selected).length;
  return `
    <section class="merge-preview-group">
      <div class="merge-group-head">
        <div>
          <strong>${escapeHtml(group.label)}</strong>
          <span>${selectedCount} selected / ${group.lines.length} lines</span>
        </div>
      </div>
      <div class="merge-line-list">
        ${group.lines
          .map((line, lineIndex) => renderMergePreviewLine(line, groupIndex, lineIndex, previewColors))
          .join('')}
      </div>
    </section>
  `;
}

function renderMergePreviewLine(
  line: PendingMergeLine,
  groupIndex: number,
  lineIndex: number,
  previewColors: Map<string, string>
): string {
  const draft = seriesDrafts[line.draftIndex];
  if (!draft) return '';
  const pointCount = countPointRows([draft]);
  const color =
    draft.color.trim() ||
    previewColors.get(getDraftSeriesId(draft, line.draftIndex)) ||
    colorInputFallbacks[line.draftIndex % colorInputFallbacks.length]!;

  return `
    <div class="merge-line-item${line.selected ? ' selected' : ''}">
      <label class="merge-line-check">
        <input type="checkbox" data-merge-group="${groupIndex}" data-merge-line="${lineIndex}" data-merge-field="selected" ${line.selected ? 'checked' : ''} />
        <span>Merge</span>
      </label>
      <label class="merge-line-main">
        <input type="radio" name="merge-main-${groupIndex}" data-merge-group="${groupIndex}" data-merge-line="${lineIndex}" data-merge-field="main" ${line.main ? 'checked' : ''} />
        <span>Main</span>
      </label>
      <div class="merge-line-info">
        <span class="series-swatch" style="background:${escapeAttribute(color)}"></span>
        <div>
          <strong>${escapeHtml(draft.name || `Line ${line.draftIndex + 1}`)}</strong>
          <code>${escapeHtml(getDraftSeriesId(draft, line.draftIndex))}</code>
          ${draft.title.trim() ? `<small>${escapeHtml(draft.title.trim())}</small>` : ''}
        </div>
      </div>
      <span class="merge-line-meta">Layer ${getDraftLayerLabel(draft, line.draftIndex)} • ${pointCount} points</span>
    </div>
  `;
}

function handleMergePreviewInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const groupIndex = Number(input.dataset.mergeGroup);
  const lineIndex = Number(input.dataset.mergeLine);
  const field = input.dataset.mergeField;
  const group = pendingMergeGroups[groupIndex];
  const line = group?.lines[lineIndex];
  if (!group || !line || !field) return;

  if (field === 'selected') {
    line.selected = input.checked;
    if (!line.selected) line.main = false;
  } else if (field === 'main') {
    group.lines.forEach((entry) => {
      entry.main = false;
    });
    line.main = true;
    line.selected = true;
  }

  renderMergePreview();
}

function handleMergePreviewClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-merge-action]');
  if (!button) return;
  const action = button.dataset.mergeAction;
  if (action === 'select-none') {
    pendingMergeGroups.forEach((group) => {
      group.lines.forEach((line) => {
        line.selected = false;
        line.main = false;
      });
    });
    renderMergePreview();
  } else if (action === 'cancel') {
    clearMergePreview();
    setStatus('Merge review closed');
  } else if (action === 'merge-selected') {
    mergeSelectedLines();
  }
}

function mergeSelectedLines(): void {
  const groups = pendingMergeGroups.filter((group) => getSelectedMergeLines(group).length >= 2);
  if (groups.length === 0) {
    setStatus('Select at least two lines in a candidate group.', true);
    return;
  }

  try {
    commitSeriesDom();
    const removeIndexes = new Set<number>();
    let removedLineCount = 0;
    let mergedPointCount = 0;

    groups.forEach((group) => {
      const selectedLines = getSelectedMergeLines(group);
      if (!validateMergeGroup(group, selectedLines)) {
        throw new Error('Merge review is stale. Reopen Merge Lines and try again.');
      }

      const mainLine = getMainMergeLine(selectedLines);
      const mainDraft = seriesDrafts[mainLine.draftIndex]!;
      const mergedPoints = selectedLines
        .flatMap((line) => structuredClone(seriesDrafts[line.draftIndex]!.points).filter((row) => !isEmptyPointRow(row)))
        .sort(comparePointRowsForMerge);

      mainDraft.points = mergedPoints.length ? mergedPoints : [makeEmptyPointRow()];
      mergedPointCount += mergedPoints.length;
      selectedLines.forEach((line) => {
        if (line.draftIndex !== mainLine.draftIndex) {
          removeIndexes.add(line.draftIndex);
          removedLineCount += 1;
        }
      });
    });

    seriesDrafts = seriesDrafts.filter((_, index) => !removeIndexes.has(index));
    sortSeriesDraftsByLayer();
    normalizeDraftRenderOrderFromPanelOrder();
    currentSeries = draftsToSeriesAllowEmpty(seriesDrafts);
    syncCurrentSeriesOrderFromDrafts();
    reconcileFiltersForSeries(currentSeries);
    reconcileActiveSeriesForChart();
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    clearMergePreview();
    setStatus(`Merged ${removedLineCount} lines into ${groups.length} groups, keeping ${mergedPointCount} point rows.`);
    scheduleLocalSave();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not merge selected lines.', true);
  }
}

function getSelectedMergeLines(group: PendingMergeGroup): PendingMergeLine[] {
  return group.lines.filter((line) => line.selected);
}

function getMainMergeLine(lines: PendingMergeLine[]): PendingMergeLine {
  return (
    lines.find((line) => line.main) ??
    [...lines].sort(
      (a, b) =>
        getDraftRenderOrder(seriesDrafts[b.draftIndex]!, b.draftIndex) -
          getDraftRenderOrder(seriesDrafts[a.draftIndex]!, a.draftIndex) ||
        a.draftIndex - b.draftIndex
    )[0]!
  );
}

function validateMergeGroup(group: PendingMergeGroup, lines: PendingMergeLine[]): boolean {
  return lines.every((line) => {
    const draft = seriesDrafts[line.draftIndex];
    return draft && getDraftSeriesId(draft, line.draftIndex) === line.draftId && getMergeGroupKey(draft) === group.key;
  });
}

function comparePointRowsForMerge(a: PointRow, b: PointRow): number {
  return compareNullableNumbers(parseNumber(a.interactivity), parseNumber(b.interactivity)) ||
    compareNullableNumbers(
      parseNumber(a[e2eNormalizedInteractivityRowKeys.p90] || a[e2eNormalizedInteractivityRowKeys.p75]),
      parseNumber(b[e2eNormalizedInteractivityRowKeys.p90] || b[e2eNormalizedInteractivityRowKeys.p75])
    ) ||
    compareNullableNumbers(parseNumber(a.throughput), parseNumber(b.throughput)) ||
    compareNullableNumbers(parseNumber(a.ttft), parseNumber(b.ttft)) ||
    compareNullableNumbers(parseNumber(a.endToEnd), parseNumber(b.endToEnd));
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareOptionalNumbers(a: number | undefined, b: number | undefined): number {
  return compareNullableNumbers(a ?? null, b ?? null);
}

function clearMergePreview(): void {
  pendingMergeGroups = [];
  renderMergePreview();
}

function getMergeGroupKey(draft: SeriesDraft): string {
  return [
    normalizeMergeKeyPart(getDraftModel(draft)),
    normalizeMergeIslOsl(getDraftIslOsl(draft)),
    normalizeMergeKeyPart(getDraftPrecision(draft)),
    isAgenticTraceSequence(draft.islOsl) ? '' : getDraftMtpFilter(draft)
  ].join('|');
}

function getMergeGroupLabel(draft: SeriesDraft): string {
  return [
    getDraftModel(draft),
    formatPrecisionLabel(getDraftPrecision(draft)),
    formatIslOslLabel(getDraftIslOsl(draft)),
    isAgenticTraceSequence(draft.islOsl) ? '' : formatMtpFilterLabel(getDraftMtpFilter(draft))
  ].filter(Boolean).join(' • ');
}

function normalizeMergeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

function normalizeMergeIslOsl(value: string): string {
  const lengths = parseIslOslLengths(value);
  return lengths ? `${lengths.isl}/${lengths.osl}` : normalizeMergeKeyPart(value);
}

function createImportBatchSettings(runId = ''): ImportBatchSettings {
  return {
    idSuffix: runId ? `ci-${runId}` : 'ci',
    nameSuffix: '',
    titleSuffix: '',
    lineStyle: DEFAULT_LINE_STYLE,
    marker: '',
    colorMode: 'auto',
    color: colorInputFallbacks[0]!
  };
}

function renderImportPreview(): void {
  const previousListScrollTop =
    githubImportPreviewEl.querySelector<HTMLElement>('.import-preview-list')?.scrollTop ?? 0;

  if (pendingImportDrafts.length === 0) {
    githubImportPreviewEl.innerHTML = '';
    return;
  }

  const selectedCount = pendingImportDrafts.filter((entry) => entry.selected).length;
  const pointCount = pendingImportDrafts
    .filter((entry) => entry.selected)
    .reduce((count, entry) => count + entry.draft.points.filter((row) => !isEmptyPointRow(row)).length, 0);

  githubImportPreviewEl.innerHTML = `
    <div class="import-preview-head">
      <div>
        <strong>Review Import</strong>
        <span>${selectedCount} selected / ${pendingImportDrafts.length} lines, ${pointCount} point rows</span>
      </div>
      <div class="import-preview-actions">
        <button type="button" class="series-action-button" data-import-action="select-all">
          ${renderIcon('check')}
          <span>Select All</span>
        </button>
        <button type="button" class="series-action-button" data-import-action="select-none">
          ${renderIcon('x')}
          <span>Select None</span>
        </button>
        <button type="button" class="series-action-button danger" data-import-action="clear-preview">
          ${renderIcon('trash')}
          <span>Discard</span>
        </button>
        <button type="button" class="primary action-button" data-import-action="add-selected">
          ${renderIcon('plus')}
          <span>Add Selected</span>
        </button>
      </div>
    </div>
    ${renderImportBatchControls()}
    <div class="import-preview-list">
      ${pendingImportDrafts.map((entry, index) => renderImportPreviewItem(entry, index)).join('')}
    </div>
  `;

  const nextList = githubImportPreviewEl.querySelector<HTMLElement>('.import-preview-list');
  if (nextList) nextList.scrollTop = previousListScrollTop;
}

function renderImportBatchControls(): string {
  return `
    <div class="import-batch-controls">
      <label>
        <span>Line ID Suffix</span>
        <input type="text" data-import-batch-field="idSuffix" value="${escapeAttribute(pendingImportSettings.idSuffix)}" placeholder="ci-123456789" />
      </label>
      <label>
        <span>Name Suffix</span>
        <input type="text" data-import-batch-field="nameSuffix" value="${escapeAttribute(pendingImportSettings.nameSuffix)}" placeholder="optional" />
      </label>
      <label>
        <span>Title Suffix</span>
        <input type="text" data-import-batch-field="titleSuffix" value="${escapeAttribute(pendingImportSettings.titleSuffix)}" placeholder="optional" />
      </label>
      <label>
        <span>Line Type</span>
        ${renderImportLineStyleMenu()}
      </label>
      <label>
        <span>Marker</span>
        <select data-import-batch-field="marker">
          ${renderPointShapeOptions(pendingImportSettings.marker, 'Precision')}
        </select>
      </label>
      <label>
        <span>Color</span>
        <div class="import-color-controls">
          <select data-import-batch-field="colorMode">
            <option value="auto" ${pendingImportSettings.colorMode === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="custom" ${pendingImportSettings.colorMode === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
          <input type="color" data-import-batch-field="color" value="${escapeAttribute(toColorInputValue(pendingImportSettings.color, 0))}" title="Custom color for all imported lines" />
          <div class="import-color-presets color-presets" aria-label="Standard import colors">
            ${colorPresets
              .map((preset) => {
                const selected =
                  pendingImportSettings.colorMode === 'custom' &&
                  pendingImportSettings.color.toLowerCase() === preset.value.toLowerCase();
                return `
                  <button
                    type="button"
                    class="color-preset${selected ? ' selected' : ''}"
                    data-import-color-preset="${escapeAttribute(preset.value)}"
                    title="${escapeAttribute(preset.name)}"
                    aria-label="${escapeAttribute(preset.name)}"
                    style="--swatch-color:${escapeAttribute(preset.value)}"
                  ></button>
                `;
              })
              .join('')}
          </div>
        </div>
      </label>
    </div>
  `;
}

function renderImportLineStyleMenu(): string {
  const selectedValue = getLineStyleSelectValue(pendingImportSettings.lineStyle || DEFAULT_LINE_STYLE);
  const selectedOption =
    lineStyleOptions.find((option) => option.value === selectedValue) ?? lineStyleOptions[0]!;
  return `
    <details class="line-style-menu import-line-style-menu" data-import-line-style-menu>
      <summary>
        ${renderLineStyleSample(selectedOption)}
        <span>${escapeHtml(selectedOption.label)}</span>
      </summary>
      <div class="line-style-menu-list">
        ${lineStyleOptions
          .map(
            (option) =>
              `<button type="button" class="${selectedValue === option.value ? 'selected' : ''}" data-import-line-style-option="${escapeAttribute(option.value)}">
                ${renderLineStyleSample(option)}
                <span>${escapeHtml(option.label)}</span>
              </button>`
          )
          .join('')}
      </div>
    </details>
  `;
}

function renderImportPreviewItem(entry: PendingImportDraft, index: number): string {
  const draft = entry.draft;
  const pointCount = draft.points.filter((row) => !isEmptyPointRow(row)).length;
  return `
    <section class="import-preview-item">
      <label class="import-preview-select">
        <input type="checkbox" data-import-index="${index}" data-import-field="selected" ${entry.selected ? 'checked' : ''} />
        <span>Add</span>
      </label>
      ${renderImportPreviewInput(index, 'id', 'Line ID', draft.id)}
      ${renderImportPreviewInput(index, 'name', 'Name', draft.name)}
      ${renderImportPreviewInput(index, 'model', 'Model', draft.model)}
      ${renderImportPreviewInput(index, 'islOsl', 'Scenario', draft.islOsl)}
      ${renderImportPreviewInput(index, 'precision', 'Precision', draft.precision)}
      ${renderImportPreviewMtpField(index, draft.mtp)}
      ${renderImportPreviewMarkerField(index, draft.marker)}
      ${renderImportPreviewInput(index, 'title', 'Title', draft.title)}
      <span class="import-preview-points">${pointCount} points</span>
    </section>
  `;
}

function renderImportPreviewInput(
  index: number,
  field: keyof Pick<SeriesDraft, 'id' | 'name' | 'model' | 'islOsl' | 'precision' | 'title'>,
  label: string,
  value: string
): string {
  return `
    <label class="import-preview-field">
      <span>${label}</span>
      <input type="text" data-import-index="${index}" data-import-field="${field}" value="${escapeAttribute(value)}" />
    </label>
  `;
}

function renderImportPreviewMtpField(index: number, value: string): string {
  if (isAgenticTraceSequence(pendingImportDrafts[index]?.draft.islOsl ?? '')) return '';
  const selectedValue = normalizeMtpValue(value);
  return `
    <label class="import-preview-field">
      <span>MTP</span>
      <select data-import-index="${index}" data-import-field="mtp">
        ${[MTP_VALUE, NON_MTP_VALUE]
          .map(
            (option) =>
              `<option value="${option}" ${selectedValue === option ? 'selected' : ''}>${formatMtpFilterLabel(option)}</option>`
          )
          .join('')}
      </select>
    </label>
  `;
}

function renderImportPreviewMarkerField(index: number, value: string): string {
  const selectedValue = normalizePointShapeValue(value);
  return `
    <label class="import-preview-field">
      <span>Marker</span>
      <select data-import-index="${index}" data-import-field="marker">
        ${renderPointShapeOptions(selectedValue, 'Precision Default')}
      </select>
    </label>
  `;
}

function handleImportPreviewInput(event: Event): void {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const batchField = input.dataset.importBatchField as keyof ImportBatchSettings | undefined;
  if (batchField) {
    updateImportBatchSetting(batchField, normalizeCellText(input.value));
    applyImportBatchSettings();
    if (batchField === 'color') {
      const colorModeSelect = githubImportPreviewEl.querySelector<HTMLSelectElement>(
        'select[data-import-batch-field="colorMode"]'
      );
      if (colorModeSelect) colorModeSelect.value = 'custom';
    }
    if (event.type === 'change' || input instanceof HTMLSelectElement) renderImportPreview();
    return;
  }

  const index = Number(input.dataset.importIndex);
  const field = input.dataset.importField;
  const entry = pendingImportDrafts[index];
  if (!entry || !field) return;
  if (field === 'selected') {
    entry.selected = input instanceof HTMLInputElement && input.checked;
    renderImportPreview();
    return;
  }
  if (field in entry.draft) {
    updateImportDraftField(entry, field as keyof SeriesDraft, normalizeCellText(input.value));
  }
}

function updateImportBatchSetting(field: keyof ImportBatchSettings, value: string): void {
  if (field === 'colorMode') {
    pendingImportSettings.colorMode = value === 'custom' ? 'custom' : 'auto';
  } else if (field === 'marker') {
    pendingImportSettings.marker = normalizePointShapeValue(value);
  } else if (field === 'lineStyle') {
    pendingImportSettings.lineStyle = normalizeLineStyleValue(value) || DEFAULT_LINE_STYLE;
  } else if (field === 'color') {
    pendingImportSettings.color = value || colorInputFallbacks[0]!;
    pendingImportSettings.colorMode = 'custom';
  } else {
    pendingImportSettings[field] = normalizeImportSuffix(value) as never;
  }
}

function updateImportDraftField(entry: PendingImportDraft, field: keyof SeriesDraft, value: string): void {
  if (field === 'id') {
    entry.sourceDraft.id = removeImportSuffix(value, pendingImportSettings.idSuffix);
  } else if (field === 'name') {
    entry.sourceDraft.name = removeImportSuffix(value, pendingImportSettings.nameSuffix);
  } else if (field === 'title') {
    entry.sourceDraft.title = removeImportSuffix(value, pendingImportSettings.titleSuffix);
  } else if (field === 'marker') {
    entry.sourceDraft.marker = normalizePointShapeValue(value);
  } else if (field === 'lineStyle') {
    entry.sourceDraft.lineStyle = value || DEFAULT_LINE_STYLE;
  } else if (field === 'color') {
    entry.sourceDraft.color = value;
  } else {
    entry.sourceDraft[field] = value as never;
  }
  entry.draft = applyImportBatchSettingsToDraft(entry.sourceDraft);
}

function applyImportBatchSettings(): void {
  pendingImportDrafts.forEach((entry) => {
    entry.draft = applyImportBatchSettingsToDraft(entry.sourceDraft);
  });
}

function applyImportBatchSettingsToDraft(sourceDraft: SeriesDraft): SeriesDraft {
  const draft = structuredClone(sourceDraft);
  draft.id = appendImportSuffix(sourceDraft.id, pendingImportSettings.idSuffix);
  draft.name = appendImportSuffix(sourceDraft.name, pendingImportSettings.nameSuffix);
  draft.title = appendImportSuffix(sourceDraft.title, pendingImportSettings.titleSuffix);
  draft.lineStyle = pendingImportSettings.lineStyle || DEFAULT_LINE_STYLE;
  draft.marker = normalizePointShapeValue(pendingImportSettings.marker);
  if (pendingImportSettings.colorMode === 'auto') {
    draft.color = '';
  } else if (pendingImportSettings.colorMode === 'custom') {
    draft.color = pendingImportSettings.color;
  }
  return draft;
}

function appendImportSuffix(value: string, suffix: string): string {
  const trimmedValue = value.trim();
  const trimmedSuffix = normalizeImportSuffix(suffix);
  if (!trimmedSuffix) return trimmedValue;
  if (!trimmedValue) return trimmedSuffix;
  return trimmedValue.endsWith(`-${trimmedSuffix}`) ? trimmedValue : `${trimmedValue}-${trimmedSuffix}`;
}

function removeImportSuffix(value: string, suffix: string): string {
  const trimmedValue = value.trim();
  const trimmedSuffix = normalizeImportSuffix(suffix);
  if (!trimmedSuffix) return trimmedValue;
  const fullSuffix = `-${trimmedSuffix}`;
  return trimmedValue.endsWith(fullSuffix) ? trimmedValue.slice(0, -fullSuffix.length) : trimmedValue;
}

function normalizeImportSuffix(value: string): string {
  return value.trim().replace(/^-+/u, '');
}

function handleImportPreviewClick(event: MouseEvent): void {
  const styleButton = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-import-line-style-option]');
  if (styleButton) {
    pendingImportSettings.lineStyle = styleButton.dataset.importLineStyleOption || DEFAULT_LINE_STYLE;
    applyImportBatchSettings();
    renderImportPreview();
    return;
  }

  const colorPresetButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-import-color-preset]'
  );
  if (colorPresetButton) {
    pendingImportSettings.color = colorPresetButton.dataset.importColorPreset || colorInputFallbacks[0]!;
    pendingImportSettings.colorMode = 'custom';
    applyImportBatchSettings();
    renderImportPreview();
    return;
  }

  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-import-action]');
  if (!button) return;
  const action = button.dataset.importAction;
  if (action === 'select-all') {
    pendingImportDrafts.forEach((entry) => {
      entry.selected = true;
    });
    renderImportPreview();
  } else if (action === 'select-none') {
    pendingImportDrafts.forEach((entry) => {
      entry.selected = false;
    });
    renderImportPreview();
  } else if (action === 'clear-preview') {
    pendingImportDrafts = [];
    pendingImportSettings = createImportBatchSettings();
    renderImportPreview();
    setImportStatus('Pending import discarded.');
  } else if (action === 'add-selected') {
    addSelectedImportLines();
  }
}

function addSelectedImportLines(): void {
  const selectedDrafts = pendingImportDrafts
    .filter((entry) => entry.selected)
    .map((entry) => structuredClone(entry.draft));
  if (selectedDrafts.length === 0) {
    setImportStatus('Select at least one line to add.', true);
    return;
  }

  try {
    commitSeriesDom();
    placeDraftsOnTop(selectedDrafts);
    const existingSeries = draftsToSeriesAllowEmpty(seriesDrafts);
    const selectedSeries = draftsToSeries(selectedDrafts);
    currentSeries = mergeImportedSeries([...existingSeries, ...selectedSeries]);
    seriesDrafts = seriesToDrafts(currentSeries);
    sortSeriesDraftsByLayer();
    normalizeDraftRenderOrderFromPanelOrder();
    syncCurrentSeriesOrderFromDrafts();
    revealImportedSeries(selectedSeries);
    state.search = '';
    renderFilterControls();
    renderSeriesEditor();
    renderAll();
    setImportStatus(formatImportSummary(selectedSeries, currentSeries, seriesDrafts));
    pendingImportDrafts = [];
    pendingImportSettings = createImportBatchSettings();
    renderImportPreview();
    clearMergePreview();
    scheduleLocalSave();
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : 'Could not add selected import lines.', true);
  }
}

async function importGitHubActionData(): Promise<void> {
  const runUrl = githubActionUrlEl.value.trim();
  const token = githubTokenEl.value.trim();
  if (!runUrl) {
    setImportStatus('Enter a GitHub Actions run URL first.', true);
    githubActionUrlEl.focus();
    return;
  }

  importActionDataEl.disabled = true;
  try {
    setImportStatus('Fetching GitHub Actions artifacts...');
    setImportProgress(-1);
    const run = parseGitHubRunUrl(runUrl);
    const importedSeries = await loadGitHubActionSeries(run, token, (fraction) =>
      setImportProgress(fraction)
    );
    persistGitHubToken();
    stageImportedSeries(importedSeries, run.runId);
    setImportStatus(
      `Fetched ${importedSeries.length} lines. Line ID suffix defaults to ${pendingImportSettings.idSuffix}. Review, edit, then click Add Selected. Current data was not changed.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not import GitHub Actions data.';
    setImportStatus(message, true);
    if (message.toLowerCase().includes('rate limit')) githubTokenEl.focus();
  } finally {
    importActionDataEl.disabled = false;
    setImportProgress(null);
  }
}

// Stage parsed series into the review panel (shared by GitHub and file imports).
function stageImportedSeries(series: InferenceCurveSeries[], idSuffixSeed: string): void {
  pendingImportSettings = createImportBatchSettings(idSuffixSeed);
  pendingImportDrafts = seriesToDrafts(series).map((draft) => ({
    selected: true,
    sourceDraft: structuredClone({ ...draft, collapsed: true }),
    draft: applyImportBatchSettingsToDraft({ ...draft, collapsed: true })
  }));
  renderImportPreview();
}

async function importDataFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  importDataFileEl.disabled = true;
  try {
    setImportStatus(`Reading ${files.length === 1 ? files[0]!.name : `${files.length} files`}...`);
    setImportProgress(-1);
    const imported: InferenceCurveSeries[] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        imported.push(...parseImportedDataFile(file.name, bytes));
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    const merged = mergeImportedSeries(imported);
    if (merged.length === 0) {
      const suffix = failures.length ? ` Last error: ${failures.at(-1)}` : '';
      throw new Error(`No importable line data found in the selected file(s).${suffix}`);
    }
    const suffixSeed = files.length === 1 ? files[0]!.name.replace(/\.[^.]+$/u, '') : '';
    stageImportedSeries(merged, suffixSeed);
    setImportStatus(
      `Loaded ${merged.length} lines. Line ID suffix defaults to ${pendingImportSettings.idSuffix}. Review, edit, then click Add Selected. Current data was not changed.`
    );
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : 'Could not import the selected file(s).', true);
  } finally {
    importDataFileEl.disabled = false;
    importDataFileInputEl.value = '';
    setImportProgress(null);
  }
}

async function loadGitHubActionSeries(
  run: GitHubRunRef,
  token: string,
  onProgress?: (fraction: number) => void
): Promise<InferenceCurveSeries[]> {
  const preflightFailures: string[] = [];
  const isInferenceXRun = isInferenceXGitHubRun(run);
  if (isInferenceXRun) {
    try {
      setImportStatus('Fetching InferenceX unofficial run JSON...');
      onProgress?.(-1);
      const series = await loadInferenceXUnofficialRunSeries(run.runId);
      const merged = mergeImportedSeries(series);
      if (merged.length > 0) {
        if (!hasMissingAgenticP90E2ENormalizedInteractivity(merged)) {
          onProgress?.(1);
          return merged;
        }
        preflightFailures.push(
          'InferenceX unofficial run JSON is missing P90 E2E Normalized Interactivity; trying the latest results_bmk artifact.'
        );
      }
      if (merged.length === 0) {
        preflightFailures.push('InferenceX unofficial run JSON: no importable benchmark data found.');
      }
    } catch (error) {
      preflightFailures.push(
        `InferenceX unofficial run JSON: ${error instanceof Error ? error.message : 'failed'}`
      );
    }
    setImportStatus('Fetching the latest results_bmk artifact...');
  }

  const headers = makeGitHubHeaders(token);
  const downloadHeaders = makeGitHubDownloadHeaders(token);
  const artifacts = await fetchGitHubArtifacts(run, headers);
  const candidates = selectBenchmarkArtifactCandidates(artifacts, isInferenceXRun);

  if (candidates.length === 0) {
    throw new Error('No benchmark artifacts found for that GitHub Actions run.');
  }

  const imported: InferenceCurveSeries[] = [];
  const failures: string[] = [];
  onProgress?.(0);
  for (const [index, artifact] of candidates.entries()) {
    try {
      setImportStatus(
        candidates.length > 1
          ? `Downloading artifact ${index + 1}/${candidates.length}: ${artifact.name}`
          : `Downloading artifact: ${artifact.name}`
      );
      imported.push(
        ...(await loadGitHubArtifactSeries(artifact, downloadHeaders, (fraction) =>
          onProgress?.((index + fraction) / candidates.length)
        ))
      );
    } catch (error) {
      failures.push(`${artifact.name}: ${error instanceof Error ? error.message : 'failed'}`);
    }
    onProgress?.((index + 1) / candidates.length);
  }

  const merged = mergeImportedSeries(imported);
  if (merged.length === 0) {
    const allFailures = [...preflightFailures, ...failures];
    const suffix = allFailures.length ? ` Last error: ${allFailures.at(-1)}` : '';
    throw new Error(`No benchmark CSV/JSON data found in the action artifacts.${suffix}`);
  }
  return merged;
}

function hasMissingAgenticP90E2ENormalizedInteractivity(
  series: InferenceCurveSeries[]
): boolean {
  return series.some(
    (line) =>
      isAgenticTraceSequence(getSeriesIslOsl(line)) &&
      line.points.some((point) => {
        const value = point.e2eNormalizedInteractivityPercentiles?.p90;
        return typeof value !== 'number' || !Number.isFinite(value);
      })
  );
}

function selectBenchmarkArtifactCandidates(
  artifacts: GitHubArtifact[],
  preferLatestResultsBenchmark: boolean
): GitHubArtifact[] {
  const available = artifacts.filter((artifact) => !artifact.expired);
  if (preferLatestResultsBenchmark) {
    const latestResultsBenchmark = available
      .filter((artifact) => isResultsBenchmarkArtifact(artifact.name))
      .sort(compareGitHubArtifactsNewestFirst)[0];
    if (latestResultsBenchmark) return [latestResultsBenchmark];
  }

  return available
    .filter((artifact) => isBenchmarkArtifactCandidate(artifact.name))
    .sort(
      (a, b) =>
        scoreArtifactName(b.name) - scoreArtifactName(a.name) ||
        compareGitHubArtifactsNewestFirst(a, b)
    )
    .slice(0, 20);
}

function compareGitHubArtifactsNewestFirst(a: GitHubArtifact, b: GitHubArtifact): number {
  const aCreatedAt = Date.parse(a.created_at ?? '');
  const bCreatedAt = Date.parse(b.created_at ?? '');
  if (Number.isFinite(aCreatedAt) && Number.isFinite(bCreatedAt) && aCreatedAt !== bCreatedAt) {
    return bCreatedAt - aCreatedAt;
  }
  return b.id - a.id;
}

async function loadInferenceXUnofficialRunSeries(runId: string): Promise<InferenceCurveSeries[]> {
  const url = `${getInferenceXUnofficialRunApiBase()}/unofficial-run?runId=${encodeURIComponent(runId)}`;
  const value = await fetchInferenceXUnofficialRunJson(url);
  return parseJsonImport(JSON.stringify(value), `InferenceX unofficial run ${runId}`);
}

function getInferenceXUnofficialRunApiBase(): string {
  return typeof window !== 'undefined' &&
    (VITE_DEV_PORTS.has(window.location.port) ||
      ['localhost', '127.0.0.1'].includes(window.location.hostname))
    ? INFERENCEX_UNOFFICIAL_RUN_DEV_PROXY_API_BASE
    : INFERENCEX_UNOFFICIAL_RUN_REMOTE_API_BASE;
}

async function fetchInferenceXUnofficialRunJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'InferenceX unofficial run API is blocked by CORS or unreachable from this page; falling back to GitHub artifacts.',
        { cause: error }
      );
    }
    throw error;
  }
  if (!response.ok) throw new Error(await formatFetchError(response));
  return response.json() as Promise<unknown>;
}

function isInferenceXGitHubRun(run: GitHubRunRef): boolean {
  return run.owner.toLowerCase() === 'semianalysisai' && run.repo.toLowerCase() === 'inferencex';
}

function parseGitHubRunUrl(value: string): GitHubRunRef {
  const url = new URL(value);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/u);
  if (url.hostname !== 'github.com' || !match) {
    throw new Error('Use a GitHub Actions run URL like https://github.com/owner/repo/actions/runs/123.');
  }
  return { owner: match[1]!, repo: match[2]!, runId: match[3]! };
}

function makeGitHubHeaders(token: string): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function makeGitHubDownloadHeaders(token: string): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function fetchGitHubArtifacts(run: GitHubRunRef, headers: Headers): Promise<GitHubArtifact[]> {
  const artifacts: GitHubArtifact[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = `https://api.github.com/repos/${encodeURIComponent(run.owner)}/${encodeURIComponent(
      run.repo
    )}/actions/runs/${encodeURIComponent(run.runId)}/artifacts?per_page=100&page=${page}`;
    const data = await fetchGitHubJson<GitHubArtifactsResponse>(url, headers);
    artifacts.push(...(data.artifacts ?? []));
    if ((data.artifacts ?? []).length < 100) break;
  }
  return artifacts;
}

async function fetchGitHubJson<T>(url: string, headers: Headers): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(await formatFetchError(response));
  return (await response.json()) as T;
}

// GitHub's API and its artifact blob storage already send a valid
// Access-Control-Allow-Origin header, so this download works with no CORS
// extension. A CORS-unblock extension breaks it by appending a second
// Access-Control-Allow-Origin, which the browser rejects ("multiple values")
// and surfaces as an opaque TypeError. We can detect the TypeError but cannot
// undo the duplicated response header, so point the user at the real cause.
const GITHUB_ARTIFACT_FETCH_HELP =
  'Could not download the artifact zip. GitHub already sends valid CORS headers here, ' +
  'so this usually means a CORS-unblock browser extension is duplicating the ' +
  'Access-Control-Allow-Origin header and the browser rejected the response. Scope that ' +
  'extension to only inferencex.semianalysis.com (so it leaves GitHub alone), or disable it ' +
  'for this import. You can also download the zip from GitHub and use Import File.';

async function fetchArtifactArchive(
  url: string,
  headers: Headers,
  onProgress?: (fraction: number) => void
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    // A blocked/duplicated-CORS response and a real network failure both surface
    // as a TypeError here, with no way to tell them apart from JS.
    if (error instanceof TypeError) throw new Error(GITHUB_ARTIFACT_FETCH_HELP, { cause: error });
    throw error;
  }
  if (!response.ok) throw new Error(await formatFetchError(response));
  const total = Number(response.headers.get('Content-Length'));
  // Fall back to a buffered read when the stream or length is unavailable;
  // the outer loop still advances the bar once this artifact resolves.
  if (!response.body || !Number.isFinite(total) || total <= 0) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(1, received / total));
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function loadGitHubArtifactSeries(
  artifact: GitHubArtifact,
  headers: Headers,
  onProgress?: (fraction: number) => void
): Promise<InferenceCurveSeries[]> {
  const bytes = await fetchArtifactArchive(artifact.archive_download_url, headers, onProgress);
  return parseImportedZipFile(artifact.name, bytes);
}

function parseImportedDataFile(filename: string, bytes: Uint8Array): InferenceCurveSeries[] {
  if (filename.toLowerCase().endsWith('.zip')) return parseImportedZipFile(filename, bytes);
  return parseImportedArtifactFile(filename, bytes, filename);
}

function parseImportedZipFile(archiveName: string, bytes: Uint8Array): InferenceCurveSeries[] {
  const archive = unzipSync(bytes);
  const imported: InferenceCurveSeries[] = [];

  Object.entries(archive).forEach(([filename, bytes]) => {
    const series = parseImportedArtifactFile(filename, bytes, archiveName);
    imported.push(...series);
  });

  return mergeImportedSeries(imported);
}

function parseImportedArtifactFile(
  filename: string,
  bytes: Uint8Array,
  artifactName: string
): InferenceCurveSeries[] {
  const lower = filename.toLowerCase();
  if (!/\.(json|jsonl|ndjson|csv|tsv)$/u.test(lower)) return [];

  const text = strFromU8(bytes);
  const sourceName = artifactName === filename ? filename : `${artifactName}/${filename}`;
  try {
    if (lower.endsWith('.json')) return parseJsonImport(text, sourceName);
    if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return parseJsonLinesImport(text, sourceName);
    return parseTableImport(text, lower.endsWith('.tsv') ? '\t' : ',', sourceName);
  } catch {
    return [];
  }
}

function parseJsonImport(text: string, sourceName: string): InferenceCurveSeries[] {
  const value = JSON.parse(text) as unknown;
  const nativeSeries = readNativeSeries(value);
  if (nativeSeries.length > 0) return nativeSeries;
  return seriesFromBenchmarkRecords(extractBenchmarkRecords(value), sourceName);
}

function parseJsonLinesImport(text: string, sourceName: string): InferenceCurveSeries[] {
  const records = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
    .filter(isRecord);
  return seriesFromBenchmarkRecords(records, sourceName);
}

function parseTableImport(text: string, delimiter: ',' | '\t', sourceName: string): InferenceCurveSeries[] {
  const rows = parseDelimitedText(text, delimiter);
  if (rows.length < 2) return [];
  const headers = rows[0]!;
  const records = rows.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? '';
    });
    return record;
  });

  const editorSeries = seriesFromEditorRecords(records);
  if (editorSeries.length > 0) return editorSeries;
  return seriesFromBenchmarkRecords(records, sourceName);
}

function readNativeSeries(value: unknown): InferenceCurveSeries[] {
  const candidate = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.series)
      ? value.series
      : isRecord(value) && Array.isArray(value.lines)
        ? value.lines
        : null;
  if (!candidate) return [];

  const series = candidate.filter(isRecord).filter((line) => Array.isArray(line.points));
  return series.map((line, index) => ({
    id: String(line.id ?? `imported-line-${index + 1}`),
    name: String(line.name ?? `Imported Line ${index + 1}`),
    hwKey: asOptionalString(line.hwKey),
    model: asOptionalString(line.model),
    islOsl: asOptionalString(line.islOsl),
    precision: asOptionalString(line.precision),
    mtp: asOptionalString(line.mtp),
    marker: normalizePointShapeValue(asOptionalString(line.marker) ?? asOptionalString(line.shape) ?? ''),
    color: asOptionalString(line.color),
    lineStyle: asOptionalString(line.lineStyle),
    renderOrder: asOptionalNumber(line.renderOrder),
    title: asOptionalString(line.title),
    note: asOptionalString(line.note),
    points: (line.points as unknown[])
      .filter(isRecord)
      .map((point) => {
        const interactivityPercentiles = readNativeLatencyPercentiles(point.interactivityPercentiles);
        const ttftPercentiles = readNativeLatencyPercentiles(point.ttftPercentiles);
        const endToEndPercentiles = readNativeLatencyPercentiles(point.endToEndPercentiles);
        const e2eNormalizedInteractivityPercentiles =
          readNativeE2ENormalizedInteractivityPercentiles(
            point.e2eNormalizedInteractivityPercentiles
          ) ?? readImportedE2ENormalizedInteractivityPercentiles(point);
        return {
          ...point,
          interactivityPercentiles,
          ttftPercentiles,
          endToEndPercentiles,
          e2eNormalizedInteractivityPercentiles,
          interactivity: asOptionalNumber(
            point.interactivity ?? interactivityPercentiles?.p90 ?? point.median_intvty ??
              point.p90_intvty ?? point.p90_interactivity
          ),
          throughput: Number(point.throughput),
          ttft: asOptionalNumber(point.ttft ?? ttftPercentiles?.p90 ?? point.median_ttft),
          endToEnd: asOptionalNumber(
            point.endToEnd ?? endToEndPercentiles?.p90 ?? point.end_to_end ?? point.e2el ??
              point.median_e2el ?? point.p90_e2el
          )
        };
      })
      .filter((point) => Number.isFinite(point.throughput) && pointHasAnyXAxisMetric(point))
  }));
}

function extractBenchmarkRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6) return;
    if (Array.isArray(node)) {
      const objectRows = node.filter(isRecord);
      if (objectRows.some(looksLikeBenchmarkRecord)) {
        records.push(...objectRows);
        return;
      }
      node.slice(0, 20).forEach((child) => walk(child, depth + 1));
      return;
    }
    if (isRecord(node)) {
      if (looksLikeBenchmarkRecord(node)) {
        records.push(node);
        return;
      }
      Object.values(node).forEach((child) => walk(child, depth + 1));
    }
  };
  walk(value, 0);
  return records.filter(looksLikeBenchmarkRecord);
}

function looksLikeBenchmarkRecord(record: Record<string, unknown>): boolean {
  return readImportedThroughput(record) !== null && readAnyImportedXAxisMetric(record) !== null;
}

function readAnyImportedXAxisMetric(record: Record<string, unknown>): number | null {
  const isAgentic = isAgenticTraceSequence(readImportedScenario(record));
  const metricReadOptions = { preferP90: isAgentic };
  if (isAgentic) {
    const normalizedInteractivity =
      readImportedE2ENormalizedInteractivityPercentiles(record);
    if (normalizedInteractivity?.p75 !== undefined) {
      return normalizedInteractivity.p75;
    }
    if (normalizedInteractivity?.p90 !== undefined) {
      return normalizedInteractivity.p90;
    }
    for (const metric of Object.keys(latencyMetricColumns) as LatencyMetricKey[]) {
      const percentiles = readImportedLatencyPercentiles(record, metric);
      const firstValue = LATENCY_PERCENTILES.map((percentile) => percentiles?.[percentile])
        .find((value) => value !== undefined);
      if (firstValue !== undefined) return firstValue;
    }
  }
  for (const key of xMetricPointKeys) {
    const value = readImportedXAxisMetric(record, key, metricReadOptions);
    if (value !== null) return value;
  }
  return null;
}

function readImportedLatencyPercentiles(
  record: Record<string, unknown>,
  metric: LatencyMetricKey
): InferenceCurveLatencyPercentiles | undefined {
  const nestedMetric = metric === 'interactivity' ? 'intvty' : metric === 'endToEnd' ? 'e2el' : 'ttft';
  const snakeMetric = metric === 'interactivity' ? 'intvty' : metric === 'endToEnd' ? 'e2el' : 'ttft';
  const label = latencyMetricColumns[metric].label.replace(' (s)', '');
  const result: InferenceCurveLatencyPercentiles = {};
  LATENCY_PERCENTILES.forEach((percentile) => {
    const upper = percentile.toUpperCase();
    const value = readMetricNumber(record, [
      `request_metrics.latency.${nestedMetric}.${percentile}`,
      ...(percentile === 'p50'
        ? [`metrics.median_${snakeMetric}`, `median_${snakeMetric}`]
        : []),
      `metrics.${percentile}_${snakeMetric}`,
      `${percentile}_${snakeMetric}`,
      `${upper} ${label}`,
      `${upper} ${label} (s)`,
      metric === 'interactivity' ? `${upper} Interactivity (tok/s/user)` : ''
    ].filter(Boolean));
    if (value !== null) result[percentile] = value;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function readImportedE2ENormalizedInteractivityPercentiles(
  record: Record<string, unknown>
): InferenceCurveE2ENormalizedInteractivityPercentiles | undefined {
  const result: InferenceCurveE2ENormalizedInteractivityPercentiles = {};
  E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
    const value = readMetricNumber(
      record,
      getE2ENormalizedInteractivityImportAliases(percentile)
    );
    if (value !== null) result[percentile] = value;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function readImportedXAxisMetric(
  record: Record<string, unknown>,
  key: InferenceCurveXAxisMetric,
  options: { preferP90?: boolean } = {}
): number | null {
  if (key === 'interactivity') {
    const p90Aliases = [
      'request_metrics.latency.intvty.p90',
      'metrics.p90_intvty',
      'metrics.p90_interactivity',
      'p90_intvty',
      'p90_interactivity',
      'P90 Interactivity',
      'P90 Interactivity (tok/s/user)'
    ];
    const medianAliases = [
      'request_metrics.latency.intvty.p50',
      'metrics.median_intvty',
      'metrics.median_interactivity',
      'median_intvty',
      'median_interactivity',
      'Median Interactivity',
      'Median Interactivity (tok/s/user)'
    ];
    return readMetricNumber(record, options.preferP90 ? p90Aliases : medianAliases);
  }
  if (key === 'e2eNormalizedInteractivity') {
    return readImportedE2ENormalizedInteractivityPercentiles(record)?.p90 ?? null;
  }
  if (key === 'ttft') {
    const p90Aliases = [
      'request_metrics.latency.ttft.p90',
      'metrics.p90_ttft',
      'p90_ttft',
      'P90 TTFT',
      'P90 TTFT (s)',
      'P90 Time To First Token',
      'P90 Time To First Token (s)'
    ];
    const medianAliases = [
      'request_metrics.latency.ttft.p50',
      'metrics.median_ttft',
      'median_ttft',
      'Median TTFT',
      'Median TTFT (s)',
      'Median Time To First Token',
      'Median Time To First Token (s)'
    ];
    return readMetricNumber(record, options.preferP90 ? p90Aliases : medianAliases);
  }
  if (key === 'endToEnd') {
    const p90Aliases = [
      'request_metrics.latency.e2el.p90',
      'metrics.p90_e2el',
      'metrics.p90_end_to_end',
      'p90_e2el',
      'p90_end_to_end',
      'P90 End-to-end Latency',
      'P90 End-to-end Latency (s)'
    ];
    const medianAliases = [
      'request_metrics.latency.e2el.p50',
      'metrics.median_e2el',
      'metrics.median_end_to_end',
      'median_e2el',
      'median_end_to_end',
      'Median End-to-end Latency',
      'Median End-to-end Latency (s)',
      'Median E2E Latency',
      'Median E2E Latency (s)'
    ];
    return readMetricNumber(record, options.preferP90 ? p90Aliases : medianAliases);
  }
  return null;
}

function readImportedThroughput(record: Record<string, unknown>): number | null {
  return readMetricNumber(record, [
    'request_metrics.throughput.per_gpu.total_tput_tps',
    'metrics.tput_per_gpu',
    'tput_per_gpu',
    'throughput_per_gpu',
    'token throughput per gpu',
    'token throughput per gpu (tok/s/gpu)',
    'throughput',
    'Throughput/GPU',
    'Throughput/GPU (tok/s/gpu)',
    'tok/s/gpu',
    'y'
  ]);
}

// Extra header aliases so a CSV produced by Download CSV (whose headers carry
// units / different wording) round-trips through the editor import path.
const POINT_IMPORT_ALIASES: Record<string, string[]> = {
  interactivity: [
    'interactivity',
    'Interactivity (tok/s/user)',
    'P90 Interactivity',
    'P90 Interactivity (tok/s/user)',
    'median_intvty',
    'p90_intvty',
    'p90_interactivity',
    'metrics.median_intvty',
    'metrics.p90_intvty',
    'metrics.p90_interactivity',
    'tok/s/user'
  ],
  throughput: ['throughput', 'Throughput/GPU', 'Throughput/GPU (tok/s/gpu)', 'tok/s/gpu'],
  ttft: [
    'ttft',
    'TTFT',
    'TTFT (s)',
    'Time To First Token',
    'Time To First Token (s)',
    'P90 TTFT',
    'P90 TTFT (s)',
    'P90 Time To First Token',
    'P90 Time To First Token (s)',
    'median_ttft',
    'p90_ttft',
    'metrics.median_ttft',
    'metrics.p90_ttft'
  ],
  endToEnd: [
    'endToEnd',
    'end_to_end',
    'End-to-end',
    'End-to-end (s)',
    'End-to-end Latency',
    'End-to-end Latency (s)',
    'E2E',
    'E2E Latency',
    'E2E Latency (s)',
    'e2el',
    'median_e2el',
    'p90_e2el',
    'p90_end_to_end',
    'P90 End-to-end Latency',
    'P90 End-to-end Latency (s)',
    'metrics.median_e2el',
    'metrics.p90_e2el',
    'metrics.p90_end_to_end'
  ],
  shape: ['shape', 'Marker', 'Point Marker'],
  dp_attention: ['dp_attention', 'DPA', 'DP Attention'],
  prefill_num_workers: ['prefill_num_workers', 'Prefill Workers', 'Prefill Worker', 'prefill workers'],
  decode_num_workers: ['decode_num_workers', 'Decode Workers', 'Decode Worker', 'decode workers'],
  disagg: ['disagg', 'Disagg', 'disaggregated'],
  is_multinode: ['is_multinode', 'multi_node', 'multinode', 'Multi-node', 'Multi node'],
  spec_decoding: ['spec_decoding', 'spec_method', 'Speculative Decoding'],
  kv_offload: [
    'kv_offload',
    'KV Offload',
    'kv offload',
    'kv_offloading',
    'KV Offloading',
    'kv offloading',
    'offload',
    'offload_mode',
    'Offload Mode',
    'offload mode'
  ],
  server_gpu_cache_hit_rate: [
    'server_gpu_cache_hit_rate',
    'server_metrics.cache.gpu_cache_hit_rate',
    'server_metrics.cache.server_gpu_cache_hit_rate',
    'request_metrics.cache.gpu_cache_hit_rate',
    'Chip Cache Hit Rate',
    'GPU Cache Hit Rate'
  ],
  server_external_cache_hit_rate: [
    'server_external_cache_hit_rate',
    'server_metrics.cache.external_cache_hit_rate',
    'request_metrics.cache.external_cache_hit_rate',
    'External Cache Hit Rate'
  ],
  server_cpu_cache_hit_rate: [
    'server_cpu_cache_hit_rate',
    'server_metrics.cache.cpu_cache_hit_rate',
    'request_metrics.cache.cpu_cache_hit_rate',
    'CPU Cache Hit Rate'
  ],
  theoretical_cache_hit_rate: [
    'theoretical_cache_hit_rate',
    'request_metrics.cache.theoretical_cache_hit_rate',
    'derived_agentic_metrics.cache.theoretical_cache_hit_rate',
    'Theoretical Cache Hit Rate'
  ]
};

(Object.keys(latencyMetricColumns) as LatencyMetricKey[]).forEach((metric) => {
  LATENCY_PERCENTILES.forEach((percentile) => {
    POINT_IMPORT_ALIASES[latencyMetricColumns[metric].rowKeys[percentile]] =
      getLatencyPercentileImportAliases(metric, percentile);
  });
});
E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
  POINT_IMPORT_ALIASES[e2eNormalizedInteractivityRowKeys[percentile]] =
    getE2ENormalizedInteractivityImportAliases(percentile);
});

function getLatencyPercentileImportAliases(
  metric: LatencyMetricKey,
  percentile: InferenceCurveLatencyPercentile
): string[] {
  const nestedMetric = metric === 'interactivity' ? 'intvty' : metric === 'endToEnd' ? 'e2el' : 'ttft';
  const upper = percentile.toUpperCase();
  const label = latencyMetricColumns[metric].label.replace(' (s)', '');
  return [
    getLatencyPercentileCsvHeader(metric, percentile),
    `${upper} ${label}`,
    `${percentile}_${nestedMetric}`,
    `metrics.${percentile}_${nestedMetric}`,
    `request_metrics.latency.${nestedMetric}.${percentile}`
  ];
}

function getLatencyPercentileCsvHeader(
  metric: LatencyMetricKey,
  percentile: InferenceCurveLatencyPercentile
): string {
  const upper = percentile.toUpperCase();
  if (metric === 'interactivity') return `${upper} Interactivity (tok/s/user)`;
  if (metric === 'ttft') return `${upper} TTFT (s)`;
  return `${upper} End-to-end (s)`;
}

function getE2ENormalizedInteractivityImportAliases(
  percentile: InferenceCurveE2ENormalizedInteractivityPercentile
): string[] {
  const upper = percentile.toUpperCase();
  return [
    getE2ENormalizedInteractivityCsvHeader(percentile),
    `${upper} E2E Normalized Interactivity`,
    `${percentile}_e2e_norm_intvty`,
    `metrics.${percentile}_e2e_norm_intvty`,
    `derived_agentic_metrics.${percentile}_e2e_norm_intvty`,
    `request_metrics.latency.e2e_norm_intvty.${percentile}`,
    `e2e_normalized_interactivity.${percentile}`,
    `e2eNormalizedInteractivityPercentiles.${percentile}`
  ];
}

function getE2ENormalizedInteractivityCsvHeader(
  percentile: InferenceCurveE2ENormalizedInteractivityPercentile
): string {
  return `${percentile.toUpperCase()} E2E Normalized Interactivity (tok/s/user)`;
}

function readEditorColor(record: Record<string, unknown>): string {
  const explicit = readMetricString(record, ['color']);
  if (explicit) return explicit;
  // Download CSV emits "Color Mode" + "Resolved Color"; keep the resolved value
  // only when the line used a custom color, otherwise fall back to auto.
  const mode = readMetricString(record, ['color mode', 'colormode']);
  if (mode.toLowerCase() === 'custom') return readMetricString(record, ['resolved color', 'resolvedcolor']);
  return '';
}

function seriesFromEditorRecords(records: Record<string, unknown>[]): InferenceCurveSeries[] {
  const hasEditorRows = records.some((record) => readMetricString(record, ['series_id', 'line id', 'line_id']) !== '');
  if (!hasEditorRows) return [];

  const drafts = new Map<string, SeriesDraft>();
  records.forEach((record, rowIndex) => {
    const id = readMetricString(record, ['series_id', 'line id', 'line_id']) || `imported-line-${rowIndex + 1}`;
    const name = readMetricString(record, ['series_name', 'line name', 'name']) || id;
    const title = readMetricString(record, ['title']);
    const note = readMetricString(record, ['line note', 'line_note', 'series note', 'series_note']);
    const rawMtp = readMetricString(record, ['mtp', 'MTP']);
    const draft =
      drafts.get(id) ??
      ({
        id,
        name,
        model: getInferenceXDisplayModel(readMetricString(record, ['model']) || getDefaultDraftModel()),
        hwKey: readMetricString(record, ['hwKey', 'hw_key', 'hw key', 'hardware']) || undefined,
        islOsl: readEditorSequence(record) || getDefaultDraftIslOsl(),
        precision: readMetricString(record, ['precision']) || getDefaultDraftPrecision(),
        mtp: rawMtp ? normalizeMtpValue(rawMtp) : inferMtpFilterFromTokens(`${id} ${name} ${title}`),
        marker: normalizePointShapeValue(
          readMetricString(record, ['line_marker', 'line marker', 'series_marker', 'series marker'])
        ),
        title,
        note,
        color: readEditorColor(record),
        lineStyle: readMetricString(record, ['lineStyle', 'line type', 'linestyle']) || DEFAULT_LINE_STYLE,
        renderOrder: readMetricNumber(record, ['renderOrder', 'render order', 'layer', 'z-index', 'z index']) ?? rowIndex,
        collapsed: true,
        points: []
      } satisfies SeriesDraft);

    const point = makeEmptyPointRow();
    [
      ...pointColumns.map((column) => column.key),
      ...latencyPercentilePointKeys,
      ...e2eNormalizedInteractivityPointKeys,
      ...hiddenPointKeys
    ].forEach((key) => {
      const column = pointColumns.find((item) => item.key === key);
      const aliases = POINT_IMPORT_ALIASES[key] ?? [key, column?.label ?? key];
      const value = readMetricString(record, aliases);
      if (value) point[key] = value;
    });
    if (!isEmptyPointRow(point)) {
      if (isAgenticTraceSequence(draft.islOsl) && !point.spec_decoding && rawMtp) {
        point.spec_decoding = normalizeMtpValue(rawMtp) === MTP_VALUE ? 'mtp' : 'none';
      }
      draft.points.push(point);
    }
    drafts.set(id, draft);
  });

  return draftsToSeries(Array.from(drafts.values()).filter((draft) => draft.points.length > 0));
}

function readEditorSequence(record: Record<string, unknown>): string {
  const explicitSequence = readMetricString(record, ['islOsl', 'isl/osl', 'sequence', 'sequence length']);
  if (explicitSequence) return explicitSequence;
  const scenario = readMetricString(record, ['scenario']);
  return isImportedAgenticScenario(scenario) ? 'Agentic Traces' : scenario;
}

function seriesFromBenchmarkRecords(
  records: Record<string, unknown>[],
  sourceName: string
): InferenceCurveSeries[] {
  const grouped = new Map<string, InferenceCurveSeries>();
  records.forEach((record) => {
    const imported = importedPointFromBenchmarkRecord(record, sourceName);
    if (!imported) return;
    const key = [
      imported.model,
      imported.islOsl,
      imported.precision,
      imported.mtp,
      imported.hardware,
      imported.framework,
      imported.specMethod
    ].join('|');
    const line =
      grouped.get(key) ??
      ({
        id: makeLineId(imported),
        name: imported.lineName,
        hwKey: normalizeImportedKey(imported.hardware),
        model: imported.model,
        islOsl: imported.islOsl,
        precision: imported.precision,
        mtp: imported.mtp,
        title: imported.title,
        renderOrder: grouped.size,
        points: []
      } satisfies InferenceCurveSeries);
    line.points.push(imported.point);
    grouped.set(key, line);
  });

  return Array.from(grouped.values()).map((line) => ({
    ...line,
    points: line.points.sort(
      (a, b) =>
        compareOptionalNumbers(a.interactivity, b.interactivity) ||
        compareOptionalNumbers(
          a.e2eNormalizedInteractivityPercentiles?.p90 ??
            a.e2eNormalizedInteractivityPercentiles?.p75,
          b.e2eNormalizedInteractivityPercentiles?.p90 ??
            b.e2eNormalizedInteractivityPercentiles?.p75
        ) ||
        compareOptionalNumbers(a.endToEnd, b.endToEnd) ||
        compareOptionalNumbers(a.ttft, b.ttft) ||
        a.throughput - b.throughput
    )
  }));
}

function importedPointFromBenchmarkRecord(
  record: Record<string, unknown>,
  sourceName: string
): ImportedPointRow | null {
  const scenario = readImportedScenario(record);
  const isAgentic = isAgenticTraceSequence(scenario);
  const metricReadOptions = { preferP90: isAgentic };
  const interactivityPercentiles = isAgentic
    ? readImportedLatencyPercentiles(record, 'interactivity')
    : undefined;
  const ttftPercentiles = isAgentic ? readImportedLatencyPercentiles(record, 'ttft') : undefined;
  const endToEndPercentiles = isAgentic
    ? readImportedLatencyPercentiles(record, 'endToEnd')
    : undefined;
  const e2eNormalizedInteractivityPercentiles = isAgentic
    ? readImportedE2ENormalizedInteractivityPercentiles(record)
    : undefined;
  const interactivity = interactivityPercentiles?.p90 ??
    readImportedXAxisMetric(record, 'interactivity', metricReadOptions);
  const throughput = readImportedThroughput(record);
  const ttft = ttftPercentiles?.p90 ?? readImportedXAxisMetric(record, 'ttft', metricReadOptions);
  const endToEnd = endToEndPercentiles?.p90 ??
    readImportedXAxisMetric(record, 'endToEnd', metricReadOptions);
  if (
    throughput === null ||
    (
      interactivity === null &&
      ttft === null &&
      endToEnd === null &&
      interactivityPercentiles === undefined &&
      ttftPercentiles === undefined &&
      endToEndPercentiles === undefined &&
      e2eNormalizedInteractivityPercentiles === undefined
    )
  ) {
    return null;
  }

  const hardware =
    normalizeImportedHardware(readMetricString(record, ['hardware', 'hw_key', 'hwKey', 'hw', 'gpu', 'accelerator'])) ||
    'unknown';
  const framework = readMetricString(record, ['framework', 'backend', 'runtime']) || 'unknown';
  const specMethod = resolveImportedSpecMethod(record);
  const mtp = specMethod === MTP_VALUE ? MTP_VALUE : NON_MTP_VALUE;
  const model = formatImportedModelFromRecord(record, sourceName);
  const precision = (readMetricString(record, ['precision', 'dtype', 'quantization']) || DEFAULT_PRECISION).toLowerCase();
  const isl = readMetricNumber(record, ['isl', 'input_len', 'input_length', 'input sequence length', 'input_tokens']);
  const osl = readMetricNumber(record, ['osl', 'output_len', 'output_length', 'output sequence length', 'output_tokens']);
  const islOsl = isImportedAgenticScenario(scenario)
    ? 'Agentic Traces'
    : isl !== null && osl !== null
      ? `ISL ${isl} / OSL ${osl}`
      : scenario
        ? formatScenarioLabel(scenario)
        : DEFAULT_ISL_OSL;
  const offload = readImportedOffloadConfig(record);
  const lineName = formatImportedLineName(hardware, framework, isAgentic ? '' : specMethod);
  const title = `${model} ${islOsl} ${precision.toUpperCase()} ${lineName}`;
  const prefillGpu = readMetricNumber(record, ['num_prefill_gpu', 'prefill gpus', 'prefill_gpu']);
  const decodeGpu = readMetricNumber(record, ['num_decode_gpu', 'decode gpus', 'decode_gpu']);
  const prefillTp = readMetricNumber(record, ['prefill_tp', 'prefill tp']);
  const prefillEp = readMetricNumber(record, ['prefill_ep', 'prefill ep']);
  const commonDcp = readMetricNumber(record, ['dcp_size', 'dcp size', 'metrics.dcp_size']);
  const prefillDcp = readMetricNumber(record, [
    'prefill_dcp_size',
    'prefill dcp',
    'metrics.prefill_dcp_size'
  ]) ?? commonDcp;
  const decodeTp = readMetricNumber(record, ['decode_tp', 'decode tp', 'tp']);
  const decodeEp = readMetricNumber(record, ['decode_ep', 'decode ep', 'ep']);
  const decodeDcp = readMetricNumber(record, [
    'decode_dcp_size',
    'decode dcp',
    'metrics.decode_dcp_size'
  ]) ?? commonDcp;
  const prefillDpa =
    readMetricBoolean(record, ['prefill_dp_attention', 'prefill dpa']) ??
    readMetricBoolean(record, ['dp_attention', 'dpa']);
  const decodeDpa =
    readMetricBoolean(record, ['decode_dp_attention', 'decode dpa']) ??
    readMetricBoolean(record, ['dp_attention', 'dpa']);
  const date = readMetricString(record, ['date', 'created_at', 'run_date', 'timestamp']);
  const concurrency = readMetricNumber(record, ['conc', 'concurrency', 'batch_size']);
  const shape = normalizePointShapeValue(
    readMetricString(record, ['shape', 'marker', 'point_shape', 'point shape'])
  );
  const disagg = readMetricBoolean(record, ['disagg']) ?? false;
  const totalGpu = getInferenceCurvePointGpuCount({
    throughput,
    num_prefill_gpu: prefillGpu ?? undefined,
    num_decode_gpu: decodeGpu ?? undefined,
    disagg,
    tp: decodeTp ?? undefined
  });
  const serverGpuCacheHitRate = readMetricNumber(record, [
    'server_gpu_cache_hit_rate',
    'metrics.server_gpu_cache_hit_rate',
    'server_metrics.cache.gpu_cache_hit_rate',
    'server_metrics.cache.server_gpu_cache_hit_rate',
    'request_metrics.cache.gpu_cache_hit_rate',
    'chip cache hit rate',
    'gpu cache hit rate'
  ]);
  const serverExternalCacheHitRate = readMetricNumber(record, [
    'server_external_cache_hit_rate',
    'metrics.server_external_cache_hit_rate',
    'server_metrics.cache.external_cache_hit_rate',
    'request_metrics.cache.external_cache_hit_rate',
    'external cache hit rate'
  ]);
  const serverCpuCacheHitRate = readMetricNumber(record, [
    'server_cpu_cache_hit_rate',
    'metrics.server_cpu_cache_hit_rate',
    'server_metrics.cache.cpu_cache_hit_rate',
    'request_metrics.cache.cpu_cache_hit_rate',
    'cpu cache hit rate'
  ]);
  const theoreticalCacheHitRate = readMetricNumber(record, [
    'theoretical_cache_hit_rate',
    'metrics.theoretical_cache_hit_rate',
    'request_metrics.cache.theoretical_cache_hit_rate',
    'derived_agentic_metrics.cache.theoretical_cache_hit_rate',
    'theoretical cache hit rate'
  ]);

  const point: InferenceCurveSeries['points'][number] = {
    throughput,
    precision,
    strategy: makeStrategyLabel(decodeTp, decodeEp, decodeDcp),
    tp: totalGpu ?? decodeTp ?? undefined,
    disagg,
    concurrency: concurrency ?? undefined,
    label: makeImportedPointLabel(
      date,
      prefillTp,
      prefillEp,
      prefillGpu,
      decodeGpu,
      prefillDpa,
      decodeDpa,
      offload.label,
      sourceName
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
  if (prefillGpu !== null) point.num_prefill_gpu = prefillGpu;
  if (decodeGpu !== null) point.num_decode_gpu = decodeGpu;
  if (prefillTp !== null) point.prefill_tp = prefillTp;
  if (prefillEp !== null) point.prefill_ep = prefillEp;
  if (prefillDcp !== null) point.prefill_dcp_size = prefillDcp;
  if (decodeTp !== null) point.decode_tp = decodeTp;
  if (decodeEp !== null) point.decode_ep = decodeEp;
  if (decodeDcp !== null) point.decode_dcp_size = decodeDcp;
  if (prefillDpa !== undefined) point.prefill_dp_attention = prefillDpa;
  if (decodeDpa !== undefined) point.decode_dp_attention = decodeDpa;
  if (prefillDpa !== undefined && prefillDpa === decodeDpa) point.dp_attention = prefillDpa;
  if (offload.label) point.kv_offload = offload.label;
  if (isAgentic) point.spec_decoding = specMethod;
  if (serverGpuCacheHitRate !== null) point.server_gpu_cache_hit_rate = serverGpuCacheHitRate;
  if (serverExternalCacheHitRate !== null) {
    point.server_external_cache_hit_rate = serverExternalCacheHitRate;
  }
  if (serverCpuCacheHitRate !== null) point.server_cpu_cache_hit_rate = serverCpuCacheHitRate;
  if (theoreticalCacheHitRate !== null) {
    point.theoretical_cache_hit_rate = theoreticalCacheHitRate;
  }
  if (shape) point.shape = shape;
  point.prefill_num_workers = readMetricNumber(record, ['prefill_num_workers', 'prefill workers']) ?? undefined;
  point.decode_num_workers = readMetricNumber(record, ['decode_num_workers', 'decode workers']) ?? undefined;
  point.is_multinode = readMetricBoolean(record, ['is_multinode', 'multi_node', 'multinode']) ?? undefined;

  return {
    interactivity: interactivity ?? undefined,
    throughput,
    model,
    islOsl,
    precision,
    mtp: isAgentic ? '' : mtp,
    hardware,
    framework,
    specMethod: isAgentic ? '' : specMethod,
    lineName,
    title,
    point
  };
}

function readImportedScenario(record: Record<string, unknown>): string {
  return readMetricString(record, [
    'scenario',
    'benchmark_scenario',
    'scenario type',
    'scenario_type',
    'metrics.scenario_type',
    'benchmark type',
    'benchmark_type',
    'metrics.benchmark_type',
    'workload',
    'workload_type',
    'trace',
    'trace_type',
    'dataset',
    'task'
  ]);
}

function isImportedAgenticScenario(value: string): boolean {
  return isAgenticTraceSequence(value);
}

function makeImportedPointLabel(
  date: string,
  prefillTp: number | null,
  prefillEp: number | null,
  prefillGpu: number | null,
  decodeGpu: number | null,
  prefillDpa: boolean | undefined,
  decodeDpa: boolean | undefined,
  offloadLabel: string,
  sourceName: string
): string {
  return [
    date ? `date ${date}` : '',
    prefillTp !== null || prefillEp !== null ? `prefill TP${prefillTp ?? '?'} EP${prefillEp ?? '?'}` : '',
    decodeGpu !== null ? `decode GPUs ${decodeGpu}` : '',
    prefillGpu !== null ? `prefill GPUs ${prefillGpu}` : '',
    prefillDpa !== undefined ? `prefill DPA ${prefillDpa}` : '',
    decodeDpa !== undefined ? `decode DPA ${decodeDpa}` : '',
    offloadLabel ? offloadLabel : '',
    `source ${sourceName}`
  ]
    .filter(Boolean)
    .join('; ');
}

function mergeImportedSeries(series: InferenceCurveSeries[]): InferenceCurveSeries[] {
  const merged = new Map<string, InferenceCurveSeries>();
  series.forEach((line) => {
    const existing = merged.get(line.id);
    if (!existing) {
      merged.set(line.id, { ...line, points: [...line.points] });
      return;
    }
    existing.points.push(...line.points);
  });

  return Array.from(merged.values()).map((line) => {
    const seen = new Set<string>();
    const points = line.points.filter((point) => {
      const key = JSON.stringify([
        point.interactivity,
        point.interactivityPercentiles,
        point.throughput,
        point.ttft,
        point.ttftPercentiles,
        point.endToEnd,
        point.endToEndPercentiles,
        point.e2eNormalizedInteractivityPercentiles,
        point.kv_offload,
        point.spec_decoding,
        point.prefill_dcp_size,
        point.decode_dcp_size,
        point.server_gpu_cache_hit_rate,
        point.server_external_cache_hit_rate,
        point.server_cpu_cache_hit_rate,
        point.theoretical_cache_hit_rate,
        point.precision,
        point.concurrency,
        point.label
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...line, points };
  });
}

function formatImportSummary(
  importedSeries: InferenceCurveSeries[],
  allSeries: InferenceCurveSeries[],
  drafts: SeriesDraft[]
): string {
  const importedPointRows = importedSeries.reduce((count, line) => count + line.points.length, 0);
  const importedLines = importedSeries
    .map((line) => `${line.name} (${line.points.length})`)
    .sort((a, b) => a.localeCompare(b));
  const visibleLines = importedLines.slice(0, 8).join('; ');
  const hiddenCount = Math.max(0, importedLines.length - 8);
  const suffix = hiddenCount > 0 ? `; +${hiddenCount} more` : '';
  return [
    `Appended ${importedSeries.length} lines / ${importedPointRows} point rows.`,
    `Imported lines: ${visibleLines || 'none'}${suffix}.`,
    `Current data: ${allSeries.length} lines, ${countPointRows(drafts)} point rows.`
  ].join(' ');
}

function scoreArtifactName(name: string): number {
  const value = name.toLowerCase();
  let score = 0;
  if (isResultsBenchmarkArtifact(value)) score += 30;
  if (/(^|[-_])bmk($|[-_])/u.test(value)) score += 24;
  if (/benchmark|bench/u.test(value)) score += 16;
  if (/metric|summary/u.test(value)) score += 8;
  return score;
}

function isResultsBenchmarkArtifact(name: string): boolean {
  return /^results?[-_]?bmk$/u.test(name.toLowerCase());
}

function isBenchmarkArtifactCandidate(name: string): boolean {
  const value = name.toLowerCase();
  if (/eval|run[-_]?stats|samples?|log|trace|profile/u.test(value)) return false;
  return isResultsBenchmarkArtifact(value) || /(^|[-_])bmk($|[-_])/u.test(value) || /benchmark|bench/u.test(value);
}

function parseDelimitedText(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(normalizeCellText(cell));
      cell = '';
    } else if (char === '\n' && !quoted) {
      row.push(normalizeCellText(cell));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(normalizeCellText(cell));
    rows.push(row);
  }
  return rows.filter((item) => item.some((cellValue) => cellValue));
}

function readMetricNumber(record: Record<string, unknown>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const value = readMetricValue(record, alias);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseNumber(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function readMetricString(record: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = readMetricValue(record, alias);
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function readMetricBoolean(record: Record<string, unknown>, aliases: string[]): boolean | undefined {
  for (const alias of aliases) {
    const value = readMetricValue(record, alias);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const parsed = parseBoolean(value);
      if (parsed !== null) return parsed;
    }
  }
  return undefined;
}

function readMetricValue(record: Record<string, unknown>, alias: string): unknown {
  if (alias.includes('.')) {
    const pathValue = readPathValue(record, alias.split('.'));
    if (pathValue !== undefined) return pathValue;
  }
  const wanted = normalizeImportKey(alias);
  for (const [key, value] of Object.entries(record)) {
    if (normalizeImportKey(key) === wanted) return value;
  }
  return undefined;
}

function readPathValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = readMetricValue(current, segment);
  }
  return current;
}

function normalizeImportKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function formatImportedModelFromRecord(record: Record<string, unknown>, sourceName: string): string {
  const modelKey = resolveImportedModelKey(record) ?? resolveModelKeyFromText(sourceName);
  if (modelKey) return DB_MODEL_TO_DISPLAY[modelKey] ?? modelKey;

  const rawModel = readMetricString(record, ['model', 'model_name', 'model name']);
  return formatUnknownImportedModel(rawModel);
}

function resolveImportedModelKey(record: Record<string, unknown>): string | null {
  const prefix = readMetricString(record, [
    'infmax_model_prefix',
    'model_prefix',
    'model key',
    'model_key',
    'db_model',
    'db model'
  ]);
  const prefixKey = resolveModelKeyFromPrefix(prefix);
  if (prefixKey) return prefixKey;

  const rawModel = readMetricString(record, ['model', 'model_name', 'model name']);
  return resolveModelKeyFromModelValue(rawModel);
}

function resolveModelKeyFromPrefix(value: string): string | null {
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (DB_MODEL_TO_DISPLAY[lower]) return lower;
  if (MODEL_PREFIX_ALIASES[lower]) return MODEL_PREFIX_ALIASES[lower]!;

  const stripped = lower.replace(MODEL_KEY_PRECISION_SUFFIX, '');
  if (DB_MODEL_TO_DISPLAY[stripped]) return stripped;
  return MODEL_PREFIX_ALIASES[stripped] ?? null;
}

function resolveModelKeyFromModelValue(value: string): string | null {
  if (getInferenceXDisplayModel(value) === DB_MODEL_TO_DISPLAY.dsv4) return 'dsv4';
  const lower = value.trim().toLowerCase();
  if (!lower) return null;

  const directPrefix = resolveModelKeyFromPrefix(lower);
  if (directPrefix) return directPrefix;

  const directPath = MODEL_PATH_TO_DB_KEY[lower];
  if (directPath) return directPath;

  const pathTail = lower.split(/[\\/]/u).filter(Boolean).at(-1) ?? '';
  const tailPrefix = resolveModelKeyFromPrefix(pathTail);
  if (tailPrefix) return tailPrefix;

  const compact = lower.replace(/[^a-z0-9]+/gu, '');
  const compactAliases: Record<string, string> = {
    deepseekr10528: 'dsr1',
    deepseekr1: 'dsr1',
    gptoss120b: 'gptoss120b',
    llama3370binstructfp8: 'llama70b',
    qwen35397ba17b: 'qwen3.5',
    kimik25: 'kimik2.5',
    minimaxm25: 'minimaxm2.5',
    glm5: 'glm5',
    deepseekv4pro: 'dsv4'
  };
  return compactAliases[compact] ?? null;
}

function resolveModelKeyFromText(value: string): string | null {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9.]+/u)
    .filter(Boolean);
  for (const token of tokens) {
    const key = resolveModelKeyFromPrefix(token);
    if (key) return key;
  }
  return null;
}

function formatUnknownImportedModel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_MODEL;
  return trimmed.split(/[\\/]/u).filter(Boolean).at(-1) ?? trimmed;
}

function resolveImportedSpecMethod(record: Record<string, unknown>): string {
  const rawMtp = readMetricString(record, ['mtp']);
  if (rawMtp && normalizeMtpValue(rawMtp) === MTP_VALUE) return MTP_VALUE;
  return normalizeImportedSpecMethod(
    readMetricString(record, ['spec_method', 'spec method', 'spec_decoding', 'spec decoding', 'speculation'])
  );
}

function normalizeImportedSpecMethod(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['none', 'off', 'false', 'no', 'n', '0'].includes(normalized)) return 'none';
  if (['mtp', 'on', 'true', 'yes', 'y', '1'].includes(normalized)) return MTP_VALUE;
  return normalized;
}

function readImportedOffloadConfig(record: Record<string, unknown>): { key: string; label: string } {
  const mode = readMetricString(record, ['offload_mode', 'offload mode', 'metrics.offload_mode']);
  const kvOffloading = readMetricString(record, ['kv_offloading', 'kv offloading', 'metrics.kv_offloading']);
  const backend = readMetricString(record, [
    'kv_offload_backend.name',
    'metrics.kv_offload_backend.name',
    'kv_offload_backend',
    'kv offload backend',
    'metrics.kv_offload_backend'
  ]);
  if (!mode && !kvOffloading && !backend) return { key: '', label: '' };

  const modeEnabled = normalizeOffloadFlag(mode);
  const kvEnabled = kvOffloading ? normalizeOffloadFlag(kvOffloading) : null;
  const enabled = modeEnabled ?? kvEnabled ?? Boolean(backend);
  if (!enabled) return { key: 'offload-off', label: 'KV offload off' };

  const target = normalizeOffloadPart(kvOffloading) || normalizeOffloadPart(mode) || 'on';
  const backendKey = normalizeOffloadPart(backend);
  const label = [
    'KV offload',
    target === 'on' ? 'on' : target.toUpperCase(),
    backendKey ? `via ${formatFrameworkLabel(backendKey)}` : ''
  ]
    .filter(Boolean)
    .join(' ');
  return {
    key: ['offload', target, backendKey].filter(Boolean).join('-'),
    label
  };
}

function normalizeOffloadFlag(value: string): boolean | null {
  const normalized = normalizeOffloadPart(value);
  if (!normalized) return null;
  if (['off', 'none', 'false', 'no', 'n', '0', 'disabled', 'disable'].includes(normalized)) return false;
  if (['on', 'true', 'yes', 'y', '1', 'enabled', 'enable'].includes(normalized)) return true;
  return true;
}

function normalizeOffloadPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

function formatImportedLineName(
  hardware: string,
  framework: string,
  specMethod: string
): string {
  const hardwareLabel = formatHardwareLabel(hardware);
  const frameworkLabel = formatFrameworkLabel(framework);
  const suffix = specMethod === MTP_VALUE ? ' MTP' : '';
  return frameworkLabel === 'Unknown'
    ? [hardwareLabel, suffix.trim()].filter(Boolean).join(' ')
    : `${hardwareLabel} (${frameworkLabel}${suffix})`;
}

function normalizeImportedHardware(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return '';
  const unscoped = lower.replace(/^cluster:/u, '');
  const base = unscoped.split('-')[0]!;
  const known = new Set(['gb300', 'gb200', 'b300', 'b200', 'h200', 'h100', 'mi355x', 'mi325x', 'mi300x']);
  return known.has(base) ? base : lower;
}

function formatHardwareLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join(' ');
}

function formatFrameworkLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Unknown';
  const replacements: Record<string, string> = {
    mori: 'MoRI',
    sglang: 'SGLang',
    dynamo: 'Dynamo',
    trt: 'TRT',
    tensorrt: 'TRT',
    vllm: 'vLLM',
    lmcache: 'LMCache'
  };
  return normalized
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => replacements[part] ?? part.toUpperCase())
    .join(' ');
}

function makeLineId(imported: ImportedPointRow): string {
  return [
    imported.model,
    imported.islOsl,
    imported.precision,
    imported.hardware,
    imported.framework,
    imported.specMethod
  ]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function normalizeImportedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readNativeLatencyPercentiles(
  value: unknown
): InferenceCurveLatencyPercentiles | undefined {
  if (!isRecord(value)) return undefined;
  const result: InferenceCurveLatencyPercentiles = {};
  LATENCY_PERCENTILES.forEach((percentile) => {
    const parsed = asOptionalNumber(value[percentile]);
    if (parsed !== undefined) result[percentile] = parsed;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function readNativeE2ENormalizedInteractivityPercentiles(
  value: unknown
): InferenceCurveE2ENormalizedInteractivityPercentiles | undefined {
  if (!isRecord(value)) return undefined;
  const result: InferenceCurveE2ENormalizedInteractivityPercentiles = {};
  E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.forEach((percentile) => {
    const parsed = asOptionalNumber(value[percentile]);
    if (parsed !== undefined) result[percentile] = parsed;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

async function formatFetchError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  const parsedMessage = parseGitHubErrorMessage(text);
  if (response.status === 403 && parsedMessage.toLowerCase().includes('rate limit')) {
    const resetAt = formatRateLimitReset(response.headers.get('x-ratelimit-reset'));
    return [
      'GitHub API rate limit exceeded.',
      'Paste a GitHub token in the Token field and retry.',
      resetAt ? `Unauthenticated limit resets around ${resetAt}.` : '',
      'For private repositories, use a token with Actions read access.'
    ]
      .filter(Boolean)
      .join(' ');
  }
  const message = parsedMessage || text;
  return `${response.status} ${response.statusText}${message ? `: ${message.slice(0, 220)}` : ''}`;
}

function parseGitHubErrorMessage(text: string): string {
  if (!text) return '';
  try {
    const data = JSON.parse(text) as unknown;
    if (isRecord(data) && typeof data.message === 'string') return data.message;
  } catch {
    return text;
  }
  return text;
}

function formatRateLimitReset(value: string | null): string {
  if (!value) return '';
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp * 1000).toLocaleString();
}

function downloadCsv(mode: CsvExportMode): void {
  commitSeriesDom();
  scheduleLocalSave();
  const rows = buildChartCsvRows(mode);
  if (mode === 'visible' && rows.length <= 1) {
    setStatus('No visible chart data to export.', true);
    return;
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  downloadBlob(
    makeExportFilename('csv', mode === 'visible' ? 'visible' : ''),
    `\uFEFF${csv}`,
    'text/csv;charset=utf-8'
  );
  setStatus(
    mode === 'visible'
      ? `Exported ${rows.length - 1} visible point rows`
      : `Exported ${rows.length - 1} point rows`
  );
}

function downloadPng(): void {
  const svg = chartEl.querySelector('svg');
  if (!svg) return;
  const palette = getExportPalette();
  const chartSize = getSvgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const legendItems = getExportLegendItems();
  const chartX = EXPORT_PADDING;
  const chartY = EXPORT_PADDING + EXPORT_TITLE_HEIGHT;
  // Align the legend to the plot area (inside the axes) rather than the full
  // chart SVG, and lay it out as a left-aligned grid below the chart.
  const plotLeft = chartX + INFERENCE_CURVE_MARGIN.left;
  const plotWidth = Math.max(
    0,
    chartSize.width - INFERENCE_CURVE_MARGIN.left - INFERENCE_CURVE_MARGIN.right
  );
  const legendLayout =
    legendItems.length > 0
      ? buildExportLegendLayout(legendItems, plotWidth)
      : { items: [], width: 0, height: 0 };
  const hasLegend = legendLayout.items.length > 0;
  const legendX = plotLeft;
  const legendY = chartY + chartSize.height + EXPORT_LAYOUT_GAP;
  const outerWidth = chartSize.width + EXPORT_PADDING * 2;
  const outerHeight =
    chartY + chartSize.height + (hasLegend ? EXPORT_LAYOUT_GAP + legendLayout.height : 0) + EXPORT_PADDING;

  prepareChartSvgForExport(clone, chartX, chartY, chartSize.width, chartSize.height, palette);
  const chartSvgText = new XMLSerializer().serializeToString(clone);
  const svgText = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="export-root" width="${outerWidth}" height="${outerHeight}" viewBox="0 0 ${outerWidth} ${outerHeight}" style="${escapeAttribute(buildSvgVariableStyle(palette))}">`,
    buildExportStyle(palette),
    `<rect width="100%" height="100%" fill="${escapeAttribute(palette.background)}"/>`,
    buildExportTitleSvg(EXPORT_PADDING, EXPORT_PADDING, outerWidth - EXPORT_PADDING * 2, palette),
    chartSvgText,
    hasLegend ? buildExportLegendSvg(legendLayout, legendX, legendY) : '',
    '</svg>'
  ].join('');
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width * EXPORT_IMAGE_SCALE;
    canvas.height = image.height * EXPORT_IMAGE_SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(EXPORT_IMAGE_SCALE, EXPORT_IMAGE_SCALE);
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = makeExportFilename('png');
      link.click();
      URL.revokeObjectURL(pngUrl);
    });
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus('Could not export PNG.', true);
  };
  image.src = url;
}

function buildChartCsvRows(mode: CsvExportMode): string[][] {
  const sourceSeries = getSeriesForPersistence();
  const lineById = new Map(sourceSeries.map((line) => [line.id, line]));
  const chartSeries = filterSeriesByMtp(
    filterSeriesByModelScenarioAndSequence(
      sourceSeries,
      state.modelFilter,
      state.scenarioFilter,
      state.islOslFilter
    ),
    state.mtpFilter
  ).filter((series) => state.selectedPrecisions.has(getSeriesPrecision(series)));
  const chartSeriesIds = new Set(chartSeries.map((series) => series.id));
  const currentPrepared = prepareInferenceCurveSeries(
    sourceSeries,
    state.highContrast,
    state.theme,
    getChartColorSourceSeries(chartSeries),
    state.chartMetric,
    shouldEnforceEndToEndPareto(),
    undefined,
    'maximize',
    state.latencyPercentile,
    state.chartYMetric,
    getTcoHourlyCosts()
  );
  const currentPointByKey = new Map<string, { roof: boolean }>();
  currentPrepared.forEach((series) => {
    series.points.forEach((point) => {
      currentPointByKey.set(`${series.id}|${point.pointIndex}`, point);
    });
  });
  const colorBySeriesId = new Map(currentPrepared.map((series) => [series.id, series.color]));
  const renderOrderBySeriesId = new Map(currentPrepared.map((series) => [series.id, series.renderOrder]));
  const exportSeries =
    mode === 'visible'
      ? currentPrepared.map((series) => ({
          id: series.id,
          color: series.color,
          renderOrder: series.renderOrder,
          points: series.points.map((point) => ({ point, pointIndex: point.pointIndex }))
        }))
      : sourceSeries.map((line, seriesIndex) => ({
          id: line.id,
          color: colorBySeriesId.get(line.id) ?? line.color ?? '',
          renderOrder: renderOrderBySeriesId.get(line.id) ?? getSeriesRenderOrder(line, seriesIndex),
          points: line.points.map((point, pointIndex) => ({ point, pointIndex }))
        }));
  const rows: string[][] = [
    [
      'Line ID',
      'Line Name',
      'Title',
      'Line Note',
      'Model',
      'Scenario',
      'Precision',
      'MTP',
      'HW Key',
      'Color Mode',
      'Resolved Color',
      'Line Type',
      'Line Marker',
      'Layer',
      'Included in Chart',
      'Active Line',
      'Point Index',
      'Roofline Point',
      'Point Marker',
      'Interactivity (tok/s/user)',
      'Throughput/GPU (tok/s/gpu)',
      'TTFT (s)',
      'End-to-end (s)',
      ...getLatencyPercentileCsvHeaders(),
      ...getE2ENormalizedInteractivityCsvHeaders(),
      'Prefill GPUs',
      'Decode GPUs',
      'Total GPUs',
      'Prefill TP',
      'Prefill EP',
      'Prefill DCP',
      'Prefill DPA',
      'Prefill Workers',
      'Decode TP',
      'Decode EP',
      'Decode DCP',
      'Decode DPA',
      'Decode Workers',
      'DPA',
      'Disagg',
      'Multi-node',
      'KV Offload',
      'Chip Cache Hit Rate',
      'External Cache Hit Rate',
      'CPU Cache Hit Rate',
      'Theoretical Cache Hit Rate',
      'Concurrency',
      'Strategy',
      'Note',
      'Speculative Decoding'
    ]
  ];

  exportSeries.forEach((series) => {
    const line = lineById.get(series.id);
    if (!line) return;
    const activeLine = state.activeSeriesIds.has(series.id);
    const filteredLine = chartSeriesIds.has(series.id);

    series.points.forEach(({ point, pointIndex }) => {
      const currentPoint = currentPointByKey.get(`${series.id}|${pointIndex}`);
      const pointPrecision = String(point.precision ?? getSeriesPrecision(line));
      const totalGpus = getInferenceCurvePointGpuCount(point);
      const includedInChart =
        filteredLine &&
        activeLine &&
        state.selectedPrecisions.has(pointPrecision) &&
        Boolean(currentPoint) &&
        (state.showNonOptimalPoints || currentPoint!.roof);

      if (mode === 'visible' && !includedInChart) return;

      rows.push([
        line.id,
        line.name,
        line.title ?? '',
        line.note ?? '',
        getSeriesModel(line),
        getSeriesIslOsl(line),
        getSeriesPrecision(line),
        isAgenticTraceSequence(getSeriesIslOsl(line)) ? '' : getSeriesMtpFilter(line),
        String(line.hwKey ?? ''),
        line.color?.trim() ? 'Custom' : 'Auto',
        colorBySeriesId.get(series.id) ?? series.color,
        line.lineStyle ?? DEFAULT_LINE_STYLE,
        normalizePointShapeValue(String(line.marker ?? '')) || 'precision',
        String(line.renderOrder ?? series.renderOrder),
        formatExportValue(includedInChart),
        formatExportValue(activeLine),
        String(pointIndex + 1),
        formatExportValue(currentPoint?.roof ?? false),
        normalizePointShapeValue(String(point.shape ?? '')) || '',
        formatExportValue(point.interactivity),
        formatExportValue(point.throughput),
        formatExportValue(point.ttft),
        formatExportValue(point.endToEnd),
        ...getLatencyPercentileExportValues(point, line),
        ...getE2ENormalizedInteractivityExportValues(point),
        formatExportValue(point.num_prefill_gpu),
        formatExportValue(point.num_decode_gpu),
        formatExportValue(totalGpus),
        formatExportValue(point.prefill_tp),
        formatExportValue(point.prefill_ep),
        formatExportValue(point.prefill_dcp_size),
        formatExportValue(point.prefill_dp_attention),
        formatExportValue(point.prefill_num_workers),
        formatExportValue(point.decode_tp),
        formatExportValue(point.decode_ep),
        formatExportValue(point.decode_dcp_size),
        formatExportValue(point.decode_dp_attention),
        formatExportValue(point.decode_num_workers),
        formatExportValue(point.dp_attention),
        formatExportValue(point.disagg),
        formatExportValue(point.is_multinode),
        formatExportValue(point.kv_offload),
        formatExportValue(point.server_gpu_cache_hit_rate),
        formatExportValue(point.server_external_cache_hit_rate),
        formatExportValue(point.server_cpu_cache_hit_rate),
        formatExportValue(point.theoretical_cache_hit_rate),
        formatExportValue(point.concurrency),
        String(point.strategy ?? ''),
        String(point.label ?? ''),
        String(point.spec_decoding ?? '')
      ]);
    });
  });

  return rows;
}

function getLatencyPercentileCsvHeaders(): string[] {
  return (Object.keys(latencyMetricColumns) as LatencyMetricKey[]).flatMap((metric) =>
    LATENCY_PERCENTILES.map((percentile) => getLatencyPercentileCsvHeader(metric, percentile))
  );
}

function getE2ENormalizedInteractivityCsvHeaders(): string[] {
  return E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.map((percentile) =>
    getE2ENormalizedInteractivityCsvHeader(percentile)
  );
}

function getLatencyPercentileExportValues(
  point: InferenceCurveSeries['points'][number],
  line: InferenceCurveSeries
): string[] {
  const isAgentic = isAgenticTraceSequence(getSeriesIslOsl(line));
  const entries: Array<[
    LatencyMetricKey,
    InferenceCurveLatencyPercentiles | undefined,
    unknown
  ]> = [
    ['interactivity', point.interactivityPercentiles, point.interactivity],
    ['ttft', point.ttftPercentiles, point.ttft],
    ['endToEnd', point.endToEndPercentiles, point.endToEnd]
  ];
  return entries.flatMap(([_metric, percentiles, legacyP90Value]) =>
    LATENCY_PERCENTILES.map((percentile) => {
      const value = percentiles?.[percentile] ??
        (isAgentic && percentiles === undefined && percentile === 'p90' ? legacyP90Value : undefined);
      return formatExportValue(value);
    })
  );
}

function getE2ENormalizedInteractivityExportValues(
  point: InferenceCurveSeries['points'][number]
): string[] {
  return E2E_NORMALIZED_INTERACTIVITY_PERCENTILES.map((percentile) =>
    formatExportValue(point.e2eNormalizedInteractivityPercentiles?.[percentile])
  );
}

function formatExportValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

interface ExportPalette {
  background: string;
  foreground: string;
  mutedForeground: string;
  accent: string;
  border: string;
  borderAlt: string;
  fontFamily: string;
}

interface ExportLegendItem {
  name: string;
  title: string;
  color: string;
  lineDasharray: string | null;
  active: boolean;
}

interface ExportLegendLayoutItem extends ExportLegendItem {
  label: string;
  x: number;
  y: number;
  width: number;
}

interface ExportLegendLayout {
  items: ExportLegendLayoutItem[];
  width: number;
  height: number;
}

function getExportPalette(): ExportPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read('--background', '#131416'),
    foreground: read('--foreground', '#eaebec'),
    mutedForeground: read('--muted-foreground', '#b4b9bc'),
    accent: read('--accent', '#1d1f21'),
    border: read('--border', '#656b72'),
    borderAlt: read('--border-alt', '#222426'),
    fontFamily:
      styles.getPropertyValue('font-family').trim() ||
      '"DM Sans", Inter, ui-sans-serif, system-ui, sans-serif'
  };
}

function getSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const read = (attribute: 'width' | 'height', fallback: number) => {
    const value = Number(svg.getAttribute(attribute));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const rect = svg.getBoundingClientRect();
  return {
    width: Math.round(read('width', rect.width || 960)),
    height: Math.round(read('height', rect.height || 575))
  };
}

function prepareChartSvgForExport(
  clone: SVGSVGElement,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: ExportPalette
): void {
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('x', String(x));
  clone.setAttribute('y', String(y));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('style', buildSvgVariableStyle(palette));
  clone.querySelector('.ruler-group')?.remove();
}

function buildSvgVariableStyle(palette: ExportPalette): string {
  return [
    `--background:${palette.background}`,
    `--foreground:${palette.foreground}`,
    `--muted-foreground:${palette.mutedForeground}`,
    `--accent:${palette.accent}`,
    `--border:${palette.border}`,
    `--border-alt:${palette.borderAlt}`,
    `font-family:${palette.fontFamily}`
  ].join(';');
}

function buildExportStyle(palette: ExportPalette): string {
  return `
    <style>
      .export-root, .export-root text { font-family: ${palette.fontFamily}; }
      .export-title { fill: ${palette.foreground}; font-size: 18px; font-weight: 700; }
      .export-subtitle { fill: ${palette.mutedForeground}; font-size: 12px; }
      .export-legend-text { fill: ${palette.foreground}; font-size: 11.5px; }
      .export-legend-box { fill: ${palette.accent}; stroke: ${palette.border}; stroke-opacity: 0.58; }
      .chart-root .x-axis .domain, .chart-root .y-axis .domain { stroke: ${palette.border}; stroke-width: 1; }
      .chart-root .tick line { stroke: ${palette.border}; }
      .chart-root .tick text { fill: ${palette.foreground}; font-size: 10px; }
      .chart-root .grid line { stroke: ${palette.borderAlt}; }
      .chart-root .grid .plot-border { stroke: ${palette.border}; }
      .chart-watermark { fill: ${palette.foreground}; font-weight: 800; opacity: 0.055; user-select: none; }
      .y-axis-label, .x-axis-label { fill: ${palette.foreground}; font-size: 12px; }
      .goal-direction-glow { fill: ${palette.foreground}; stroke: ${palette.foreground}; stroke-width: 8px; stroke-linejoin: round; opacity: 0.14; }
      .goal-direction-arrow, .goal-direction-label { fill: ${palette.foreground}; }
      .goal-direction-arrow { stroke: none; }
      .goal-direction-label { font-size: 14px; font-weight: 900; letter-spacing: 0.08em; paint-order: stroke; stroke: ${palette.background}; stroke-width: 4px; stroke-linejoin: round; }
      .point-label { paint-order: stroke; stroke: ${palette.background}; stroke-width: 3px; fill: ${palette.foreground}; font-size: 10px; font-weight: 700; }
      .parallelism-label text, .line-label text, .pill-text { fill: #fff; font-size: 9px; font-weight: 700; }
      .line-label text { font-size: 11px; }
      .pill-bg { opacity: 0.9; }
    </style>
  `;
}

function buildExportTitleSvg(x: number, y: number, width: number, palette: ExportPalette): string {
  const title = document.querySelector('.chart-caption h2')?.textContent?.trim() || 'Token Throughput per GPU vs. Interactivity';
  const subtitle = chartSubtitleEl.textContent.trim() || getChartSubtitle();
  return `
    <g transform="translate(${x},${y})">
      <text class="export-title" x="0" y="19">${escapeHtml(title)}</text>
      <text class="export-subtitle" x="0" y="43">${escapeHtml(subtitle)}</text>
      <line x1="0" y1="56" x2="${width}" y2="56" stroke="${escapeAttribute(palette.border)}" stroke-opacity="0.32"/>
    </g>
  `;
}

function getExportLegendItems(): ExportLegendItem[] {
  const filteredSeries = getFilteredSeriesForChart();
  const prepared = prepareInferenceCurveSeries(
    filteredSeries,
    state.highContrast,
    state.theme,
    getChartColorSourceSeries(filteredSeries),
    state.chartMetric,
    shouldEnforceEndToEndPareto(),
    undefined,
    'maximize',
    state.latencyPercentile,
    state.chartYMetric,
    getTcoHourlyCosts()
  );
  const query = state.search.trim().toLowerCase();

  return prepared
    .filter(
      (series) =>
        state.activeSeriesIds.has(series.id) &&
        (!query ||
          series.name.toLowerCase().includes(query) ||
          Boolean(series.title?.toLowerCase().includes(query)))
    )
    .map((series) => ({
      name: series.name,
      title: series.title ?? series.name,
      color: series.color,
      lineDasharray: series.lineDasharray,
      active: true
    }));
}

function buildExportLegendLayout(items: ExportLegendItem[], availableWidth: number): ExportLegendLayout {
  if (items.length === 0 || availableWidth <= 0) return { items: [], width: 0, height: 0 };

  const innerWidth = Math.max(0, availableWidth - EXPORT_LEGEND_PAD_X * 2);
  const entryBaseWidth = EXPORT_LEGEND_SWATCH + EXPORT_LEGEND_SWATCH_GAP;
  const measured = items.map((item) => {
    const label = item.name;
    return { ...item, label, width: entryBaseWidth + label.length * EXPORT_LEGEND_CHAR_W };
  });

  // Left-aligned grid: uniform columns sized to the widest entry so labels line
  // up, filled row by row.
  const columnWidth = Math.min(innerWidth, Math.max(...measured.map((item) => item.width)));
  const columns = Math.max(
    1,
    Math.min(
      measured.length,
      Math.floor((innerWidth + EXPORT_LEGEND_ITEM_GAP) / (columnWidth + EXPORT_LEGEND_ITEM_GAP))
    )
  );
  const rowCount = Math.ceil(measured.length / columns);

  // Column-major fill: items run top-to-bottom down each column, then move right.
  const layoutItems: ExportLegendLayoutItem[] = measured.map((item, index) => ({
    ...item,
    x: EXPORT_LEGEND_PAD_X + Math.floor(index / rowCount) * (columnWidth + EXPORT_LEGEND_ITEM_GAP),
    y: EXPORT_LEGEND_PAD_Y + (index % rowCount) * EXPORT_LEGEND_ROW_H
  }));

  return {
    items: layoutItems,
    width: availableWidth,
    height: EXPORT_LEGEND_PAD_Y * 2 + rowCount * EXPORT_LEGEND_ROW_H
  };
}

function buildExportLegendSvg(layout: ExportLegendLayout, x: number, y: number): string {
  if (layout.items.length === 0) return '';
  const textX = EXPORT_LEGEND_SWATCH + EXPORT_LEGEND_SWATCH_GAP;
  const mid = EXPORT_LEGEND_ROW_H / 2;
  const entries = layout.items
    .map((item) => {
      const dash = item.lineDasharray ? ` stroke-dasharray="${escapeAttribute(item.lineDasharray)}"` : '';
      return `
        <g transform="translate(${item.x},${item.y})">
          <title>${escapeHtml(item.title)}</title>
          <line x1="0" y1="${mid}" x2="${EXPORT_LEGEND_SWATCH}" y2="${mid}" stroke="${escapeAttribute(item.color)}" stroke-width="3" stroke-linecap="round"${dash}/>
          <circle cx="${EXPORT_LEGEND_SWATCH / 2}" cy="${mid}" r="3.4" fill="${escapeAttribute(item.color)}"/>
          <text class="export-legend-text" x="${textX}" y="${mid + 4}">${escapeHtml(item.label)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <g transform="translate(${x},${y})">
      <rect class="export-legend-box" width="${layout.width}" height="${layout.height}" rx="6"/>
      ${entries}
    </g>
  `;
}

function makeExportFilename(extension: 'csv' | 'png', suffix = ''): string {
  const label = getChartSubtitle()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  const date = new Date().toISOString().slice(0, 10);
  const scopedLabel = [label || 'inferencex-curve', suffix].filter(Boolean).join('-');
  return `${scopedLabel}-${date}.${extension}`;
}

function getColorPicker(seriesIndex: number): HTMLInputElement | null {
  return seriesEditorEl.querySelector<HTMLInputElement>(
    `input[data-series-index="${seriesIndex}"][data-color-picker="true"]`
  );
}

function getLineStyleCustomInput(seriesIndex: number): HTMLInputElement | null {
  return seriesEditorEl.querySelector<HTMLInputElement>(
    `input[data-series-index="${seriesIndex}"][data-line-style-custom="true"]`
  );
}

function syncColorPicker(seriesIndex: number, color: string, selectedColor = color): void {
  const picker = getColorPicker(seriesIndex);
  if (picker) picker.value = toColorInputValue(color, seriesIndex);
  syncSeriesSwatch(seriesIndex, color);
  syncPresetSelection(seriesIndex, selectedColor);
  syncColorMode(seriesIndex, selectedColor.trim() ? 'custom' : 'auto', color);
}

function syncSeriesSwatch(seriesIndex: number, color: string): void {
  const swatch = seriesEditorEl.querySelector<HTMLElement>(
    `.series-card[data-series-index="${seriesIndex}"] .series-swatch`
  );
  if (swatch && color.trim()) swatch.style.background = color;
}

function syncPresetSelection(seriesIndex: number, color: string): void {
  seriesEditorEl
    .querySelectorAll<HTMLButtonElement>(`button[data-series-index="${seriesIndex}"][data-color-preset]`)
    .forEach((button) => {
      button.classList.toggle(
        'selected',
        (button.dataset.colorPreset ?? '').toLowerCase() === color.trim().toLowerCase()
      );
    });
}

function syncColorMode(seriesIndex: number, mode: 'auto' | 'custom', resolvedColor: string): void {
  const card = seriesEditorEl.querySelector<HTMLElement>(`.series-card[data-series-index="${seriesIndex}"]`);
  if (!card) return;
  const controls = card.querySelector<HTMLElement>('[data-color-controls]');
  controls?.classList.toggle('auto', mode === 'auto');
  controls?.classList.toggle('custom', mode === 'custom');

  const autoButton = card.querySelector<HTMLButtonElement>('button[data-color-auto]');
  if (autoButton) {
    autoButton.classList.toggle('active', mode === 'auto');
    autoButton.setAttribute('aria-pressed', mode === 'auto' ? 'true' : 'false');
    autoButton.title = `Resolved color: ${resolvedColor}`;
  }

  const swatch = card.querySelector<HTMLElement>('[data-color-auto-swatch]');
  if (swatch && resolvedColor.trim()) swatch.style.background = resolvedColor;
}

function toColorInputValue(color: string, index: number): string {
  const trimmed = color.trim();
  if (isSixDigitHex(trimmed)) return trimmed;
  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/iu);
  if (shortHex) {
    return `#${shortHex[1]!
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`;
  }
  return colorInputFallbacks[index % colorInputFallbacks.length]!;
}

function isSixDigitHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/iu.test(value.trim());
}

function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setStatus(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', error);
  statusEl.classList.remove('dirty');
}

function markChartDirty(): void {
  statusEl.textContent = 'Rendering chart changes...';
  statusEl.classList.remove('error');
  statusEl.classList.add('dirty');
  scheduleAutoRender();
}

function setImportStatus(message: string, error = false): void {
  githubImportStatusEl.textContent = message;
  githubImportStatusEl.classList.toggle('error', error);
}

// fraction: null hides the bar, a negative value shows an indeterminate animation,
// and 0..1 fills the bar to that proportion.
function setImportProgress(fraction: number | null): void {
  if (fraction === null) {
    githubImportProgressEl.hidden = true;
    githubImportProgressEl.classList.remove('indeterminate');
    githubImportProgressFillEl.style.width = '0%';
    return;
  }
  githubImportProgressEl.hidden = false;
  if (fraction < 0) {
    githubImportProgressEl.classList.add('indeterminate');
    githubImportProgressFillEl.style.width = '';
  } else {
    githubImportProgressEl.classList.remove('indeterminate');
    githubImportProgressFillEl.style.width = `${Math.min(100, Math.max(0, fraction) * 100)}%`;
  }
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeHtml(value: string): string {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}
