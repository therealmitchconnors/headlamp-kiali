import oracleText from '../../test-files/parity/istio-gateway-conflict-oracle.json?raw';
import { istioGatewayConflictChecks, istioGatewayHostConflicts } from './istioGatewayConflicts';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { initialValidation } from './validation';
const oracle: {
  cases: {
    input: {
      records: Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[];
      skip: boolean;
    };
    expected: { paths: string[]; references: number[] }[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)('matches original Go Istio Gateway collisions %#', ({ input, expected }) => {
  input.records.forEach((_record, index) => {
    expect(istioGatewayHostConflicts(input.records, index, input.skip)).toEqual(expected[index]);
  });
});
const spec = {
  selector: { istio: 'ingress' },
  servers: [{ port: { number: 80 }, hosts: ['example.com'] }],
};
const record = (
  name: string,
  namespace: string,
  value: Record<string, unknown> = spec
): ValidationRecord => ({ name, namespace, uid: `${namespace}-${name}`, labels: {}, spec: value });
const owner = { name: 'selected', uid: 'bookinfo-selected' };
const context = (): ReferenceValidationContext => ({
  cluster: 'alpha',
  identityDomain: null,
  namespaces: { complete: false, items: [] },
  sidecars: { complete: false, items: [] },
  destinationRules: { complete: false, items: [] },
  istioGateways: {
    complete: true,
    items: [record('selected', 'bookinfo'), record('peer', 'other')],
  },
});
const check = (value = context(), target: Record<string, unknown> = spec) =>
  istioGatewayConflictChecks('Gateway', 'networking.istio.io', 'bookinfo', target, value, owner);
it('retains the networking group, exact path, references and exclusions', () => {
  expect(check()).toEqual({
    skipped: [],
    findings: [
      {
        code: 'KIA0301',
        severity: 'warning',
        path: 'spec/servers[0]/hosts[0]',
        message: 'More than one Gateway for the same host port combination',
        references: [
          {
            kind: 'Gateway',
            group: 'networking.istio.io',
            namespace: 'other',
            name: 'peer',
            uid: 'other-peer',
          },
        ],
      },
    ],
  });
  expect(
    initialValidation({
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind: 'Gateway',
      spec,
      workloads: [],
      complete: false,
      context: context(),
      owner,
      annotations: { 'kiali.io/ignore-validations': 'KIA0301' },
    }).suppressed
  ).toBe(1);
  expect(referenceValidationSources('Gateway', 'networking.istio.io', spec, null)).toEqual([
    'istioGateways',
  ]);
  expect(
    istioGatewayConflictChecks('Gateway', 'gateway.networking.k8s.io', 'bookinfo', spec)
  ).toEqual({ findings: [], skipped: [] });
});
it('ignores protocol and TLS without conflating different selectors or ports', () => {
  const value = context();
  value.istioGateways!.items[1].spec = {
    ...spec,
    servers: [
      { port: { number: 80, protocol: 'HTTPS' }, hosts: ['EXAMPLE.COM'], tls: { mode: 'SIMPLE' } },
    ],
  };
  expect(check(value).findings).toHaveLength(1);
  value.istioGateways!.items[1].spec = { ...spec, selector: { istio: 'another' } };
  expect(check(value).findings).toEqual([]);
});
it('skips only bare stars when enabled and retains the pinned subdomain matching', () => {
  const value = context();
  value.istioGateways!.items[1].spec = {
    ...spec,
    servers: [{ port: { number: 80 }, hosts: ['*'] }],
  };
  expect(check(value).findings).toHaveLength(1);
  value.skipWildcardGatewayHosts = true;
  expect(check(value).findings).toEqual([]);
  value.istioGateways!.items[1].spec = {
    ...spec,
    servers: [{ port: { number: 80 }, hosts: ['*.example.com'] }],
  };
  const target = { ...spec, servers: [{ port: { number: 80 }, hosts: ['api.example.com'] }] };
  value.istioGateways!.items[0].spec = target;
  expect(check(value, target).findings).toHaveLength(1);
});
it.each(['uid', 'selector', 'hosts', 'port', 'missing', 'duplicate', 'denied'])(
  'defers stale/incomplete %s evidence',
  mode => {
    const value = context();
    const records = [...value.istioGateways!.items];
    if (mode === 'uid') records[0] = { ...records[0], uid: 'replacement' };
    if (mode === 'selector') records[0] = { ...records[0], spec: { ...spec, selector: {} } };
    if (mode === 'hosts' || mode === 'port')
      records[0] = {
        ...records[0],
        spec: {
          ...spec,
          servers: [
            {
              port: { number: mode === 'port' ? 443 : 80 },
              hosts: mode === 'hosts' ? ['different'] : ['example.com'],
            },
          ],
        },
      };
    if (mode === 'missing') records.shift();
    if (mode === 'duplicate') records.push(records[0]);
    value.istioGateways = { complete: mode !== 'denied', items: records };
    expect(check(value).findings).toEqual([]);
    expect(check(value).skipped).toHaveLength(1);
  }
);
it('excludes generated gateways and does not fabricate a peer for self duplicates', () => {
  const value = context();
  value.istioGateways!.items[1].name = 'peer-autogenerated-k8s';
  expect(check(value).findings).toEqual([]);
  const target = {
    ...spec,
    servers: [{ port: { number: 80 }, hosts: ['example.com', 'example.com'] }],
  };
  value.istioGateways = { complete: true, items: [record('selected', 'bookinfo', target)] };
  expect(check(value, target).findings).toMatchObject([
    { path: 'spec/servers[0]/hosts[0]', references: [] },
  ]);
});
it.each(['a\n', 'é.example', '[', 'x'.repeat(1025)])(
  'reports unsupported or invalid pattern %s',
  host => {
    const target = {
      ...spec,
      servers: [{ port: { number: 80 }, hosts: [host, 'another.example'] }],
    };
    const value = context();
    value.istioGateways = { complete: true, items: [record('selected', 'bookinfo', target)] };
    expect(check(value, target).findings).toEqual([]);
    expect(check(value, target).skipped).toHaveLength(1);
  }
);
it('bounds host expansion and exactly counts the comparison budget', () => {
  const records = Array.from({ length: 201 }, (_, i) => record(`g${i}`, 'bookinfo'));
  expect(istioGatewayHostConflicts(records.slice(0, 200), 0).paths).toHaveLength(1);
  expect(() => istioGatewayHostConflicts(records, 0)).toThrow('20000 host comparisons');
  const many = Array.from({ length: 20 }, (_, i) => ({
    port: { number: i },
    hosts: Array(100).fill('example.com'),
  }));
  expect(() =>
    istioGatewayHostConflicts(
      [record('a', 'bookinfo', { servers: many }), record('b', 'bookinfo')],
      0
    )
  ).toThrow('2000 hosts');
  expect(() => istioGatewayHostConflicts(Array(1001).fill(records[0]), 0)).toThrow(
    'bounded records'
  );
});
