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
  rules: [
    { backendRefs: [{ name: 'reviews', namespace: 'preview', port: 9080, weight: 100 }] },
  ],
};

function snapshot({
  version = '1',
  grant = true,
  incomplete,
}: {
  version?: string;
  grant?: boolean;
  incomplete?: ValidationSourceKey;
} = {}) {
  const sources = (
    ['gateways', 'namespaces', 'services', 'referenceGrants'] as ValidationSourceKey[]
  ).map(key => ({
    key,
    complete: key !== incomplete,
    resourceVersion: version,
    ...(key === incomplete ? { error: { message: 'forbidden' } } : {}),
  }));
  return {
    sources,
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: {
        complete: true,
        items: [
          { name: 'bookinfo', namespace: '', labels: {}, spec: {} },
          { name: 'edge', namespace: '', labels: {}, spec: {} },
          { name: 'preview', namespace: '', labels: {}, spec: {} },
        ],
      },
      destinationRules: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
      gateways: {
        complete: true,
        items: [
          {
            name: 'public',
            namespace: 'edge',
            uid: 'gateway-uid',
            resourceVersion: version,
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
        ],
      },
      services: {
        complete: true,
        items: [
          {
            name: 'reviews',
            namespace: 'preview',
            uid: 'service-uid',
            resourceVersion: version,
            labels: {},
            spec: { ports: [{ port: 9080 }] },
          },
        ],
      },
      referenceGrants: {
        complete: true,
        items: grant
          ? [
              {
                name: 'routes',
                namespace: 'preview',
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
          : [],
      },
    },
  };
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
    sourceVersions: { gateways: '1', namespaces: '1', services: '1', referenceGrants: '1' },
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
  vi.mocked(loadValidationSnapshot).mockResolvedValue(snapshot({ incomplete: 'services' }) as never);
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

it('requires explicit listener and backend ports to match observed targets', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot).mockResolvedValue(
    snapshot() as never
  );
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
  ).rejects.toThrow('does not expose port 8080');
});

it('rejects review confirmation when reference evidence changed after dry-run', async () => {
  const signal = new AbortController().signal;
  vi.mocked(loadValidationSnapshot)
    .mockResolvedValueOnce(snapshot({ version: '1' }) as never)
    .mockResolvedValueOnce(snapshot({ version: '2' }) as never);
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
