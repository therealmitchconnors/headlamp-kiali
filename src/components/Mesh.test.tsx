import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { useKialiConfig } from '../config';
import { readConfig } from '../core/config';
import { loadMeshSnapshot, MeshSnapshot } from '../data/mesh';
import Mesh, { MeshResults } from './Mesh';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { useSelectedClusters: () => ['alpha'], useClustersConf: () => ({ alpha: {} }) },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/mesh', async importOriginal => ({
  ...(await importOriginal<typeof import('../data/mesh')>()),
  loadMeshSnapshot: vi.fn(),
}));
vi.mock('./configuration/StructuredValue', () => ({
  default: ({ value }: { value: unknown }) => <pre>{JSON.stringify(value)}</pre>,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({
    children,
    routeName,
    params,
    search,
  }: {
    children: ReactNode;
    routeName: string;
    params?: { cluster?: string };
    search?: string;
  }) => (
    <a href={`/${routeName}?${search ?? ''}`} data-cluster={params?.cluster}>
      {children}
    </a>
  ),
  StatusLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SimpleTable: <T,>({
    data,
    columns,
    emptyMessage,
  }: {
    data: T[];
    columns: { label: string; getter: (row: T) => ReactNode }[];
    emptyMessage?: string;
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column, j) => (
            <th key={j}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length ? (
          data.map((row, i) => (
            <tr key={i}>
              {columns.map((column, j) => (
                <td key={j}>{column.getter(row)}</td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={columns.length}>{emptyMessage}</td>
          </tr>
        )}
      </tbody>
    </table>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue(
    readConfig({
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, telemetryCluster: 'alpha' } },
    })
  );
  vi.mocked(loadMeshSnapshot).mockReset();
});
it('shows the selected mounted file, captured identity and failed refresh without reviving old fields', async () => {
  const controller = {
    name: 'istiod',
    namespace: 'system',
    uid: 'cp',
    revision: '',
    configurationContainer: 'first',
    meshConfigSource: {
      kind: 'mounted' as const,
      name: 'mounted',
      key: 'config',
      path: '/custom/mesh',
    },
    managesExternal: false,
    effectiveConfigBlocked: false,
    replicas: null,
    stale: false,
    configurationWarnings: [],
  };
  const source = {
    cluster: 'alpha',
    namespace: 'system',
    name: 'mounted',
    key: 'config',
    uid: 'map-uid',
    resourceVersion: 'map-12',
  };
  const snapshot: MeshSnapshot = {
    cluster: 'alpha',
    namespaces: { complete: true, items: [] },
    controllers: { complete: true, items: [controller] },
    tags: { complete: true, items: [] },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'mounted', source, value: { hasDiscoverySelectors: false } },
        injector: { status: 'ready', name: 'injector', value: {} },
        effective: {
          status: 'ready',
          sharedAbsent: true,
          value: { hasDiscoverySelectors: false, trustDomain: 'captured.test' },
          sources: { local: { ...source, kind: 'mounted', path: '/custom/mesh' } },
        },
      },
    ],
  };
  vi.mocked(loadMeshSnapshot).mockResolvedValue(snapshot);
  render(<Mesh />);
  await userEvent.click(screen.getByRole('button', { name: 'Discover mesh' }));
  await screen.findByRole('heading', { name: 'Mounted mesh configuration' });
  expect(screen.getByText('Declared mesh file: /custom/mesh')).toBeDefined();
  expect(
    screen.getByText('ConfigMap key: config; UID: map-uid; resource version: map-12')
  ).toBeDefined();
  expect(screen.getByText(/Only the selected local configuration/)).toBeDefined();
  expect(screen.getByText('Captured mesh configuration sources')).toBeDefined();
  expect(screen.getByText('captured.test')).toBeDefined();
  vi.mocked(loadMeshSnapshot).mockRejectedValue(new Error('Mounted source became denied'));
  await userEvent.click(screen.getByRole('button', { name: 'Discover mesh' }));
  await screen.findByText(/Mounted source became denied/);
  expect(screen.queryByText('captured.test')).toBeNull();
});
it('captures only explicit logical identity and invalidates relevant changes without replay or resurrection', async () => {
  const controller = {
    name: 'istiod',
    namespace: 'system',
    uid: 'cp',
    revision: '',
    clusterId: 'alpha',
    managesExternal: true,
    effectiveConfigBlocked: true,
    replicas: null,
    stale: false,
    configurationWarnings: ['External control-plane topology is not resolved'],
  };
  vi.mocked(loadMeshSnapshot).mockResolvedValue({
    cluster: 'alpha',
    namespaces: { complete: true, items: [] },
    controllers: { complete: true, items: [controller] },
    tags: { complete: true, items: [] },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'istio', value: { hasDiscoverySelectors: false } },
        injector: { status: 'ready', name: 'injector', value: {} },
        effective: { status: 'unavailable', message: 'External mapping unresolved' },
      },
    ],
  });
  const view = render(<Mesh />);
  const user = userEvent.setup();
  const discover = () => user.click(screen.getByRole('button', { name: 'Discover mesh' }));
  await discover();
  await screen.findByText(/No logical mesh cluster name was captured/);
  expect(screen.queryByText(/Declared controller ID matches/)).toBeNull();
  const configure = (meshClusterName: string, telemetryCluster = 'alpha') => {
    vi.mocked(useKialiConfig).mockReturnValue(
      readConfig({
        schemaVersion: 1,
        clusters: { alpha: { prometheus: null, meshClusterName, telemetryCluster } },
      })
    );
    view.rerender(<Mesh />);
  };
  configure('alpha');
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: 'Local control planes' })).toBeNull();
  await discover();
  await screen.findByText(/Declared controller ID matches/);
  expect(screen.getByText('External mapping unresolved')).toBeDefined();
  configure('alpha', 'unrelated-metric-id');
  expect(screen.getByText(/Declared controller ID matches/)).toBeDefined();
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(2);
  configure('other');
  expect(screen.queryByText(/Declared controller ID matches/)).toBeNull();
  configure('alpha');
  expect(screen.queryByRole('heading', { name: 'Local control planes' })).toBeNull();
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(2);
  await discover();
  await screen.findByText(/Declared controller ID matches/);
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(3);
});
it('cancels a pending capture when the logical name changes instead of replaying its requests', async () => {
  vi.mocked(loadMeshSnapshot).mockImplementation(() => new Promise(() => {}));
  const view = render(<Mesh />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Discover mesh' }));
  await waitFor(() => expect(loadMeshSnapshot).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadMeshSnapshot).mock.calls[0][1];
  vi.mocked(useKialiConfig).mockReturnValue(
    readConfig({
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, meshClusterName: 'new' } },
    })
  );
  view.rerender(<Mesh />);
  expect(signal.aborted).toBe(true);
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(1);
});
it('renders declared local membership separately from label hints and default-hidden namespaces', () => {
  const controller = {
    name: 'istiod',
    namespace: 'system',
    uid: 'cp',
    revision: 'blue',
    clusterId: 'logical',
    isMaistra: false,
    managesExternal: false,
    effectiveConfigBlocked: false,
    replicas: null,
    stale: false,
    configurationWarnings: [],
  };
  const fields = { rootNamespace: 'system', hasDiscoverySelectors: false };
  const snapshot: MeshSnapshot = {
    cluster: 'alpha',
    namespaces: {
      complete: true,
      resourceVersion: '1',
      items: [
        { name: 'system', labels: {} },
        { name: 'app', labels: { 'istio.io/rev': 'blue' } },
        { name: 'kube-system', labels: { 'istio.io/rev': 'blue' } },
      ],
    },
    controllers: { complete: true, resourceVersion: '2', items: [controller] },
    tags: { complete: true, resourceVersion: '3', items: [] },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'istio-blue', value: fields },
        injector: { status: 'ready', name: 'injector', value: {} },
        effective: { status: 'ready', sharedAbsent: false, value: fields },
      },
    ],
  };
  render(<MeshResults snapshot={snapshot} logicalName="logical" />);
  const section = screen
    .getByRole('heading', { name: 'Declared local namespace scope' })
    .closest('section')!;
  expect(within(section).getByRole('link', { name: 'system' })).toBeDefined();
  expect(within(section).getByRole('link', { name: 'app' })).toBeDefined();
  expect(within(section).queryByRole('link', { name: 'kube-system' })).toBeNull();
  expect(within(section).getByText(/2 eligible namespaces/)).toBeDefined();
});
it('shows source revision candidates and provenance without resolving controllers or hiding Maistra labels', () => {
  const snapshot: MeshSnapshot = {
    cluster: 'alpha',
    namespaces: {
      complete: true,
      items: [
        { name: 'both-labels', labels: { 'istio-injection': 'enabled', 'istio.io/rev': 'blue' } },
        { name: 'ambient-default', labels: { 'istio.io/dataplane-mode': 'ambient' } },
        { name: 'maistra', labels: { 'maistra.io/member-of': 'mesh-other' } },
        {
          name: 'ignored-maistra',
          labels: { 'maistra.io/member-of': 'mesh-other', 'maistra.io/ignore-namespace': 'false' },
        },
      ],
    },
    controllers: { complete: true, items: [] },
    tags: { complete: true, items: [] },
    controlPlanes: [],
  };
  render(<MeshResults snapshot={snapshot} />);
  const section = screen
    .getByRole('heading', { name: 'Namespace injection labels and revision hints' })
    .closest('section')!;
  for (const name of ['both-labels', 'ambient-default']) {
    const row = within(section).getByRole('link', { name }).closest('tr')!;
    expect(within(row).getAllByRole('cell')[3].textContent).toContain('default');
  }
  expect(within(section).getByText('Conflicting injection labels')).toBeDefined();
  expect(within(section).getByText('Enabled injection takes precedence')).toBeDefined();
  expect(within(section).getByText('Ambient without a revision uses default')).toBeDefined();
  expect(within(section).getByText('mesh-other')).toBeDefined();
  expect(
    within(section).getByText('Maistra ignore label is present; its value is not a boolean switch.')
  ).toBeDefined();
  expect(within(section).queryByRole('link', { name: 'Inspect configured mTLS' })).toBeNull();
  expect(
    screen.getByText(/not a resolved controller or managed-namespace inventory/)
  ).toBeDefined();
});
it('shows first-tag precedence and preserves assessment links for selected aliases and own/root namespaces', () => {
  const controller = {
    name: 'istiod',
    namespace: 'istio-system',
    uid: 'cp',
    revision: 'blue',
    configurationContainer: 'inspected-first',
    replicas: null,
    stale: false,
    configurationWarnings: [],
    managesExternal: false,
    effectiveConfigBlocked: false,
  };
  const fields = { rootNamespace: 'policies', hasDiscoverySelectors: false };
  const snapshot: MeshSnapshot = {
    cluster: 'alpha',
    namespaces: {
      complete: true,
      items: [
        ...['blue', 'stable', 'canary'].map(name => ({
          name,
          labels: { 'istio.io/rev': name },
        })),
        ...['istio-system', 'policies'].map(name => ({
          name,
          labels: { 'maistra.io/member-of': 'mesh' },
        })),
      ],
    },
    controllers: { complete: true, items: [controller] },
    tags: {
      complete: true,
      items: [
        { name: 'first', tag: 'stable', revision: 'blue' },
        { name: 'later', tag: 'canary', revision: 'blue' },
      ],
    },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'istio-blue', value: fields },
        injector: { status: 'ready', name: 'injector', value: {} },
        effective: { status: 'ready', sharedAbsent: false, value: fields },
      },
    ],
  };
  render(<MeshResults snapshot={snapshot} />);
  expect(screen.getByRole('columnheader', { name: 'First container' })).toBeDefined();
  expect(screen.getByRole('cell', { name: 'inspected-first' })).toBeDefined();
  expect(screen.getByText('First webhook (selected)')).toBeDefined();
  expect(screen.getByText('Later webhook (ignored)')).toBeDefined();
  const links = screen.getAllByRole('link', { name: 'Inspect configured mTLS' });
  expect(links).toHaveLength(3);
  for (const [index, namespace] of ['stable', 'istio-system', 'policies'].entries()) {
    expect(links[index].getAttribute('data-cluster')).toBe('alpha');
    expect(links[index].getAttribute('href')).toBe(
      `/kiali-mtls?namespace=${namespace}&controllerNamespace=istio-system&controller=istiod`
    );
  }
});
it('loads only on request, retains partial evidence and does not refetch for fresh translator functions', async () => {
  vi.mocked(loadMeshSnapshot).mockResolvedValue({
    cluster: 'alpha',
    namespaces: { complete: true, items: [] },
    controllers: { complete: true, items: [] },
    tags: {
      complete: false,
      items: [],
      error: { kind: 'forbidden', message: 'Tag access denied' },
    },
    controlPlanes: [],
  });
  render(<Mesh />);
  expect(loadMeshSnapshot).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Discover mesh' }));
  await waitFor(() => expect(screen.getByText(/Tag access denied/)).toBeDefined());
  expect(
    screen.getByText(
      'No matching local controller Deployments were returned. A remote or custom-labeled control plane may still exist.'
    )
  ).toBeDefined();
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(1);
});
it('renders matched and excluded configured namespace contexts without claiming runtime membership', () => {
  const controller = {
    name: 'istiod',
    namespace: 'istio-system',
    uid: 'cp',
    revision: 'blue',
    replicas: null,
    stale: false,
    configurationWarnings: [],
    managesExternal: false,
    effectiveConfigBlocked: false,
  };
  const fields = {
    rootNamespace: 'istio-system',
    hasDiscoverySelectors: true,
    discoverySelectors: [{ matchLabels: { team: 'mesh' } }],
  };
  const snapshot: MeshSnapshot = {
    cluster: 'alpha',
    namespaces: {
      complete: true,
      items: [
        { name: 'bookinfo', labels: { 'istio.io/rev': 'blue', team: 'mesh' } },
        { name: 'other', labels: { 'istio.io/rev': 'blue', team: 'other' } },
        {
          name: 'maistra',
          labels: { 'istio.io/rev': 'blue', team: 'mesh', 'maistra.io/member-of': 'other-mesh' },
        },
      ],
    },
    controllers: { complete: true, items: [controller] },
    tags: { complete: true, items: [] },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'istio-blue', value: fields },
        injector: { status: 'ready', name: 'injector', value: {} },
        effective: { status: 'ready', sharedAbsent: false, value: fields },
      },
    ],
  };
  render(<MeshResults snapshot={snapshot} />);
  expect(screen.getByText('Matched configured discovery selector')).toBeDefined();
  expect(screen.getByText(/other: Namespace is excluded/)).toBeDefined();
  expect(screen.getByText(/maistra: Maistra membership cannot be resolved/)).toBeDefined();
  expect(screen.getAllByRole('link', { name: 'Inspect configured mTLS' })).toHaveLength(1);
  expect(screen.getByText(/not actual injection, traffic or health/)).toBeDefined();
});
