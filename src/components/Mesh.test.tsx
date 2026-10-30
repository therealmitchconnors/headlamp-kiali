import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { loadMeshSnapshot, MeshSnapshot } from '../data/mesh';
import Mesh, { MeshResults } from './Mesh';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { useSelectedClusters: () => ['alpha'], useClustersConf: () => ({ alpha: {} }) },
  useTranslation: () => ({ t: (key: string) => key }),
}));
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
