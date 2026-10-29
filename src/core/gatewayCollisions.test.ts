import oracleText from '../../test-files/parity/gateway-collision-oracle.json?raw';
import { gatewayCollisionChecks, gatewayNeedsCollisionContext } from './gatewayCollisions';
import {
  referenceValidation,
  ReferenceValidationContext,
  ValidationRecord,
} from './referenceValidation';
import { Finding } from './validation';

const oracle: {
  cases: {
    input: { gateways: ValidationRecord[] };
    expected: Finding[];
    references: [string, string][];
  }[];
} = JSON.parse(oracleText);
const owner = { name: 'selected', uid: 'selected-uid' };
const group = 'gateway.networking.k8s.io';
const listener = { name: 'http', hostname: 'example.com', port: 80, protocol: 'HTTP' };
const address = { type: 'IPAddress', value: '10.0.0.1' };
const selected = {
  ...owner,
  namespace: 'bookinfo',
  labels: {},
  spec: { listeners: [listener], addresses: [address] },
};
const peer = { ...selected, name: 'peer', uid: 'peer-uid', namespace: 'edge' };
const context = (items: ValidationRecord[]): ReferenceValidationContext => ({
  cluster: 'alpha',
  identityDomain: null,
  namespaces: { complete: false, items: [] },
  destinationRules: { complete: false, items: [] },
  sidecars: { complete: false, items: [] },
  gateways: { complete: true, items },
});
const normalized = (findings: Finding[]) =>
  findings
    .map(({ code, path, message, severity }) => ({ code, path, message, severity }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
it.each(oracle.cases)(
  'matches original Go Gateway collision pipeline %#',
  ({ input, expected, references }) => {
    const result = referenceValidation(
      'Gateway',
      group,
      'bookinfo',
      input.gateways[0].spec,
      context(input.gateways),
      owner
    );
    expect(normalized(result.findings)).toEqual(normalized(expected));
    const actual = [
      ...new Set(
        result.findings.flatMap(
          finding => finding.references?.map(ref => JSON.stringify([ref.namespace, ref.name])) ?? []
        )
      ),
    ].sort();
    expect(actual).toEqual(references.map(value => JSON.stringify(value)).sort());
  }
);
it('gates cross-object checks on captured UID and relevant fields, preserving source-specific unknowns', () => {
  for (const changed of [
    { ...selected, uid: 'replaced' },
    { ...selected, spec: { ...selected.spec, listeners: [{ ...listener, port: 81 }] } },
  ]) {
    const result = gatewayCollisionChecks(
      'Gateway',
      group,
      'bookinfo',
      selected.spec,
      context([changed, peer]),
      owner
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped[0]).toContain('changed');
  }
  const incomplete = context([selected, peer]);
  incomplete.gateways = { complete: false, items: [selected, peer] };
  expect(
    gatewayCollisionChecks('Gateway', group, 'bookinfo', selected.spec, incomplete, owner).findings
  ).toEqual([]);
  expect(
    gatewayNeedsCollisionContext('Gateway', group, {
      listeners: [{ ...listener, hostname: null }],
      addresses: [{ value: address.value }],
    })
  ).toBe(false);
  expect(gatewayNeedsCollisionContext('Gateway', 'networking.istio.io', selected.spec)).toBe(false);
});
it('returns group-safe observed peer identities and collapses duplicate address findings', () => {
  const duplicate = { ...selected, spec: { ...selected.spec, addresses: [address, address] } };
  const result = gatewayCollisionChecks(
    'Gateway',
    group,
    'bookinfo',
    duplicate.spec,
    context([duplicate, peer]),
    owner
  );
  expect(result.findings.map(finding => finding.code)).toEqual(['KIA1502', 'KIA1501']);
  expect(result.findings[0].references).toEqual([
    { kind: 'Gateway', group, namespace: 'edge', name: 'peer', uid: 'peer-uid' },
  ]);
});
it('bounds malformed lists, duplicate identity and total entries without partial conflict conclusions', () => {
  const bad = { ...peer, spec: { listeners: [null] } };
  expect(
    gatewayCollisionChecks(
      'Gateway',
      group,
      'bookinfo',
      selected.spec,
      context([selected, bad]),
      owner
    ).skipped[0]
  ).toContain('Malformed');
  expect(
    gatewayCollisionChecks(
      'Gateway',
      group,
      'bookinfo',
      selected.spec,
      context([selected, peer, peer]),
      owner
    ).skipped[0]
  ).toContain('duplicate');
  for (const spec of [
    { listeners: Array.from({ length: 65 }, () => listener) },
    { addresses: Array.from({ length: 17 }, () => address) },
  ])
    expect(
      gatewayCollisionChecks('Gateway', group, 'bookinfo', spec, context([]), owner).skipped[0]
    ).toContain('64 listeners and 16 addresses');
  const records = Array.from({ length: 1000 }, (_, i) => ({
    ...peer,
    name: `peer-${i}`,
    uid: `uid-${i}`,
    spec: { listeners: Array.from({ length: 20 }, () => listener) },
  }));
  records[0] = {
    ...records[0],
    name: selected.name,
    uid: selected.uid,
    namespace: selected.namespace,
  };
  expect(
    gatewayCollisionChecks('Gateway', group, 'bookinfo', records[0].spec, context(records), owner)
      .findings
  ).toHaveLength(20);
  records[999].spec.listeners.push(listener);
  const result = gatewayCollisionChecks(
    'Gateway',
    group,
    'bookinfo',
    records[0].spec,
    context(records),
    owner
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toContain('20000');
});
