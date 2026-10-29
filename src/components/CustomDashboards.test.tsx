import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { customDashboardJobs } from '../core/customDashboards';
import { loadCustomDashboard } from '../data/customDashboards';
import CustomDashboards from './CustomDashboards';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'] },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/customDashboards', () => ({ loadCustomDashboard: vi.fn() }));
vi.mock('./MetricChart', () => ({
  default: ({ title, unit }: { title: string; unit: string }) => (
    <div role="img" aria-label={title}>
      {unit}
    </div>
  ),
}));
vi.mock('./MetricComparisonChart', () => ({
  default: ({ title, metrics }: { title: string; metrics: { name: string }[] }) => (
    <div role="img" aria-label={title}>
      {metrics.map(metric => (
        <span key={metric.name}>{metric.name}</span>
      ))}
    </div>
  ),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
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
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
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
              name: 'runtime',
              title: 'Runtime',
              items: [
                {
                  chart: {
                    name: 'Memory',
                    metricName: 'memory_bytes',
                    unit: 'bytes',
                    dataType: 'raw' as const,
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
};
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  vi.mocked(loadCustomDashboard)
    .mockReset()
    .mockImplementation(async (_scope, _provider, query) => ({
      query,
      metrics: [],
      charts: customDashboardJobs(query).map(({ chart, key, summary, metric, chartIndex }) => ({
        key,
        chart,
        summary,
        metric,
        chartIndex,
        read: { ok: true, result: { warnings: [], series: [] } },
      })),
    }));
});
afterEach(cleanup);
const open = () =>
  render(
    <MemoryRouter initialEntries={['/dashboards?namespace=bookinfo']}>
      <CustomDashboards />
    </MemoryRouter>
  );
it('captures definitions/time/scope and preserves results during draft edits without replay', async () => {
  open();
  const user = userEvent.setup();
  expect(loadCustomDashboard).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: 'Use current dashboard time' }));
  await user.type(screen.getByLabelText('Dashboard end time (local time)'), '2026-01-02T03:04');
  await user.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  await screen.findByRole('img', { name: 'Memory' });
  const captured = vi.mocked(loadCustomDashboard).mock.calls[0][2];
  expect(captured.namespace).toBe('bookinfo');
  expect(captured.metricCluster).toBe('east');
  expect(captured.end).toBe(Math.floor(new Date('2026-01-02T03:04').getTime() / 1000));
  await user.clear(screen.getByLabelText('Dashboard namespace'));
  await user.type(screen.getByLabelText('Dashboard namespace'), 'other');
  expect(captured.namespace).toBe('bookinfo');
  expect(loadCustomDashboard).toHaveBeenCalledTimes(1);
});
it('requires explicit single-cluster acknowledgment and clears it on a source change', async () => {
  const single = structuredClone(configured);
  single.config.clusters.alpha.customDashboards.clusterLabel = null;
  vi.mocked(useKialiConfig).mockReturnValue(single);
  const view = open();
  const user = userEvent.setup();
  const load = screen.getByRole('button', { name: 'Load custom dashboard' });
  await user.click(load);
  expect(
    screen.getByText(/Confirm that the custom dashboard endpoint contains only one cluster/)
  ).toBeDefined();
  expect(loadCustomDashboard).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I confirm this Prometheus source contains only one cluster',
    })
  );
  await user.click(load);
  await screen.findByRole('img', { name: 'Memory' });
  expect(screen.getByText(/plugin cannot verify that assertion/)).toBeDefined();
  const signal = vi.mocked(loadCustomDashboard).mock.calls[0][3];
  const changed = structuredClone(single);
  changed.config.clusters.alpha.prometheus.service = 'other';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(
    <MemoryRouter>
      <CustomDashboards />
    </MemoryRouter>
  );
  expect(signal.aborted).toBe(true);
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  expect(
    (
      screen.getByRole('checkbox', {
        name: 'I confirm this Prometheus source contains only one cluster',
      }) as HTMLInputElement
    ).checked
  ).toBe(false);
  expect(loadCustomDashboard).toHaveBeenCalledTimes(1);
});
it('invalidates results after definitions change and never resurrects them automatically', async () => {
  const view = open();
  await userEvent.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  await screen.findByRole('img', { name: 'Memory' });
  const changed = structuredClone(configured);
  changed.config.clusters.alpha.customDashboards.dashboards[0].items[0].chart.metricName =
    'new_metric';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(
    <MemoryRouter>
      <CustomDashboards />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.queryAllByRole('img')).toHaveLength(0));
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  view.rerender(
    <MemoryRouter>
      <CustomDashboards />
    </MemoryRouter>
  );
  expect(loadCustomDashboard).toHaveBeenCalledTimes(1);
});
it('shows missing configuration and per-chart failure rather than an empty success', async () => {
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: { schemaVersion: 1, clusters: {} },
  });
  const view = open();
  expect(
    screen.getByText('No custom aggregate dashboards are configured for this cluster.')
  ).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Load custom dashboard' })).toBeNull();
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  vi.mocked(loadCustomDashboard).mockImplementation(async (_scope, _provider, query) => ({
    query,
    metrics: [],
    charts: [
      {
        ...customDashboardJobs(query)[0],
        read: { ok: false, error: { kind: 'forbidden', message: 'Dashboard read denied' } },
      },
    ],
  }));
  view.rerender(
    <MemoryRouter>
      <CustomDashboards />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  await screen.findByText('Dashboard read denied');
  expect(screen.queryAllByRole('img')).toHaveLength(0);
});
it('captures draft equality filters and blocks scope replacement before a read', async () => {
  open();
  const user = userEvent.setup();
  const field = screen.getByLabelText('Additional metric labels (JSON)');
  fireEvent.change(field, { target: { value: '{"namespace":"other"}' } });
  await user.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  expect(
    screen.getByText(
      'Additional dashboard filters cannot replace the namespace or metric-cluster scope'
    )
  ).toBeDefined();
  expect(loadCustomDashboard).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '{"job":"runtime","container":""}' } });
  await user.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  await screen.findByRole('img', { name: 'Memory' });
  expect(vi.mocked(loadCustomDashboard).mock.calls[0][2].labelsFilters).toEqual({
    container: '',
    job: 'runtime',
  });
  expect(screen.getByText('Show captured dashboard label filters')).toBeDefined();
  fireEvent.change(field, { target: { value: '{}' } });
  expect(vi.mocked(loadCustomDashboard).mock.calls[0][2].labelsFilters?.job).toBe('runtime');
  expect(loadCustomDashboard).toHaveBeenCalledTimes(1);
});
it('groups declared metric comparisons under one chart per histogram summary', async () => {
  const changed = structuredClone(configured);
  Object.assign(changed.config.clusters.alpha.customDashboards.dashboards[0].items[0].chart, {
    name: 'Capacity',
    dataType: 'histogram',
    metrics: [
      { metricName: 'used', displayName: 'Used' },
      { metricName: 'limit', displayName: 'Limit' },
    ],
  });
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  open();
  await userEvent.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  await screen.findByRole('img', { name: 'Capacity - Average' });
  expect(screen.getByRole('img', { name: 'Capacity - P95' })).toBeDefined();
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(
    vi
      .mocked(loadCustomDashboard)
      .mock.calls[0][2].dashboard.items[0].chart.metrics?.map(metric => metric.displayName)
  ).toEqual(['Used', 'Limit']);
});
it('captures histogram summary selection and rejects empty selections without replay', async () => {
  const changed = structuredClone(configured);
  Object.assign(changed.config.clusters.alpha.customDashboards.dashboards[0].items[0].chart, {
    name: 'Latency',
    dataType: 'histogram',
  });
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  await screen.findByRole('img', { name: 'Latency - Average' });
  expect(screen.getByRole('img', { name: 'Latency - P95' })).toBeDefined();
  const captured = vi.mocked(loadCustomDashboard).mock.calls[0][2];
  await user.click(screen.getByRole('checkbox', { name: 'Histogram summary P95' }));
  expect(captured.histogramSummaries).toEqual(['avg', 'p95']);
  expect(screen.getByRole('img', { name: 'Latency - P95' })).toBeDefined();
  expect(loadCustomDashboard).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('checkbox', { name: 'Histogram summary Average' }));
  await user.click(screen.getByRole('button', { name: 'Load custom dashboard' }));
  expect(screen.getByText(/1 to 5 distinct supported summaries/)).toBeDefined();
  expect(loadCustomDashboard).toHaveBeenCalledTimes(1);
  expect(screen.queryAllByRole('img')).toHaveLength(0);
});
