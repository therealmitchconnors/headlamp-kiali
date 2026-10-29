import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import {
  discoverIstio,
  inspectPrometheus,
  InvalidResponseError,
  readCluster,
  readFailure,
  serviceProxyPath,
} from './requests';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
}));

const endpoint = {
  namespace: 'istio-system',
  service: 'prometheus',
  port: 'http',
  basePath: '/metrics',
};

beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

describe('Headlamp request boundary', () => {
  it('binds every read to its captured cluster and signal without authentication side effects', async () => {
    const controller = new AbortController();
    vi.mocked(ApiProxy.request).mockResolvedValue({ items: [] });
    await readCluster(clusterScope('alpha'), '/api/v1/namespaces', controller.signal);
    expect(ApiProxy.request).toHaveBeenCalledWith(
      '/api/v1/namespaces',
      { cluster: 'alpha', signal: controller.signal, autoLogoutOnAuthError: false },
      false
    );
  });

  it('does not send requests that are already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readCluster(clusterScope('alpha'), '/api/v1/namespaces', controller.signal)
    ).rejects.toBeDefined();
    expect(ApiProxy.request).not.toHaveBeenCalled();
  });

  it.each(['https://external.invalid', '//external.invalid', 'relative'])(
    'does not allow an external or relative cluster path: %s',
    async path => {
      await expect(
        readCluster(clusterScope('alpha'), path, new AbortController().signal)
      ).rejects.toThrow();
      expect(ApiProxy.request).not.toHaveBeenCalled();
    }
  );

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [500, 'unavailable'],
  ])('distinguishes HTTP %s failures', (status, kind) => {
    expect(readFailure(Object.assign(new Error('Server message'), { status }))).toEqual({
      status,
      kind,
      message: 'Server message',
    });
  });

  it('does not equate a malformed response with absent Istio', () => {
    expect(readFailure(new InvalidResponseError('Invalid payload')).kind).toBe('invalid-response');
  });
});

describe('capability response contracts', () => {
  it('constructs only internal Service proxy paths', () => {
    expect(serviceProxyPath(endpoint, '/api/v1/status/buildinfo')).toBe(
      '/api/v1/namespaces/istio-system/services/prometheus:http/proxy/metrics/api/v1/status/buildinfo'
    );
    expect(() => serviceProxyPath(endpoint, '/../pods')).toThrow();
    expect(() => serviceProxyPath(endpoint, '/api?token=private')).toThrow();
    expect(serviceProxyPath(endpoint, '/api/v2/search/tag/.service.name/values')).toContain(
      '/proxy/metrics/api/v2/search/tag/.service.name/values'
    );
    for (const suffix of [
      '/api/./values',
      '/api/../values',
      '/api/.',
      '/api/..',
      '/api/%2e%2e/values',
      '/api\\..\\values',
      '/api/values\n',
      '/api/values#fragment',
    ])
      expect(() => serviceProxyPath(endpoint, suffix)).toThrow();
  });

  it('reads real discovery version shapes without inferring control-plane health', async () => {
    vi.mocked(ApiProxy.request).mockResolvedValue({
      name: 'networking.istio.io',
      versions: [{ version: 'v1' }, { version: 'v1beta1' }],
    });
    await expect(
      discoverIstio(clusterScope('alpha'), new AbortController().signal)
    ).resolves.toEqual({ versions: ['v1', 'v1beta1'] });
  });

  it.each([
    {},
    { name: 'wrong', versions: [{ version: 'v1' }] },
    { name: 'networking.istio.io', versions: [] },
    { name: 'networking.istio.io', versions: [{ version: '' }] },
    { name: 'networking.istio.io', versions: [{ unexpected: 'v1' }] },
  ])(
    'rejects malformed discovery rather than returning an empty installed state %j',
    async response => {
      vi.mocked(ApiProxy.request).mockResolvedValue(response);
      await expect(
        discoverIstio(clusterScope('alpha'), new AbortController().signal)
      ).rejects.toBeInstanceOf(InvalidResponseError);
    }
  );

  it('validates the configured Prometheus response', async () => {
    vi.mocked(ApiProxy.request).mockResolvedValue({
      status: 'success',
      data: { version: '3.10.0' },
    });
    await expect(
      inspectPrometheus(clusterScope('alpha'), endpoint, new AbortController().signal)
    ).resolves.toEqual({ version: '3.10.0' });
    vi.mocked(ApiProxy.request).mockResolvedValue({ status: 'error', data: { version: '3.10.0' } });
    await expect(
      inspectPrometheus(clusterScope('alpha'), endpoint, new AbortController().signal)
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });
});
