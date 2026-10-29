import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { commitMutationBatch, reviewMutationBatch } from '../data/mutationBatch';
import {
  assertTrafficProposalFresh,
  loadServiceTrafficSource,
  ServiceTrafficSource,
} from '../data/serviceTraffic';
import { configurationDefinitions } from '../resources/registry';
import ServiceTrafficWizard from './ServiceTrafficWizard';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: {
    cluster: { KubeObject: class {} },
    useSelectedClusters: () => ['alpha'],
    useClustersConf: () => ({ alpha: {} }),
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (match, name) => String(values?.[name] ?? match)),
  }),
}));
vi.mock('../config', () => ({
  useKialiConfig: () => ({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: {
        alpha: { prometheus: null, identityDomain: 'svc.cluster.local' },
      },
    },
  }),
}));
vi.mock('../data/serviceTraffic', async () => ({
  ...(await vi.importActual<typeof import('../data/serviceTraffic')>('../data/serviceTraffic')),
  loadServiceTrafficSource: vi.fn(),
  assertTrafficProposalFresh: vi.fn(),
  assertTrafficSourceCurrent: vi.fn(),
  assertTrafficTargetsAbsent: vi.fn(),
}));
vi.mock('../data/mutationBatch', () => ({
  reviewMutationBatch: vi.fn(),
  commitMutationBatch: vi.fn(),
}));
vi.mock('./configuration/CodeBlock', () => ({
  default: ({ value, label }: { value: string; label: string }) => (
    <pre aria-label={label}>{value}</pre>
  ),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/configuration">{children}</a>,
  SimpleTable: ({
    data,
    columns,
  }: {
    data: unknown[];
    columns: { label: string; getter: (row: unknown) => ReactNode }[];
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map(column => (
            <th key={column.label}>{column.label}</th>
          ))}
        </tr>
      </thead>
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
const source: ServiceTrafficSource = {
  service: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    name: 'reviews',
    uid: 'svc',
    resourceVersion: '1',
    selector: { app: 'reviews' },
    ports: [{ port: 9080, protocol: 'TCP', name: 'http' }],
  },
  identityDomain: 'svc.cluster.local',
  versionLabel: 'version',
  versions: ['v1', 'v2'].map(value => ({
    value,
    subset: value,
    weight: 50,
    workloads: [`Deployment/reviews-${value}`],
  })),
  conflicts: [],
  definitions: ['DestinationRule', 'VirtualService'].map(kind => ({
    definition: configurationDefinitions.find(definition => definition.kind === kind)!,
    apiVersion: 'networking.istio.io/v1',
  })),
};
beforeEach(() => {
  vi.mocked(loadServiceTrafficSource).mockReset().mockResolvedValue(source);
  vi.mocked(assertTrafficProposalFresh).mockReset().mockResolvedValue();
  vi.mocked(reviewMutationBatch)
    .mockReset()
    .mockImplementation(async mutations => ({ mutations }));
  vi.mocked(commitMutationBatch)
    .mockReset()
    .mockImplementation(async batch =>
      batch.mutations.map((mutation, index) => ({
        mutation,
        status: index === 0 ? 'succeeded' : 'failed-or-unknown',
        ...(index === 0
          ? {}
          : { error: { kind: 'unavailable' as const, message: 'Connection lost' } }),
      }))
    );
});
afterEach(cleanup);
function open() {
  render(
    <MemoryRouter initialEntries={['/traffic?namespace=bookinfo&service=reviews']}>
      <ServiceTrafficWizard />
    </MemoryRouter>
  );
}
it('requires valid weights, reviews both specs and waits for explicit confirmation before reporting partial results', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  const review = await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  expect(reviewMutationBatch).not.toHaveBeenCalled();
  expect(commitMutationBatch).not.toHaveBeenCalled();
  const first = screen.getByLabelText('Weight for version v1');
  await user.clear(first);
  await user.type(first, '70');
  expect(review.hasAttribute('disabled')).toBe(true);
  const second = screen.getByLabelText('Weight for version v2');
  await user.clear(second);
  await user.type(second, '30');
  await user.click(review);
  const confirm = await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  expect(reviewMutationBatch).toHaveBeenCalledTimes(1);
  expect(commitMutationBatch).not.toHaveBeenCalled();
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(JSON.stringify(mutations[1].spec)).toContain('"weight":70');
  expect(JSON.stringify(mutations[1].spec)).toContain('"weight":30');
  await user.click(confirm);
  await screen.findByText('Connection lost');
  expect(screen.getByText('API operation succeeded')).toBeDefined();
  expect(screen.getByText('Failed or outcome unknown')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Confirm creation of both resources' })).toBeNull();
  expect(
    screen.queryByText(
      'Both server dry-runs succeeded. No configuration has been persisted by this review.'
    )
  ).toBeNull();
  expect(assertTrafficProposalFresh).toHaveBeenCalledTimes(2);
  expect(loadServiceTrafficSource).toHaveBeenCalledTimes(1);
});
it('requires explicit forwarding weights after selecting a shadow version and reviews both resources', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  const review = await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  await user.click(screen.getByLabelText('Mirrored version'));
  await user.click(screen.getByRole('option', { name: 'v2' }));
  expect(screen.getByLabelText('Weight for version v2').hasAttribute('disabled')).toBe(true);
  expect(review.hasAttribute('disabled')).toBe(true);
  await user.clear(screen.getByLabelText('Weight for version v1'));
  await user.type(screen.getByLabelText('Weight for version v1'), '100');
  await user.clear(screen.getByLabelText('Mirror percentage'));
  await user.type(screen.getByLabelText('Mirror percentage'), '0.5');
  await user.click(review);
  const confirm = await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(mutations[0].spec).toMatchObject({
    subsets: [
      { name: 'v1', labels: { version: 'v1' } },
      { name: 'v2', labels: { version: 'v2' } },
    ],
  });
  expect(mutations[1].spec).toMatchObject({
    http: [
      {
        route: [
          {
            destination: {
              host: 'reviews.bookinfo.svc.cluster.local',
              subset: 'v1',
              port: { number: 9080 },
            },
            weight: 100,
          },
        ],
        mirror: {
          host: 'reviews.bookinfo.svc.cluster.local',
          subset: 'v2',
          port: { number: 9080 },
        },
        mirrorPercentage: { value: 0.5 },
      },
    ],
  });
  expect(screen.getByText('Shadow for this rule')).toBeDefined();
  expect(screen.getByText(/can repeat writes or other side effects/)).toBeDefined();
  expect(commitMutationBatch).not.toHaveBeenCalled();
  await user.click(confirm);
  await screen.findByText('Connection lost');
  expect(vi.mocked(commitMutationBatch).mock.calls[0][0].mutations).toBe(mutations);
});

it('requires explicit TLS selection and keeps the transport warning in the two-resource review', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  const review = await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  await user.click(screen.getByLabelText('Outbound TLS change'));
  await user.click(screen.getByRole('option', { name: 'Set explicit TLS policy' }));
  expect(review.hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByLabelText('Outbound TLS mode'));
  await user.click(screen.getByRole('option', { name: 'DISABLE' }));
  await user.click(review);
  await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(mutations[0].spec).toHaveProperty('trafficPolicy.tls', { mode: 'DISABLE' });
  expect(mutations[1].spec).not.toHaveProperty('trafficPolicy');
  expect(screen.getByText(/DISABLE stops originating TLS/)).toBeDefined();
  expect(commitMutationBatch).not.toHaveBeenCalled();
});

it('preserves incompatible HTTP drafts when switching to TCP and requires explicit corrections', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  const review = await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  const choose = async (label: string, value: string) => {
    await user.click(screen.getByLabelText(label));
    await user.click(screen.getByRole('option', { name: value }));
  };
  await choose('Mirrored version', 'v2');
  await choose('Routing protocol', 'TCP');
  expect(review.hasAttribute('disabled')).toBe(true);
  expect(screen.getByLabelText('Mirrored version').textContent).toBe('v2');
  expect(screen.getByText(/Remove the mirrored version before reviewing TCP/)).toBeDefined();
  await choose('Mirrored version', 'No mirrored version');
  expect(review.hasAttribute('disabled')).toBe(false);
  await choose('Load-balancer change', 'Set strategy');
  await choose('Load-balancing strategy', 'HTTP header affinity');
  await user.type(screen.getByLabelText('Affinity HTTP header name'), 'x-user');
  expect(review.hasAttribute('disabled')).toBe(true);
  await choose('Load-balancing strategy', 'Source IP affinity');
  await user.click(review);
  const confirm = await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(mutations[0].spec).toHaveProperty(
    'trafficPolicy.loadBalancer.consistentHash.useSourceIp',
    true
  );
  expect(mutations[1].spec).not.toHaveProperty('http');
  expect(mutations[1].spec).toMatchObject({
    tcp: [
      {
        match: [{ port: 9080 }],
        route: ['v1', 'v2'].map(subset => ({
          destination: {
            host: 'reviews.bookinfo.svc.cluster.local',
            subset,
            port: { number: 9080 },
          },
          weight: 50,
        })),
      },
    ],
  });
  expect(screen.getByText('Routing protocol: TCP')).toBeDefined();
  expect(screen.getByText(/TCP rules route connections/)).toBeDefined();
  expect(commitMutationBatch).not.toHaveBeenCalled();
  await user.click(confirm);
  await screen.findByText('Connection lost');
});

it('composes HTTP behavior with creation, keeps fault warnings in review and blocks TCP/conflicting timing', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  const review = await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  const choose = async (label: string, value: string) => {
    await user.click(screen.getByLabelText(label));
    await user.click(screen.getByRole('option', { name: value }));
  };
  await choose('Request timeout action', 'Set value');
  await choose('Retry action', 'Set value');
  await user.click(review);
  await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const timing = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(timing[1].spec).toMatchObject({ http: [{ timeout: '10s', retries: { attempts: 3 } }] });
  expect(timing[0].spec).not.toHaveProperty('http');
  expect(screen.getByText(/Retries can repeat requests/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Back to edit' }));
  await choose('Delay fault action', 'Set value');
  expect(
    screen.getByRole('button', { name: 'Review and dry-run both changes' }).hasAttribute('disabled')
  ).toBe(true);
  await choose('Request timeout action', 'Not included');
  await choose('Retry action', 'Not included');
  await choose('HTTP abort action', 'Set value');
  await choose('Routing protocol', 'TCP');
  expect(screen.getByText(/Exclude HTTP timeout, retry and fault settings/)).toBeDefined();
  expect(
    screen.getByRole('button', { name: 'Review and dry-run both changes' }).hasAttribute('disabled')
  ).toBe(true);
  await choose('Routing protocol', 'HTTP/gRPC');
  await user.click(screen.getByRole('button', { name: 'Review and dry-run both changes' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const fault = vi.mocked(reviewMutationBatch).mock.calls[1][0];
  expect(fault[1].spec).toMatchObject({
    http: [
      {
        fault: {
          delay: { fixedDelay: '5s', percentage: { value: 10 } },
          abort: { httpStatus: 503, percentage: { value: 10 } },
        },
      },
    ],
  });
  expect(JSON.stringify(fault[1].spec)).not.toContain('"timeout"');
  expect(JSON.stringify(fault[1].spec)).not.toContain('"retries"');
  expect(
    screen.getByText(/Fault injection intentionally delays or rejects requests/)
  ).toBeDefined();
  expect(commitMutationBatch).not.toHaveBeenCalled();
  await user.click(confirm);
  await screen.findByText('Connection lost');
  expect(vi.mocked(commitMutationBatch).mock.calls[0][0].mutations).toBe(fault);
});

it('keeps request conditions explicit, validates RE2 and reviews header-AND/URI-OR semantics', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  const review = await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  const choose = async (label: string, value: string) => {
    await user.click(screen.getByLabelText(label));
    await user.click(screen.getByRole('option', { name: value }));
  };
  await user.click(screen.getByRole('button', { name: 'Add HTTP condition' }));
  expect(review.hasAttribute('disabled')).toBe(true);
  await user.type(screen.getByLabelText('Condition 1 header name'), 'x-enabled');
  await choose('Condition 1 operator', 'Header present');
  await user.click(screen.getByRole('button', { name: 'Add HTTP condition' }));
  await choose('Condition 2 field', 'URI');
  await choose('Condition 2 operator', 'Regular expression');
  await user.type(screen.getByLabelText('Condition 2 value'), '(');
  expect(review.hasAttribute('disabled')).toBe(true);
  await user.clear(screen.getByLabelText('Condition 2 value'));
  await user.type(screen.getByLabelText('Condition 2 value'), '/reviews/.*');
  await choose('Routing protocol', 'TCP');
  expect(review.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Remove HTTP request conditions before reviewing TCP/)).toBeDefined();
  await choose('Routing protocol', 'HTTP/gRPC');
  await user.click(review);
  await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(mutations[1].spec).toMatchObject({
    http: [
      {
        match: [
          { headers: { 'x-enabled': {} }, port: 9080 },
          { uri: { regex: '/reviews/.*' }, port: 9080 },
        ],
      },
    ],
  });
  expect(screen.getByText(/All header conditions form one AND alternative/)).toBeDefined();
  expect(commitMutationBatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back to edit' }));
  await user.click(screen.getByRole('button', { name: 'Remove condition 1' }));
  expect((screen.getByLabelText('Condition 1 value') as HTMLInputElement).value).toBe(
    '/reviews/.*'
  );
});

it('blocks a stale proposal before dry-run or final writes', async () => {
  vi.mocked(assertTrafficProposalFresh).mockRejectedValue(new Error('Service changed'));
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  await user.click(await screen.findByRole('button', { name: 'Review and dry-run both changes' }));
  await screen.findByText('Service changed');
  expect(reviewMutationBatch).not.toHaveBeenCalled();
  expect(commitMutationBatch).not.toHaveBeenCalled();
});
it('does not turn observed routing overlap into an overwrite proposal', async () => {
  vi.mocked(loadServiceTrafficSource).mockResolvedValue({
    ...source,
    conflicts: [{ kind: 'VirtualService', namespace: 'bookinfo', name: 'existing' }],
  });
  open();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load Service versions' }));
  await screen.findByText(/Potentially overlapping routing configuration exists/);
  expect(
    screen.getByRole('button', { name: 'Review and dry-run both changes' }).hasAttribute('disabled')
  ).toBe(true);
  expect(commitMutationBatch).not.toHaveBeenCalled();
});
it('locks scope controls while reviewing and preserves the draft when returning from review', async () => {
  let resolve!: (value: {
    mutations: readonly import('../data/mutations').PreparedMutation[];
  }) => void;
  vi.mocked(reviewMutationBatch).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  await user.click(await screen.findByRole('button', { name: 'Review and dry-run both changes' }));
  await waitFor(() => expect(reviewMutationBatch).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Service name').hasAttribute('disabled')).toBe(true);
  resolve({ mutations: vi.mocked(reviewMutationBatch).mock.calls[0][0] });
  await user.click(await screen.findByRole('button', { name: 'Back to edit' }));
  expect((screen.getByLabelText('Weight for version v1') as HTMLInputElement).value).toBe('50');
  expect(commitMutationBatch).not.toHaveBeenCalled();
});

it('validates optional circuit values and includes them in the frozen two-resource review', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  await user.click(screen.getByLabelText('Connection pool change'));
  await user.click(screen.getByRole('option', { name: 'Set values' }));
  await user.clear(screen.getByLabelText('Maximum connections'));
  expect(
    screen.getByRole('button', { name: 'Review and dry-run both changes' }).hasAttribute('disabled')
  ).toBe(true);
  expect(reviewMutationBatch).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Maximum connections'), '100');
  await user.click(screen.getByLabelText('Outlier detection change'));
  await user.click(screen.getByRole('option', { name: 'Set values' }));
  await user.clear(screen.getByLabelText('Consecutive 5xx errors'));
  await user.type(screen.getByLabelText('Consecutive 5xx errors'), '0');
  await user.click(screen.getByRole('button', { name: 'Review and dry-run both changes' }));
  await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(mutations[0].spec).toMatchObject({
    trafficPolicy: {
      connectionPool: { tcp: { maxConnections: 100 }, http: { http1MaxPendingRequests: 1 } },
      outlierDetection: { consecutive5xxErrors: 0 },
    },
  });
  expect(mutations[1].spec).not.toHaveProperty('trafficPolicy');
  expect(commitMutationBatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back to edit' }));
  expect((screen.getByLabelText('Maximum connections') as HTMLInputElement).value).toBe('100');
  expect((screen.getByLabelText('Consecutive 5xx errors') as HTMLInputElement).value).toBe('0');
});

it('includes an explicit affinity strategy alongside circuit settings in Service creation', async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load Service versions' }));
  await screen.findByRole('button', { name: 'Review and dry-run both changes' });
  await user.click(screen.getByLabelText('Load-balancer change'));
  await user.click(screen.getByRole('option', { name: 'Set strategy' }));
  await user.click(screen.getByLabelText('Load-balancing strategy'));
  await user.click(screen.getByRole('option', { name: 'HTTP header affinity' }));
  expect(
    screen.getByRole('button', { name: 'Review and dry-run both changes' }).hasAttribute('disabled')
  ).toBe(true);
  await user.type(screen.getByLabelText('Affinity HTTP header name'), 'x-user-id');
  await user.click(screen.getByLabelText('Outlier detection change'));
  await user.click(screen.getByRole('option', { name: 'Set values' }));
  await user.click(screen.getByRole('button', { name: 'Review and dry-run both changes' }));
  await screen.findByRole('button', { name: 'Confirm creation of both resources' });
  const mutations = vi.mocked(reviewMutationBatch).mock.calls[0][0];
  expect(mutations[0].spec).toMatchObject({
    trafficPolicy: {
      loadBalancer: { consistentHash: { httpHeaderName: 'x-user-id' } },
      outlierDetection: { consecutive5xxErrors: 1 },
    },
  });
  expect(mutations[1].spec).not.toHaveProperty('trafficPolicy');
  expect(commitMutationBatch).not.toHaveBeenCalled();
});
