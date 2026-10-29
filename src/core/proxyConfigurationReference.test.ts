import { ProxyConfigurationKind, proxyConfigurationTarget } from './proxyConfigurationReference';
import { proxyRouteDetails } from './proxyDetails';
import { readProxyMetadataPath } from './proxySummary';

const path = '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews.v1';
it.each([
  ['DestinationRule', 'destinationrules'],
  ['VirtualService', 'virtualservices'],
] as const)(
  'retains explicit namespace and dotted names for %s without DNS inference',
  (kind, plural) => {
    expect(
      proxyConfigurationTarget({ kind, path: path.replace('destinationrules', plural) })
    ).toEqual({
      available: true,
      kind,
      namespace: 'bookinfo',
      name: 'reviews.v1',
      observedApiVersion: 'networking.istio.io/v1',
    });
  }
);
it.each([
  ['', 'absent'],
  [path.replace('/v1/', '/v1alpha3/'), 'format'],
  [path.replace('networking.istio.io', 'security.istio.io'), 'format'],
  [`https://example.test${path}`, 'format'],
  [`/${path}`, 'format'],
  [`${path}/extra`, 'format'],
  [path.replace('destinationrules', 'virtualservices'), 'kind'],
  [path.replace('destinationrules', 'secrets'), 'kind'],
  [path.replace('bookinfo', 'bad.namespace'), 'identity'],
  [`${path}?query=x`, 'identity'],
  [`${path}#fragment`, 'identity'],
  [`${path}\n`, 'identity'],
  [path.replace('reviews.v1', '%2fsecret'), 'identity'],
  [path.replace('reviews.v1', '..'), 'identity'],
] as const)('does not request noncanonical metadata %j', (value, reason) => {
  expect(proxyConfigurationTarget({ kind: 'DestinationRule', path: value })).toEqual({
    available: false,
    reason,
  });
});
it('rejects invalid kinds and oversized raw metadata, while keeping legacy reference display', () => {
  const query: { kind: ProxyConfigurationKind; path: string } = { kind: 'DestinationRule', path };
  Object.assign(query, { kind: 'Secret' });
  expect(() => proxyConfigurationTarget(query)).toThrow('Unsupported');
  expect(() =>
    proxyConfigurationTarget({ kind: 'DestinationRule', path: 'x'.repeat(4097) })
  ).toThrow('4096');
  expect(readProxyMetadataPath({ filter_metadata: { istio: { config: path } } })).toBe(path);
  expect(readProxyMetadataPath(undefined)).toBe('');
  const referencePath = path.replace('destinationrules', 'virtualservices');
  const routes = proxyRouteDetails({
    virtual_hosts: [
      {
        routes: [
          {
            direct_response: { status: 503 },
            metadata: { filter_metadata: { istio: { config: referencePath } } },
          },
        ],
      },
    ],
  });
  expect(routes[0]).toMatchObject({
    reference: 'reviews.v1.bookinfo',
    referencePath,
    action: 'direct-response',
  });
});
