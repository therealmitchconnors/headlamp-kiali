import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import ztunnelFixture from '../../test-files/diagnostics/ztunnel.json?raw';
import { useKialiConfig } from '../config';
import { DiagnosticPod } from '../core/diagnostics';
import { loadProxySnapshot } from '../data/proxyAdmin';
import { loadProxyServiceCandidate } from '../data/proxyService';
import ProxyDiagnostics from './ProxyDiagnostics';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
vi.mock('../data/proxyAdmin', () => ({ loadProxySnapshot: vi.fn() }));
vi.mock('../data/proxyService', () => ({ loadProxyServiceCandidate: vi.fn() }));
vi.mock('../data/proxyConfigurationReference', () => ({
  loadProxyConfigurationCandidate: vi.fn(),
}));
vi.mock('../config', () => ({
  useKialiConfig: vi.fn(),
}));
vi.mock('./configuration/CodeBlock', () => ({
  default: ({ value, label }: { value: string; label: string }) => (
    <pre aria-label={label}>{value}</pre>
  ),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({
    activeCluster,
    routeName,
    params,
    children,
  }: {
    activeCluster: string;
    routeName: string;
    params: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={`/c/${activeCluster}/${routeName}/${params.namespace}/${params.name}`}>{children}</a>
  ),
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SimpleTable: ({
    data,
    columns,
  }: {
    data: Record<string, unknown>[];
    columns: { getter: (row: Record<string, unknown>) => ReactNode }[];
  }) => (
    <div>
      {data.map((row, i) => (
        <div key={i}>
          {columns.map((column, j) => (
            <span key={j}>{column.getter(row)}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));
const pod: DiagnosticPod = { namespace: 'bookinfo', name: 'reviews', uid: 'uid', containers: [] };
const snapshot = {
  capturedAt: '2026-10-27T00:00:00Z',
  restartVerified: true,
  data: { version: 'synthetic-envoy', state: 'LIVE' },
};
beforeEach(() => {
  vi.mocked(useKialiConfig)
    .mockReset()
    .mockReturnValue({ valid: true, config: { schemaVersion: 1, clusters: {} } });
  vi.mocked(loadProxySnapshot).mockReset().mockResolvedValue(snapshot);
  vi.mocked(loadProxyServiceCandidate).mockReset();
});
afterEach(cleanup);
it('requires an explicit read and shows server state without claiming synchronization', async () => {
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  expect(loadProxySnapshot).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy server information' }));
  await screen.findByText('synthetic-envoy');
  expect(screen.getByText('LIVE')).toBeDefined();
  expect(screen.getByText(/not a control-plane synchronization/)).toBeDefined();
  expect(vi.mocked(loadProxySnapshot).mock.calls[0].slice(0, 3)).toEqual([
    { cluster: 'alpha' },
    pod,
    'server-info',
  ]);
});
it('shows configuration details only on selection and hides stale details on another read', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({
    ...snapshot,
    data: {
      configs: [
        {
          '@type': 'type.googleapis.com/envoy.admin.v3.ClustersConfigDump',
          static_clusters: [
            { cluster: { name: 'synthetic-cluster', private_extension: 'synthetic-detail' } },
          ],
        },
      ],
    },
  });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  await screen.findByText('synthetic-cluster');
  expect(screen.queryByText(/synthetic-detail/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /^Inspect/ }));
  await screen.findByText(/synthetic-detail/);
  const signal = vi.mocked(loadProxySnapshot).mock.calls[0][3];
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy server information' }));
  await screen.findByText('synthetic-envoy');
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText(/synthetic-detail/)).toBeNull();
});
it('cancels replacement reads and ignores late responses after unmount', async () => {
  let resolve: (value: typeof snapshot) => void = () => {};
  vi.mocked(loadProxySnapshot).mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    })
  );
  const { unmount } = render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  const signal = vi.mocked(loadProxySnapshot).mock.calls[0][3];
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy server information' }));
  await screen.findByText('synthetic-envoy');
  expect(signal.aborted).toBe(true);
  unmount();
  resolve(snapshot);
  expect(vi.mocked(loadProxySnapshot).mock.calls[1][3].aborted).toBe(true);
});
it('surfaces malformed responses and unknown proxy-instance evidence explicitly', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({ ...snapshot, data: {} });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  await screen.findByText(/Malformed or oversized Envoy configuration dump/);
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({ ...snapshot, restartVerified: false });
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy server information' }));
  await screen.findByText(/exact proxy instance could not be verified/);
});
it('adds a scoped cluster summary without inventing DNS identity or refetching on settings changes', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({
    ...snapshot,
    data: {
      configs: [
        {
          '@type': 'type.googleapis.com/envoy.admin.v3.ClustersConfigDump',
          dynamic_active_clusters: [
            {
              cluster: {
                name: 'outbound|9080|v1|reviews.bookinfo.svc.cluster.local',
                type: 'EDS',
                metadata: {
                  filter_metadata: {
                    istio: {
                      config:
                        '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews',
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  });
  const { rerender } = render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Inspect / }));
  await screen.findByText(/no Kubernetes Service identity is inferred/);
  expect(screen.getByText('9080')).toBeDefined();
  expect(screen.getByText('reviews.bookinfo')).toBeDefined();
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, identityDomain: 'svc.cluster.local' } },
    },
  });
  rerender(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await screen.findByText('bookinfo');
  expect(screen.getByText('reviews')).toBeDefined();
  expect(screen.queryByText(/no Kubernetes Service identity is inferred/)).toBeNull();
  expect(loadProxySnapshot).toHaveBeenCalledTimes(1);
});
it('wires explicit Service lookup to the captured proxy scope without rereading the proxy', async () => {
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, identityDomain: 'svc.cluster.local' } },
    },
  });
  const name = 'outbound|9080||reviews.bookinfo.svc.cluster.local';
  vi.mocked(loadProxySnapshot).mockResolvedValue({
    ...snapshot,
    data: {
      configs: [
        {
          '@type': 'type.googleapis.com/envoy.admin.v3.ClustersConfigDump',
          static_clusters: [{ cluster: { name } }],
        },
      ],
    },
  });
  vi.mocked(loadProxyServiceCandidate).mockResolvedValue({
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    target: { namespace: 'bookinfo', name: 'reviews', port: 9080, subset: '' },
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: '',
      kind: 'Service',
      name: 'reviews',
      uid: 'current-service-uid',
    },
    resourceVersion: '1',
    serviceType: 'ClusterIP',
    externalName: undefined,
    ports: [{ port: 9080, name: 'http', protocol: 'TCP' }],
    portDeclared: true,
    checkedAt: snapshot.capturedAt,
  });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  await user.click(await screen.findByRole('button', { name: /^Inspect / }));
  expect(loadProxyServiceCandidate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Find current Service candidate' }));
  await screen.findByRole('link', { name: 'reviews' });
  expect(vi.mocked(loadProxyServiceCandidate).mock.calls[0].slice(0, 2)).toEqual([
    { cluster: 'alpha' },
    { name, identityDomain: 'svc.cluster.local' },
  ]);
  expect(loadProxySnapshot).toHaveBeenCalledTimes(1);
});

it('keeps raw configuration inspectable when summary metadata is malformed', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({
    ...snapshot,
    data: {
      configs: [
        {
          '@type': 'type.googleapis.com/envoy.admin.v3.ClustersConfigDump',
          static_clusters: [{ cluster: { name: 'synthetic', metadata: ['malformed'] } }],
        },
      ],
    },
  });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Inspect / }));
  await screen.findByText('Malformed Envoy configuration metadata');
  expect(screen.getByLabelText('Selected proxy configuration entry').textContent).toContain(
    '"malformed"'
  );
});
it('inspects complete route constraints and listener matches without hiding unsupported fields', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({
    ...snapshot,
    data: {
      configs: [
        {
          '@type': 'type.googleapis.com/envoy.admin.v3.RoutesConfigDump',
          static_route_configs: [
            {
              route_config: {
                name: 'route',
                virtual_hosts: [
                  {
                    domains: ['example'],
                    routes: [
                      {
                        match: { headers: [{ name: 'x-user', exact_match: 'test' }] },
                        direct_response: { status: 503 },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          '@type': 'type.googleapis.com/envoy.admin.v3.ListenersConfigDump',
          static_listeners: [
            {
              listener: {
                name: 'listener',
                filter_chains: [
                  {
                    filter_chain_match: {
                      application_protocols: ['istio-peer-exchange', 'istio'],
                      future_match: 'preserved',
                    },
                    filters: [
                      {
                        name: 'envoy.filters.network.tcp_proxy',
                        typed_config: { cluster: 'outbound' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('button', { name: 'Read proxy configuration' }));
  await userEvent.click(
    await screen.findByRole('button', { name: 'Inspect Route route (Static), entry 1' })
  );
  await screen.findByText('Direct response');
  await userEvent.click(screen.getByRole('button', { name: 'Inspect route match and action 1' }));
  expect(screen.getByLabelText('Route match and action').textContent).toContain('"x-user"');
  await userEvent.click(
    screen.getByRole('button', { name: 'Inspect Listener listener (Static), entry 2' })
  );
  await screen.findByText('TCP TLS');
  expect(screen.queryByLabelText('Route match and action')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Inspect listener filter chain 1' }));
  expect(
    screen.getByLabelText('Listener filter-chain match and destinations').textContent
  ).toContain('"future_match": "preserved"');
  expect(
    screen.getByLabelText('Listener filter-chain match and destinations').textContent
  ).toContain('"outbound"');
});
it('selects ztunnel explicitly, preserves unknown observations and filters without refetching', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({
    ...snapshot,
    data: JSON.parse(ztunnelFixture),
  });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('radio', { name: 'ztunnel' }));
  expect(loadProxySnapshot).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Read proxy server information' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Read ztunnel configuration' }));
  await screen.findByText('3 of 3 reported services');
  await screen.findByText('3 of 3 reported workloads');
  expect(vi.mocked(loadProxySnapshot).mock.calls[0][2]).toBe('ztunnel-configuration');
  expect(screen.queryByText(/SYNTHETIC-CERTIFICATE-NOT-FOR-DISPLAY/)).toBeNull();
  expect(screen.queryByText(/SYNTHETIC-POLICY-BODY-NOT-FOR-DISPLAY/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Inspect ztunnel service 2' }));
  expect(screen.getByLabelText('Selected ztunnel service').textContent).toContain(
    '"enabled": false'
  );
  expect(screen.getByLabelText('Selected ztunnel service').textContent).toContain('"count": 0');
  await userEvent.type(screen.getByLabelText('Filter observed ztunnel services'), 'reviews');
  await screen.findByText('1 of 3 reported services');
  expect(screen.queryByLabelText('Selected ztunnel service')).toBeNull();
  await userEvent.type(screen.getByLabelText('Filter observed ztunnel workloads'), 'mesh-b');
  await screen.findByText('1 of 3 reported workloads');
  expect(loadProxySnapshot).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(loadProxySnapshot).mock.calls[0][3];
  await userEvent.click(screen.getByRole('radio', { name: 'Envoy' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Observed ztunnel services')).toBeNull();
});
it('rejects an Envoy dump under the ztunnel format instead of reporting empty observations', async () => {
  vi.mocked(loadProxySnapshot).mockResolvedValueOnce({ ...snapshot, data: { configs: [] } });
  render(<ProxyDiagnostics cluster="alpha" pod={pod} />);
  await userEvent.click(screen.getByRole('radio', { name: 'ztunnel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Read ztunnel configuration' }));
  await screen.findByText(/requires ztunnel services and workloads arrays/);
  expect(screen.queryByText('0 of 0 reported services')).toBeNull();
});
