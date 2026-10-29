import oracleText from '../../test-files/parity/destination-peer-policy-oracle.json?raw';
import {
  destinationRuleNeedsPeerPolicies,
  destinationRulePolicyChecks,
} from './destinationRulePolicyValidation';
import { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import { Finding, initialValidation } from './validation';

const group = 'networking.istio.io';
const namespace = 'bookinfo';
const owner = { name: 'selected', uid: 'selected-uid' };
const spec = (host = '*.local', mode = 'DISABLE') => ({ host, trafficPolicy: { tls: { mode } } });
function context(specification: Record<string, unknown>, auto = false): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: 'svc.cluster.local',
    namespaces: {
      complete: true,
      items: ['istio-system', 'bookinfo'].map(name => ({
        name,
        namespace: '',
        labels: {},
        spec: {},
      })),
    },
    destinationRules: {
      complete: true,
      items: [{ ...owner, namespace, labels: {}, spec: specification }],
    },
    sidecars: { complete: false, items: [] },
    peerAuthentications: { complete: true, items: [] },
    namespaceMesh: new Map(
      ['bookinfo', 'istio-system'].map(name => [
        name,
        {
          status: 'ready',
          controller: 'istio-system/istiod',
          fields: {
            rootNamespace: 'istio-system',
            enableAutoMtls: auto,
            hasDiscoverySelectors: false,
          },
        },
      ])
    ),
  };
}
const peer = (ns = 'istio-system', mode = 'STRICT'): ValidationRecord => ({
  name: 'peer',
  namespace: ns,
  uid: 'peer-uid',
  labels: {},
  spec: { mtls: { mode } },
});
const oracle: {
  cases: {
    input: {
      namespace: string;
      root: string;
      domain: string;
      autoMtls: boolean;
      spec: Record<string, unknown>;
      peers: { namespace: string; spec: Record<string, unknown> }[];
    };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original-Go filtering, scope, modes and policy order %#',
  ({ input, expected }) => {
    const specification = { ...input.spec, exportTo: ['*'] };
    const current = context(specification, input.autoMtls);
    current.identityDomain = input.domain;
    current.destinationRules.items = [
      { ...owner, namespace: input.namespace, labels: {}, spec: specification },
    ];
    current.peerAuthentications = {
      complete: true,
      items: input.peers.map((value, i) => ({
        name: `peer-${i}`,
        uid: `uid-${i}`,
        labels: {},
        ...value,
      })),
    };
    const result = destinationRulePolicyChecks(
      'DestinationRule',
      group,
      input.namespace,
      specification,
      current,
      owner
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
it('does not request policies for service-specific or non-applicable TLS modes', () => {
  for (const input of [
    spec('reviews'),
    spec('*.local', 'MUTUAL'),
    spec('*.local', 'SIMPLE'),
    { host: '*.local' },
  ]) {
    expect(
      destinationRuleNeedsPeerPolicies(
        'DestinationRule',
        group,
        namespace,
        input,
        'svc.cluster.local'
      )
    ).toBe(false);
    expect(destinationRulePolicyChecks('DestinationRule', group, namespace, input)).toEqual({
      findings: [],
      skipped: [],
    });
  }
});
it('distinguishes namespace DNS evidence from the legacy mesh-wide host', () => {
  const mesh = spec();
  const current = context(mesh);
  current.identityDomain = null;
  current.peerAuthentications = { complete: true, items: [peer()] };
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, mesh, current, owner)
      .findings[0].code
  ).toBe('KIA0208');
  const scoped = spec('*.bookinfo.svc.cluster.local');
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, scoped, current, owner)
      .skipped[0]
  ).toMatch(/DNS identity/);
});
it('requires resolved configuration before applying the automatic-mTLS shortcut', () => {
  const input = spec('*.local', 'ISTIO_MUTUAL');
  const current = context(input, true);
  current.peerAuthentications = { complete: false, items: [] };
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, input, current, owner)
  ).toEqual({ findings: [], skipped: [] });
  current.namespaceMesh = undefined;
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, input, current, owner)
      .skipped[0]
  ).toMatch(/resolved namespace/);
});
it.each(['namespaces', 'destinationRules', 'peerAuthentications'] as const)(
  'does not infer absence from incomplete %s',
  key => {
    const input = spec('*.local', 'ISTIO_MUTUAL');
    const current = context(input);
    current[key] = { complete: false, items: [] };
    const result = destinationRulePolicyChecks(
      'DestinationRule',
      group,
      namespace,
      input,
      current,
      owner
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped[0]).toMatch(/complete/);
  }
);
it('requires selected identity/settings freshness and preserves private export scope', () => {
  const input = spec('*.local', 'ISTIO_MUTUAL');
  const current = context(input);
  current.destinationRules.items[0].uid = 'replacement';
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, input, current, owner)
      .skipped[0]
  ).toMatch(/changed/);
  current.destinationRules.items[0].uid = owner.uid;
  current.destinationRules.items[0].spec = spec('*.local', 'DISABLE');
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, input, current, owner)
      .skipped[0]
  ).toMatch(/changed/);
  const privateInput = { ...input, exportTo: ['istio-system'] };
  current.destinationRules.items[0].spec = privateInput;
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, privateInput, current, owner)
      .skipped[0]
  ).toMatch(/not exported/);
});
it('does not import-filter individual policy checks and links observed peers', () => {
  const input = spec();
  const current = context(input);
  current.peerAuthentications = { complete: true, items: [peer()] };
  current.sidecars = {
    complete: true,
    items: [
      {
        name: 'exclude',
        namespace,
        uid: 'sidecar',
        labels: {},
        spec: { egress: [{ hosts: ['~/*'] }] },
      },
    ],
  };
  const result = destinationRulePolicyChecks(
    'DestinationRule',
    group,
    namespace,
    input,
    current,
    owner
  );
  expect(result.findings[0].references).toEqual([
    {
      kind: 'PeerAuthentication',
      group: 'security.istio.io',
      namespace: 'istio-system',
      name: 'peer',
      uid: 'peer-uid',
    },
  ]);
});
it('bounds global peer evidence before selecting local/root policies', () => {
  const input = spec('*.local', 'ISTIO_MUTUAL');
  const current = context(input);
  current.peerAuthentications = {
    complete: true,
    items: Array.from({ length: 1000 }, (_, i) => ({
      ...peer('unrelated'),
      name: `peer-${i}`,
      uid: `uid-${i}`,
    })),
  };
  expect(
    destinationRulePolicyChecks('DestinationRule', group, namespace, input, current, owner)
      .findings[0].code
  ).toBe('KIA0205');
  current.peerAuthentications.items = [...current.peerAuthentications.items, peer()];
  const result = destinationRulePolicyChecks(
    'DestinationRule',
    group,
    namespace,
    input,
    current,
    owner
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/1000 records/);
});

it('honors policy finding exclusions without upgrading coverage', () => {
  const input = spec();
  const current = context(input);
  current.sidecars = { complete: true, items: [] };
  current.peerAuthentications = { complete: true, items: [peer()] };
  const result = initialValidation({
    cluster: 'alpha',
    namespace,
    kind: 'DestinationRule',
    group,
    spec: input,
    owner,
    annotations: { 'kiali.io/ignore-validations': 'KIA0208' },
    workloads: [],
    complete: false,
    context: current,
  });
  expect(result.findings).toEqual([]);
  expect(result.suppressed).toBe(1);
  expect(result.coverage).toBe('partial');
});
