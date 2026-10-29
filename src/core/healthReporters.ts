/*
 * Request normalization and reporter merging from Kiali v2.33.0 models/health.go.
 */
import { DirectionalRates, RequestHealth } from './health';
import { MetricResult, requestRateQuery } from './telemetry';

export type HealthReporterMode = 'single' | 'combined';
export interface ReportedRequestRate {
  labels: Readonly<Record<string, string>>;
  value: number;
}

export function requestHealthCode(labels: Readonly<Record<string, string>>): string {
  const code = labels.response_code ?? '';
  if (code === '0') return '-';
  return labels.request_protocol === 'grpc' &&
    Object.prototype.hasOwnProperty.call(labels, 'grpc_response_status')
    ? labels.grpc_response_status
    : code;
}

export function combineReportedRequests(
  inbound: readonly ReportedRequestRate[],
  outbound: readonly ReportedRequestRate[]
): RequestHealth {
  if (inbound.length + outbound.length > 4000)
    throw new Error('Health reporter input exceeds 4,000 samples');
  type Rates = Map<string, Map<string, number>>;
  const direct: Rates = new Map();
  const source: Rates = new Map();
  const destination: Rates = new Map();
  const out: Rates = new Map();
  function aggregate(target: Rates, sample: ReportedRequestRate) {
    if (!Number.isFinite(sample.value) || sample.value < 0)
      throw new Error('Reporter rates must be finite and nonnegative');
    const protocol = sample.labels.request_protocol ?? '';
    const code = requestHealthCode(sample.labels);
    const codes = target.get(protocol) ?? new Map<string, number>();
    const sum = (codes.get(code) ?? 0) + sample.value;
    if (!Number.isFinite(sum)) throw new Error('Reporter rates exceed numeric limits');
    codes.set(code, sum);
    target.set(protocol, codes);
  }
  for (const sample of inbound)
    aggregate(
      sample.labels.reporter === 'source'
        ? source
        : sample.labels.reporter === 'destination'
        ? destination
        : direct,
      sample
    );
  for (const sample of outbound) if (sample.labels.reporter === 'source') aggregate(out, sample);
  for (const [protocol, rates] of source) {
    const codes = direct.get(protocol) ?? new Map<string, number>();
    for (const [code, rate] of rates) codes.set(code, rate);
    direct.set(protocol, codes);
  }
  for (const [protocol, rates] of destination) {
    const codes = direct.get(protocol) ?? new Map<string, number>();
    for (const [code, rate] of rates)
      if (!codes.has(code) || rate > codes.get(code)!) codes.set(code, rate);
    direct.set(protocol, codes);
  }
  const object = (rates: Rates): DirectionalRates =>
    Object.fromEntries(
      [...rates].map(([protocol, codes]) => [protocol, Object.fromEntries(codes)])
    );
  return { inbound: object(direct), outbound: object(out) };
}

export function combinedMetricHealth(
  inbound: MetricResult,
  outbound?: MetricResult
): RequestHealth {
  const samples = (result: MetricResult | undefined, direction: 'inbound' | 'outbound') =>
    (result?.series ?? []).map(series => {
      const reporter = series.labels.reporter;
      if (
        (reporter !== 'source' && reporter !== 'destination') ||
        (direction === 'outbound' && reporter !== 'source')
      )
        throw new Error('Combined health requires explicit source/destination reporter labels');
      const value = series.samples[0]?.value;
      if (
        series.samples.length !== 1 ||
        value === null ||
        value === undefined ||
        !series.labels.request_protocol ||
        !requestHealthCode(series.labels)
      )
        throw new Error('Invalid combined request-health observation');
      return { labels: series.labels, value };
    });
  return combineReportedRequests(samples(inbound, 'inbound'), samples(outbound, 'outbound'));
}

export function healthRequestQuery({
  namespace,
  telemetryCluster,
  name,
  target,
  direction,
  reporterMode = 'single',
}: {
  namespace: string;
  telemetryCluster: string;
  name: string;
  target: 'workload' | 'canonical_service' | 'service';
  direction: 'inbound' | 'outbound';
  reporterMode?: HealthReporterMode;
}) {
  if (reporterMode !== 'single' && reporterMode !== 'combined')
    throw new Error('Unknown health reporter mode');
  if (target === 'service' && direction !== 'inbound')
    throw new Error('Service request health is inbound-only');
  const side = direction === 'inbound' ? 'destination' : 'source';
  const labels: Record<string, string> = {};
  if (reporterMode === 'single' || direction === 'outbound') labels.reporter = side;
  labels[`${side}_${target === 'service' ? 'service' : 'workload'}_namespace`] = namespace;
  labels[`${side}_cluster`] = telemetryCluster;
  labels[`${side}_${target === 'service' ? 'service_name' : target}`] = name;
  return requestRateQuery(labels, reporterMode === 'combined');
}
