import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { VALIDATION_IGNORE_ANNOTATION } from '../../core/validationAnnotations';
import { executeMutation } from '../../data/mutations';
import { DestinationRule } from '../../resources/destination-rule';
import { GRPCRoute } from '../../resources/grpc-route';
import { HTTPRoute } from '../../resources/http-route';
import { PeerAuthentication } from '../../resources/peer-authentication';
import { configurationDefinitions } from '../../resources/registry';
import { VirtualService } from '../../resources/virtual-service';
import ConfigurationActions from './ConfigurationActions';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    cluster: {
      KubeObject: class {
        constructor(public jsonData: { metadata: object; spec?: object }, public cluster: string) {}
        get metadata() {
          return this.jsonData.metadata;
        }
      },
    },
  },
  ApiProxy: { request: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('notistack', () => ({ useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SimpleTable: ({
    data,
    columns,
  }: {
    data: unknown[];
    columns: { label: string; getter: (row: unknown) => ReactNode }[];
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
vi.mock('../../data/mutations', async importOriginal => {
  const original = await importOriginal<typeof import('../../data/mutations')>();
  return { ...original, executeMutation: vi.fn() };
});
vi.mock('./CodeBlock', () => ({
  default: ({ value }: { value: string }) => <pre>{value}</pre>,
}));
beforeEach(() => {
  vi.mocked(executeMutation).mockReset();
});
afterEach(cleanup);

function open() {
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions[0]}
      apiVersion="networking.istio.io/v1"
      cluster="alpha"
      onChanged={onChanged}
    />
  );
  return onChanged;
}

async function prepare() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create configuration' }));
  await user.type(screen.getByLabelText('Namespace'), 'bookinfo');
  await user.type(screen.getByLabelText('Name'), 'reviews-test');
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  return user;
}

it('cannot commit before a successful dry-run and explicit second confirmation', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const onChanged = open();
  const user = await prepare();
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  expect(executeMutation).toHaveBeenCalledTimes(1);
  expect(vi.mocked(executeMutation).mock.calls[0][1]).toBe(true);
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][1]).toBe(false);
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(
    vi.mocked(executeMutation).mock.calls[0][0]
  );
});

it('reviews mirroring from an immutable snapshot, warns about side effects and requires confirmation', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'mirror-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      hosts: ['reviews'],
      http: [
        {
          name: 'forward',
          route: [{ destination: { host: 'reviews', subset: 'v1' }, weight: 100 }],
          timeout: '10s',
          mirrors: [{ destination: { host: 'old-shadow' }, percentage: { value: 10 } }],
        },
      ],
    },
  };
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions.find(value => value.kind === 'VirtualService')!}
      apiVersion="networking.istio.io/v1"
      cluster="alpha"
      resource={new VirtualService(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit HTTP mirroring' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.click(screen.getByLabelText('Mirroring change'));
  await user.click(screen.getByRole('option', { name: 'Replace with one mirror' }));
  expect((screen.getByLabelText('Mirror host') as HTMLInputElement).value).toBe('old-shadow');
  data.metadata.resourceVersion = '2';
  data.spec.http[0].timeout = '99s';
  await user.clear(screen.getByLabelText('Mirror host'));
  await user.type(screen.getByLabelText('Mirror host'), 'shadow.bookinfo.svc.cluster.local');
  await user.clear(screen.getByLabelText('Mirror percentage'));
  await user.type(screen.getByLabelText('Mirror percentage'), '101');
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  expect(executeMutation).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Mirror percentage'));
  await user.type(screen.getByLabelText('Mirror percentage'), '0');
  expect(screen.getByText(/can repeat writes or other side effects/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(prepared.spec).toEqual({
    hosts: ['reviews'],
    http: [
      {
        name: 'forward',
        route: [{ destination: { host: 'reviews', subset: 'v1' }, weight: 100 }],
        timeout: '10s',
        mirror: { host: 'shadow.bookinfo.svc.cluster.local' },
        mirrorPercentage: { value: 0 },
      },
    ],
  });
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
  expect(vi.mocked(executeMutation).mock.calls[1][1]).toBe(false);
});

it('aborts mirroring review when the cluster changes and discards a late response', async () => {
  let resolve!: () => void;
  vi.mocked(executeMutation).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = () => done(undefined);
      })
  );
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'mirror',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      hosts: ['reviews'],
      http: [{ route: [{ destination: { host: 'reviews' } }], mirror: { host: 'shadow' } }],
    },
  };
  const definition = configurationDefinitions.find(value => value.kind === 'VirtualService')!;
  const onChanged = vi.fn();
  const view = render(
    <ConfigurationActions
      definition={definition}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new VirtualService(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit HTTP mirroring' }));
  await user.click(screen.getByLabelText('Mirroring change'));
  await user.click(screen.getByRole('option', { name: 'Remove all mirrors' }));
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  const signal = vi.mocked(executeMutation).mock.calls[0][2];
  view.rerender(
    <ConfigurationActions
      definition={definition}
      apiVersion={data.apiVersion}
      cluster="beta"
      resource={new VirtualService(data, 'beta')}
      onChanged={onChanged}
    />
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onChanged).not.toHaveBeenCalled();
});

it('keeps outbound TLS explicit, preserves its captured policy and reviews mode-specific impact', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'tls',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      host: 'reviews',
      trafficPolicy: {
        tls: {
          mode: 'SIMPLE' as const,
          credentialName: 'old-secret',
          sni: 'example.com',
          insecureSkipVerify: true,
        },
        connectionPool: { tcp: { maxConnections: 10 } },
      },
    },
  };
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions.find(value => value.kind === 'DestinationRule')!}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new DestinationRule(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit outbound TLS' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.click(screen.getByLabelText('Outbound TLS change'));
  await user.click(screen.getByRole('option', { name: 'Set explicit TLS policy' }));
  await user.click(screen.getByLabelText('Outbound TLS mode'));
  await user.click(screen.getByRole('option', { name: 'MUTUAL' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.type(screen.getByLabelText('Client certificate file path'), '/etc/cert.pem');
  await user.type(screen.getByLabelText('Private key file path'), '/etc/key.pem');
  data.metadata.resourceVersion = '2';
  data.spec.trafficPolicy.tls.sni = 'changed.example.com';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(prepared.spec).toEqual({
    host: 'reviews',
    trafficPolicy: {
      tls: {
        mode: 'MUTUAL',
        sni: 'example.com',
        insecureSkipVerify: true,
        clientCertificate: '/etc/cert.pem',
        privateKey: '/etc/key.pem',
      },
      connectionPool: { tcp: { maxConnections: 10 } },
    },
  });
  expect(screen.getAllByText(/remove any credentialName secret reference/).length).toBeGreaterThan(
    0
  );
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
});

it('reviews HTTP route ordering from the captured version and blocks moving a catch-all ahead of rules', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'ordering',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      hosts: ['reviews'],
      http: [
        {
          name: 'first',
          match: [{ uri: { exact: '/first' } }],
          route: [{ destination: { host: 'reviews' } }],
          timeout: '1s',
        },
        {
          name: 'second',
          match: [{ uri: { exact: '/second' } }],
          route: [{ destination: { host: 'reviews' } }],
        },
        { name: 'fallback', route: [{ destination: { host: 'reviews' } }] },
      ],
    },
  };
  const before = structuredClone(data.spec);
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions.find(value => value.kind === 'VirtualService')!}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new VirtualService(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reorder HTTP routes' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.click(screen.getByLabelText('New route position'));
  await user.click(screen.getAllByRole('option')[2]);
  expect(
    screen.getByText(
      'A route without match conditions must be last; later routes would be unreachable'
    )
  ).toBeDefined();
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.click(screen.getByLabelText('New route position'));
  await user.click(screen.getAllByRole('option')[1]);
  data.metadata.resourceVersion = '2';
  data.spec.http[0].timeout = '99s';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(prepared.spec).toEqual({
    hosts: ['reviews'],
    http: [before.http[1], before.http[0], before.http[2]],
  });
  expect(screen.getAllByText(/HTTP routes use first-match ordering/).length).toBeGreaterThan(0);
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
});

it('edits one existing condition from its captured version without discarding scope restrictions', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'match',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      hosts: ['reviews'],
      http: [
        {
          match: [
            {
              port: 9080,
              sourceNamespace: 'clients',
              headers: { 'x-user': { exact: 'old' }, 'x-present': {} },
              uri: { prefix: '/reviews' },
            },
          ],
          route: [{ destination: { host: 'reviews' } }],
        },
      ],
    },
  };
  const before = structuredClone(data.spec);
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions.find(value => value.kind === 'VirtualService')!}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new VirtualService(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit HTTP match conditions' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.clear(screen.getByLabelText('Condition {{index}} value'));
  await user.type(screen.getByLabelText('Condition {{index}} value'), 'new');
  await user.click(screen.getByLabelText('Match condition change'));
  await user.click(screen.getByRole('option', { name: 'Set this condition' }));
  data.metadata.resourceVersion = '2';
  data.spec.http[0].match[0].port = 9999;
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  before.http[0].match[0].headers['x-user'].exact = 'new';
  expect(prepared.spec).toEqual(before);
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(screen.getAllByText(/Conditions inside one alternative are ANDed/).length).toBeGreaterThan(
    0
  );
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
});

it('reviews inbound mTLS against captured scope and preserves selector and workload-port overrides', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'security.istio.io/v1',
    kind: 'PeerAuthentication',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'peer-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      selector: { matchLabels: { app: 'reviews' } },
      mtls: { mode: 'PERMISSIVE' as const },
      portLevelMtls: { '9080': { mode: 'DISABLE' as const } },
    },
  };
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions.find(value => value.kind === 'PeerAuthentication')!}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new PeerAuthentication(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit inbound mTLS' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.click(screen.getByLabelText('Inbound mTLS change'));
  await user.click(screen.getByRole('option', { name: 'Set explicit mTLS mode' }));
  await user.click(screen.getByLabelText('Inbound mTLS mode'));
  await user.click(screen.getByRole('option', { name: 'STRICT' }));
  data.metadata.resourceVersion = '2';
  data.spec.selector.matchLabels.app = 'changed';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(prepared.spec).toEqual({
    selector: { matchLabels: { app: 'reviews' } },
    mtls: { mode: 'STRICT' },
    portLevelMtls: { '9080': { mode: 'DISABLE' } },
  });
  expect(screen.getAllByText(/STRICT requires mTLS under this policy/).length).toBeGreaterThan(0);
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
});

it.each([
  { Resource: HTTPRoute, kind: 'HTTPRoute' },
  { Resource: GRPCRoute, kind: 'GRPCRoute' },
])(
  'reviews relative Gateway backend weights for $kind without changing captured references',
  async ({ Resource }) => {
    vi.mocked(executeMutation).mockResolvedValue(undefined);
    const data = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: Resource.kind,
      metadata: {
        name: 'reviews',
        namespace: 'bookinfo',
        uid: 'gateway-route',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: {
        parentRefs: [{ name: 'edge', namespace: 'gateway-system' }],
        rules: [
          {
            backendRefs: [
              { name: 'reviews', namespace: 'one', port: 9080 },
              { name: 'reviews', namespace: 'two', port: 9080 },
            ],
          },
        ],
      },
    };
    const onChanged = vi.fn();
    render(
      <ConfigurationActions
        definition={configurationDefinitions.find(value => value.kind === Resource.kind)!}
        apiVersion={data.apiVersion}
        cluster="alpha"
        resource={new Resource(data, 'alpha')}
        onChanged={onChanged}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Adjust Gateway backend weights' }));
    expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
      true
    );
    const inputs = screen.getAllByLabelText('Backend {{index}} relative weight');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '0');
    await user.clear(inputs[1]);
    await user.type(inputs[1], '0');
    expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
      true
    );
    await user.clear(inputs[0]);
    await user.type(inputs[0], '2');
    await user.clear(inputs[1]);
    await user.type(inputs[1], '3');
    data.metadata.resourceVersion = '2';
    data.spec.rules[0].backendRefs[0].namespace = 'changed';
    await user.click(screen.getByRole('button', { name: 'Check and review' }));
    await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
    const prepared = vi.mocked(executeMutation).mock.calls[0][0];
    expect(prepared.original?.resourceVersion).toBe('1');
    expect(prepared.spec).toEqual({
      parentRefs: [{ name: 'edge', namespace: 'gateway-system' }],
      rules: [
        {
          backendRefs: [
            { name: 'reviews', namespace: 'one', port: 9080, weight: 2 },
            { name: 'reviews', namespace: 'two', port: 9080, weight: 3 },
          ],
        },
      ],
    });
    expect(screen.getAllByText(/relative proportions, not percentages/).length).toBeGreaterThan(0);
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
  }
);

it('keeps denied dry-runs in edit mode and shows the reason', async () => {
  vi.mocked(executeMutation).mockRejectedValue(new Error('Forbidden'));
  open();
  await prepare();
  expect(await screen.findByText('Forbidden')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Confirm operation' })).toBeNull();
});

it('prevents blind retry after an uncertain write outcome', async () => {
  vi.mocked(executeMutation)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Network failed'));
  const onChanged = open();
  const user = await prepare();
  await user.click(await screen.findByRole('button', { name: 'Confirm operation' }));
  await screen.findByText('Network failed');
  expect(screen.getByText(/server may have received/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Confirm operation' }).hasAttribute('disabled')).toBe(
    true
  );
  expect(onChanged).not.toHaveBeenCalled();
});

it('reviews circuit settings against an immutable snapshot before a distinct confirmation', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'circuit-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      host: 'reviews',
      trafficPolicy: {
        tls: { mode: 'ISTIO_MUTUAL' as const },
        connectionPool: { tcp: { maxConnections: 5, connectTimeout: '7s' } },
        outlierDetection: { consecutiveErrors: 3, interval: '10s' },
      },
    },
  };
  const resource = new DestinationRule(data, 'alpha');
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={
        configurationDefinitions.find(definition => definition.kind === 'DestinationRule')!
      }
      apiVersion="networking.istio.io/v1"
      cluster="alpha"
      resource={resource}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit circuit breaking' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  data.metadata.resourceVersion = '2';
  data.spec.trafficPolicy.connectionPool.tcp.maxConnections = 999;
  await user.click(screen.getByLabelText('Connection pool change'));
  await user.click(screen.getByRole('option', { name: 'Set values' }));
  await user.clear(screen.getByLabelText('Maximum connections'));
  await user.type(screen.getByLabelText('Maximum connections'), '10');
  await user.click(screen.getByLabelText('Outlier detection change'));
  await user.click(screen.getByRole('option', { name: 'Set values' }));
  await user.clear(screen.getByLabelText('Consecutive 5xx errors'));
  await user.type(screen.getByLabelText('Consecutive 5xx errors'), '0');
  expect(screen.getByText(/removes the deprecated consecutiveErrors alias/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(prepared.spec).toMatchObject({
    host: 'reviews',
    trafficPolicy: {
      tls: { mode: 'ISTIO_MUTUAL' },
      connectionPool: {
        tcp: { maxConnections: 10, connectTimeout: '7s' },
        http: { http1MaxPendingRequests: 1 },
      },
      outlierDetection: { consecutive5xxErrors: 0, interval: '10s' },
    },
  });
  expect(JSON.stringify(prepared.spec)).not.toContain('consecutiveErrors');
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
  expect(vi.mocked(executeMutation).mock.calls[1][1]).toBe(false);
});

it('aborts a circuit dry-run and removes its review on a cluster change', async () => {
  let resolve!: () => void;
  vi.mocked(executeMutation).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = () => done(undefined);
      })
  );
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'circuit-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: { host: 'reviews' },
  };
  const definition = configurationDefinitions.find(
    definition => definition.kind === 'DestinationRule'
  )!;
  const onChanged = vi.fn();
  const view = render(
    <ConfigurationActions
      definition={definition}
      apiVersion="networking.istio.io/v1"
      cluster="alpha"
      resource={new DestinationRule(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit circuit breaking' }));
  await user.click(screen.getByLabelText('Outlier detection change'));
  await user.click(screen.getByRole('option', { name: 'Set values' }));
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  const signal = vi.mocked(executeMutation).mock.calls[0][2];
  view.rerender(
    <ConfigurationActions
      definition={definition}
      apiVersion="networking.istio.io/v1"
      cluster="beta"
      resource={new DestinationRule(data, 'beta')}
      onChanged={onChanged}
    />
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirm operation' })).toBeNull();
  expect(onChanged).not.toHaveBeenCalled();
});

it('reviews validated load-balancing changes without dropping advanced policy fields', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'balancer-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      host: 'reviews',
      trafficPolicy: {
        tls: { mode: 'ISTIO_MUTUAL' as const },
        loadBalancer: {
          consistentHash: {
            httpCookie: { name: 'session', ttl: '30s', path: '/shop' },
            ringHash: { minimumRingSize: 1024 },
          },
          localityLbSetting: { enabled: false },
        },
      },
    },
  };
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={
        configurationDefinitions.find(definition => definition.kind === 'DestinationRule')!
      }
      apiVersion="networking.istio.io/v1"
      cluster="alpha"
      resource={new DestinationRule(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit load balancing' }));
  await user.click(screen.getByLabelText('Load-balancer change'));
  await user.click(screen.getByRole('option', { name: 'Set strategy' }));
  await user.clear(screen.getByLabelText('Affinity cookie TTL'));
  await user.type(screen.getByLabelText('Affinity cookie TTL'), 'bad');
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  expect(executeMutation).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Affinity cookie TTL'));
  await user.type(screen.getByLabelText('Affinity cookie TTL'), '0s');
  data.metadata.resourceVersion = '2';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original?.resourceVersion).toBe('1');
  expect(prepared.spec).toMatchObject({
    trafficPolicy: {
      tls: { mode: 'ISTIO_MUTUAL' },
      loadBalancer: {
        localityLbSetting: { enabled: false },
        consistentHash: {
          httpCookie: { name: 'session', ttl: '0s', path: '/shop' },
          ringHash: { minimumRingSize: 1024 },
        },
      },
    },
  });
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
});

it('makes cluster-wide scope explicit and never collects a namespace for GatewayClass', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  render(
    <ConfigurationActions
      definition={configurationDefinitions.find(entry => entry.kind === 'GatewayClass')!}
      apiVersion="gateway.networking.k8s.io/v1"
      cluster="alpha"
      onChanged={vi.fn()}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create configuration' }));
  expect(screen.queryByLabelText('Namespace')).toBeNull();
  expect(
    screen.getByText(
      'This resource is cluster-scoped. The operation is not restricted to a namespace.'
    )
  ).toBeDefined();
  await user.type(screen.getByLabelText('Name'), 'example-gateway');
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  expect(vi.mocked(executeMutation).mock.calls[0][0].target.namespace).toBe('');
  expect(vi.mocked(executeMutation).mock.calls[0][1]).toBe(true);
});

it('reviews only valid traffic weights and retains the original snapshot across live object changes', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      namespace: 'bookinfo',
      name: 'reviews',
      uid: 'weights-fixture',
      resourceVersion: '1',
      creationTimestamp: '2026-10-27T00:00:00Z',
    },
    spec: {
      hosts: ['reviews'],
      http: [
        {
          timeout: '5s',
          mirror: { host: 'shadow' },
          route: [
            { destination: { host: 'reviews', subset: 'v1' }, weight: 50 },
            { destination: { host: 'reviews', subset: 'v2' }, weight: 50 },
          ],
        },
      ],
    },
  };
  const resource = new VirtualService(data, 'alpha');
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions[0]}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={resource}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Adjust traffic weights' }));
  expect(executeMutation).not.toHaveBeenCalled();
  const fields = screen.getAllByRole('spinbutton');
  await user.clear(fields[0]);
  await user.type(fields[0], '90');
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await user.clear(fields[1]);
  await user.type(fields[1], '10');
  data.metadata.resourceVersion = '2';
  data.spec.http[0].timeout = '99s';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original).toEqual({ uid: 'weights-fixture', resourceVersion: '1' });
  expect(prepared.spec).toEqual({
    hosts: ['reviews'],
    http: [
      {
        timeout: '5s',
        mirror: { host: 'shadow' },
        route: [
          { destination: { host: 'reviews', subset: 'v1' }, weight: 90 },
          { destination: { host: 'reviews', subset: 'v2' }, weight: 10 },
        ],
      },
    ],
  });
  expect(vi.mocked(executeMutation).mock.calls[0][1]).toBe(true);
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back to edit' }));
  expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('90');
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[2][1]).toBe(false);
});

it('keeps HTTP changes explicit, preserves unrelated fields and requires removing conflicting behavior', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      namespace: 'bookinfo',
      name: 'http-controls',
      uid: 'http-fixture',
      resourceVersion: '1',
      creationTimestamp: '2026-10-27T00:00:00Z',
    },
    spec: {
      hosts: ['reviews'],
      http: [
        {
          timeout: '5s',
          retries: { attempts: 1, retryRemoteLocalities: true },
          route: [{ destination: { host: 'reviews' }, weight: 100 }],
          headers: { request: { add: { 'x-preserve': 'yes' } } },
        },
      ],
    },
  };
  const onChanged = vi.fn();
  render(
    <ConfigurationActions
      definition={configurationDefinitions[0]}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new VirtualService(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit HTTP route behavior' }));
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  async function action(label: string, value: string) {
    await user.click(screen.getByRole('combobox', { name: label }));
    await user.click(screen.getByRole('option', { name: value }));
  }
  await action('Request timeout action', 'Set value');
  await user.clear(screen.getByLabelText('Request timeout'));
  await user.type(screen.getByLabelText('Request timeout'), '10s');
  await action('Retry action', 'Set value');
  await user.clear(screen.getByLabelText('Retry attempts'));
  await user.type(screen.getByLabelText('Retry attempts'), '3');
  data.metadata.resourceVersion = '2';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const first = vi.mocked(executeMutation).mock.calls[0][0];
  expect(first.original?.resourceVersion).toBe('1');
  expect(first.spec).toMatchObject({
    http: [
      {
        timeout: '10s',
        retries: { attempts: 3, retryRemoteLocalities: true },
        headers: data.spec.http[0].headers,
        route: data.spec.http[0].route,
      },
    ],
  });
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back to edit' }));
  await action('Delay fault action', 'Set value');
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  await action('Request timeout action', 'Remove setting');
  await action('Retry action', 'Remove setting');
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  const second = vi.mocked(executeMutation).mock.calls[1][0];
  expect(second.spec).toMatchObject({
    http: [
      {
        fault: { delay: { fixedDelay: '5s', percentage: { value: 10 } } },
        headers: data.spec.http[0].headers,
        route: data.spec.http[0].route,
      },
    ],
  });
  expect(JSON.stringify(second.spec)).not.toContain('"retries"');
  await user.click(await screen.findByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[2][1]).toBe(false);
});

function exclusionResource(value?: string) {
  const annotations: Record<string, string> = { unrelated: 'preserve' };
  if (value !== undefined) annotations[VALIDATION_IGNORE_ANNOTATION] = value;
  const data = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'exclusions-fixture',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
      annotations,
    },
    spec: { hosts: ['reviews'] },
  };
  const onChanged = vi.fn();
  const view = render(
    <ConfigurationActions
      definition={configurationDefinitions[0]}
      apiVersion={data.apiVersion}
      cluster="alpha"
      resource={new VirtualService(data, 'alpha')}
      onChanged={onChanged}
    />
  );
  return { data, onChanged, view };
}

it('reviews an annotation-only proposal from the immutable opening snapshot before confirmation', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  const { data, onChanged } = exclusionResource('KIA0004');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit validation exclusions' }));
  expect(screen.queryByLabelText('Specification (JSON)')).toBeNull();
  await user.clear(screen.getByLabelText('Validation codes (comma-separated)'));
  await user.type(screen.getByLabelText('Validation codes (comma-separated)'), 'KIA1107,GWAPI');
  data.metadata.resourceVersion = '2';
  data.metadata.annotations[VALIDATION_IGNORE_ANNOTATION] = 'KIA9999';
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  const prepared = vi.mocked(executeMutation).mock.calls[0][0];
  expect(prepared.original).toEqual({ uid: 'exclusions-fixture', resourceVersion: '1' });
  expect(prepared.validationExclusions).toEqual({ value: 'KIA1107,GWAPI' });
  expect(prepared.spec).toBeUndefined();
  expect(
    screen.getByText(JSON.stringify({ [VALIDATION_IGNORE_ANNOTATION]: 'KIA0004' }, null, 2), {
      normalizer: value => value,
    })
  ).toBeDefined();
  expect(screen.queryByText(/"unrelated"/)).toBeNull();
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeMutation).mock.calls[1][0]).toBe(prepared);
  expect(vi.mocked(executeMutation).mock.calls[1][1]).toBe(false);
});

it('makes restoration distinct from ignore-all and blocks retry after an uncertain annotation write', async () => {
  vi.mocked(executeMutation)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Uncertain annotation result'));
  const { onChanged } = exclusionResource('');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit validation exclusions' }));
  await user.click(screen.getByRole('combobox', { name: 'Validation exclusion mode' }));
  await user.click(screen.getByRole('option', { name: 'Restore normal checks' }));
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  expect(vi.mocked(executeMutation).mock.calls[0][0].validationExclusions).toEqual({ value: null });
  expect(
    screen.getByText(
      'An empty object means the annotation is removed; an empty string means all findings are ignored.'
    )
  ).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Confirm operation' }));
  await screen.findByText('Uncertain annotation result');
  expect(screen.getByRole('button', { name: 'Confirm operation' }).hasAttribute('disabled')).toBe(
    true
  );
  expect(onChanged).not.toHaveBeenCalled();
});

it('requires valid selected codes or a deliberate ignore-all selection', async () => {
  vi.mocked(executeMutation).mockResolvedValue(undefined);
  exclusionResource();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit validation exclusions' }));
  await user.click(screen.getByRole('combobox', { name: 'Validation exclusion mode' }));
  await user.click(screen.getByRole('option', { name: 'Ignore selected codes' }));
  await user.type(screen.getByLabelText('Validation codes (comma-separated)'), 'KIA0004,');
  expect(screen.getByRole('button', { name: 'Check and review' }).hasAttribute('disabled')).toBe(
    true
  );
  expect(executeMutation).not.toHaveBeenCalled();
  await user.click(screen.getByRole('combobox', { name: 'Validation exclusion mode' }));
  await user.click(screen.getByRole('option', { name: 'Ignore all findings for this object' }));
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await screen.findByText('Server dry-run succeeded. Confirm to perform this operation.');
  expect(vi.mocked(executeMutation).mock.calls[0][0].validationExclusions).toEqual({ value: '' });
});

it('aborts and clears a pending annotation review when the cluster changes, even for matching UIDs', async () => {
  let finish: () => void = () => {};
  vi.mocked(executeMutation).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const { data, onChanged, view } = exclusionResource();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit validation exclusions' }));
  await user.click(screen.getByRole('combobox', { name: 'Validation exclusion mode' }));
  await user.click(screen.getByRole('option', { name: 'Ignore all findings for this object' }));
  await user.click(screen.getByRole('button', { name: 'Check and review' }));
  await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(executeMutation).mock.calls[0][2];
  view.rerender(
    <ConfigurationActions
      definition={configurationDefinitions[0]}
      apiVersion={data.apiVersion}
      cluster="beta"
      resource={new VirtualService(data, 'beta')}
      onChanged={onChanged}
    />
  );
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => finish());
  expect(onChanged).not.toHaveBeenCalled();
});
