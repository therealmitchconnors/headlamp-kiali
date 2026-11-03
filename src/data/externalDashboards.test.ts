import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { ExternalDashboardProvider } from '../core/config';
import { ExternalDashboardContext } from '../core/externalDashboards';
import { clusterScope } from '../core/scope';
import { discoverExternalDashboards } from './externalDashboards';
import { readFailure } from './requests';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));

const endpoint = {
  namespace: 'observability',
  service: 'grafana',
  port: '3000',
  basePath: '/monitoring',
};
const grafana = {
  endpoint,
  externalURL: 'https://dashboards.example.test/grafana',
  datasourceUID: 'prom',
  dashboards: [
    {
      name: 'Istio Service Dashboard',
      variables: {
        cluster: 'var-cluster',
        namespace: 'var-namespace',
        service: 'var-service',
        version: 'var-version',
      },
    },
  ],
};
const perses = {
  endpoint: { ...endpoint, service: 'perses', port: '8080', basePath: '' },
  externalURL: 'https://dashboards.example.test/perses',
  project: 'istio',
  dashboards: [
    {
      name: 'Istio Workload Dashboard',
      variables: { workload: 'var-workload', namespace: 'var-namespace' },
    },
  ],
};
const context: ExternalDashboardContext = {
  cluster: 'mesh-east',
  namespace: 'bookinfo',
  service: 'ratings',
  workload: 'ratings-v1',
  version: 'v1',
  start: 1700000000000,
  end: 1700000900000,
};

beforeEach(() => vi.mocked(ApiProxy.request).mockReset());

async function discover(provider: ExternalDashboardProvider, config: unknown = provider === 'grafana' ? grafana : perses) {
  return discoverExternalDashboards(
    clusterScope('alpha'),
    provider,
    config,
    context,
    new AbortController().signal
  );
}

describe('external dashboard provider discovery', () => {
  it('discovers exact Grafana dashboard identities through the cluster proxy and builds links', async () => {
    vi.mocked(ApiProxy.request).mockResolvedValue([
      { title: 'Istio Service Dashboard', type: 'dash-db', url: '/d/service-uid/istio-service' },
      { title: 'Istio Service Dashboard (old)', type: 'dash-db', url: '/d/old/old' },
    ]);
    const result = await discover('grafana');
    expect(result).toMatchObject({
      provider: 'grafana',
      capability: 'verified',
      missing: [],
    });
    expect(result.dashboards).toHaveLength(1);
    const link = new URL(result.dashboards[0].url);
    expect(link.pathname).toBe('/grafana/d/service-uid/istio-service');
    expect(link.searchParams.get('var-cluster')).toBe('mesh-east');
    expect(link.searchParams.get('var-service')).toBe('ratings.bookinfo.svc.cluster.local');
    expect(link.searchParams.get('from')).toBe(String(context.start));
    const [path, options] = vi.mocked(ApiProxy.request).mock.calls[0];
    const request = new URL(String(path), 'http://headlamp.test');
    expect(request.pathname).toBe(
      '/api/v1/namespaces/observability/services/grafana:3000/proxy/monitoring/api/search'
    );
    expect(request.searchParams.get('query')).toBe('Istio Service Dashboard');
    expect(options).toMatchObject({
      cluster: 'alpha',
      autoLogoutOnAuthError: false,
      headers: { Accept: 'application/json' },
    });
    expect(JSON.stringify(options)).not.toMatch(/authorization|token|password/i);
  });

  it('discovers Perses by its project and slug and reports the verified capability', async () => {
    vi.mocked(ApiProxy.request).mockResolvedValue({
      kind: 'Dashboard',
      metadata: { name: 'istio-workload-dashboard', project: 'istio' },
    });
    const result = await discover('perses');
    expect(result.capability).toBe('verified');
    expect(result.dashboards[0].name).toBe('Istio Workload Dashboard');
    const link = new URL(result.dashboards[0].url);
    expect(link.pathname).toBe('/perses/projects/istio/dashboards/istio-workload-dashboard');
    expect(link.searchParams.get('var-workload')).toBe('ratings-v1');
    expect(link.searchParams.get('var-datasource')).toBeNull();
    expect(link.searchParams.get('start')).toBe(new Date(context.start).toISOString());
    expect(link.searchParams.get('end')).toBe(new Date(context.end).toISOString());
    expect(String(vi.mocked(ApiProxy.request).mock.calls[0][0])).toContain(
      '/services/perses:8080/proxy/api/v1/projects/istio/dashboards/istio-workload-dashboard'
    );
  });

  it('distinguishes missing dashboards, unavailable provider APIs, and denied endpoints', async () => {
    vi.mocked(ApiProxy.request).mockRejectedValueOnce(
      Object.assign(new Error('missing'), { status: 404 })
    );
    const missing = await discover('perses');
    expect(missing).toMatchObject({
      capability: 'unverified',
      dashboards: [],
      missing: ['Istio Workload Dashboard'],
    });
    vi.mocked(ApiProxy.request).mockRejectedValueOnce(
      Object.assign(new Error('missing API'), { status: 404 })
    );
    try {
      await discover('grafana');
      throw new Error('Expected an unsupported provider API');
    } catch (error) {
      expect(readFailure(error).kind).toBe('unsupported');
      expect((error as Error).message).toContain('search API is not supported');
    }
    vi.mocked(ApiProxy.request).mockRejectedValueOnce(
      Object.assign(new Error('provider denied'), { status: 403 })
    );
    try {
      await discover('grafana');
      throw new Error('Expected a denied endpoint');
    } catch (error) {
      expect(readFailure(error).kind).toBe('forbidden');
    }
  });

  it('rejects provider capability mismatches and invalid dashboard identities', async () => {
    vi.mocked(ApiProxy.request).mockResolvedValue({ status: 'ok', dashboards: [] });
    try {
      await discover('grafana');
      throw new Error('Expected an unsupported response');
    } catch (error) {
      expect(readFailure(error).kind).toBe('unsupported');
      expect(error).toHaveProperty('message', 'Grafana search API did not return a supported dashboard list');
    }
    vi.mocked(ApiProxy.request).mockResolvedValue({
      kind: 'Dashboard',
      metadata: { name: 'wrong', project: 'istio' },
    });
    await expect(discover('perses')).rejects.toThrow('unsupported dashboard identity');
  });

  it('captures provider settings and query values before transport begins', async () => {
    vi.mocked(ApiProxy.request).mockResolvedValue([
      { title: 'Istio Service Dashboard', url: '/d/service-uid/istio-service' },
    ]);
    const settings = structuredClone(grafana);
    const requestContext = { ...context };
    const pending = discoverExternalDashboards(
      clusterScope('alpha'),
      'grafana',
      settings,
      requestContext,
      new AbortController().signal
    );
    settings.endpoint.service = 'changed';
    settings.dashboards[0].name = 'changed';
    requestContext.namespace = 'changed';
    const result = await pending;
    expect(result.dashboards[0].url).toContain('var-namespace=bookinfo');
    expect(String(vi.mocked(ApiProxy.request).mock.calls[0][0])).toContain('/services/grafana:3000/');
    expect(new URL(String(vi.mocked(ApiProxy.request).mock.calls[0][0]), 'http://headlamp.test').searchParams.get('query')).toBe(
      'Istio Service Dashboard'
    );
  });

  it('rejects pre-cancelled and oversized discovery before transport', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      discoverExternalDashboards(clusterScope('alpha'), 'grafana', grafana, context, aborted.signal)
    ).rejects.toThrow();
    expect(ApiProxy.request).not.toHaveBeenCalled();

    await expect(
      discoverExternalDashboards(
        clusterScope('alpha'),
        'grafana',
        {
          ...grafana,
          dashboards: Array.from({ length: 33 }, (_, index) => ({
            name: `Dashboard ${index}`,
            variables: {},
          })),
        },
        context,
        new AbortController().signal
      )
    ).rejects.toThrow('between 1 and 32');
    expect(ApiProxy.request).not.toHaveBeenCalled();
  });
});
