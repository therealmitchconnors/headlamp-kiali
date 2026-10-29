import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import fixtureText from '../../test-files/tracing/fixtures.json?raw';
import { TracingConfig } from '../core/config';
import { clusterScope } from '../core/scope';
import { readFailure } from './requests';
import { discoverTraceNames, inspectTracing, loadTrace, searchTraces } from './tracing';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const fixtures = JSON.parse(fixtureText);
const config: TracingConfig = {
  provider: 'jaeger',
  endpoint: { namespace: 'observability', service: 'query', port: '16686', basePath: '/jaeger' },
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('uses only the explicit Service proxy scope and requests JSON without persisting credentials', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue(fixtures.jaeger);
  const signal = new AbortController().signal;
  await searchTraces(
    clusterScope('alpha'),
    config,
    { service: 'reviews', start: 1700000000, end: 1700000900, limit: 20 },
    signal
  );
  const [path, options] = vi.mocked(ApiProxy.request).mock.calls[0];
  expect(path).toContain(
    '/api/v1/namespaces/observability/services/query:16686/proxy/jaeger/api/traces?'
  );
  expect(options).toMatchObject({
    cluster: 'alpha',
    autoLogoutOnAuthError: false,
    headers: { Accept: 'application/json' },
  });
  expect(options?.signal).not.toBe(signal);
  expect(options?.signal?.aborted).toBe(true);
});
it('uses provider-specific capability probes and retains HTTP/format/not-found failures', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({ data: ['reviews'] });
  await expect(
    inspectTracing(clusterScope('alpha'), config, new AbortController().signal)
  ).resolves.toEqual({ count: 1 });
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({ tagNames: [] });
  await inspectTracing(
    clusterScope('alpha'),
    { ...config, provider: 'tempo' },
    new AbortController().signal
  );
  expect(vi.mocked(ApiProxy.request).mock.calls[1][0]).toContain('/api/search/tags');
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({ data: [] });
  try {
    await loadTrace(clusterScope('alpha'), config, '1', new AbortController().signal);
    throw new Error('Expected missing trace');
  } catch (error) {
    expect(readFailure(error).kind).toBe('not-found');
  }
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({});
  await expect(
    loadTrace(clusterScope('alpha'), config, '1', new AbortController().signal)
  ).rejects.toThrow('not found');
  vi.mocked(ApiProxy.request).mockRejectedValueOnce({ status: 403, message: 'Denied' });
  await expect(
    loadTrace(clusterScope('alpha'), config, '1', new AbortController().signal)
  ).rejects.toEqual({ status: 403, message: 'Denied' });
});
it('validates trace identities and stops cancelled reads before sending requests', async () => {
  await expect(
    loadTrace(clusterScope('alpha'), config, '../bad', new AbortController().signal)
  ).rejects.toThrow();
  const abort = new AbortController();
  abort.abort();
  await expect(loadTrace(clusterScope('alpha'), config, '1', abort.signal)).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('captures provider, endpoint, tags and decode limits before the deferred read', async () => {
  const mutable = structuredClone(config);
  const query = {
    service: 'reviews',
    start: 1700000000,
    end: 1700000900,
    limit: 20,
    tags: [{ key: 'http.method', value: 'GET' }],
  };
  vi.mocked(ApiProxy.request).mockResolvedValue(fixtures.jaeger);
  const read = searchTraces(clusterScope('alpha'), mutable, query, new AbortController().signal);
  mutable.provider = 'tempo';
  mutable.endpoint.service = 'different';
  query.limit = 0;
  query.tags[0].value = 'changed';
  const result = await read;
  expect(result.traces).toHaveLength(1);
  const url = new URL(String(vi.mocked(ApiProxy.request).mock.calls[0][0]), 'http://example.test');
  expect(url.pathname).toContain('/services/query:16686/');
  expect(JSON.parse(url.searchParams.get('tags')!)).toEqual({ 'http.method': 'GET' });
});
it('captures typed Tempo filters before deferred reads and never sends them to Jaeger', async () => {
  const current = { ...config, provider: 'tempo' as const };
  const query = {
    service: 'reviews',
    start: 1700000000,
    end: 1700000900,
    limit: 20,
    tempoFilters: [
      {
        scope: 'span' as const,
        key: 'sequence',
        type: 'integer' as const,
        operator: '=' as const,
        value: '9007199254740993',
      },
    ],
  };
  vi.mocked(ApiProxy.request).mockResolvedValue(fixtures.tempoSearch);
  const pending = searchTraces(clusterScope('alpha'), current, query, new AbortController().signal);
  query.tempoFilters[0].value = '0';
  await pending;
  const url = new URL(String(vi.mocked(ApiProxy.request).mock.calls[0][0]), 'http://example.test');
  expect(url.searchParams.get('q')).toContain('span.sequence = 9007199254740993');
  await expect(
    searchTraces(clusterScope('alpha'), config, query, new AbortController().signal)
  ).rejects.toThrow('require Tempo');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});

it.each(['event', 'link', 'instrumentation'] as const)(
  'captures %s attribute scope and literal names without cross-provider replay',
  async scope => {
    const query = {
      service: 'reviews',
      start: 1700000000,
      end: 1700000900,
      limit: 20,
      tempoFilters: [
        {
          scope,
          key: 'name/with:punctuation',
          type: 'string' as const,
          operator: '=' as const,
          value: 'literal',
        },
      ],
    };
    vi.mocked(ApiProxy.request).mockResolvedValue(fixtures.tempoSearch);
    const pending = searchTraces(
      clusterScope('alpha'),
      { ...config, provider: 'tempo' },
      query,
      new AbortController().signal
    );
    query.tempoFilters[0].key = 'changed';
    await pending;
    const url = new URL(
      String(vi.mocked(ApiProxy.request).mock.calls[0][0]),
      'http://example.test'
    );
    expect(url.searchParams.get('q')).toContain(`${scope}."name/with:punctuation" = "literal"`);
    await expect(
      searchTraces(clusterScope('alpha'), config, query, new AbortController().signal)
    ).rejects.toThrow('require Tempo');
    expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  }
);

it('captures intrinsic predicates before awaiting and blocks invalid or Jaeger submissions', async () => {
  const query = {
    service: 'reviews',
    start: 1700000000,
    end: 1700000900,
    limit: 20,
    tempoIntrinsics: [
      { field: 'duration' as const, operator: '>=' as const, value: '9007199254740993ns' },
      { field: 'traceDuration' as const, operator: '>=' as const, value: '2s' },
      { field: 'rootName' as const, operator: '=' as const, value: 'GET /productpage' },
      { field: 'rootServiceName' as const, operator: '=' as const, value: 'productpage' },
    ],
  };
  vi.mocked(ApiProxy.request).mockResolvedValue(fixtures.tempoSearch);
  const pending = searchTraces(
    clusterScope('alpha'),
    { ...config, provider: 'tempo' },
    query,
    new AbortController().signal
  );
  query.tempoIntrinsics[0].value = '0.1ns';
  query.tempoIntrinsics[1].value = '0ns';
  query.tempoIntrinsics[2].value = 'changed';
  await pending;
  const url = new URL(String(vi.mocked(ApiProxy.request).mock.calls[0][0]), 'http://example.test');
  expect(url.searchParams.get('q')).toContain('span:duration >= 9007199254740993ns');
  expect(url.searchParams.get('q')).toContain('trace:duration >= 2000000000ns');
  expect(url.searchParams.get('q')).toContain('trace:rootName = "GET /productpage"');
  expect(url.searchParams.get('q')).toContain('trace:rootService = "productpage"');
  await expect(
    searchTraces(
      clusterScope('alpha'),
      { ...config, provider: 'tempo' },
      query,
      new AbortController().signal
    )
  ).rejects.toThrow('not rounded');
  query.tempoIntrinsics[0].value = '0ns';
  await expect(
    searchTraces(clusterScope('alpha'), config, query, new AbortController().signal)
  ).rejects.toThrow('require Tempo');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});

it('captures punctuation and Unicode attribute keys without interpreting them as query structure', async () => {
  const key = 'k8s.io/label"\\\u00e9';
  const query = {
    service: 'reviews',
    start: 1700000000,
    end: 1700000900,
    limit: 20,
    tags: [{ key: 'customer tier', value: 'paid' }],
    tempoFilters: [
      {
        scope: 'resource' as const,
        key,
        type: 'string' as const,
        operator: '=' as const,
        value: 'literal',
      },
    ],
  };
  vi.mocked(ApiProxy.request).mockResolvedValue(fixtures.tempoSearch);
  const pending = searchTraces(
    clusterScope('alpha'),
    { ...config, provider: 'tempo' },
    query,
    new AbortController().signal
  );
  query.tempoFilters[0].key = 'changed';
  query.tags[0].key = 'different';
  await pending;
  const url = new URL(String(vi.mocked(ApiProxy.request).mock.calls[0][0]), 'http://example.test');
  expect(url.searchParams.get('q')).toBe(
    `{ .service.name = "reviews" && ."customer tier" = "paid" && resource.${JSON.stringify(
      key
    )} = "literal" }`
  );
});

it('enforces the search deadline and aborts even when the SDK ignores cancellation', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const read = searchTraces(
      clusterScope('alpha'),
      config,
      { service: 'reviews', start: 1700000000, end: 1700000900, limit: 20 },
      new AbortController().signal
    );
    const rejected = expect(read).rejects.toThrow('exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it.each(['jaeger', 'tempo'] as const)(
  'captures %s detail and capability scope/provider before any deferred work',
  async provider => {
    for (const action of ['detail', 'probe']) {
      vi.mocked(ApiProxy.request).mockClear();
      const mutable = { ...structuredClone(config), provider };
      const scope = { cluster: 'alpha' };
      const response =
        action === 'detail'
          ? provider === 'jaeger'
            ? fixtures.jaeger
            : fixtures.tempoTrace
          : provider === 'jaeger'
          ? { data: ['reviews'] }
          : { tagNames: ['service.name'] };
      vi.mocked(ApiProxy.request).mockResolvedValue(response);
      const pending =
        action === 'detail'
          ? loadTrace(scope, mutable, '1', new AbortController().signal)
          : inspectTracing(scope, mutable, new AbortController().signal);
      mutable.provider = provider === 'jaeger' ? 'tempo' : 'jaeger';
      mutable.endpoint.namespace = 'different';
      mutable.endpoint.service = 'changed';
      scope.cluster = 'beta';
      const result = await pending;
      expect(result).toMatchObject(
        action === 'detail' ? { id: '00000000000000000000000000000001' } : { count: 1 }
      );
      const [path, options] = vi.mocked(ApiProxy.request).mock.calls[0];
      expect(path).toContain('/namespaces/observability/services/query:16686/');
      expect(path).toContain(
        action === 'detail'
          ? '/api/traces/'
          : provider === 'jaeger'
          ? '/api/services'
          : '/api/search/tags'
      );
      expect(options?.cluster).toBe('alpha');
      expect(options?.signal?.aborted).toBe(true);
    }
  }
);

it.each(['detail', 'probe'] as const)(
  'bounds %s reads even when the SDK ignores abort and prevents cancelled queued work',
  async action => {
    const read = (signal: AbortSignal) =>
      action === 'detail'
        ? loadTrace(clusterScope('alpha'), config, '1', signal)
        : inspectTracing(clusterScope('alpha'), config, signal);
    vi.useFakeTimers();
    try {
      vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
      const pending = read(new AbortController().signal);
      const rejected = expect(pending).rejects.toThrow('exceeded 15 seconds');
      await vi.advanceTimersByTimeAsync(14999);
      const signal = vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal;
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(signal?.aborted).toBe(true);
      vi.mocked(ApiProxy.request).mockClear();
      const caller = new AbortController();
      const cancelled = read(caller.signal);
      const aborted = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      caller.abort();
      await aborted;
      expect(ApiProxy.request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }
);

it.each(['detail', 'probe'] as const)(
  'cancels active %s reads promptly and preserves backend errors',
  async action => {
    const read = (signal: AbortSignal) =>
      action === 'detail'
        ? loadTrace(clusterScope('alpha'), config, '1', signal)
        : inspectTracing(clusterScope('alpha'), config, signal);
    const caller = new AbortController();
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const cancelled = read(caller.signal);
    const aborted = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const signal = vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal;
    caller.abort();
    await aborted;
    expect(signal?.aborted).toBe(true);
    vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'Explicit denial' });
    await expect(read(new AbortController().signal)).rejects.toEqual({
      status: 403,
      message: 'Explicit denial',
    });
    vi.mocked(ApiProxy.request).mockResolvedValue({ unexpected: true });
    await expect(read(new AbortController().signal)).rejects.toThrow();
  }
);

it('captures name-discovery provider, scope, endpoint and service before awaiting the backend', async () => {
  const current = structuredClone(config);
  const scope = clusterScope('alpha');
  const query = {
    start: 1700000000,
    end: 1700000900,
    kind: 'operations' as const,
    service: 'reviews / ? &',
  };
  vi.mocked(ApiProxy.request).mockResolvedValue({ data: [{ name: 'GET /', spanKind: 'server' }] });
  const result = discoverTraceNames(scope, current, query, new AbortController().signal);
  current.provider = 'tempo';
  current.endpoint.service = 'changed';
  query.service = 'different';
  expect(await result).toEqual(['GET /']);
  const [path, options] = vi.mocked(ApiProxy.request).mock.calls[0];
  const url = new URL(String(path), 'http://example.test');
  expect(url.pathname).toBe(
    '/api/v1/namespaces/observability/services/query:16686/proxy/jaeger/api/operations'
  );
  expect(url.searchParams.get('service')).toBe('reviews / ? &');
  expect(options).toMatchObject({
    cluster: 'alpha',
    headers: { Accept: 'application/json' },
    autoLogoutOnAuthError: false,
  });
  expect(options?.signal?.aborted).toBe(true);
});

it('preserves name-discovery HTTP and malformed-response failures with no fallback endpoint', async () => {
  const query = { start: 1700000000, end: 1700000900, kind: 'services' as const };
  vi.mocked(ApiProxy.request).mockRejectedValueOnce({
    status: 404,
    message: 'Unsupported endpoint',
  });
  await expect(
    discoverTraceNames(clusterScope('alpha'), config, query, new AbortController().signal)
  ).rejects.toMatchObject({ status: 404 });
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({ data: [] });
  await expect(
    discoverTraceNames(
      clusterScope('alpha'),
      { ...config, provider: 'tempo' },
      query,
      new AbortController().signal
    )
  ).rejects.toThrow(/1,000 entries/);
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});

it('bounds discovery to 15 seconds and prevents pre-aborted reads', async () => {
  const query = { start: 1700000000, end: 1700000900, kind: 'services' as const };
  const abort = new AbortController();
  abort.abort();
  await expect(
    discoverTraceNames(clusterScope('alpha'), config, query, abort.signal)
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const result = discoverTraceNames(
      clusterScope('alpha'),
      config,
      query,
      new AbortController().signal
    );
    const rejected = expect(result).rejects.toThrow('exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
