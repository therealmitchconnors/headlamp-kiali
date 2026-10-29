import fixturesText from '../../test-files/configuration/fixtures.json?raw';
import gatewayFixturesText from '../../test-files/configuration/gateway-fixtures.json?raw';
import { configurationReferences, configurationSections, serviceHost } from './configuration';

const fixtures = JSON.parse(fixturesText);

describe('configuration references', () => {
  it('extracts routing, mirror, delegate and named gateway references, not mesh or external hosts', () => {
    const refs = configurationReferences(
      'VirtualService',
      fixtures.virtualService.spec,
      'bookinfo'
    );
    expect(refs).toContainEqual({
      kind: 'Gateway',
      namespace: 'edge',
      name: 'public',
      path: 'spec.gateways[1]',
    });
    expect(refs).toContainEqual({
      kind: 'VirtualService',
      namespace: 'edge',
      name: 'nested-routes',
      path: 'spec.http[1].delegate',
    });
    expect(refs.filter(ref => ref.kind === 'Service')).toHaveLength(5);
    expect(refs.find(ref => ref.path === 'spec.http[0].route[0].destination')?.subset).toBe('v1');
    expect(refs.some(ref => ref.name === 'mesh')).toBe(false);
    expect(
      configurationReferences(
        'VirtualService',
        { http: [{ route: [{ destination: { host: '*.example.test' } }] }] },
        'bookinfo'
      )
    ).toEqual([]);
  });
  describe('Gateway API configuration references', () => {
    const fixtures = JSON.parse(gatewayFixturesText);
    it('distinguishes Gateway API parent and cluster-scoped GatewayClass links from Istio Gateway', () => {
      const refs = configurationReferences(
        'HTTPRoute',
        fixtures.httpRoute.spec,
        'bookinfo',
        'gateway.networking.k8s.io'
      );
      expect(refs).toContainEqual({
        kind: 'Gateway',
        group: 'gateway.networking.k8s.io',
        namespace: 'edge',
        name: 'public',
        sectionName: 'https',
        path: 'spec.parentRefs[0]',
      });
      expect(
        refs.filter(ref => ref.kind === 'Service').map(ref => [ref.namespace, ref.name])
      ).toEqual([
        ['preview', 'shadow'],
        ['bookinfo', 'reviews'],
      ]);
      expect(
        configurationReferences(
          'Gateway',
          fixtures.gateway.spec,
          'edge',
          'gateway.networking.k8s.io'
        )
      ).toEqual([
        {
          kind: 'GatewayClass',
          group: 'gateway.networking.k8s.io',
          namespace: '',
          name: 'example-gateway',
          path: 'spec.gatewayClassName',
        },
        {
          kind: 'Secret',
          group: '',
          namespace: 'edge',
          name: 'example-certificate',
          path: 'spec.listeners[0].tls.certificateRefs[0]',
        },
      ]);
    });
    it('links inference picker Services without interpreting selectors as observed traffic', () => {
      expect(
        configurationReferences(
          'InferencePool',
          fixtures.inferencePool.spec,
          'bookinfo',
          'inference.networking.k8s.io'
        )
      ).toEqual([
        {
          kind: 'Service',
          group: '',
          namespace: 'bookinfo',
          name: 'picker',
          path: 'spec.endpointPickerRef',
        },
      ]);
    });
    it('does not convert unsupported backend groups or unnamed grants into fabricated targets', () => {
      expect(
        configurationReferences(
          'HTTPRoute',
          {
            rules: [
              {
                backendRefs: [{ name: 'not-a-service', group: 'other.example', kind: 'Service' }],
              },
            ],
          },
          'bookinfo',
          'gateway.networking.k8s.io'
        )
      ).toEqual([]);
      expect(
        configurationReferences(
          'ReferenceGrant',
          {
            from: [
              { group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', namespace: 'bookinfo' },
            ],
            to: [{ group: '', kind: 'Service' }],
          },
          'edge',
          'gateway.networking.k8s.io'
        )
      ).toEqual([
        {
          kind: 'Namespace',
          group: '',
          namespace: '',
          name: 'bookinfo',
          path: 'spec.from[0].namespace',
        },
      ]);
    });
  });
  it('resolves DestinationRule target and all top-level spec fields without mutation', () => {
    const before = JSON.stringify(fixtures.destinationRule);
    expect(
      configurationReferences('DestinationRule', fixtures.destinationRule.spec, 'bookinfo')
    ).toEqual([{ kind: 'Service', namespace: 'bookinfo', name: 'reviews', path: 'spec.host' }]);
    expect(
      configurationSections(fixtures.destinationRule.spec).map(section => section.name)
    ).toEqual(Object.keys(fixtures.destinationRule.spec));
    expect(JSON.stringify(fixtures.destinationRule)).toBe(before);
  });
  it.each([
    'reviews',
    'reviews.bookinfo',
    'reviews.bookinfo.svc',
    'reviews.bookinfo.svc.cluster.local.',
  ])('resolves a Kubernetes Service DNS form: %s', host => {
    expect(serviceHost(host, 'bookinfo')).toEqual({ name: 'reviews', namespace: 'bookinfo' });
  });
  it.each(['*', '*.bookinfo', 'reviews.example.test', 'http://reviews', '../reviews', 'a/b', ''])(
    'leaves external or unsafe hosts unresolved: %s',
    host => expect(serviceHost(host, 'bookinfo')).toBeNull()
  );
});
