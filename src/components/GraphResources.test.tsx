import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { useKialiConfig } from '../config';
import { TopologyNode } from '../core/topology';
import { loadGraphResources } from '../data/graphResources';
import GraphResources from './GraphResources';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useClustersConf: () => ({ alpha: {}, beta: {} }) },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/graphResources', () => ({ loadGraphResources: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({
    activeCluster,
    routeName,
    params,
    children,
  }: {
    activeCluster?: string;
    routeName: string;
    params: { cluster?: string; namespace: string; name: string };
    children: ReactNode;
  }) => (
    <a
      href={`/c/${params.cluster ?? activeCluster}/${routeName}/${params.namespace}/${params.name}`}
    >
      {children}
    </a>
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
const node: TopologyNode = {
  id: 'node',
  cluster: 'metric-east',
  namespace: 'bookinfo',
  label: 'reviews-v1',
  kind: 'workload',
  workloads: ['reviews-v1'],
  apps: ['reviews'],
  versions: ['v1'],
};
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null }, beta: { prometheus: null } },
    },
  });
  vi.mocked(loadGraphResources)
    .mockReset()
    .mockImplementation(async target => ({
      target,
      checkedAt: '2026-01-01T00:00:00Z',
      unresolved: [],
      candidates: [
        {
          identity: {
            cluster: target.cluster,
            namespace: 'bookinfo',
            group: 'apps',
            kind: 'Deployment',
            name: 'reviews-v1',
            uid: 'current-uid',
          },
          app: 'reviews',
          version: 'v1',
        },
      ],
    }));
});
afterEach(cleanup);
it('reads only after explicit request and labels results as current name candidates, not historical UID matches', async () => {
  const view = render(
    <GraphResources node={node} cluster="alpha" telemetryCluster="metric-east" />
  );
  expect(loadGraphResources).not.toHaveBeenCalled();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  await userEvent.click(
    screen.getByRole('button', { name: 'Find current resource candidates in alpha' })
  );
  await screen.findByText('current-uid');
  expect(screen.getByRole('link', { name: 'reviews-v1' }).getAttribute('href')).toBe(
    '/c/alpha/Deployment/bookinfo/reviews-v1'
  );
  expect(screen.getByText(/cannot verify historical identity/)).toBeDefined();
  const signal = vi.mocked(loadGraphResources).mock.calls[0][2];
  view.rerender(
    <GraphResources
      node={{ ...node, id: 'other', cluster: 'unmapped' }}
      cluster="alpha"
      telemetryCluster="metric-east"
    />
  );
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('current-uid')).toBeNull();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
it('keeps VM group identity separate from entry label provenance in scoped links', async () => {
  vi.mocked(loadGraphResources).mockImplementation(async target => ({
    target,
    checkedAt: '2026-01-01T00:00:00Z',
    unresolved: [],
    candidates: [
      {
        identity: {
          cluster: target.cluster,
          namespace: 'bookinfo',
          group: 'networking.istio.io',
          kind: 'WorkloadGroup',
          name: 'vm-group',
          uid: 'group-uid',
        },
        app: 'vm',
        version: 'v1',
        virtualMachine: {
          labelSource: 'entry',
          matchingEntries: 2,
          entry: { name: 'first-entry', uid: 'entry-uid', resourceVersion: 'entry-version' },
        },
      },
    ],
  }));
  render(<GraphResources node={node} cluster="alpha" telemetryCluster="metric-east" />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Find current resource candidates in alpha' })
  );
  await screen.findByText('group-uid');
  expect(screen.getByRole('link', { name: 'vm-group' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-workload-group-detail/bookinfo/vm-group'
  );
  expect(screen.getByRole('link', { name: 'first-entry' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-workload-entry-detail/bookinfo/first-entry'
  );
  expect(
    screen.getByText(/Observed UID: entry-uid; resource version: entry-version/)
  ).toBeDefined();
  expect(screen.getByText(/2 selector-matched entries; not a VM readiness count/)).toBeDefined();
});

it('blocks duplicate mappings and invalidates a prior lookup when mapping settings change', async () => {
  const view = render(
    <GraphResources node={node} cluster="alpha" telemetryCluster="metric-east" />
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Find current resource candidates in alpha' })
  );
  await waitFor(() => expect(loadGraphResources).toHaveBeenCalledTimes(1));
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: { beta: { prometheus: null, telemetryCluster: 'metric-east' } },
    },
  });
  view.rerender(<GraphResources node={node} cluster="alpha" telemetryCluster="metric-east" />);
  expect(screen.getByText(/multiple Headlamp contexts/)).toBeDefined();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(loadGraphResources).toHaveBeenCalledTimes(1);
});
