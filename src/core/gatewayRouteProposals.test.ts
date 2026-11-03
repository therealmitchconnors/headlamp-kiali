import {
  GatewayRouteDraft,
  planGatewayRouteAttachment,
  planGatewayRouteCreation,
} from './gatewayRouteProposals';

const draft: GatewayRouteDraft = {
  name: 'reviews',
  namespace: 'bookinfo',
  hostnames: '',
  parentName: 'public',
  parentNamespace: 'edge',
  sectionName: 'https',
  parentPort: '443',
  serviceName: 'reviews',
  serviceNamespace: 'bookinfo',
  servicePort: '9080',
};

describe('Gateway API route proposals', () => {
  it('creates HTTPRoute and GRPCRoute proposals with pinned wizard defaults', () => {
    for (const kind of ['HTTPRoute', 'GRPCRoute'] as const) {
      expect(planGatewayRouteCreation(kind, 'gateway.networking.k8s.io/v1', draft)).toEqual({
        name: 'reviews',
        namespace: 'bookinfo',
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind,
        spec: {
          hostnames: ['reviews'],
          parentRefs: [{ name: 'public', namespace: 'edge', sectionName: 'https', port: 443 }],
          rules: [
            {
              backendRefs: [{ name: 'reviews', port: 9080, weight: 100 }],
            },
          ],
        },
      });
    }
  });

  it('preserves same-namespace and omitted optional identity defaults', () => {
    const result = planGatewayRouteCreation('HTTPRoute', 'gateway.networking.k8s.io/v1', {
      ...draft,
      parentNamespace: 'bookinfo',
      sectionName: '',
      parentPort: '',
      serviceNamespace: 'bookinfo',
      hostnames: '*.example.test, api.example.test',
    });
    expect(result.spec).toEqual({
      hostnames: ['*.example.test', 'api.example.test'],
      parentRefs: [{ name: 'public' }],
      rules: [{ backendRefs: [{ name: 'reviews', port: 9080, weight: 100 }] }],
    });
  });

  it.each([
    ['HTTPRoute', 'gateway.networking.k8s.io/v1alpha2'],
    ['GRPCRoute', 'gateway.networking.k8s.io/v1beta1'],
  ] as const)('rejects unsupported discovery version %s/%s', (kind, apiVersion) => {
    expect(() => planGatewayRouteCreation(kind, apiVersion, draft)).toThrow(
      `${kind} API version is unsupported`
    );
  });

  it.each([
    { ...draft, namespace: 'Bad_Namespace' },
    { ...draft, name: '../reviews' },
    { ...draft, parentName: '' },
    { ...draft, parentNamespace: '' },
    { ...draft, serviceName: 'bad/name' },
    { ...draft, serviceNamespace: 'bad_namespace' },
    { ...draft, servicePort: '0' },
    { ...draft, servicePort: '65536' },
    { ...draft, servicePort: '80x' },
    { ...draft, parentPort: '65536' },
    { ...draft, sectionName: 'bad/name' },
    { ...draft, hostnames: '192.0.2.1' },
  ])('rejects invalid route identities and ports', invalid => {
    expect(() => planGatewayRouteCreation('HTTPRoute', 'gateway.networking.k8s.io/v1', invalid)).toThrow();
  });

  it('omits parent namespace when attaching within the route namespace', () => {
    const proposal = planGatewayRouteAttachment(
      'GRPCRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      { hostnames: ['reviews.example.test'], rules: [{ matches: [{ method: { service: 'reviews' } }] }] },
      { name: 'internal', namespace: 'bookinfo', sectionName: '', port: '' }
    );
    expect(proposal.parentRefs).toEqual([{ name: 'internal' }]);
  });

  it('preserves existing route content when attaching and rejects duplicate parent references', () => {
    const original = {
      hostnames: ['reviews.example.test'],
      rules: [{ backendRefs: [{ name: 'reviews', port: 9080, weight: 40 }] }],
      parentRefs: [{ name: 'public', namespace: 'edge', sectionName: 'https' }],
    };
    const before = structuredClone(original);
    const proposal = planGatewayRouteAttachment(
      'HTTPRoute',
      'gateway.networking.k8s.io/v1',
      'bookinfo',
      original,
      { name: 'internal', namespace: 'bookinfo', sectionName: 'http', port: '80' }
    );
    expect(proposal).toEqual({
      ...original,
      parentRefs: [
        ...original.parentRefs,
        { name: 'internal', sectionName: 'http', port: 80 },
      ],
    });
    expect(original).toEqual(before);
    expect(() =>
      planGatewayRouteAttachment(
        'HTTPRoute',
        'gateway.networking.k8s.io/v1',
        'bookinfo',
        { parentRefs: [proposal.parentRefs?.[1]] },
        { name: 'internal', namespace: 'bookinfo', sectionName: 'http', port: '80' }
      )
    ).toThrow('This Gateway attachment already exists');
  });
});
