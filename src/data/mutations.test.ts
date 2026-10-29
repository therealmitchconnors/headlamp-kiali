import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import fixtureText from '../../test-files/configuration/fixtures.json?raw';
import gatewayFixtureText from '../../test-files/configuration/gateway-fixtures.json?raw';
import { initialCircuitBreaker, planCircuitBreaker } from '../core/circuitBreaker';
import { initialHttpMirroring, planHttpMirroring } from '../core/httpMirroring';
import { planPeerMtls } from '../core/peerMtlsEditing';
import { configurationDefinitions } from '../resources/registry';
import { executeMutation, MutationConflict, prepareMutation } from './mutations';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const original = JSON.parse(fixtureText).virtualService;
const target = {
  cluster: 'alpha',
  namespace: 'bookinfo',
  name: original.metadata.name,
  apiVersion: 'networking.istio.io/v1',
  definition: configurationDefinitions[0],
};
const allowed = { status: { allowed: true } };
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

it('requires immutable valid identity, version and a specification object', () => {
  for (const spec of ['bad JSON', 'null', '[]', '"string"']) {
    expect(() => prepareMutation(target, 'create', spec)).toThrow();
  }
  expect(() => prepareMutation({ ...target, namespace: '../wrong' }, 'create', '{}')).toThrow();
  expect(() => prepareMutation(target, 'update', '{}')).toThrow('original');
  const prepared = prepareMutation(target, 'update', '{"hosts":["reviews"]}', original);
  expect(Object.isFrozen(prepared.target)).toBe(true);
  expect(prepared.original).toEqual({ uid: original.metadata.uid, resourceVersion: '1' });
});

it('never sends a mutation when authorization is denied or malformed', async () => {
  const prepared = prepareMutation(target, 'create', '{}');
  for (const response of [{ status: { allowed: false, reason: 'No access' } }, {}]) {
    vi.mocked(ApiProxy.request).mockReset().mockResolvedValueOnce(response);
    await expect(executeMutation(prepared, false, new AbortController().signal)).rejects.toThrow();
    expect(ApiProxy.request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ApiProxy.request).mock.calls[0][0]).toContain('selfsubjectaccessreviews');
  }
});

it('uses server dry-run and rechecks authorization when executing a reviewed create', async () => {
  const prepared = prepareMutation(target, 'create', '{"hosts":["reviews"]}');
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce({});
  const signal = new AbortController().signal;
  await executeMutation(prepared, true, signal);
  await executeMutation(prepared, false, signal);
  const calls = vi.mocked(ApiProxy.request).mock.calls;
  expect(calls[1][0]).toBe(
    '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices?dryRun=All'
  );
  expect(calls[3][0]).toBe('/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices');
  expect(calls.every(call => call[1]?.cluster === 'alpha')).toBe(true);
  expect(JSON.parse(String(calls[3][1]?.body)).metadata).toEqual({
    name: original.metadata.name,
    namespace: 'bookinfo',
  });
});

it.each(['uid', 'resourceVersion'])('rejects a changed %s without writing', async field => {
  const prepared = prepareMutation(target, 'update', '{}', original);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce({
      ...original,
      metadata: { ...original.metadata, [field]: 'changed' },
    });
  await expect(
    executeMutation(prepared, false, new AbortController().signal)
  ).rejects.toBeInstanceOf(MutationConflict);
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});

it('preserves metadata and status when updating only the spec, using the original version', async () => {
  const prepared = prepareMutation(target, 'update', '{"hosts":["new"]}', original);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({});
  await executeMutation(prepared, false, new AbortController().signal);
  const options = vi.mocked(ApiProxy.request).mock.calls[2][1];
  expect(options?.method).toBe('PUT');
  expect(JSON.parse(String(options?.body))).toEqual({ ...original, spec: { hosts: ['new'] } });
});

it('protects delete from concurrent replacement using UID and resourceVersion preconditions', async () => {
  const prepared = prepareMutation(target, 'delete', '', original);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({});
  await executeMutation(prepared, false, new AbortController().signal);
  const options = vi.mocked(ApiProxy.request).mock.calls[2][1];
  expect(options?.method).toBe('DELETE');
  expect(JSON.parse(String(options?.body)).preconditions).toEqual(prepared.original);
});

it('does not retry a write with an unknown outcome and sends nothing after cancellation', async () => {
  const prepared = prepareMutation(target, 'create', '{}');
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockRejectedValueOnce(new Error('Connection lost'));
  await expect(executeMutation(prepared, false, new AbortController().signal)).rejects.toThrow(
    'Connection lost'
  );
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  controller.abort();
  await expect(executeMutation(prepared, false, controller.signal)).rejects.toBeDefined();
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});

it('carries circuit proposals through permission, version and dry-run guards without changing metadata or status', async () => {
  const original = {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      namespace: 'bookinfo',
      name: 'reviews',
      uid: 'dr',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
      labels: { preserved: 'yes' },
      annotations: { retained: 'yes' },
    },
    spec: { host: 'reviews', trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } } },
    status: { retained: true },
  };
  const target = {
    cluster: 'alpha',
    namespace: 'bookinfo',
    name: 'reviews',
    apiVersion: original.apiVersion,
    definition: configurationDefinitions.find(definition => definition.kind === 'DestinationRule')!,
  };
  const plan = planCircuitBreaker(original.spec, {
    ...initialCircuitBreaker(original.spec),
    connectionPoolMode: 'set',
    maxConnections: '10',
    http1MaxPendingRequests: '0',
  });
  const prepared = prepareMutation(target, 'update', JSON.stringify(plan.spec), original);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({});
  const signal = new AbortController().signal;
  await executeMutation(prepared, true, signal);
  await executeMutation(prepared, false, signal);
  const calls = vi.mocked(ApiProxy.request).mock.calls;
  expect(calls[2][0]).toBe(
    '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews?dryRun=All'
  );
  expect(calls[5][0]).toBe(
    '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews'
  );
  expect(JSON.parse(String(calls[5][1]?.body))).toEqual({ ...original, spec: plan.spec });
  expect(
    calls.every(([, options]) => options?.cluster === 'alpha' && options?.signal === signal)
  ).toBe(true);
});

it('preserves metadata and guards identity when applying a reviewed mirror proposal', async () => {
  const plan = planHttpMirroring(original.spec, {
    ...initialHttpMirroring(),
    routeIndex: 0,
    mode: 'set',
    host: 'shadow.bookinfo.svc.cluster.local',
    subset: 'v3',
    port: '9080',
    percentage: '0.5',
  });
  const prepared = prepareMutation(target, 'update', JSON.stringify(plan.spec), original);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({});
  const signal = new AbortController().signal;
  await executeMutation(prepared, true, signal);
  await executeMutation(prepared, false, signal);
  const calls = vi.mocked(ApiProxy.request).mock.calls;
  expect(calls[2][0]).toContain('?dryRun=All');
  expect(calls[5][0]).not.toContain('dryRun');
  expect(JSON.parse(String(calls[5][1]?.body))).toEqual({ ...original, spec: plan.spec });
  expect(
    calls.every(([, options]) => options?.cluster === 'alpha' && options?.signal === signal)
  ).toBe(true);
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce({
      ...original,
      metadata: { ...original.metadata, resourceVersion: 'replaced' },
    });
  await expect(executeMutation(prepared, false, signal)).rejects.toBeInstanceOf(MutationConflict);
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});

it('uses security-group permissions and preserves PeerAuthentication identity when reviewing mTLS', async () => {
  const object = {
    apiVersion: 'security.istio.io/v1',
    kind: 'PeerAuthentication',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'peer',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
      annotations: { retained: 'yes' },
    },
    spec: { mtls: { mode: 'PERMISSIVE' }, portLevelMtls: { '9080': { mode: 'DISABLE' } } },
  };
  const peerTarget = {
    ...target,
    name: 'reviews',
    apiVersion: object.apiVersion,
    definition: configurationDefinitions.find(value => value.kind === 'PeerAuthentication')!,
  };
  const plan = planPeerMtls(object.spec, { action: 'set', mode: 'STRICT' });
  const prepared = prepareMutation(peerTarget, 'update', JSON.stringify(plan.spec), object);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce(object)
    .mockResolvedValueOnce({});
  await executeMutation(prepared, true, new AbortController().signal);
  const calls = vi.mocked(ApiProxy.request).mock.calls;
  expect(JSON.parse(String(calls[0][1]?.body)).spec.resourceAttributes).toMatchObject({
    group: 'security.istio.io',
    resource: 'peerauthentications',
    namespace: 'bookinfo',
    name: 'reviews',
    verb: 'update',
  });
  expect(calls[2][0]).toBe(
    '/apis/security.istio.io/v1/namespaces/bookinfo/peerauthentications/reviews?dryRun=All'
  );
  expect(JSON.parse(String(calls[2][1]?.body))).toEqual({ ...object, spec: plan.spec });
});

describe('cluster-scoped GatewayClass operations', () => {
  const original = JSON.parse(gatewayFixtureText).gatewayClass;
  const target = {
    cluster: 'alpha',
    namespace: '',
    name: original.metadata.name,
    apiVersion: original.apiVersion,
    definition: configurationDefinitions.find(entry => entry.kind === 'GatewayClass')!,
  };
  it('omits namespace from paths, metadata and permission attributes', async () => {
    const prepared = prepareMutation(target, 'create', JSON.stringify(original.spec));
    vi.mocked(ApiProxy.request).mockResolvedValueOnce(allowed).mockResolvedValueOnce({});
    await executeMutation(prepared, true, new AbortController().signal);
    const calls = vi.mocked(ApiProxy.request).mock.calls;
    expect(JSON.parse(String(calls[0][1]?.body)).spec.resourceAttributes).not.toHaveProperty(
      'namespace'
    );
    expect(calls[1][0]).toBe('/apis/gateway.networking.k8s.io/v1/gatewayclasses?dryRun=All');
    expect(JSON.parse(String(calls[1][1]?.body)).metadata).toEqual({
      name: original.metadata.name,
    });
    expect(() => prepareMutation({ ...target, namespace: 'default' }, 'create', '{}')).toThrow(
      'target'
    );
  });
  it('retains UID/version protections and accepts an omitted namespace for cluster resources', async () => {
    const prepared = prepareMutation(target, 'delete', '', original);
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({});
    await executeMutation(prepared, false, new AbortController().signal);
    const calls = vi.mocked(ApiProxy.request).mock.calls;
    expect(calls[2][0]).toBe(
      `/apis/gateway.networking.k8s.io/v1/gatewayclasses/${original.metadata.name}`
    );
    expect(JSON.parse(String(calls[2][1]?.body)).preconditions).toEqual({
      uid: 'class-uid',
      resourceVersion: '1',
    });
  });
});
