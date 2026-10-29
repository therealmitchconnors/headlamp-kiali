import oracleText from '../../test-files/parity/peer-authentication-oracle.json?raw';
import {
  peerAuthenticationChecks,
  peerAuthenticationNeedsContext,
} from './peerAuthenticationValidation';
import { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import { Finding, initialValidation } from './validation';

const group = 'security.istio.io';
const strict = { mtls: { mode: 'STRICT' } };
const disabled = { mtls: { mode: 'DISABLE' } };
const rule = (host = '*.local', mode = 'ISTIO_MUTUAL'): ValidationRecord => ({
  name: 'rule',
  namespace: 'istio-system',
  uid: 'rule-uid',
  labels: {},
  spec: { host, exportTo: ['*'], trafficPolicy: { tls: { mode } } },
});
function context(auto = false): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: 'svc.cluster.local',
    namespaces: {
      complete: true,
      items: ['bookinfo', 'istio-system'].map(name => ({
        name,
        namespace: '',
        labels: {},
        spec: {},
      })),
    },
    destinationRules: { complete: true, items: [] },
    sidecars: { complete: false, items: [] },
    namespaceMesh: new Map(
      ['bookinfo', 'istio-system'].map(name => [
        name,
        {
          status: 'ready',
          controller: 'istio-system/istiod',
          fields: {
            rootNamespace: 'istio-system',
            hasDiscoverySelectors: false,
            enableAutoMtls: auto,
          },
        },
      ])
    ),
  };
}
const oracle: {
  cases: {
    input: {
      namespace: string;
      root: string;
      domain: string;
      autoMtls: boolean;
      spec: Record<string, unknown>;
      rules: { namespace: string; spec: Record<string, unknown> }[];
    };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original-Go scope, selector presence and policy order %#',
  ({ input, expected }) => {
    const current = context(input.autoMtls);
    current.identityDomain = input.domain;
    current.destinationRules = {
      complete: true,
      items: input.rules.map((entry, i) => ({
        name: `rule-${i}`,
        uid: `uid-${i}`,
        labels: {},
        namespace: entry.namespace,
        spec: { ...entry.spec, exportTo: ['*'] },
      })),
    };
    const result = peerAuthenticationChecks(
      'PeerAuthentication',
      group,
      input.namespace,
      input.spec,
      current
    );
    expect(result.skipped).toEqual([]);
    expect(
      result.findings.map(({ code, message, severity, path }) => ({
        code,
        message,
        severity,
        path,
      }))
    ).toEqual(expected);
  }
);
it('uses automatic mTLS defaults only after namespace configuration is resolved', () => {
  const current = context();
  current.namespaceMesh = new Map([
    [
      'bookinfo',
      {
        status: 'ready',
        controller: 'root/istiod',
        fields: { hasDiscoverySelectors: false },
      },
    ],
  ]);
  current.destinationRules.complete = false;
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current)
  ).toEqual({ findings: [], skipped: [] });
  current.namespaceMesh = undefined;
  const result = peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/resolved namespace/);
});
it('uses a separately resolved controller-namespace fallback without overwriting raw fields', () => {
  const current = context();
  current.namespaceMesh = new Map([
    [
      'istio-system',
      {
        status: 'ready',
        controller: 'istio-system/istiod',
        root: { namespace: 'istio-system', basis: 'controller-namespace' },
        fields: { hasDiscoverySelectors: false, enableAutoMtls: false },
      },
    ],
  ]);
  current.identityDomain = null;
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'istio-system', strict, current)
      .findings[0].code
  ).toBe('KIA0401');
  expect(current.namespaceMesh.get('istio-system')?.status).toBe('ready');
});
it('distinguishes namespace DNS requirements from mesh-wide patterns', () => {
  const current = context();
  current.identityDomain = null;
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current).skipped[0]
  ).toMatch(/DNS identity/);
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'istio-system', strict, current)
      .findings[0].code
  ).toBe('KIA0401');
});
it.each([{}, { matchLabels: {} }, { matchLabels: { app: 'reviews' } }])(
  'does not broaden a present selector into a namespace-wide checker %#',
  selector => {
    const spec = { ...strict, selector };
    expect(peerAuthenticationNeedsContext('PeerAuthentication', group, spec)).toBe(false);
    expect(peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', spec)).toEqual({
      findings: [],
      skipped: [],
    });
  }
);
it.each([
  { selector: false },
  { selector: { matchExpressions: [] } },
  { selector: { matchLabels: { 'bad key': 'x' } } },
  { mtls: false },
  { mtls: { mode: 'unknown' } },
])('reports malformed policy inputs %#', input => {
  const result = peerAuthenticationChecks(
    'PeerAuthentication',
    group,
    'bookinfo',
    { ...strict, ...input },
    context()
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped).toHaveLength(1);
});
it('requires complete policy sources and does not apply Sidecar imports', () => {
  const current = context();
  current.destinationRules = { complete: false, items: [] };
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current).skipped[0]
  ).toMatch(/complete/);
  current.destinationRules = { complete: true, items: [rule()] };
  current.sidecars = {
    complete: true,
    items: [
      {
        name: 'exclude',
        namespace: 'bookinfo',
        uid: 'sidecar',
        labels: {},
        spec: { egress: [{ hosts: ['~/*'] }] },
      },
    ],
  };
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current)
  ).toEqual({ findings: [], skipped: [] });
});
it('respects exported rules and defers unresolved relevant defaults rather than claiming absence', () => {
  const current = context();
  current.destinationRules = {
    complete: true,
    items: [{ ...rule(), spec: { ...rule().spec, exportTo: ['.'] } }],
  };
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current).findings[0]
      .code
  ).toBe('KIA0501');
  current.destinationRules.items[0].spec.exportTo = [];
  current.namespaceMesh = new Map([
    [
      'bookinfo',
      {
        status: 'ready',
        controller: 'istio-system/istiod',
        fields: {
          hasDiscoverySelectors: false,
          rootNamespace: 'istio-system',
          enableAutoMtls: false,
        },
      },
    ],
  ]);
  const result = peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/export defaults/);
});
it('links the observed conflicting DestinationRule with its UID', () => {
  const current = context();
  current.destinationRules.items = [rule()];
  const finding = peerAuthenticationChecks(
    'PeerAuthentication',
    group,
    'bookinfo',
    disabled,
    current
  ).findings[0];
  expect(finding.code).toBe('KIA0505');
  expect(finding.references).toEqual([
    {
      kind: 'DestinationRule',
      group: 'networking.istio.io',
      namespace: 'istio-system',
      name: 'rule',
      uid: 'rule-uid',
    },
  ]);
});
it('integrates exclusions without treating missing workload evidence as complete', () => {
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'PeerAuthentication',
    group,
    spec: strict,
    context: context(),
    workloads: [],
    complete: false,
    annotations: { 'kiali.io/ignore-validations': 'KIA0501' },
  });
  expect(result.findings).toEqual([]);
  expect(result.suppressed).toBe(1);
  expect(result.coverage).toBe('partial');
});

it('enforces policy record bounds and leaves unrelated unknown defaults out of these patterns', () => {
  const current = context();
  current.namespaceMesh = new Map([
    [
      'bookinfo',
      {
        status: 'ready',
        controller: 'istio-system/istiod',
        fields: {
          rootNamespace: 'istio-system',
          enableAutoMtls: false,
          hasDiscoverySelectors: false,
        },
      },
    ],
  ]);
  current.destinationRules.items = Array.from({ length: 1000 }, (_, i) => ({
    ...rule('reviews.bookinfo.svc.cluster.local'),
    name: `rule-${i}`,
    uid: `uid-${i}`,
    spec: { host: 'reviews.bookinfo.svc.cluster.local' },
  }));
  expect(
    peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current).findings[0]
      .code
  ).toBe('KIA0501');
  current.destinationRules.items = [
    ...current.destinationRules.items,
    { ...rule(), name: 'overflow', uid: 'overflow' },
  ];
  const result = peerAuthenticationChecks('PeerAuthentication', group, 'bookinfo', strict, current);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/1000 records/);
});
