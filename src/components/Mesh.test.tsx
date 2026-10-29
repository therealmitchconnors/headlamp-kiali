import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  Link: ({ children }: { children: ReactNode }) => <a href="/resource">{children}</a>,
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
    <div>
      {data.length
        ? data.map((row, i) => (
            <div key={i}>
              {columns.map((column, j) => (
                <span key={j}>{column.getter(row)}</span>
              ))}
            </div>
          ))
        : emptyMessage}
    </div>
  ),
}));
afterEach(cleanup);
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
  expect(screen.getByText(/not actual injection, traffic or health/)).toBeDefined();
});
