import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures scope, spec source requirements and registry overrides before deferred work', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (path === '/apis/gateway.networking.k8s.io')
      return {
        name: 'gateway.networking.k8s.io',
        versions: [{ groupVersion: 'gateway.networking.k8s.io/v1' }],
      };
    if (path === '/apis/gateway.networking.k8s.io/v1')
      return {
        groupVersion: 'gateway.networking.k8s.io/v1',
        resources: [{ name: 'gateways', kind: 'Gateway', namespaced: true }],
      };
    return {
      kind: 'GatewayList',
      apiVersion: 'gateway.networking.k8s.io/v1',
      metadata: { resourceVersion: '1' },
      items: [],
    };
  });
  const scope = { cluster: 'alpha' };
  const spec = {
    gatewayClassName: 'istio',
    listeners: [{ name: 'http', hostname: 'example.com', protocol: 'HTTP', port: 80 }],
  };
  const settings = { classes: [{ name: 'Istio', className: 'istio' }], selector: {} };
  const signal = new AbortController().signal;
  const pending = loadValidationSnapshot(
    scope,
    'Gateway',
    'gateway.networking.k8s.io',
    spec,
    null,
    signal,
    'bookinfo',
    settings
  );
  scope.cluster = 'beta';
  spec.listeners.length = 0;
  settings.classes[0].className = 'changed';
  const result = await pending;
  expect(result.context.cluster).toBe('alpha');
  expect(result.sources.map(source => source.key)).toEqual(['gateways']);
  expect(result.context.gatewayClassRegistry?.classes[0].className).toBe('istio');
  const capturedSignal = vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal;
  expect(capturedSignal).not.toBe(signal);
  expect(capturedSignal?.aborted).toBe(true);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.every(
        ([, options]) => options?.cluster === 'alpha' && options.signal === capturedSignal
      )
  ).toBe(true);
});
it('rejects a hung context at 15 seconds even when the SDK ignores cancellation', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadValidationSnapshot(
      { cluster: 'alpha' },
      'ReferenceGrant',
      'gateway.networking.k8s.io',
      { from: [{ namespace: 'missing' }] },
      null,
      new AbortController().signal,
      'bookinfo'
    );
    const rejected = expect(pending).rejects.toThrow('Configuration checks exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(1);
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it('propagates caller cancellation without waiting for the deadline or starting queued sources', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = loadValidationSnapshot(
    { cluster: 'alpha' },
    'VirtualService',
    'networking.istio.io',
    { http: [{ route: [{ destination: { host: 'reviews', subset: 'v1' } }] }] },
    'svc.cluster.local',
    controller.signal,
    'bookinfo'
  );
  const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve();
  controller.abort();
  await rejected;
  expect(vi.mocked(ApiProxy.request).mock.calls.length).toBeLessThanOrEqual(3);
  expect(
    vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
  ).toBe(true);
});
it('preserves source errors when reads finish before the deadline', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'Namespaces denied' });
  const result = await loadValidationSnapshot(
    { cluster: 'alpha' },
    'ReferenceGrant',
    'gateway.networking.k8s.io',
    { from: [] },
    null,
    new AbortController().signal,
    'bookinfo'
  );
  expect(result.sources[0]).toMatchObject({
    complete: false,
    error: { kind: 'forbidden', message: 'Namespaces denied' },
  });
});
