import fixtureText from '../../test-files/parity/proxy-summary-oracle.json?raw';
import { IstioHost } from './hosts';
import {
  EnvoyClusterSummaryInput,
  proxyApplicationProtocol,
  proxyBestDomain,
  proxyClusterSummary,
  proxyConfigReference,
  proxyXdsStatus,
  readProxyClusterSummary,
} from './proxySummary';

type Input =
  | { operation: 'cluster'; cluster: EnvoyClusterSummaryInput; domain: string }
  | { operation: 'reference'; path: string }
  | { operation: 'protocol'; protocols: string[] }
  | { operation: 'domain'; domains: string[]; namespaces: string[]; domain: string }
  | { operation: 'xds'; sent: string; acked: string; subscribed: boolean };
const fixtures: { commit: string; cases: { input: Input; expected: unknown }[] } =
  JSON.parse(fixtureText);
const wireHost = (host: IstioHost) => ({
  service: host.service,
  namespace: host.namespace,
  cluster: host.identityDomain,
  complete_input: host.completeInput,
});
it('retains the pinned proxy-summary oracle', () => {
  expect(fixtures.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(fixtures.cases).toHaveLength(1063);
});
it.each(fixtures.cases)('matches original Go proxy helper %#', ({ input, expected }) => {
  let actual: unknown;
  switch (input.operation) {
    case 'cluster': {
      const summary = proxyClusterSummary(input.cluster, input.domain);
      actual = { ...summary, host: wireHost(summary.host) };
      break;
    }
    case 'reference':
      actual = proxyConfigReference(input.path);
      break;
    case 'protocol':
      actual = proxyApplicationProtocol(input.protocols);
      break;
    case 'domain':
      actual = wireHost(proxyBestDomain(input.domains, input.namespaces, input.domain));
      break;
    case 'xds':
      actual = proxyXdsStatus(input.sent, input.acked, input.subscribed);
      break;
  }
  expect(actual).toEqual(expected);
});
it('bounds cluster-name inputs and preserves decimal values outside JS safe integers', () => {
  expect(() => proxyClusterSummary({ name: 'a'.repeat(4097) }, '')).toThrow('4096');
  expect(proxyClusterSummary({ name: 'outbound|9007199254740993||reviews' }, '').port).toBe(
    '9007199254740993'
  );
});
it('decodes cluster observations while rejecting malformed known fields', () => {
  const raw = {
    name: 'outbound|9080|v1|reviews.bookinfo.svc.cluster.local',
    type: 'EDS',
    metadata: {
      filter_metadata: {
        istio: {
          config: '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews',
        },
      },
    },
    unknown_extension: { keep: true },
  };
  expect(readProxyClusterSummary(raw, 'svc.cluster.local')).toMatchObject({
    host: { service: 'reviews', namespace: 'bookinfo', identityDomain: 'svc.cluster.local' },
    port: '9080',
    subset: 'v1',
    direction: 'outbound',
    type: 'EDS',
    destinationRule: 'reviews.bookinfo',
  });
  expect(readProxyClusterSummary({}, '').port).toBe('0');
  for (const value of [
    null,
    [],
    { name: 7 },
    { type: false },
    { metadata: [] },
    { metadata: { filter_metadata: 'invalid' } },
  ])
    expect(() => readProxyClusterSummary(value, '')).toThrow('Malformed');
});
