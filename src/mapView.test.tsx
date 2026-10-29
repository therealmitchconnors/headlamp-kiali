import { cleanup, renderHook } from '@testing-library/react';
import { kialiConfigurationSource } from './mapView';

interface FixtureResource {
  kind: string;
  cluster: string;
  metadata: { name: string; namespace: string; uid: string };
  spec: Record<string, unknown>;
}
const state = vi.hoisted(() => ({
  serviceError: null as null | { message: string },
  entryError: null as null | { message: string },
  groupError: null as null | { message: string },
  groups: [] as FixtureResource[],
  entries: [] as FixtureResource[],
  serviceReads: 0,
  entryReads: 0,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  K8s: {
    ResourceClasses: {
      Service: {
        useList: () => {
          state.serviceReads++;
          return [
            [
              {
                cluster: 'alpha',
                metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'service-uid' },
              },
            ],
            state.serviceError,
          ];
        },
      },
    },
  },
}));
vi.mock('./resources/registry', () => ({
  configurationDefinitions: [
    {
      id: 'virtual-service',
      kind: 'VirtualService',
      resourceClass: {
        useList: () => [
          [
            {
              kind: 'VirtualService',
              cluster: 'alpha',
              metadata: { name: 'reviews-routes', namespace: 'bookinfo', uid: 'config-uid' },
              spec: { http: [{ route: [{ destination: { host: 'reviews' } }] }] },
            },
          ],
          null,
        ],
      },
    },
    {
      id: 'workload-group',
      kind: 'WorkloadGroup',
      group: 'networking.istio.io',
      resourceClass: { useList: () => [state.groups, state.groupError] },
    },
    {
      id: 'workload-entry',
      kind: 'WorkloadEntry',
      group: 'networking.istio.io',
      resourceClass: { useList: () => [state.entries, state.entryError] },
    },
  ],
}));
vi.mock('./resources/workload-entry', () => ({
  WorkloadEntry: {
    useList: () => {
      state.entryReads++;
      return [state.entries, state.entryError];
    },
  },
}));
vi.mock('./components/configuration/Configuration', () => ({ ConfigurationDetail: () => <div /> }));

const fixture = (
  kind: string,
  name: string,
  spec: Record<string, unknown>,
  cluster = 'alpha',
  namespace = 'bookinfo'
): FixtureResource => ({
  kind,
  cluster,
  metadata: { name, namespace, uid: `${cluster}-${namespace}-${name}` },
  spec,
});
beforeEach(() => {
  state.serviceError = null;
  state.entryError = null;
  state.groupError = null;
  state.serviceReads = 0;
  state.entryReads = 0;
  state.groups = [fixture('WorkloadGroup', 'group', { metadata: { labels: { app: 'vm' } } })];
  state.entries = [fixture('WorkloadEntry', 'entry', { labels: { app: 'vm' } })];
});
afterEach(cleanup);
function groupSource() {
  if (!('sources' in kialiConfigurationSource)) throw new Error('Expected grouped source');
  const source = kialiConfigurationSource.sources.find(
    item => item.id === 'kiali-config-workload-group'
  );
  if (!source || !('useData' in source)) throw new Error('Expected WorkloadGroup source');
  return source;
}

it('keeps target Service nodes when only the Kiali structural source is enabled', () => {
  if (!('sources' in kialiConfigurationSource)) throw new Error('Expected grouped source');
  const source = kialiConfigurationSource.sources[0];
  if (!('useData' in source)) throw new Error('Expected leaf source');
  const { result } = renderHook(source.useData);
  expect(result.current?.nodes?.map(node => node.id)).toEqual(['config-uid', 'service-uid']);
  expect(result.current?.edges).toEqual([
    {
      id: 'config-uid-service-uid',
      source: 'config-uid',
      target: 'service-uid',
      label: 'Configuration reference',
    },
  ]);
  expect(kialiConfigurationSource.icon).toBeDefined();
  expect(source.icon).toBeDefined();
  expect(state.entryReads).toBe(0);
});
it('adds WorkloadEntry targets with same-cluster/namespace spec-label edges and no irrelevant Service read', () => {
  state.entries.push(
    fixture('WorkloadEntry', 'other-cluster', { labels: { app: 'vm' } }, 'beta'),
    fixture('WorkloadEntry', 'other-namespace', { labels: { app: 'vm' } }, 'alpha', 'other'),
    fixture('WorkloadEntry', 'other-labels', { labels: { app: 'other' } })
  );
  const { result } = renderHook(groupSource().useData);
  expect(result.current?.nodes?.map(node => node.id)).toEqual([
    'alpha-bookinfo-group',
    'alpha-bookinfo-entry',
  ]);
  expect(result.current?.edges).toEqual([
    {
      id: 'alpha-bookinfo-group-alpha-bookinfo-entry',
      source: 'alpha-bookinfo-group',
      target: 'alpha-bookinfo-entry',
      label: 'WorkloadGroup label match (not ownership)',
    },
  ]);
  expect(result.current?.nodes?.[1].detailsComponent).toBeDefined();
  expect(state.serviceReads).toBe(0);
  expect(state.entryReads).toBe(1);
});
it.each([{}, { metadata: {} }, { metadata: { labels: {} } }])(
  'does not turn missing or empty group labels into all-entry edges %#',
  spec => {
    state.groups[0].spec = spec;
    const { result } = renderHook(groupSource().useData);
    expect(result.current?.edges).toEqual([]);
  }
);
it('retains matching observed nodes while marking transport errors explicitly incomplete', () => {
  state.entryError = { message: 'Entries denied' };
  const { result } = renderHook(groupSource().useData);
  expect(result.current?.edges).toHaveLength(1);
  expect(
    result.current?.nodes?.some(
      node => node.status === 'warning' && node.subtitle === 'Entries denied'
    )
  ).toBe(true);
});
it.each(['labels', 'namespace', 'uid'])(
  'rejects malformed %s instead of drawing unscoped entry edges',
  field => {
    if (field === 'labels') state.entries[0].spec = { labels: { app: false } };
    if (field === 'namespace') state.entries[0].metadata.namespace = '';
    if (field === 'uid') state.entries[0].metadata.uid = '';
    const { result } = renderHook(groupSource().useData);
    expect(result.current?.edges).toEqual([]);
    expect(result.current?.nodes?.some(node => node.status === 'warning')).toBe(true);
  }
);
it('bounds aggregate label text before constructing entry edges', () => {
  const labels = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [`key-${index}`, 'x'.repeat(1024)])
  );
  state.entries = Array.from({ length: 4 }, (_, index) =>
    fixture('WorkloadEntry', `entry-${index}`, { labels })
  );
  const { result } = renderHook(groupSource().useData);
  expect(result.current?.edges).toEqual([]);
  expect(
    result.current?.nodes?.some(
      node => node.status === 'warning' && node.subtitle?.includes('1,000,000')
    )
  ).toBe(true);
});

it('bounds aggregate match work at exactly 10,000 comparisons and signals partial topology', () => {
  state.groups = Array.from({ length: 11 }, (_, index) =>
    fixture('WorkloadGroup', `group-${index}`, { metadata: { labels: { app: 'vm' } } })
  );
  state.entries = Array.from({ length: 1000 }, (_, index) =>
    fixture('WorkloadEntry', `entry-${index}`, { labels: { app: 'vm' } })
  );
  const { result } = renderHook(groupSource().useData);
  expect(result.current?.edges).toHaveLength(10000);
  expect(
    result.current?.nodes?.some(
      node => node.status === 'warning' && node.subtitle?.includes('10,000')
    )
  ).toBe(true);
});
