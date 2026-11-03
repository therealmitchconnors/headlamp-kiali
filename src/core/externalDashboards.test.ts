import {
  ExternalDashboardDefinition,
  GrafanaDashboardConfig,
  PersesDashboardConfig,
  validateExternalDashboards,
} from './config';
import {
  buildExternalDashboardLink,
  decodeGrafanaDashboardSearch,
  decodePersesDashboard,
  ExternalDashboardContext,
  externalDashboardPath,
  persesDashboardID,
} from './externalDashboards';

const endpoint = {
  namespace: 'observability',
  service: 'grafana',
  port: '3000',
  basePath: '',
};
const grafana: GrafanaDashboardConfig = {
  endpoint,
  externalURL: 'https://dashboards.example.test/grafana',
  datasourceUID: 'prometheus-uid',
  dashboards: [
    {
      name: 'Istio Service Dashboard',
      variables: {
        cluster: 'var-cluster',
        namespace: 'var-namespace',
        service: 'var-service',
        version: 'var-version',
        app: 'var-app',
      },
    },
  ],
};
const perses: PersesDashboardConfig = {
  endpoint: { ...endpoint, service: 'perses', port: '8080' },
  externalURL: 'https://dashboards.example.test/perses',
  project: 'istio',
  dashboards: [
    {
      name: 'Istio Workload Dashboard',
      variables: {
        datasource: 'var-datasource',
        workload: 'var-workload',
        namespace: 'var-namespace',
        cluster: 'var-cluster',
      },
    },
  ],
};
const context: ExternalDashboardContext = {
  cluster: 'mesh east',
  namespace: 'book info',
  service: 'ratings',
  application: '',
  workload: 'ratings-v1',
  version: 'v1 & blue',
  start: 1700000000000,
  end: 1700000900000,
};

describe('external dashboard identity and safe links', () => {
  it('uses the pinned Grafana query identity and source-aligned search result path', () => {
    const definition = grafana.dashboards[0];
    const path = externalDashboardPath('grafana', grafana, definition);
    expect(new URLSearchParams(path.split('?')[1]).get('query')).toBe(definition.name);
    expect(
      decodeGrafanaDashboardSearch(
        [{ title: definition.name, type: 'dash-db', url: '/d/grafana-uid/istio-service' }],
        definition.name,
        grafana.externalURL
      )
    ).toBe('/grafana/d/grafana-uid/istio-service');
  });

  it('encodes mapped Grafana variables, preserves empty values, and carries exact history', () => {
    const definition = grafana.dashboards[0];
    const path = decodeGrafanaDashboardSearch(
      [{ title: definition.name, url: '/d/grafana-uid/istio-service' }],
      definition.name,
      grafana.externalURL
    )!;
    const url = new URL(buildExternalDashboardLink('grafana', grafana, definition, path, context));
    expect(url.pathname).toBe('/grafana/d/grafana-uid/istio-service');
    expect(url.searchParams.get('var-cluster')).toBe('mesh east');
    expect(url.searchParams.get('var-namespace')).toBe('book info');
    expect(url.searchParams.get('var-service')).toBe('ratings.book info.svc.cluster.local');
    expect(url.searchParams.get('var-version')).toBe('v1 & blue');
    expect(url.searchParams.has('var-app')).toBe(true);
    expect(url.searchParams.get('var-app')).toBe('');
    expect(url.searchParams.get('from')).toBe(String(context.start));
    expect(url.searchParams.get('to')).toBe(String(context.end));
  });

  it('uses the pinned Perses dashboard identity and project path with absolute history', () => {
    const definition = perses.dashboards[0];
    expect(persesDashboardID(definition.name)).toBe('istio-workload-dashboard');
    expect(externalDashboardPath('perses', perses, definition)).toBe(
      '/api/v1/projects/istio/dashboards/istio-workload-dashboard'
    );
    expect(
      decodePersesDashboard(
        {
          kind: 'Dashboard',
          metadata: { name: 'istio-workload-dashboard', project: 'istio' },
        },
        perses.project,
        definition.name
      )
    ).toBe(true);
    const url = new URL(
      buildExternalDashboardLink(
        'perses',
        perses,
        definition,
        '/projects/istio/dashboards/istio-workload-dashboard',
        context
      )
    );
    expect(url.pathname).toBe('/perses/projects/istio/dashboards/istio-workload-dashboard');
    expect(url.searchParams.get('var-datasource')).toBe('istio');
    expect(url.searchParams.get('var-workload')).toBe('ratings-v1');
    expect(url.searchParams.get('var-cluster')).toBe('mesh east');
    expect(url.searchParams.get('start')).toBe(new Date(context.start).toISOString());
    expect(url.searchParams.get('end')).toBe(new Date(context.end).toISOString());
  });

  it('rejects ambiguous or mismatched provider identities and unsafe Grafana URLs', () => {
    const name = grafana.dashboards[0].name;
    expect(() => decodeGrafanaDashboardSearch({}, name, grafana.externalURL)).toThrow(
      'supported dashboard list'
    );
    expect(() =>
      decodeGrafanaDashboardSearch(
        [
          { title: name, url: '/d/one/dashboard' },
          { title: name, url: '/d/two/dashboard' },
        ],
        name,
        grafana.externalURL
      )
    ).toThrow('ambiguous');
    expect(() =>
      decodeGrafanaDashboardSearch(
        [{ title: name, url: 'https://attacker.example.test/d/uid/dashboard' }],
        name,
        grafana.externalURL
      )
    ).toThrow('configured host');
    expect(() =>
      decodeGrafanaDashboardSearch([{ title: name, url: '/api/admin' }], name, grafana.externalURL)
    ).toThrow('supported dashboard route');
    expect(() =>
      decodeGrafanaDashboardSearch([{ title: name, url: '/d/%252e%252e/redirect' }], name, grafana.externalURL)
    ).toThrow('safe path');
    expect(() =>
      decodePersesDashboard(
        { metadata: { name: 'other', project: 'istio' } },
        'istio',
        perses.dashboards[0].name
      )
    ).toThrow('unsupported dashboard identity');
  });

  it.each([
    'javascript:alert(1)',
    'ftp://dashboards.example.test',
    '******dashboards.example.test',
    'https://dashboards.example.test/path?redirect=https://attacker.example',
    'https://dashboards.example.test/#fragment',
    'https://dashboards.example.test/%2f..',
    'https://@dashboards.example.test',
  ])('rejects unsafe external URL %s and secret/unknown fields', url => {
    expect(() =>
      validateExternalDashboards({
        grafana: {
          endpoint,
          externalURL: url,
          dashboards: [{ name: 'Dashboard', variables: {} }],
        },
      })
    ).toThrow();
    expect(() =>
      validateExternalDashboards({
        grafana: {
          endpoint,
          externalURL: 'https://dashboards.example.test',
          token: 'never persist credentials',
          dashboards: [{ name: 'Dashboard', variables: {} }],
        },
      })
    ).toThrow();
  });

  it('validates provider names, variable mappings, limits, and historical ranges', () => {
    expect(() =>
      validateExternalDashboards({
        perses: {
          endpoint,
          externalURL: 'https://dashboards.example.test',
          project: 'istio',
          dashboards: [{ name: 'Bad/Path', variables: {} }],
        },
      })
    ).toThrow('safe dashboard identifier');
    expect(() =>
      validateExternalDashboards({
        grafana: {
          endpoint,
          externalURL: 'https://dashboards.example.test',
          dashboards: [{ name: 'Dashboard', variables: { namespace: 'var-namespace&redirect' } }],
        },
      })
    ).toThrow('safe query parameter');
    expect(() =>
      validateExternalDashboards({
        grafana: {
          endpoint,
          externalURL: 'https://dashboards.example.test',
          dashboards: [
            { name: 'Dashboard', variables: { namespace: 'var-value', cluster: 'var-value' } },
          ],
        },
      })
    ).toThrow('query parameter names must be unique');
    expect(() =>
      validateExternalDashboards({
        grafana: {
          endpoint,
          externalURL: 'https://dashboards.example.test',
          dashboards: [{ name: 'Dashboard', variables: { namespace: 'from' } }],
        },
      })
    ).toThrow('cannot replace the time range');
    expect(() =>
      validateExternalDashboards({
        perses: {
          endpoint,
          externalURL: 'https://dashboards.example.test',
          project: 'istio',
          dashboards: [
            { name: 'Istio Dashboard', variables: {} },
            { name: 'istio-dashboard', variables: {} },
          ],
        },
      })
    ).toThrow('names must be unique');
    const definition: ExternalDashboardDefinition = grafana.dashboards[0];
    for (const range of [
      { start: 100, end: 100 },
      { start: -1, end: 100 },
      { start: 1, end: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(() =>
        buildExternalDashboardLink('grafana', grafana, definition, '/d/u/name', {
          ...context,
          ...range,
        })
      ).toThrow('valid historical');
    }
  });
});
