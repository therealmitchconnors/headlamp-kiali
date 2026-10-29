import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { loadTelemetry } from './telemetry';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
const endpoint = { namespace: 'istio-system', service: 'prometheus', port: '9090', basePath: '' };
const query = {
  namespace: 'bookinfo',
  telemetryCluster: 'east',
  direction: 'inbound' as const,
  minutes: 15 as const,
  end: 10000,
};

it('distinguishes malformed payloads from network failures', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue({});
  const result = await loadTelemetry(
    clusterScope('alpha'),
    endpoint,
    query,
    new AbortController().signal
  );
  expect(result.requests.ok).toBe(false);
  if (result.requests.ok === false) expect(result.requests.error.kind).toBe('invalid-response');
});

it('keeps queries on the explicit cluster/endpoint and retains a failed panel', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    const promql = url.searchParams.get('query')!;
    if (promql.includes('histogram_quantile')) throw { status: 403, message: 'Forbidden' };
    if (url.pathname.endsWith('query_range')) {
      expect(url.searchParams.get('start')).toBe('9100');
      expect(url.searchParams.get('end')).toBe('10000');
      expect(url.searchParams.get('step')).toBe('15');
    }
    return {
      status: 'success',
      data: { resultType: url.pathname.endsWith('/query') ? 'vector' : 'matrix', result: [] },
    };
  });
  const signal = new AbortController().signal;
  const result = await loadTelemetry(clusterScope('headlamp-alpha'), endpoint, query, signal);
  expect(result.requests.ok).toBe(true);
  expect(result.latency).toEqual({
    ok: false,
    error: { status: 403, kind: 'forbidden', message: 'Forbidden' },
  });
  expect(ApiProxy.request).toHaveBeenCalledTimes(5);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(path).toMatch(
      /^\/api\/v1\/namespaces\/istio-system\/services\/prometheus:9090\/proxy\//
    );
    expect(options?.cluster).toBe('headlamp-alpha');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal).not.toBe(signal);
  }
});

it('keeps a failed security query explicit while retaining independent successful charts', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    const promql = url.searchParams.get('query')!;
    if (promql.includes('connection_security_policy'))
      throw { status: 403, message: 'Security metric denied' };
    return {
      status: 'success',
      data: { resultType: url.pathname.endsWith('/query') ? 'vector' : 'matrix', result: [] },
    };
  });
  const result = await loadTelemetry(
    clusterScope('alpha'),
    endpoint,
    query,
    new AbortController().signal
  );
  expect(result.requests.ok).toBe(true);
  expect(result.security).toMatchObject({
    ok: false,
    error: { kind: 'forbidden', message: 'Security metric denied' },
  });
});
