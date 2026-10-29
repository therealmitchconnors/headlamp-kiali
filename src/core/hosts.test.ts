import oracleText from '../../test-files/parity/host-oracle.json?raw';
import {
  filterByHost,
  getHost,
  hostIsWildcard,
  hostString,
  hostWithinWildcardHost,
  normalizeHost,
  parseGatewayAsHost,
  parseHost,
  parseTwoPartHost,
} from './hosts';

interface HostCase {
  input: {
    operation: string;
    host: string;
    namespace: string;
    domain: string;
    namespaces: string[];
    service: string;
    serviceNamespace: string;
    wildcard: string;
  };
  expected: unknown;
}
const oracle: { commit: string; cases: HostCase[] } = JSON.parse(oracleText);
it('uses the pinned independently executed host functions', () => {
  expect(oracle.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(oracle.cases.length).toBeGreaterThan(500);
});
it.each(oracle.cases)('matches original Go host case %#', ({ input: i, expected }) => {
  let actual: unknown;
  switch (i.operation) {
    case 'normalize':
      actual = normalizeHost(i.host, i.namespace);
      break;
    case 'filter':
      actual = filterByHost(i.host, i.namespace, i.service, i.serviceNamespace, i.domain);
      break;
    case 'wildcard':
      actual = hostWithinWildcardHost(i.host, i.wildcard);
      break;
    default: {
      const host =
        i.operation === 'parse'
          ? parseHost(i.host, i.namespace, i.domain)
          : i.operation === 'get'
          ? getHost(i.host, i.namespace, i.namespaces, i.domain)
          : parseGatewayAsHost(i.host, i.namespace, i.domain);
      actual = {
        host: {
          service: host.service,
          namespace: host.namespace,
          cluster: host.identityDomain,
          complete_input: host.completeInput,
        },
        string: hostString(host),
        wildcard: hostIsWildcard(host),
        twoPart: parseTwoPartHost(host),
      };
    }
  }
  expect(actual).toEqual(expected);
});

it('never confuses a namespace suffix with a wildcard DNS label boundary', () => {
  expect(
    hostWithinWildcardHost(
      'reviews.istio-bookinfo.svc.cluster.local',
      '*.bookinfo.svc.cluster.local'
    )
  ).toBe(false);
  expect(
    hostWithinWildcardHost('reviews.bookinfo.svc.cluster.local', '*.bookinfo.svc.cluster.local')
  ).toBe(true);
});
