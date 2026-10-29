import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { Link as RouterLink, MemoryRouter } from 'react-router-dom';
import { readConfig } from '../core/config';
import { CorrelationKind, CorrelationResource } from '../core/correlation';
import { virtualWorkloadResources } from '../core/virtualWorkloads';
import type { CorrelationSnapshot } from '../data/correlation';
import Applications from './Applications';

const state = vi.hoisted(() => ({
  load: vi.fn(),
  config: undefined as unknown,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useSelectedClusters: () => ['alpha'],
    ResourceClasses: {
      Namespace: { useList: () => [[{ metadata: { name: 'bookinfo' } }], null] },
    },
  },
  ApiProxy: { request: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (match, key) => String(values?.[key] ?? match)),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: () => readConfig(state.config) }));
vi.mock('../data/correlation', () => ({ loadCorrelationSnapshot: state.load }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({
    routeName,
    search,
    params,
    activeCluster,
    children,
  }: {
    routeName: string;
    search?: string;
    params?: { cluster?: string; namespace?: string; name?: string };
    activeCluster?: string;
    children: ReactNode;
  }) => {
    expect(search === undefined || typeof search === 'string').toBe(true);
    return routeName === 'kiali-applications' ? (
      <RouterLink
        to={{ pathname: '/kiali/applications', search: new URLSearchParams(search).toString() }}
      >
        {children}
      </RouterLink>
    ) : (
      <a href={routeName} data-cluster={params?.cluster ?? activeCluster}>
        {children}
      </a>
    );
  },
  SimpleTable: <T,>({
    data,
    columns,
    emptyMessage,
  }: {
    data: T[];
    columns: { label: string; getter: (item: T) => ReactNode }[];
    emptyMessage?: string;
  }) =>
    data.length ? (
      <table>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => (
            <tr key={index}>
              {columns.map(column => (
                <td key={column.label}>{column.getter(item)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p>{emptyMessage}</p>
    ),
}));

function fixture(partial = false, emptyLabel = false): CorrelationSnapshot {
  function resource(kind: CorrelationKind, name: string): CorrelationResource {
    return {
      identity: {
        cluster: 'alpha',
        namespace: 'bookinfo',
        group: kind === 'Deployment' ? 'apps' : '',
        kind,
        name,
        uid: `${kind}:${name}`,
      },
      labels: { app: 'reviews', version: 'v1' },
      workloadLabels: { app: emptyLabel ? '' : 'reviews', version: 'v1' },
      serviceSelector: kind === 'Service' ? { app: 'reviews' } : null,
      owners: [],
      proxyMode: kind === 'Pod' ? 'native-sidecar' : 'none',
      ...(kind === 'Pod' ? { podAccount: { ok: true as const, name: 'bookinfo-reviews' } } : {}),
    };
  }
  const deployment = resource('Deployment', 'reviews-v1');
  const service = resource('Service', 'reviews');
  const pod = resource('Pod', 'reviews-pod');
  pod.owners = [{ ...deployment.identity, controller: true }];
  const resources = partial ? [deployment, pod] : [deployment, pod, service];
  return {
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    resources,
    complete: !partial,
    sources: [
      {
        source: { kind: 'Deployment', group: 'apps', apiVersion: 'apps/v1', plural: 'deployments' },
        resources: [deployment],
        complete: true,
      },
      {
        source: { kind: 'Pod', group: '', apiVersion: 'v1', plural: 'pods' },
        resources: [pod],
        complete: true,
      },
      {
        source: { kind: 'Service', group: '', apiVersion: 'v1', plural: 'services' },
        resources: partial ? [] : [service],
        complete: !partial,
        ...(partial
          ? { error: { kind: 'forbidden' as const, message: 'Forbidden', status: 403 } }
          : {}),
      },
    ],
  };
}

function open(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/kiali/applications${search}`]}>
      <Applications />
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.load.mockReset();
  state.config = undefined;
});
afterEach(cleanup);

it('requires an explicit namespace before reading workload data', () => {
  open();
  expect(screen.getByText(/Select one valid namespace/)).toBeDefined();
  expect(state.load).not.toHaveBeenCalled();
});

it('renders a logical application and drills into workloads, selectors and native sidecars', async () => {
  state.load.mockResolvedValue(fixture());
  open('?namespace=bookinfo');
  const link = await screen.findByRole('link', { name: 'reviews' });
  expect(state.load).toHaveBeenCalledWith(
    { cluster: 'alpha', namespace: 'bookinfo' },
    expect.any(AbortSignal)
  );
  await userEvent.setup().click(link);
  expect(await screen.findByText('Application: reviews')).toBeDefined();
  expect(screen.getByText('reviews-v1')).toBeDefined();
  expect(screen.getByText('reviews-pod')).toBeDefined();
  expect(screen.getByText('Native sidecar')).toBeDefined();
  expect(screen.getByText('bookinfo-reviews (attributed Pods: 1)')).toBeDefined();
  expect(screen.getByText('bookinfo-reviews')).toBeDefined();
  expect(screen.getByText(/do not prove ServiceAccount existence/)).toBeDefined();
  expect(state.load).toHaveBeenCalledTimes(1);
});

it('renders VM label provenance and group/entry links without treating entries as Pods', async () => {
  const base = fixture();
  const resources = virtualWorkloadResources(
    base.scope,
    [
      {
        name: 'vm-group',
        namespace: 'bookinfo',
        uid: 'group-uid',
        resourceVersion: 'group-version',
        labels: { app: 'metadata-app' },
        selector: { app: 'vm' },
      },
    ],
    [
      {
        name: 'entry-one',
        namespace: 'bookinfo',
        uid: 'entry-uid',
        resourceVersion: 'entry-version',
        labels: { app: 'vm', version: 'v1' },
      },
    ]
  );
  state.load.mockResolvedValue({ ...base, resources: [...base.resources, ...resources] });
  open('?namespace=bookinfo&application=vm');
  await screen.findByText('Application: vm');
  expect(screen.getByRole('link', { name: 'vm-group' }).getAttribute('href')).toBe(
    'kiali-config-workload-group-detail'
  );
  expect(screen.getByRole('link', { name: 'vm-group' }).getAttribute('data-cluster')).toBe('alpha');
  expect(screen.getByRole('link', { name: 'entry-one' }).getAttribute('href')).toBe(
    'kiali-config-workload-entry-detail'
  );
  expect(screen.getByRole('link', { name: 'entry-one' }).getAttribute('data-cluster')).toBe(
    'alpha'
  );
  expect(screen.getByText('First matching WorkloadEntry specification')).toBeDefined();
  expect(
    screen.getByText(/Observed UID: entry-uid; resource version: entry-version/)
  ).toBeDefined();
  expect(screen.getByText(/1 selector-matched entries; not a VM readiness count/)).toBeDefined();
  expect(screen.getByText('No owned pods were found.')).toBeDefined();
  expect(screen.queryByText('Sidecar')).toBeNull();
  expect(screen.getByText('VM entry accounts are not Pod account evidence')).toBeDefined();
});
it('shows missing Pod accounts without replacing them with default', async () => {
  const data = fixture();
  const pod = data.resources.find(item => item.identity.kind === 'Pod')!;
  pod.podAccount = {
    ok: false,
    message: 'Pod service account name was not reported; no default was inferred',
  };
  state.load.mockResolvedValue(data);
  open('?namespace=bookinfo&application=reviews');
  await screen.findByText('Application: reviews');
  expect(screen.getByText('1 Pod account observations unavailable')).toBeDefined();
  expect(screen.queryByText('default')).toBeNull();
  expect(screen.getAllByText(/no default was inferred/)).toHaveLength(2);
});

it('keeps missing Service permissions visible instead of claiming zero Services', async () => {
  state.load.mockResolvedValue(fixture(true));
  open('?namespace=bookinfo');
  await screen.findByRole('link', { name: 'reviews' });
  expect(screen.getByText(/Some resource lists are incomplete/)).toBeDefined();
  expect(screen.getByText('Unavailable')).toBeDefined();
  expect(screen.getAllByText('At least 1').length).toBeGreaterThan(0);
});

it('supports an empty application label without falling back or losing the detail route', async () => {
  state.load.mockResolvedValue(fixture(false, true));
  open('?namespace=bookinfo&application=');
  expect(await screen.findByText('Application: Empty application label')).toBeDefined();
});

it('does not query an invalid namespace', () => {
  open('?namespace=..%2Fdefault');
  expect(screen.getByText(/Select one valid namespace/)).toBeDefined();
  expect(state.load).not.toHaveBeenCalled();
});

it('surfaces invalid saved configuration without querying resources', async () => {
  state.load.mockResolvedValue(fixture());
  state.config = { schemaVersion: 99, clusters: {} };
  open('?namespace=bookinfo');
  await waitFor(() =>
    expect(screen.getByText(/Stored Kiali configuration is invalid/)).toBeDefined()
  );
  expect(state.load).not.toHaveBeenCalled();
});
