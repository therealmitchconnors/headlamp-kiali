import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import fixtureText from '../../test-files/topology/fixture.json?raw';
import { useKialiConfig } from '../config';
import { decodeTopology, TopologyQuery } from '../core/topology';
import { loadTopology } from '../data/topology';
import { TopologyResults, TopologyScope } from './Topology';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { cluster: { KubeObject: class {} } },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/topology', () => ({ loadTopology: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children, routeName }: { children: ReactNode; routeName: string }) => (
    <a href={routeName}>{children}</a>
  ),
  SimpleTable: <T,>({
    data,
    columns,
    emptyMessage,
  }: {
    data: T[];
    columns: { label: string; getter: (row: T) => ReactNode }[];
    emptyMessage?: string;
  }) =>
    data.length ? (
      <table>
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={i}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map((column, j) => (
                <td key={j}>{column.getter(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p>{emptyMessage}</p>
    ),
}));
const endpoint = { namespace: 'istio-system', service: 'prometheus', port: '9090', basePath: '' };
const query: TopologyQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  reporter: 'source',
  windowSeconds: 600,
  end: 10000,
  measure: 'requests',
  includeIdle: false,
};
const fixture = JSON.parse(fixtureText);
const snapshot = {
  query,
  ...decodeTopology(
    [
      {
        metric: 'istio_requests_total',
        result: {
          warnings: [],
          series: fixture.samples.map((item: { labels: Record<string, string>; rate: number }) => ({
            labels: { ...fixture.labels, ...item.labels },
            samples: [{ timestamp: query.end, value: item.rate }],
          })),
        },
      },
    ],
    query
  ),
};
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: { schemaVersion: 1, clusters: { alpha: { prometheus: endpoint } } },
  });
  vi.mocked(loadTopology).mockReset().mockResolvedValue(snapshot);
});
afterEach(cleanup);

it('provides local projections and neighbor filtering without issuing additional reads', async () => {
  render(<TopologyResults snapshot={snapshot} />);
  expect(screen.getByText('Showing 6 of 6 nodes and 6 of 6 connections')).toBeDefined();
  await userEvent.click(screen.getByRole('combobox', { name: /Graph projection/ }));
  await userEvent.click(screen.getByRole('option', { name: 'Applications' }));
  expect(screen.getByText('Showing 4 of 4 nodes and 4 of 4 connections')).toBeDefined();
  await userEvent.click(screen.getByRole('combobox', { name: /Graph projection/ }));
  await userEvent.click(screen.getByRole('option', { name: 'Services' }));
  expect(screen.getByText(/Service edges are structural projections/)).toBeDefined();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Filter nodes and their neighbors' }),
    'ratings'
  );
  expect(screen.getByText('Showing 2 of 4 nodes and 1 of 4 connections')).toBeDefined();
  expect(loadTopology).not.toHaveBeenCalled();
});
it('annotates selected/outside/unknown namespaces consistently without issuing reads', async () => {
  const base = snapshot.observations[0];
  const observed = {
    ...snapshot,
    observations: [
      {
        ...base,
        destination: {
          ...base.destination,
          namespace: 'edge',
          serviceNamespace: 'edge',
          workload: 'outside-v1',
          app: 'outside',
          service: 'outside',
        },
      },
      {
        ...base,
        source: {
          ...base.source,
          cluster: 'Remote',
          namespace: 'bookinfo',
          workload: 'remote-v1',
          app: 'remote',
        },
      },
      {
        ...base,
        source: {
          ...base.source,
          cluster: 'unknown',
          namespace: 'unknown',
          workload: 'unknown',
          app: 'unknown',
          service: '',
          serviceNamespace: 'unknown',
          version: 'unknown',
        },
      },
    ],
  };
  render(<TopologyResults snapshot={observed} />);
  const nodes = within(screen.getByRole('region', { name: 'Observed graph nodes' }));
  expect(
    nodes.getByRole('row', { name: /Kubernetes.*edge.*outside-v1.*Outside selected namespace/ })
  ).toBeDefined();
  expect(
    nodes.getByRole('row', { name: /Remote.*bookinfo.*remote-v1.*Selected namespace/ })
  ).toBeDefined();
  expect(nodes.getByRole('row', { name: /unknown.*Namespace not established/ })).toBeDefined();
  const outside = screen.getByRole('button', {
    name: 'Inspect Kubernetes / edge / outside-v1',
    description: 'Outside selected namespace',
  });
  await userEvent.click(outside);
  expect(
    within(screen.getByRole('region', { name: 'Selected graph node' })).getByText(
      'Outside selected namespace'
    )
  ).toBeDefined();
  for (const projection of ['Applications', 'Versioned applications', 'Services']) {
    await userEvent.click(screen.getByRole('combobox', { name: /Graph projection/ }));
    await userEvent.click(screen.getByRole('option', { name: projection }));
    expect(
      within(screen.getByRole('region', { name: 'Observed graph nodes' })).getByText(
        'Outside selected namespace'
      )
    ).toBeDefined();
  }
  expect(screen.getByText(/They do not establish Kubernetes access/)).toBeDefined();
  expect(loadTopology).not.toHaveBeenCalled();
});

it('exposes keyboard node inspection, edge response/security distributions and no guessed resource links', async () => {
  render(<TopologyResults snapshot={snapshot} />);
  const node = screen.getByRole('button', { name: 'Inspect Kubernetes / bookinfo / reviews-v3' });
  node.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByText('Reported revisions: v3')).toBeDefined();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Inspect http connection from Kubernetes / bookinfo / reviews-v3 to Kubernetes / bookinfo / ratings-v1',
    })
  );
  const inspected = within(screen.getByRole('region', { name: 'Selected graph connection' }));
  expect(inspected.getByText('503')).toBeDefined();
  expect(inspected.getByText('UF')).toBeDefined();
  expect(inspected.getByText('none')).toBeDefined();
  expect(screen.queryByText('Reported revisions: v3')).toBeNull();
});
it('renders total-byte metadata with byte units, never request units', () => {
  render(
    <TopologyResults
      snapshot={{
        query: { ...query, measure: 'tcpTotal' },
        observations: [
          {
            ...snapshot.observations[0],
            protocol: 'tcp',
            code: undefined,
            metric: 'istio_tcp_sent_bytes_total',
            rate: 4096,
          },
        ],
        warnings: [],
      }}
    />
  );
  expect(screen.getByRole('columnheader', { name: 'Bytes / second' })).toBeDefined();
  expect(screen.queryByRole('columnheader', { name: 'Requests / second' })).toBeNull();
});
it('requires explicit loading, captures historical time, and clears snapshots immediately when scope changes', async () => {
  render(
    <MemoryRouter initialEntries={['/?namespace=bookinfo']}>
      <TopologyScope cluster="alpha" />
    </MemoryRouter>
  );
  expect(loadTopology).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Istio metric cluster label' }),
    'Kubernetes'
  );
  await userEvent.click(screen.getByRole('checkbox', { name: 'Use current time' }));
  const input = screen.getByLabelText('Query end time (local time)');
  await userEvent.type(input, '2026-01-02T03:04');
  await userEvent.click(screen.getByRole('button', { name: 'Load graph snapshot' }));
  await screen.findByRole('group', { name: 'Observed traffic graph' });
  expect(vi.mocked(loadTopology).mock.calls[0][2].end).toBe(
    Math.floor(new Date('2026-01-02T03:04').getTime() / 1000)
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Namespace' }), '-other');
  expect(screen.queryByRole('group', { name: 'Observed traffic graph' })).toBeNull();
  expect(vi.mocked(loadTopology).mock.calls[0][3].aborted).toBe(true);
});
it('suppresses late cross-cluster data and exposes denied reads rather than an empty success', async () => {
  let resolve: (value: typeof snapshot) => void = () => {};
  vi.mocked(loadTopology).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const { rerender } = render(
    <MemoryRouter>
      <TopologyScope key="alpha" cluster="alpha" />
    </MemoryRouter>
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Namespace' }), 'bookinfo');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Istio metric cluster label' }),
    'Kubernetes'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Load graph snapshot' }));
  const signal = vi.mocked(loadTopology).mock.calls[0][3];
  rerender(
    <MemoryRouter>
      <TopologyScope key="beta" cluster="beta" />
    </MemoryRouter>
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(snapshot));
  expect(screen.queryByRole('group', { name: 'Observed traffic graph' })).toBeNull();
  rerender(
    <MemoryRouter>
      <TopologyScope key="alpha-2" cluster="alpha" />
    </MemoryRouter>
  );
  vi.mocked(loadTopology).mockRejectedValueOnce({ status: 403, message: 'Graph denied' });
  await userEvent.type(screen.getByRole('textbox', { name: 'Namespace' }), 'bookinfo');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Istio metric cluster label' }),
    'Kubernetes'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Load graph snapshot' }));
  await screen.findByText('Access denied: Graph denied');
});
