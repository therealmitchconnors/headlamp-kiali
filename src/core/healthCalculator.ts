/*
 * Port of Kiali v2.33.0 business/health_calculator.go and health_config.go.
 * User patterns run through RE2, never the backtracking JavaScript regexp engine.
 */
import { RE2JS } from 're2js';
import {
  HealthStatus,
  healthStatusPriority,
  mergeHealthStatus,
  RequestHealth,
  simpleRequestErrorRatio,
  totalRequestRate,
  WorkloadStatus,
  workloadStatusHealth,
} from './health';
import { isRecord } from './object';

export interface HealthTolerance {
  code: string;
  degraded: number;
  failure: number;
  protocol: string;
  direction: string;
}

export interface HealthRateRule {
  namespace?: string;
  name?: string;
  kind?: string;
  tolerance: HealthTolerance[];
}

export interface EntityHealth {
  namespace: string;
  name: string;
  kind: 'app' | 'workload' | 'service';
  requests: RequestHealth;
  workloadStatuses?: (WorkloadStatus | null)[];
  annotations?: Readonly<Record<string, string>>;
}

export interface CalculatedHealth {
  status: HealthStatus;
  errorRatio: number;
  totalRequestRate: number;
  warnings: string[];
}

export const DEFAULT_HEALTH_RATES: readonly HealthRateRule[] = [
  {
    tolerance: [
      { code: '5XX', protocol: 'http', direction: '.*', degraded: 0, failure: 10 },
      { code: '4XX', protocol: 'http', direction: '.*', degraded: 10, failure: 20 },
      { code: '^[1-9]$|^1[0-6]$', protocol: 'grpc', direction: '.*', degraded: 0, failure: 10 },
      { code: '^-$', protocol: 'http|grpc', direction: '.*', degraded: 0, failure: 10 },
    ],
  },
];

export function validateHealthRules(value: unknown): HealthRateRule[] {
  if (!Array.isArray(value) || value.length > 99)
    throw new Error('Custom health rules must be an array of at most 99 rules');
  const text = (value: unknown) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 512)
      throw new Error('Health patterns must be strings of at most 512 characters');
    return value;
  };
  const allowed = (record: Record<string, unknown>, keys: string[]) => {
    if (Object.keys(record).some(key => !keys.includes(key)))
      throw new Error('Unsupported health-rule field');
  };
  return value.map((rule: unknown) => {
    if (!isRecord(rule) || !Array.isArray(rule.tolerance) || rule.tolerance.length > 100) {
      throw new Error('Each health rule must contain a tolerance array of at most 100 entries');
    }
    allowed(rule, ['namespace', 'name', 'kind', 'tolerance']);
    const parsed: HealthRateRule = {
      namespace: text(rule.namespace),
      name: text(rule.name),
      kind: text(rule.kind),
      tolerance: rule.tolerance.map((tolerance: unknown) => {
        if (!isRecord(tolerance)) throw new Error('Invalid health tolerance');
        allowed(tolerance, ['code', 'degraded', 'failure', 'protocol', 'direction']);
        const degraded = tolerance.degraded ?? 0;
        const failure = tolerance.failure ?? 0;
        if (
          typeof degraded !== 'number' ||
          typeof failure !== 'number' ||
          !Number.isFinite(Math.fround(degraded)) ||
          !Number.isFinite(Math.fround(failure)) ||
          degraded > failure
        ) {
          throw new Error('Finite health thresholds must have degraded <= failure');
        }
        return {
          code: text(tolerance.code),
          protocol: text(tolerance.protocol),
          direction: text(tolerance.direction),
          degraded,
          failure,
        };
      }),
    };
    const warnings: string[] = [];
    compile(parsed.namespace!, warnings);
    compile(parsed.name!, warnings);
    compile(parsed.kind!, warnings);
    parsed.tolerance.forEach(tolerance => compileTolerance(tolerance, warnings));
    if (warnings.length) throw new Error(warnings.join('; '));
    return parsed;
  });
}

interface CompiledTolerance extends HealthTolerance {
  codePattern: RE2JS;
  protocolPattern: RE2JS;
  directionPattern: RE2JS;
}

function compile(pattern: string, warnings: string[]): RE2JS {
  if (pattern.length > 512) throw new Error('Health patterns are limited to 512 characters');
  let anchored = pattern || '.*';
  if (!anchored.startsWith('^')) anchored = `^${anchored}`;
  if (!anchored.endsWith('$')) anchored += '$';
  try {
    return RE2JS.compile(anchored);
  } catch (error) {
    warnings.push(
      `Invalid health pattern ${JSON.stringify(pattern)}; using the upstream match-all fallback. ${
        error instanceof Error ? error.message : ''
      }`
    );
    return RE2JS.compile('^.*$');
  }
}

function compileTolerance(value: HealthTolerance, warnings: string[]): CompiledTolerance {
  if (
    !Number.isFinite(Math.fround(value.degraded)) ||
    !Number.isFinite(Math.fround(value.failure)) ||
    value.degraded > value.failure
  )
    throw new Error('Health thresholds must be finite with degraded <= failure');
  return {
    ...value,
    degraded: Math.fround(value.degraded),
    failure: Math.fround(value.failure),
    codePattern: compile(value.code.replace(/[Xx]/g, '\\d'), warnings),
    protocolPattern: compile(value.protocol, warnings),
    directionPattern: compile(value.direction, warnings),
  };
}

/** Match upstream valid entries while retaining explicit diagnostics for skipped annotations. */
export function parseHealthAnnotation(annotation: string): {
  tolerances: HealthTolerance[];
  warnings: string[];
} {
  const tolerances: HealthTolerance[] = [];
  const warnings: string[] = [];
  if (annotation.length > 4096)
    throw new Error('Health annotations are limited to 4,096 characters');
  for (const part of annotation
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)) {
    const fields = part.split(',');
    const number = (value: string) => {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return NaN;
      return Math.fround(Number(value));
    };
    const degraded = fields.length === 5 ? number(fields[1]) : NaN;
    const failure = fields.length === 5 ? number(fields[2]) : NaN;
    if (
      fields.length !== 5 ||
      !Number.isFinite(degraded) ||
      !Number.isFinite(failure) ||
      degraded > failure
    ) {
      warnings.push(`Invalid health annotation entry ${JSON.stringify(part)} was ignored`);
      continue;
    }
    tolerances.push({
      code: fields[0],
      degraded,
      failure,
      protocol: fields[3],
      direction: fields[4],
    });
  }
  if (annotation && tolerances.length === 0)
    warnings.push('No valid annotation tolerances; using configured rules');
  return { tolerances, warnings };
}

function validateRequests(requests: RequestHealth) {
  for (const direction of [requests.inbound, requests.outbound]) {
    for (const codes of Object.values(direction ?? {})) {
      for (const value of Object.values(codes)) {
        if (!Number.isFinite(value) || value < 0)
          throw new Error('Health input contains invalid or negative request rates');
      }
    }
  }
  if (!Number.isFinite(totalRequestRate(requests)))
    throw new Error('Health input rates exceeded numeric limits');
}

function requestStatus(requests: RequestHealth, tolerances: CompiledTolerance[]) {
  if (tolerances.length === 0) {
    const ratio = simpleRequestErrorRatio(requests);
    const percent = ratio * 100;
    const status: HealthStatus =
      ratio < 0 ? 'NA' : percent >= 10 ? 'Failure' : percent >= 0.1 ? 'Degraded' : 'Healthy';
    return { status, errorRatio: ratio < 0 ? -1 : percent };
  }
  let worst: HealthStatus = 'NA';
  let errorRatio = -1;
  let hasTraffic = false;
  for (const direction of ['inbound', 'outbound'] as const) {
    for (const [protocol, codes] of Object.entries(requests[direction] ?? {})) {
      for (const tolerance of tolerances) {
        if (
          !tolerance.directionPattern.test(direction) ||
          !tolerance.protocolPattern.test(protocol)
        )
          continue;
        let total = 0;
        let errors = 0;
        for (const [code, rate] of Object.entries(codes)) {
          total += rate;
          if (tolerance.codePattern.test(code)) errors += rate;
        }
        if (total === 0) continue;
        hasTraffic = true;
        const ratio = (errors / total) * 100;
        const status: HealthStatus =
          ratio <= 0
            ? 'Healthy'
            : ratio >= tolerance.failure
            ? 'Failure'
            : ratio >= tolerance.degraded
            ? 'Degraded'
            : 'Healthy';
        if (healthStatusPriority(status) > healthStatusPriority(worst)) {
          worst = status;
          errorRatio = ratio;
        }
      }
    }
  }
  if (worst === 'NA' && hasTraffic) return { status: 'Healthy' as const, errorRatio: 0 };
  return { status: worst, errorRatio };
}

export function calculateHealth(
  input: EntityHealth | null,
  rules: readonly HealthRateRule[] = DEFAULT_HEALTH_RATES
): CalculatedHealth {
  const warnings: string[] = [];
  if (input === null) return { status: 'NA', errorRatio: 0, totalRequestRate: 0, warnings };
  if (rules.length > 100) throw new Error('At most 100 health rules are supported');
  validateRequests(input.requests);
  const compiled = rules.map(rule => {
    if (rule.tolerance.length > 100)
      throw new Error('At most 100 tolerances per health rule are supported');
    return {
      namespace: compile(rule.namespace ?? '', warnings),
      name: compile(rule.name ?? '', warnings),
      kind: compile(rule.kind ?? '', warnings),
      tolerances: rule.tolerance.map(tolerance => compileTolerance(tolerance, warnings)),
    };
  });
  const annotation = parseHealthAnnotation(input.annotations?.['health.kiali.io/rate'] ?? '');
  warnings.push(...annotation.warnings);
  const matching =
    compiled.find(
      rule =>
        rule.namespace.test(input.namespace) &&
        rule.name.test(input.name) &&
        rule.kind.test(input.kind)
    ) ?? compiled[compiled.length - 1];
  const tolerances = annotation.tolerances.length
    ? annotation.tolerances.map(tolerance => compileTolerance(tolerance, warnings))
    : matching?.tolerances ?? [];
  const calculated = requestStatus(input.requests, tolerances);
  let status: HealthStatus = calculated.status;
  if (input.kind !== 'service') {
    const statuses =
      input.kind === 'workload'
        ? [input.workloadStatuses?.[0] ?? null]
        : input.workloadStatuses ?? [];
    for (const workload of statuses)
      status = mergeHealthStatus(status, workloadStatusHealth(workload));
  }
  return {
    status,
    errorRatio: calculated.errorRatio,
    totalRequestRate: totalRequestRate(input.requests),
    warnings,
  };
}
