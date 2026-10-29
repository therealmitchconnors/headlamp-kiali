import { editableObject, isRecord } from './object';

export type RouteEditMode = 'keep' | 'set' | 'remove';
export interface HttpBehaviorDraft {
  routeIndex: number;
  timeoutMode: RouteEditMode;
  timeout: string;
  retryMode: RouteEditMode;
  attempts: string;
  perTryTimeout: string;
  retryOn: string;
  delayMode: RouteEditMode;
  delay: string;
  delayPercent: string;
  abortMode: RouteEditMode;
  abortStatus: string;
  abortPercent: string;
}
export interface EditableHttpRoute {
  index: number;
  name?: string;
  value: Record<string, unknown>;
}
export function httpMatchAlternatives(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('HTTP editing requires a valid list of at most 100 match alternatives');
  return value.map(match => {
    if (!isRecord(match)) throw new Error('Malformed HTTP match alternative');
    return match;
  });
}
export function hasHttpMatchConditions(match: Record<string, unknown>): boolean {
  return Object.entries(match).some(([key, value]) => {
    if (['name', 'ignoreUriCase', 'statPrefix'].includes(key)) return false;
    if (key === 'port') return value !== undefined && value !== null && value !== 0;
    if (key === 'sourceNamespace') return value !== undefined && value !== null && value !== '';
    if (['uri', 'scheme', 'method', 'authority'].includes(key))
      return value !== undefined && value !== null;
    if (key === 'gateways')
      return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
    if (['headers', 'withoutHeaders', 'queryParams', 'sourceLabels'].includes(key)) {
      if (value === undefined || value === null) return false;
      if (!isRecord(value)) return true;
      return Object.keys(value).some(
        name => key !== 'headers' || !['uri', 'scheme', 'method', 'authority'].includes(name)
      );
    }
    return true;
  });
}
export function allHttpRoutes(spec: unknown): EditableHttpRoute[] {
  if (!isRecord(spec) || !Array.isArray(spec.http))
    throw new Error('No HTTP route list is available');
  if (spec.http.length > 100) throw new Error('HTTP behavior editing is limited to 100 routes');
  return spec.http.map((route, index) => {
    if (!isRecord(route)) throw new Error('Malformed HTTP route');
    return { index, value: route, ...(typeof route.name === 'string' ? { name: route.name } : {}) };
  });
}
export function editableHttpRoutes(spec: unknown): EditableHttpRoute[] {
  return allHttpRoutes(spec).filter(
    route => Array.isArray(route.value.route) && route.value.route.length > 0
  );
}
export function initialHttpBehavior(route?: EditableHttpRoute): HttpBehaviorDraft {
  const value = route?.value ?? {};
  const retries = isRecord(value.retries) ? value.retries : {};
  const fault = isRecord(value.fault) ? value.fault : {};
  const delay = isRecord(fault.delay) ? fault.delay : {};
  const abort = isRecord(fault.abort) ? fault.abort : {};
  const text = (value: unknown, fallback: string) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
  return {
    routeIndex: route?.index ?? -1,
    timeoutMode: 'keep',
    timeout: text(value.timeout, '10s'),
    retryMode: 'keep',
    attempts: text(retries.attempts, '3'),
    perTryTimeout: text(retries.perTryTimeout, ''),
    retryOn: text(retries.retryOn, 'gateway-error,connect-failure,refused-stream'),
    delayMode: 'keep',
    delay: text(delay.fixedDelay, '5s'),
    delayPercent: text(isRecord(delay.percentage) ? delay.percentage.value : delay.percent, '10'),
    abortMode: 'keep',
    abortStatus: text(abort.httpStatus, '503'),
    abortPercent: text(isRecord(abort.percentage) ? abort.percentage.value : abort.percent, '10'),
  };
}
export function routeDuration(value: string, allowZero = false): number {
  const match = value.length <= 64 && /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error('Use a duration such as 1ms, 1s, 1m or 1h');
  const factor = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
  const milliseconds = Number(match[1]) * factor;
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds > 86400000 ||
    (milliseconds < 1 && !(allowZero && milliseconds === 0))
  )
    throw new Error('Duration must be between 1 ms and 24 hours; only route timeout may be zero');
  return milliseconds;
}
function numeric(value: string, min: number, max: number, integer = false): number {
  const number = value.trim() === '' ? NaN : Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isInteger(number))
  )
    throw new Error(`Value must be ${integer ? 'an integer ' : ''}between ${min} and ${max}`);
  return number;
}
export function planHttpBehavior(
  spec: unknown,
  draft: HttpBehaviorDraft
): {
  spec: Record<string, unknown>;
  index: number;
} {
  const modes = [draft.timeoutMode, draft.retryMode, draft.delayMode, draft.abortMode];
  if (modes.some(mode => !['keep', 'set', 'remove'].includes(mode)))
    throw new Error('Unknown HTTP behavior edit action');
  if (modes.every(mode => mode === 'keep'))
    throw new Error('Choose at least one field to set or remove');
  const selected = editableHttpRoutes(spec).find(route => route.index === draft.routeIndex);
  if (!isRecord(spec) || !selected || !Array.isArray(spec.http))
    throw new Error('Select an existing HTTP forwarding route');
  const route = { ...selected.value };
  if (draft.timeoutMode === 'set') {
    routeDuration(draft.timeout, true);
    route.timeout = draft.timeout;
  } else if (draft.timeoutMode === 'remove') delete route.timeout;
  if (draft.retryMode === 'set') {
    const retries = editableObject(route.retries, 'retry configuration');
    retries.attempts = numeric(draft.attempts, 0, 10, true);
    if (draft.perTryTimeout) {
      routeDuration(draft.perTryTimeout);
      retries.perTryTimeout = draft.perTryTimeout;
    } else delete retries.perTryTimeout;
    if (draft.retryOn) {
      if (draft.retryOn.length > 512 || !/^[a-z0-9-]+(?:,[a-z0-9-]+)*$/.test(draft.retryOn))
        throw new Error(
          'Retry conditions must be comma-separated tokens without spaces, at most 512 characters'
        );
      retries.retryOn = draft.retryOn;
    } else delete retries.retryOn;
    route.retries = retries;
  } else if (draft.retryMode === 'remove') delete route.retries;
  if (draft.delayMode !== 'keep' || draft.abortMode !== 'keep') {
    const fault = editableObject(route.fault, 'fault configuration');
    if (draft.delayMode === 'set') {
      routeDuration(draft.delay);
      const delay = editableObject(fault.delay, 'delay fault');
      delete delay.exponentialDelay;
      delete delay.percent;
      delay.fixedDelay = draft.delay;
      delay.percentage = {
        ...editableObject(delay.percentage, 'delay percentage'),
        value: numeric(draft.delayPercent, 0, 100),
      };
      fault.delay = delay;
    } else if (draft.delayMode === 'remove') delete fault.delay;
    if (draft.abortMode === 'set') {
      const abort = editableObject(fault.abort, 'abort fault');
      delete abort.grpcStatus;
      delete abort.http2Error;
      delete abort.percent;
      abort.httpStatus = numeric(draft.abortStatus, 100, 599, true);
      abort.percentage = {
        ...editableObject(abort.percentage, 'abort percentage'),
        value: numeric(draft.abortPercent, 0, 100),
      };
      fault.abort = abort;
    } else if (draft.abortMode === 'remove') delete fault.abort;
    if (Object.keys(fault).length) route.fault = fault;
    else delete route.fault;
  }
  const hasFault =
    isRecord(route.fault) && (route.fault.delay !== undefined || route.fault.abort !== undefined);
  if (
    hasFault &&
    (route.timeout !== undefined || route.retries !== undefined) &&
    modes.some(mode => mode === 'set')
  )
    throw new Error(
      'Fault injection and timeout/retry settings cannot be combined in this editor; remove one group explicitly'
    );
  if (JSON.stringify(route) === JSON.stringify(selected.value))
    throw new Error('The selected HTTP route would not change');
  return {
    index: selected.index,
    spec: {
      ...spec,
      http: spec.http.map((value, index) => (index === selected.index ? route : value)),
    },
  };
}
