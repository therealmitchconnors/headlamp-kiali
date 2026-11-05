import { metricGroupIdentity } from './metricGroups';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export interface TrafficQuery {
  namespace: string;
  telemetryCluster: string;
  direction: 'inbound' | 'outbound';
  minutes: 5 | 15 | 60;
  end: number;
  workload?: string;
}

export interface Sample {
  timestamp: number;
  value: number | null;
}
export interface MetricSeries {
  labels: Record<string, string>;
  samples: Sample[];
}
export interface MetricResult {
  series: MetricSeries[];
  warnings: string[];
}

export function metricSelector(labels: Readonly<Record<string, string>>): string {
  return Object.entries(labels)
    .map(([key, value]) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || typeof value !== 'string')
        throw new Error('Invalid request-rate metric label');
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(',');
}

export function requestRateQuery(
  labels: Readonly<Record<string, string>>,
  retainReporter = false
): string {
  const selector = metricSelector(labels);
  return `sum by (${
    retainReporter ? 'reporter,' : ''
  }request_protocol,response_code,grpc_response_status) (rate(istio_requests_total{${selector}}[5m]))`;
}

export function validateTelemetryScope(
  query: Pick<TrafficQuery, 'namespace' | 'telemetryCluster' | 'end'>
) {
  if (
    !isDnsLabel(query.namespace) ||
    !query.telemetryCluster.trim() ||
    query.telemetryCluster.length > 256 ||
    !Number.isFinite(query.end) ||
    query.end <= 0
  )
    throw new Error('Invalid traffic query scope or time range');
}

export function trafficMetricLabels(query: TrafficQuery): Record<string, string> {
  validateTelemetryScope(query);
  if (![5, 15, 60].includes(query.minutes) || !['inbound', 'outbound'].includes(query.direction))
    throw new Error('Invalid traffic query scope or time range');
  const side = query.direction === 'inbound' ? 'destination' : 'source';
  if (query.workload !== undefined && !isDnsSubdomain(query.workload))
    throw new Error('Invalid workload metric selector');
  return {
    reporter: side,
    [`${side}_workload_namespace`]: query.namespace,
    [`${side}_cluster`]: query.telemetryCluster,
    ...(query.workload ? { [`${side}_workload`]: query.workload } : {}),
  };
}

export function prometheusQueries(query: TrafficQuery) {
  const labels = trafficMetricLabels(query);
  const scopeLabels = Object.fromEntries(
    Object.entries(labels).filter(([key]) => key !== 'reporter')
  );
  const scopeSelector = metricSelector(scopeLabels);
  const selector = metricSelector(labels);
  const by =
    'source_cluster,source_workload_namespace,source_workload,destination_cluster,destination_workload_namespace,destination_workload,request_protocol';
  return {
    requests: requestRateQuery(labels),
    latency: `histogram_quantile(0.95,sum by (le) (rate(istio_request_duration_milliseconds_bucket{${selector}}[5m])))`,
    tcp: `sum(rate(istio_tcp_sent_bytes_total{${selector}}[5m]))`,
    traffic: `sum by (${by}) (rate(istio_requests_total{${selector}}[5m]))`,
    security: `sum by (request_protocol,connection_security_policy) (rate(istio_requests_total{reporter="destination",${scopeSelector}}[5m]))`,
  };
}

export function decodePrometheus(value: unknown, resultType: 'matrix' | 'vector'): MetricResult {
  if (!isRecord(value) || value.status !== 'success') {
    const message =
      isRecord(value) && typeof value.error === 'string'
        ? value.error
        : 'Invalid Prometheus response';
    throw new Error(message);
  }
  if (
    !isRecord(value.data) ||
    value.data.resultType !== resultType ||
    !Array.isArray(value.data.result)
  ) {
    throw new Error('Unexpected Prometheus result type');
  }
  if (value.data.result.length > 2000)
    throw new Error('Metric result exceeded the 2,000-series display limit');
  const warnings = value.warnings ?? [];
  if (!Array.isArray(warnings) || warnings.some(warning => typeof warning !== 'string')) {
    throw new Error('Invalid Prometheus warnings');
  }
  let samples = 0;
  const series = value.data.result.map((entry: unknown): MetricSeries => {
    if (!isRecord(entry) || !isRecord(entry.metric)) throw new Error('Invalid metric series');
    const labels = Object.fromEntries(
      Object.entries(entry.metric).map(([key, value]) => {
        if (typeof value !== 'string') throw new Error('Invalid metric label');
        return [key, value];
      })
    );
    const values = resultType === 'matrix' ? entry.values : [entry.value];
    if (!Array.isArray(values)) throw new Error('Invalid metric samples');
    let previous = -Infinity;
    return {
      labels,
      samples: values.map((pair: unknown): Sample => {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== 'number' ||
          !Number.isFinite(pair[0]) ||
          typeof pair[1] !== 'string' ||
          pair[0] <= previous
        ) {
          throw new Error('Invalid or unordered metric sample');
        }
        if (++samples > 100000)
          throw new Error('Metric result exceeded the 100,000-sample display limit');
        previous = pair[0];
        const special = ['NaN', '+Inf', '-Inf'].includes(pair[1]);
        if (!special && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(pair[1])) {
          throw new Error('Invalid metric sample value');
        }
        const parsed = Number(pair[1]);
        return { timestamp: pair[0], value: special || !Number.isFinite(parsed) ? null : parsed };
      }),
    };
  });
  return { series, warnings };
}

export interface RequestPoint {
  timestamp: number;
  requests: number | null;
  errors: number | null;
  errorPercent: number | null;
}

/** Operational error rate only; this does not implement Kiali health tolerances. */
export function requestPoints(result: MetricResult): RequestPoint[] {
  const points = new Map<number, RequestPoint>();
  const observed = new Map<number, number>();
  const labelSets = new Set<string>();
  for (const series of result.series) {
    const key = JSON.stringify(
      Object.entries(series.labels).sort(([a], [b]) => a.localeCompare(b))
    );
    if (labelSets.has(key)) throw new Error('Duplicate request metric series');
    labelSets.add(key);
    const protocol = series.labels.request_protocol;
    for (const sample of series.samples) {
      observed.set(sample.timestamp, (observed.get(sample.timestamp) ?? 0) + 1);
      const point = points.get(sample.timestamp) ?? {
        timestamp: sample.timestamp,
        requests: 0,
        errors: 0,
        errorPercent: null,
      };
      if (sample.value === null || sample.value < 0 || !protocol) {
        point.requests = null;
        point.errors = null;
      } else if (point.requests !== null && point.errors !== null) {
        const code =
          protocol === 'grpc' ? series.labels.grpc_response_status : series.labels.response_code;
        if (!code || !/^\d+$/.test(code)) {
          point.requests = null;
          point.errors = null;
        } else {
          point.requests += sample.value;
          if (protocol === 'grpc' ? code !== '0' : /^[45]\d\d$/.test(code))
            point.errors += sample.value;
          if (!Number.isFinite(point.requests) || !Number.isFinite(point.errors)) {
            point.requests = null;
            point.errors = null;
          }
        }
      }
      points.set(sample.timestamp, point);
    }
  }
  return [...points.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(point =>
      observed.get(point.timestamp) !== result.series.length
        ? { timestamp: point.timestamp, requests: null, errors: null, errorPercent: null }
        : {
            ...point,
            errorPercent:
              point.requests !== null && point.errors !== null && point.requests > 0
                ? (point.errors / point.requests) * 100
                : null,
          }
    );
}

export interface TrafficEdge {
  source: { cluster: string; namespace: string; workload: string };
  destination: { cluster: string; namespace: string; workload: string };
  protocol: string;
  rate: number;
}

export interface SecurityRate {
  protocol: string;
  policy: string;
  rate: number | null;
  observedPercent: number | null;
  timestamp: number | null;
}

export type SecurityCategory =
  | 'encrypted'
  | 'plaintext'
  | 'mixed'
  | 'unknown'
  | 'unsupported'
  | 'unavailable';

export interface SecurityObservation {
  protocol: string;
  category: SecurityCategory;
  completeness: 'available' | 'partial' | 'unavailable';
  timestamp: number | null;
}

export interface SecurityProjection {
  rates: SecurityRate[];
  protocols: SecurityObservation[];
}

const SECURITY_GROUPS = ['request_protocol', 'connection_security_policy'] as const;
const MAX_SECURITY_SERIES = 8;

export function securityTelemetry(
  result: MetricResult,
  query: Pick<TrafficQuery, 'minutes' | 'end'>
): SecurityProjection {
  if (
    ![5, 15, 60].includes(query.minutes) ||
    !Number.isSafeInteger(query.end) ||
    query.end <= query.minutes * 60 ||
    query.end > 8640000000000
  )
    throw new Error('Invalid security observation time range');
  if (result.series.length > MAX_SECURITY_SERIES)
    throw new Error('Security observations exceeded the 8-series display limit');

  const seen = new Set<string>();
  const byProtocol = new Map<string, MetricSeries[]>();
  const expectedSamples = (query.minutes * 60) / 15 + 1;
  const rangeStart = query.end - query.minutes * 60;
  for (const series of result.series) {
    const identity = metricGroupIdentity(series.labels, SECURITY_GROUPS).key;
    if (seen.has(identity)) throw new Error('Duplicate security metric series');
    seen.add(identity);
    if (series.samples.length > expectedSamples)
      throw new Error('Security observations exceeded the captured sample budget');
    for (let index = 0; index < series.samples.length; index++) {
      const sample = series.samples[index];
      if (
        !Number.isFinite(sample.timestamp) ||
        sample.timestamp < query.end - query.minutes * 60 - 1 ||
        sample.timestamp > query.end + 1 ||
        (index > 0 && sample.timestamp <= series.samples[index - 1].timestamp) ||
        (sample.value !== null && (!Number.isFinite(sample.value) || sample.value < 0))
      )
        throw new Error('Invalid security metric sample');
    }
    const protocol = series.labels.request_protocol || 'unknown';
    const seriesForProtocol = byProtocol.get(protocol) ?? [];
    seriesForProtocol.push(series);
    byProtocol.set(protocol, seriesForProtocol);
  }

  const rates: SecurityRate[] = [];
  const protocols: SecurityObservation[] = [];
  for (const [protocol, series] of byProtocol) {
    const timestamp = Math.max(
      ...series.flatMap(item => item.samples.map(sample => sample.timestamp)),
      -Infinity
    );
    const rows = series.map(item => {
      const sample = item.samples.find(value => value.timestamp === timestamp);
      return {
        protocol,
        policy: item.labels.connection_security_policy || 'unknown',
        rate: sample?.value ?? null,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
      };
    });
    const complete =
      result.warnings.length === 0 &&
      rows.every(row => row.rate !== null) &&
      series.every(item => item.samples.every(sample => sample.value !== null)) &&
      timestamp >= query.end - 1 &&
      series.every(
        item =>
          item.samples.length === expectedSamples &&
          item.samples.every(
            (sample, index) => Math.abs(sample.timestamp - (rangeStart + index * 15)) <= 1
          )
      );
    const total = rows.reduce((sum, row) => sum + (row.rate ?? 0), 0);
    if (!Number.isFinite(total)) throw new Error('Security rates exceeded numeric limits');
    rates.push(
      ...rows.map(row => ({
        ...row,
        observedPercent:
          complete && total > 0 && row.rate !== null ? (row.rate / total) * 100 : null,
      }))
    );

    const positivePolicies = new Set(
      series.flatMap(item =>
        item.samples.some(sample => sample.value !== null && sample.value > 0)
          ? [item.labels.connection_security_policy || 'unknown']
          : []
      )
    );
    const knownPolicies = new Set(
      [...positivePolicies].filter(policy => policy === 'mutual_tls' || policy === 'none')
    );
    const hasUnknown = [...positivePolicies].some(
      policy => policy !== 'mutual_tls' && policy !== 'none'
    );
    const supportedProtocol = protocol === 'http' || protocol === 'grpc';
    const category: SecurityCategory = !supportedProtocol
      ? 'unsupported'
      : positivePolicies.size === 0
      ? 'unavailable'
      : knownPolicies.size > 1
      ? 'mixed'
      : knownPolicies.has('mutual_tls')
      ? 'encrypted'
      : knownPolicies.has('none')
      ? 'plaintext'
      : 'unknown';
    const partial = !complete || hasUnknown || !supportedProtocol || category === 'unknown';
    protocols.push({
      protocol,
      category,
      completeness: category === 'unavailable' ? 'unavailable' : partial ? 'partial' : 'available',
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
    });
  }
  return {
    rates: rates.sort(
      (a, b) => a.protocol.localeCompare(b.protocol) || a.policy.localeCompare(b.policy)
    ),
    protocols: protocols.sort((a, b) => a.protocol.localeCompare(b.protocol)),
  };
}

export function trafficEdges(result: MetricResult): TrafficEdge[] {
  const edges: TrafficEdge[] = [];
  const seen = new Set<string>();
  for (const series of result.series) {
    const rate = series.samples[0]?.value;
    if (rate === null || rate === undefined || rate === 0) continue;
    if (rate < 0 || !Number.isFinite(rate)) throw new Error('Invalid traffic rate');
    const endpoint = (side: string) => ({
      cluster: series.labels[`${side}_cluster`] || 'unknown',
      namespace: series.labels[`${side}_workload_namespace`] || 'unknown',
      workload: series.labels[`${side}_workload`] || 'unknown',
    });
    const edge = {
      source: endpoint('source'),
      destination: endpoint('destination'),
      protocol: series.labels.request_protocol || 'unknown',
      rate,
    };
    const key = JSON.stringify([edge.source, edge.destination, edge.protocol]);
    if (seen.has(key)) throw new Error('Duplicate aggregated traffic edge');
    seen.add(key);
    edges.push(edge);
  }
  return edges.sort((a, b) => b.rate - a.rate);
}
