import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { useKialiConfig } from '../config';
import { loadClusterComparison } from '../data/clusterComparison';
import ClusterComparison from './ClusterComparison';

const host = vi.hoisted(() => ({ selected: ['alpha'], available: { alpha: {}, beta: {} } }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => host.selected, useClustersConf: () => host.available },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/clusterComparison', () => ({ loadClusterComparison: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({
    params,
    routeName,
    children,
  }: {
    params?: { cluster: string };
    routeName: string;
    children: ReactNode;
  }) => <a href={`/c/${params?.cluster}/${routeName}`}>{children}</a>,
  SimpleTable: <T,>({
    data,
    columns,
  }: {
    data: T[];
    columns: { label: string; getter: (row: T) => ReactNode }[];
  }) => (
    <table>
      <tbody>
        {data.map((row, index) => (
          <tr key={index}>
            {columns.map(column => (
              <td key={column.label}>{column.getter(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const config = {
  valid: true as const,
  config: {
    schemaVersion: 1 as const,
    clusters: {
      alpha: { prometheus: endpoint, telemetryCluster: 'shared' },
      beta: { prometheus: endpoint, telemetryCluster: 'shared' },
    },
  },
};
beforeEach(() => {
  host.selected = ['alpha'];
  vi.mocked(useKialiConfig).mockReturnValue(config);
  vi.mocked(loadClusterComparison)
    .mockReset()
    .mockImplementation(async query => ({
      query,
      clusters: query.targets.map(target => ({
        target,
        istio: { status: 'ready', value: { versions: ['v1'] } },
        namespace: { status: 'error', error: { kind: 'forbidden', message: 'Namespace denied' } },
        metrics: { status: 'ready', value: { point: null, warnings: [] } },
      })),
    }));
});
afterEach(cleanup);
it('compares only explicit selections, preserves errors and avoids combined health/rate claims', async () => {
  render(<ClusterComparison />);
  const user = userEvent.setup();
  expect(loadClusterComparison).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText('beta'));
  await user.type(screen.getByLabelText('Namespace'), 'bookinfo');
  await user.click(screen.getByRole('button', { name: 'Compare clusters' }));
  await screen.findByText('Captured cluster comparison');
  expect(screen.getByText(/Repeated telemetry identities: shared/)).toBeDefined();
  expect(screen.getAllByText('Forbidden: Namespace denied')).toHaveLength(2);
  expect(screen.getAllByText('No usable samples')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'beta' }).getAttribute('href')).toBe(
    '/c/beta/kiali-overview'
  );
  expect(
    vi.mocked(loadClusterComparison).mock.calls[0][0].targets.map(target => target.cluster)
  ).toEqual(['alpha', 'beta']);
});
it('invalidates and aborts submissions when a selected connection changes, without replay', async () => {
  vi.mocked(loadClusterComparison).mockImplementation(() => new Promise(() => {}));
  const view = render(<ClusterComparison />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Namespace'), 'bookinfo');
  await user.click(screen.getByRole('button', { name: 'Compare clusters' }));
  await waitFor(() => expect(loadClusterComparison).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadClusterComparison).mock.calls[0][1];
  const changed = structuredClone(config);
  changed.config.clusters.alpha.telemetryCluster = 'changed';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(<ClusterComparison />);
  expect(signal.aborted).toBe(true);
  vi.mocked(useKialiConfig).mockReturnValue(config);
  view.rerender(<ClusterComparison />);
  expect(loadClusterComparison).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Clear cluster selection' }));
  expect(screen.getByRole('button', { name: 'Compare clusters' }).hasAttribute('disabled')).toBe(
    true
  );
});
