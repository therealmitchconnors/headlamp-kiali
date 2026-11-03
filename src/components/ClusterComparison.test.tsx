import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      alpha: {
        prometheus: endpoint,
        meshClusterName: 'logical-alpha',
        telemetryCluster: 'shared',
        telemetryStore: 'shared-store',
      },
      beta: {
        prometheus: endpoint,
        meshClusterName: 'logical-beta',
        telemetryCluster: 'shared',
        telemetryStore: 'shared-store',
      },
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
        metrics: { status: 'ready', value: { points: [], warnings: [] } },
      })),
      stores: [
        {
          identity: 'shared-store',
          kind: 'shared',
          sourceClusters: query.targets.map(target => target.cluster),
          sourceMappings: query.targets,
          status: 'incomplete',
          points: [],
          duplicates: [],
          reason: 'No usable samples',
        },
      ],
    }));
});
afterEach(cleanup);
it('compares explicit contexts over a captured historical range and preserves source errors', async () => {
  render(<ClusterComparison />);
  const user = userEvent.setup();
  expect(loadClusterComparison).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText('beta'));
  await user.type(screen.getByLabelText('Namespace'), 'bookinfo');
  fireEvent.change(screen.getByLabelText('Range duration (minutes)'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText('Range end (UTC)'), {
    target: { value: '2023-11-14T22:13' },
  });
  await user.click(screen.getByRole('button', { name: 'Compare clusters' }));
  await screen.findByText('Captured cluster comparison');
  expect(screen.getByText('Normalized telemetry stores')).toBeDefined();
  expect(screen.getAllByText('Forbidden: Namespace denied')).toHaveLength(2);
  expect(screen.getAllByText('No usable samples')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'beta' }).getAttribute('href')).toBe(
    '/c/beta/kiali-overview'
  );
  const submitted = vi.mocked(loadClusterComparison).mock.calls[0][0];
  expect(submitted.targets.map(target => target.cluster)).toEqual(['alpha', 'beta']);
  expect(submitted.targets.map(target => target.meshClusterName)).toEqual([
    'logical-alpha',
    'logical-beta',
  ]);
  expect(submitted.targets.map(target => target.telemetryStore)).toEqual([
    'shared-store',
    'shared-store',
  ]);
  expect(submitted.end).toBe(Date.parse('2023-11-14T22:13:00Z') / 1000);
  expect(submitted.start).toBe(submitted.end - 30 * 60);
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
  changed.config.clusters.alpha.telemetryStore = 'changed';
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
