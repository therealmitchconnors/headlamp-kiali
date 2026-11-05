import { ValidationSourceKey } from '../core/referenceValidation';
import { discoverConfiguration } from './configuration';
import {
  assertGatewayRouteReferencesFresh,
  inspectGatewayRouteReferences,
} from './gatewayRouteReferences';
import { loadValidationSnapshot } from './validation';

vi.mock('./configuration', () => ({ discoverConfiguration: vi.fn() }));
vi.mock('./validation', () => ({ loadValidationSnapshot: vi.fn() }));

const routeSpec = {
  hostnames: ['reviews.example.test'],
  parentRefs: [{ name: 'public', namespace: 'edge', sectionName: 'https', port: 443 }],
  rules: [{ backendRefs: [{ name: 'reviews', namespace: 'preview', port: 9080, weight: 100 }] }],
};

function snapshot({
  listVersion = '1',
  objectVersion = '1',
  grant = true,
  incomplete,
  ambiguousServicePort = false,
  reverseItems = false,
  gatewayUid = 'gateway-uid',
  gatewayZone = 'edge-zone',
  removeGateway = false,
  extraService = false,
}: {
  listVersion?: string;
  objectVersion?: string;
  grant?: boolean;
  incomplete?: ValidationSourceKey;
  ambiguousServicePort?: boolean;
  reverseItems?: boolean;
  gatewayUid?: string;
  gatewayZone?: string;
  removeGateway?: boolean;
  extraService?: boolean;
} = {}) {
  const order = <T>(items: T[]) => (reverseItems ? [...items].reverse() : items);
  const context = {
    cluster: 'alpha',
    identityDomain: null,
    namespaces: {
      complete: true,
      items: order([
        {
          name: 'bookinfo',
          namespace: '',
          uid: 'bookinfo-uid',
          resourceVersion: objectVersion,
          labels: {},
          spec: {},
        },
        {
          name: 'edge',
          namespace: '',
          uid: 'edge-uid',
          resourceVersion: objectVersion,
          labels: { zone: gatewayZone },
          spec: {},
        },
        {
          name: 'preview',
          namespace: '',
          uid: 'preview-uid',
          resourceVersion: objectVersion,
          labels: {},
          spec: {},
        },
      ]),
    },
    destinationRules: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
    gateways: {
      complete: true,
      items: order(
        removeGateway
          ? []
          : [
              {
                name: 'public',
                namespace: 'edge',
                uid: gatewayUid,
                resourceVersion: objectVersion,
                labels: {},
                spec: {
                  listeners: [
                    {
                      name: 'https',
                      port: 443,
                      allowedRoutes: { namespaces: { from: 'All' } },
                    },
                  ],
                },
              },
            ]
      ),
    },
    services: {
      complete: true,
      items: order([
        {
          name: 'reviews',
          namespace: 'preview',
          uid: 'service-uid',
          resourceVersion: objectVersion,
          labels: {},
          spec: {
            ports: ambiguousServicePort ? [{ port: 9080 }, { port: 9080 }] : [{ port: 9080 }],
          },
        },
        ...(extraService
          ? [
              {
                name: 'other',
                namespace: 'preview',
                uid: 'other-service-uid',
                resourceVersion: objectVersion,
                labels: {},
                spec: { ports: [{ port: 8080 }] },
              },
            ]
          : []),
      ]),
    },
    referenceGrants: {
      complete: true,
      items: order(
        grant
          ? [
              {
                name: 'routes',
                namespace: 'preview',
                uid: 'grant-uid',
                resourceVersion: objectVersion,
                labels: {},
                spec: {
                  from: [
                    {
                      group: 'gateway.networking.k8s.io',
                      kind: 'HTTPRoute',
                      namespace: 'bookinfo',
                    },
                  ],
                  to: [{ group: '', kind: 'Service', name: 'reviews' }],
                },
              },
            ]
          : []
      ),
    },
  };
  const sourceItems = {
    gateways: context.gateways.items,
    namespaces: context.namespaces.items,
    services: context.services.items,
    referenceGrants: context.referenceGrants.items,
  };
  const sources = (['gateways', 'namespaces', 'services', 'referenceGrants'] as const).map(key => ({
    key: key as ValidationSourceKey,
    items: sourceItems[key],
    complete: key !== incomplete,
    resourceVersion: listVersion,
    ...(key === incomplete ? { error: { message: 'forbidden' } } : {}),
  }));
  return { sources, context };
}

beforeEach(() => {
  vi.mocked(discoverConfiguration).mockResolvedValue({
    available: true,
    apiVersion: 'gateway.networking.k8s.io/v1',
  });
  vi.mocked(loadValidationSnapshot).mockResolvedValue(snapshot() as never);
});

it('requires matching cross-namespace Gateway sharing and Service ReferenceGrants', async () => {
  const signal = new AbortController().signal;
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      signal
    )
  ).resolves.toMatchObject({
    sourceEvidence: expect.any(String),
    uncertainty: expect.arrayContaining([
      expect.stringContaining('controller status are not verified'),
    ]),
  });

  vi.mocked(loadValidationSnapshot).mockResolvedValue(snapshot({ grant: false }) as never);
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      signal
    )
  ).rejects.toThrow('Cross-namespace Service reference is not permitted');
});

it('blocks unsupported API discovery and denied reference reads', async () => {
  const signal = new AbortController().signal;
  vi.mocked(discoverConfiguration).mockResolvedValue({ available: false, reason: 'absent' });
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'GRPCRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      signal
    )
  ).rejects.toThrow('discovery is unavailable');

  vi.mocked(discoverConfiguration).mockResolvedValue({
    available: true,
    apiVersion: 'gateway.networking.k8s.io/v1',
  });
  vi.mocked(loadValidationSnapshot).mockResolvedValue(
    snapshot({ incomplete: 'services' }) as never
  );
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      signal
    )
  ).rejects.toThrow('services reference evidence is incomplete: forbidden');
});

it('requires complete namespace evidence for the route target', async () => {
  const signal = new AbortController().signal;
  const evidence = snapshot();
  evidence.context.namespaces.items = [];
  vi.mocked(loadValidationSnapshot).mockResolvedValue(evidence as never);
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      signal
    )
  ).rejects.toThrow('Route namespace bookinfo is missing');
});

it('requires explicit listener and backend ports to match observed targets', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot).mockResolvedValue(snapshot() as never);
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      {
        ...routeSpec,
        rules: [{ backendRefs: [{ name: 'reviews', namespace: 'preview', port: 8080 }] }],
      },
      signal
    )
  ).rejects.toThrow('one unambiguous TCP port 8080');
});

it('rejects a backend port that ambiguously matches multiple Service ports', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot).mockResolvedValue(
    snapshot({ ambiguousServicePort: true }) as never
  );
  await expect(
    inspectGatewayRouteReferences(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      signal
    )
  ).rejects.toThrow('one unambiguous TCP port 9080');
});

it('allows list snapshot resourceVersions to advance when object evidence is unchanged', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot)
    .mockResolvedValueOnce(snapshot({ listVersion: '1', objectVersion: '1' }) as never)
    .mockResolvedValueOnce(snapshot({ listVersion: '2', objectVersion: '1' }) as never);
  const reviewed = await inspectGatewayRouteReferences(
    { cluster: 'alpha' },
    'HTTPRoute',
    'gateway.networking.k8s.io/v1',
    'bookinfo',
    routeSpec,
    signal
  );
  await expect(
    assertGatewayRouteReferencesFresh(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      reviewed,
      signal
    )
  ).resolves.toBeUndefined();
});

it('ignores collection item ordering when checking reviewed reference evidence', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot)
    .mockResolvedValueOnce(snapshot() as never)
    .mockResolvedValueOnce(snapshot({ reverseItems: true }) as never);
  const reviewed = await inspectGatewayRouteReferences(
    { cluster: 'alpha' },
    'HTTPRoute',
    'gateway.networking.k8s.io/v1',
    'bookinfo',
    routeSpec,
    signal
  );
  await expect(
    assertGatewayRouteReferencesFresh(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      reviewed,
      signal
    )
  ).resolves.toBeUndefined();
});

it.each([
  ['changed object resourceVersion', { objectVersion: '2' }],
  ['changed object fields', { gatewayZone: 'replacement-zone' }],
  ['recreated Gateway UID', { gatewayUid: 'replacement-gateway-uid' }],
  ['new collection member', { extraService: true }],
])('rejects confirmation when reference evidence has %s', async (_change, changed) => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot)
    .mockResolvedValueOnce(snapshot() as never)
    .mockResolvedValueOnce(snapshot(changed) as never);
  const reviewed = await inspectGatewayRouteReferences(
    { cluster: 'alpha' },
    'HTTPRoute',
    'gateway.networking.k8s.io/v1',
    'bookinfo',
    routeSpec,
    signal
  );
  await expect(
    assertGatewayRouteReferencesFresh(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      reviewed,
      signal
    )
  ).rejects.toThrow('evidence changed');
});

it('rejects confirmation when a referenced Gateway was deleted', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot)
    .mockResolvedValueOnce(snapshot() as never)
    .mockResolvedValueOnce(snapshot({ removeGateway: true }) as never);
  const reviewed = await inspectGatewayRouteReferences(
    { cluster: 'alpha' },
    'HTTPRoute',
    'gateway.networking.k8s.io/v1',
    'bookinfo',
    routeSpec,
    signal
  );
  await expect(
    assertGatewayRouteReferencesFresh(
      { cluster: 'alpha' },
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      routeSpec,
      reviewed,
      signal
    )
  ).rejects.toThrow('non-existent or inaccessible K8s gateway');
});
