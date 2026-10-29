import oracleText from '../../test-files/parity/mtls-oracle.json?raw';
import {
  assessNamespaceTls,
  configuredTlsStatus,
  meshTlsStatus,
  MtlsPolicyInput,
  namespaceTlsStatus,
  overallTlsStatus,
  workloadTlsStatus,
} from './mtls';

const oracle: {
  commit: string;
  cases: {
    input: {
      operation: string;
      autoMtlsEnabled: boolean;
      allowPermissive: boolean;
      dr: string;
      pa: string;
      namespace: { dr: string; pa: string };
      mesh: { dr: string; pa: string };
    };
    expected: unknown;
  }[];
} = JSON.parse(oracleText);
it('uses independent pinned Go configuration status outputs', () => {
  expect(oracle.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(oracle.cases).toHaveLength(2600);
});
it.each(oracle.cases)(
  'matches original Go configured mTLS composition %#',
  ({ input: i, expected }) => {
    const result =
      i.operation === 'final'
        ? configuredTlsStatus(i.dr, i.pa, i)
        : overallTlsStatus(
            configuredTlsStatus(i.namespace.dr, i.namespace.pa, i),
            configuredTlsStatus(i.mesh.dr, i.mesh.pa, i),
            i
          );
    expect(result).toEqual(expected);
  }
);
const base: MtlsPolicyInput = {
  autoMtlsEnabled: true,
  allowPermissive: false,
  peerAuthentications: [],
  destinationRules: [],
};
it('preserves explicit selector presence and the pinned namespace/mesh wildcard patterns', () => {
  const input: MtlsPolicyInput = {
    ...base,
    peerAuthentications: [{ name: 'strict', namespace: 'bookinfo', mode: 'STRICT' }],
    destinationRules: [
      { name: 'tls', namespace: 'bookinfo', host: '*.bookinfo.svc.custom', mode: 'ISTIO_MUTUAL' },
    ],
  };
  expect(namespaceTlsStatus('bookinfo', 'svc.custom', input).overallStatus).toBe('MTLS_ENABLED');
  expect(
    namespaceTlsStatus('bookinfo', 'svc.custom', {
      ...input,
      peerAuthentications: [{ ...input.peerAuthentications[0], selector: {} }],
    }).peerAuthenticationStatus
  ).toBe('');
  expect(
    meshTlsStatus({
      ...base,
      destinationRules: [
        { name: 'tls', namespace: 'istio-system', host: '*.local', mode: 'ISTIO_MUTUAL' },
      ],
    }).overallStatus
  ).toBe('MTLS_ENABLED');
  expect(
    meshTlsStatus({
      ...base,
      destinationRules: [
        { name: 'tls', namespace: 'istio-system', host: '*', mode: 'ISTIO_MUTUAL' },
      ],
    }).overallStatus
  ).toBe('MTLS_NOT_ENABLED');
});

it('treats an explicit empty selector as namespace-wide in the conservative consumer', () => {
  const result = assessNamespaceTls('bookinfo', 'istio-system', 'svc.cluster.local', {
    ...base,
    peerAuthentications: [{ name: 'strict', namespace: 'bookinfo', mode: 'STRICT', selector: {} }],
  });
  expect(result.namespace.peerAuthenticationStatus).toBe('STRICT');
  expect(result.status).toBe('MTLS_ENABLED');
  expect(
    assessNamespaceTls('bookinfo', 'istio-system', 'svc.cluster.local', {
      ...base,
      peerAuthentications: [{ name: 'mesh', namespace: 'istio-system', mode: 'STRICT' }],
    }).status
  ).toBe('UNSET_INHERITED_STRICT');
});

it('refuses arbitrary first-match results when namespace policies or wildcard rules conflict', () => {
  expect(() =>
    assessNamespaceTls('bookinfo', 'istio-system', 'svc.cluster.local', {
      ...base,
      peerAuthentications: [
        { name: 'a', namespace: 'bookinfo', mode: 'STRICT' },
        { name: 'b', namespace: 'bookinfo', mode: 'DISABLE' },
      ],
    })
  ).toThrow('Multiple');
  expect(() =>
    assessNamespaceTls('bookinfo', 'istio-system', 'svc.cluster.local', {
      ...base,
      destinationRules: [
        { name: 'a', namespace: 'bookinfo', host: '*.local', mode: 'DISABLE' },
        { name: 'b', namespace: 'other', host: '*.local', mode: 'MUTUAL' },
      ],
    })
  ).toThrow('Multiple');
});
it('matches workload selectors and associated Services without treating empty selectors as universal', () => {
  const input = {
    ...base,
    matchingLabels: { app: 'reviews' },
    services: [{ name: 'reviews', namespace: 'bookinfo', selector: { app: 'reviews' } }],
    peerAuthentications: [
      {
        name: 'pa',
        namespace: 'bookinfo',
        selector: { app: 'reviews' },
        mode: 'PERMISSIVE' as const,
      },
    ],
    destinationRules: [
      { name: 'dr', namespace: 'bookinfo', host: 'reviews', mode: 'MUTUAL' as const },
    ],
  };
  expect(workloadTlsStatus('bookinfo', 'svc.cluster.local', input)).toBe('MTLS_ENABLED');
  expect(
    workloadTlsStatus('bookinfo', 'svc.cluster.local', {
      ...input,
      services: [{ ...input.services[0], selector: {} }],
    })
  ).toBe('MTLS_NOT_ENABLED');
  expect(
    workloadTlsStatus('bookinfo', 'svc.cluster.local', {
      ...input,
      matchingLabels: { app: 'other' },
    })
  ).toBe('MTLS_NOT_ENABLED');
});
