import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { useKialiConfig } from '../config';
import { correlateResources, CorrelationResource } from '../core/correlation';
import { CustomDashboardQuery } from '../core/customDashboards';
import ApplicationDashboards, { InspectionResults } from './ApplicationDashboards';
import { DashboardResults } from './CustomDashboards';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('./CustomDashboards', () => ({
  DashboardResults: vi.fn(({ query }: { query: CustomDashboardQuery }) => (
    <div role="img" aria-label="Captured application chart">
      {JSON.stringify(query.labelsFilters)}
    </div>
  )),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SimpleTable: <T,>({
    data,
    columns,
  }: {
    data: T[];
    columns: { label: string; getter: (row: T) => ReactNode }[];
  }) => (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {columns.map(column => (
              <td key={column.label}>{column.getter(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
const configured = {
  valid: true as const,
  config: {
    schemaVersion: 1 as const,
    clusters: {
      alpha: {
        prometheus: { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' },
        telemetryCluster: 'east',
        customDashboards: {
          namespaceLabel: 'namespace',
          clusterLabel: 'cluster' as string | null,
          dashboards: [
            {
              name: 'go',
              title: 'Go',
              discoverOn: 'go_info',
              items: [
                { chart: { name: 'Memory', dataType: 'raw' as const, metricName: 'memory_bytes' } },
              ],
            },
          ],
        },
      },
    },
  },
};
function application() {
  const pod: CorrelationResource = {
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: '',
      kind: 'Pod',
      name: 'reviews',
      uid: 'pod-uid',
    },
    resourceVersion: '7',
    labels: { app: 'reviews' },
    workloadLabels: { app: 'reviews' },
    owners: [],
    serviceSelector: null,
    proxyMode: 'none',
    dashboardRefs: { ok: true, refs: ['go'], bytes: 2 },
  };
  return correlateResources([pod]).applications[0];
}
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue(structuredClone(configured));
  vi.mocked(DashboardResults).mockClear();
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockResolvedValue({
      kind: 'Namespace',
      apiVersion: 'v1',
      metadata: { name: 'bookinfo', uid: 'ns-uid', resourceVersion: '3' },
    });
});
afterEach(cleanup);
const inspect = () =>
  userEvent.click(
    screen.getByRole('button', { name: 'Inspect application dashboard recommendations' })
  );
const choose = () => userEvent.click(screen.getByRole('button', { name: 'Inspect go charts' }));
const load = () =>
  userEvent.click(screen.getByRole('button', { name: 'Load captured application dashboard' }));
async function selectScope() {
  await userEvent.click(screen.getByLabelText('Application metric label convention'));
  await userEvent.click(screen.getByRole('option', { name: 'app → app' }));
}
it('does nothing until inspection and then requires a label choice before scoped chart loading', async () => {
  render(<ApplicationDashboards app={application()} complete labels={null} />);
  expect(ApiProxy.request).not.toHaveBeenCalled();
  await inspect();
  await screen.findByRole('button', { name: 'Inspect go charts' });
  await choose();
  await load();
  expect(screen.getByText('Choose an explicit application metric label convention')).toBeDefined();
  expect(DashboardResults).not.toHaveBeenCalled();
  await selectScope();
  await load();
  await screen.findByRole('img', { name: 'Captured application chart' });
  const query = vi.mocked(DashboardResults).mock.calls[0][0].query;
  expect(query).toMatchObject({
    namespace: 'bookinfo',
    metricCluster: 'east',
    labelsFilters: { app: 'reviews' },
    chartNames: ['Memory'],
    annotationSources: [{ uid: 'ns-uid', resourceVersion: '3' }],
    templateReferences: [{ name: 'go', origin: 'custom' }],
  });
  fireEvent.change(screen.getByLabelText('Application dashboard metric cluster'), {
    target: { value: 'draft' },
  });
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  expect(query.metricCluster).toBe('east');
});
it('invalidates after provider or captured Pod version changes without replay or resurrection', async () => {
  const app = application();
  const view = render(<ApplicationDashboards app={app} complete labels={null} />);
  await inspect();
  await screen.findByRole('button', { name: 'Inspect go charts' });
  const signal = vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal;
  const changed = structuredClone(configured);
  changed.config.clusters.alpha.prometheus.service = 'other';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(<ApplicationDashboards app={app} complete labels={null} />);
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: 'Inspect go charts' })).toBeNull();
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  view.rerender(<ApplicationDashboards app={app} complete labels={null} />);
  expect(screen.queryByRole('button', { name: 'Inspect go charts' })).toBeNull();
  await inspect();
  await screen.findByRole('button', { name: 'Inspect go charts' });
  const newer = structuredClone(app);
  newer.pods[0].resourceVersion = '8';
  view.rerender(<ApplicationDashboards app={newer} complete labels={null} />);
  expect(screen.queryByRole('button', { name: 'Inspect go charts' })).toBeNull();
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});
it('does not resurrect a single-cluster acknowledgment when settings return to an older binding', async () => {
  const config = structuredClone(configured);
  config.config.clusters.alpha.customDashboards.clusterLabel = null;
  vi.mocked(useKialiConfig).mockReturnValue(config);
  const app = application();
  const view = render(<ApplicationDashboards app={app} complete labels={null} />);
  const name = 'I confirm the application dashboard metrics source contains only one cluster';
  await userEvent.click(screen.getByRole('checkbox', { name }));
  const changed = structuredClone(config);
  changed.config.clusters.alpha.prometheus.service = 'other';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(<ApplicationDashboards app={app} complete labels={null} />);
  vi.mocked(useKialiConfig).mockReturnValue(config);
  view.rerender(<ApplicationDashboards app={app} complete labels={null} />);
  expect((screen.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(false);
});
it('shows malformed or incomplete evidence without turning it into an empty runtime inventory', async () => {
  const app = application();
  app.pods[0].dashboardRefs = { ok: false, message: 'Malformed Pod references' };
  const view = render(<ApplicationDashboards app={app} complete labels={null} />);
  expect(screen.getByText('Malformed Pod references')).toBeDefined();
  expect(
    screen.queryByRole('button', { name: 'Inspect application dashboard recommendations' })
  ).toBeNull();
  const partial = application();
  partial.pods[0].dashboardRefs = { ok: true, refs: [], bytes: 0 };
  view.rerender(<ApplicationDashboards app={partial} complete={false} labels={null} />);
  await inspect();
  await screen.findByText(/absence of explicit dashboard references cannot be established/);
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('uses the discovered winning selector without a new guess or version constraint', async () => {
  const app = application();
  app.pods[0].dashboardRefs = { ok: true, refs: [], bytes: 0 };
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (path === '/api/v1/namespaces/bookinfo')
      return {
        kind: 'Namespace',
        apiVersion: 'v1',
        metadata: { name: 'bookinfo', uid: 'ns-uid', resourceVersion: '3' },
      };
    return {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: { __name__: 'go_info' },
            value: [Math.floor(Date.now() / 1000), '1'],
          },
        ],
      },
    };
  });
  render(<ApplicationDashboards app={app} complete labels={null} />);
  await inspect();
  await screen.findByRole('button', { name: 'Inspect go charts' });
  await choose();
  expect(screen.queryByLabelText('Application metric label convention')).toBeNull();
  await load();
  expect(vi.mocked(DashboardResults).mock.calls[0][0].query.labelsFilters).toEqual({
    app: 'reviews',
  });
  expect(ApiProxy.request).toHaveBeenCalledTimes(4);
});
it('loads workload charts with the captured app/version pair and workload annotation identity', async () => {
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce({
      kind: 'Namespace',
      apiVersion: 'v1',
      metadata: { name: 'bookinfo', uid: 'ns-uid', resourceVersion: '3' },
    })
    .mockResolvedValueOnce({
      kind: 'Pod',
      apiVersion: 'v1',
      metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'pod-uid', resourceVersion: '17' },
    });
  render(
    <InspectionResults
      settings={configured.config.clusters.alpha}
      query={{
        metricCluster: 'east',
        confirmed: false,
        evidence: {
          cluster: 'alpha',
          namespace: 'bookinfo',
          application: 'reviews',
          complete: true,
          pods: [],
          refs: ['go'],
          workload: {
            kind: 'Pod',
            name: 'reviews',
            uid: 'pod-uid',
            resourceVersion: '17',
            version: 'v2',
          },
          selectors: [
            {
              label: 'app',
              metricLabel: 'app',
              versionLabel: 'version',
              metricVersionLabel: 'version',
              filters: { app: 'reviews', version: 'v2' },
            },
          ],
        },
      }}
    />
  );
  await screen.findByRole('button', { name: 'Inspect go charts' });
  await choose();
  await userEvent.click(screen.getByRole('button', { name: 'Load captured workload dashboard' }));
  const query = vi.mocked(DashboardResults).mock.calls[0][0].query;
  expect(query.labelsFilters).toEqual({ app: 'reviews', version: 'v2' });
  expect(query.annotationSources).toMatchObject([
    { uid: 'ns-uid' },
    { uid: 'pod-uid', resourceVersion: '17' },
  ]);
});
