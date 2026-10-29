import oracleText from '../../test-files/parity/service-entry-oracle.json?raw';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { serviceEntryChecks, serviceEntryCollisions } from './serviceEntryValidation';
import { initialValidation } from './validation';

const record = (
  name: string,
  namespace = 'bookinfo',
  spec: Record<string, unknown> = {}
): ValidationRecord => ({ name, namespace, uid: `${namespace}-${name}`, labels: {}, spec });
const spec = {
  hosts: ['api.example.test'],
  ports: [{ number: 80, protocol: 'HTTP' }],
  exportTo: ['*'],
};
const owner = { name: 'selected', uid: 'bookinfo-selected' };
const context = (): ReferenceValidationContext => ({
  cluster: 'alpha',
  identityDomain: null,
  namespaces: { complete: true, items: [record('bookinfo', ''), record('other', '')] },
  sidecars: { complete: true, items: [] },
  destinationRules: { complete: false, items: [] },
  serviceEntries: {
    complete: true,
    items: [record('selected', 'bookinfo', spec), record('peer', 'other', spec)],
  },
});
const check = (value = context(), selected: Record<string, unknown> = spec) =>
  serviceEntryChecks('ServiceEntry', 'networking.istio.io', 'bookinfo', selected, value, owner);
const fixture: {
  cases: {
    input: { records: Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[] };
    expected: unknown;
  }[];
} = JSON.parse(oracleText);
const compare = (a: unknown, b: unknown) =>
  JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
it.each(fixture.cases)('matches original Go host/port grouping %#', ({ input, expected }) => {
  const actual = serviceEntryCollisions(input.records)
    .map(group => ({
      checkID:
        group.code === 'KIA1212'
          ? 'serviceentries.port.protocol.conflict'
          : 'serviceentries.multimatch',
      members: group.members
        .map(member => ({
          Name: member.name,
          Namespace: member.namespace,
          PortIndex: member.portIndex,
          Protocol: member.protocol,
        }))
        .sort(compare),
    }))
    .sort(compare);
  expect(actual).toEqual(expected);
});
it('retains the active warning codes, exact paths, related namespace/UID identities and suppression', () => {
  expect(check()).toEqual({
    skipped: [],
    findings: [
      {
        code: 'KIA1211',
        severity: 'warning',
        path: 'spec/ports[0]',
        message: 'More than one ServiceEntry for the same host and port',
        references: [
          {
            kind: 'ServiceEntry',
            group: 'networking.istio.io',
            name: 'peer',
            namespace: 'other',
            uid: 'other-peer',
          },
        ],
      },
    ],
  });
  const changed = context();
  changed.serviceEntries = {
    complete: true,
    items: [
      record('selected', 'bookinfo', spec),
      record('peer', 'other', { ...spec, ports: [{ number: 80, protocol: 'TCP' }] }),
    ],
  };
  expect(check(changed).findings[0]).toMatchObject({ code: 'KIA1212', severity: 'warning' });
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'ServiceEntry',
    spec,
    owner,
    context: changed,
    annotations: { 'kiali.io/ignore-validations': 'KIA1212' },
    workloads: [],
    complete: false,
  });
  expect(result.findings).toEqual([]);
  expect(result.suppressed).toBe(1);
});
it('checks only namespace-exported and Sidecar-imported entries, retaining whole imported objects', () => {
  const scoped = context();
  scoped.serviceEntries = {
    complete: true,
    items: [
      record('selected', 'bookinfo', spec),
      record('peer', 'other', { ...spec, exportTo: ['.'] }),
    ],
  };
  expect(check(scoped).findings).toEqual([]);
  scoped.serviceEntries = context().serviceEntries;
  scoped.identityDomain = 'svc.cluster.local';
  scoped.sidecars = {
    complete: true,
    items: [record('scope', 'bookinfo', { egress: [{ hosts: ['other/*'] }] })],
  };
  expect(check(scoped).skipped[0]).toContain('not exported and imported');
  scoped.sidecars = {
    complete: true,
    items: [
      record('scope', 'bookinfo', {
        egress: [{ hosts: ['*/allowed-a.example.test', '*/allowed-b.example.test'] }],
      }),
    ],
  };
  const multipleHosts = { ...spec, hosts: ['allowed-a.example.test', 'blocked.example.test'] };
  scoped.serviceEntries = {
    complete: true,
    items: [
      record('selected', 'bookinfo', multipleHosts),
      record('peer', 'other', {
        ...spec,
        hosts: ['allowed-b.example.test', 'blocked.example.test'],
      }),
    ],
  };
  const result = check(scoped, multipleHosts);
  expect(result.skipped).toEqual([]);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0].references).toHaveLength(1);
});
it('uses per-source mesh export defaults and ambient namespace semantics without guessing', () => {
  const value = context();
  const withoutExports = { hosts: spec.hosts, ports: spec.ports };
  value.serviceEntries = {
    complete: true,
    items: [record('selected', 'bookinfo', spec), record('peer', 'other', withoutExports)],
  };
  expect(check(value).skipped[0]).toContain('export defaults are unresolved');
  value.namespaceMesh = new Map([
    [
      'other',
      {
        status: 'ready',
        controller: 'istiod',
        fields: { hasDiscoverySelectors: false, defaultServiceExportTo: ['.'] },
      },
    ],
  ]);
  expect(check(value).findings).toEqual([]);
  value.namespaceMesh = new Map([
    [
      'other',
      {
        status: 'ready',
        controller: 'istiod',
        fields: { hasDiscoverySelectors: false, defaultServiceExportTo: ['*'] },
      },
    ],
  ]);
  expect(check(value).findings[0].code).toBe('KIA1211');
  value.namespaceMesh = new Map([
    [
      'other',
      {
        status: 'ready',
        controller: 'other/istiod',
        discovery: 'implicit',
        fields: {
          rootNamespace: 'other',
          hasDiscoverySelectors: true,
          discoverySelectors: [{ matchLabels: { team: 'other' } }],
          defaultServiceExportTo: ['*'],
        },
      },
    ],
  ]);
  expect(check(value).findings[0].code).toBe('KIA1211');
  value.namespaces.items = [
    record('bookinfo', ''),
    { ...record('other', ''), labels: { 'istio.io/dataplane-mode': 'ambient' } },
  ];
  expect(check(value).findings).toEqual([]);
  value.namespaces.items = [
    { ...record('bookinfo', ''), labels: { 'istio.io/dataplane-mode': 'ambient' } },
    record('other', ''),
  ];
  value.sidecars = {
    complete: true,
    items: [record('ignored', 'bookinfo', { egress: [{ hosts: ['~/ignored'] }] })],
  };
  expect(check(value).findings[0].code).toBe('KIA1211');
});
it.each([
  'partial-entries',
  'partial-namespaces',
  'partial-sidecars',
  'uid',
  'spec',
  'duplicate',
  'missing-namespace',
  'domain',
  'root',
  'bad-host',
  'bad-number',
])('defers %s evidence without emitting conflict findings', reason => {
  const value = context();
  if (reason === 'partial-entries') value.serviceEntries!.complete = false;
  if (reason === 'partial-namespaces') value.namespaces.complete = false;
  if (reason === 'partial-sidecars') value.sidecars.complete = false;
  if (reason === 'uid') value.serviceEntries!.items[0].uid = 'replaced';
  if (reason === 'spec')
    value.serviceEntries!.items[0].spec = { ...spec, ports: [{ number: 81, protocol: 'HTTP' }] };
  if (reason === 'duplicate')
    value.serviceEntries = {
      complete: true,
      items: [record('selected', 'bookinfo', spec), record('selected', 'bookinfo', spec)],
    };
  if (reason === 'missing-namespace') value.namespaces.items = [record('bookinfo', '')];
  if (reason === 'domain')
    value.sidecars = {
      complete: true,
      items: [record('local', 'bookinfo', { egress: [{ hosts: ['*/*'] }] })],
    };
  if (reason === 'root')
    value.sidecars = {
      complete: true,
      items: [record('remote', 'other', { egress: [{ hosts: ['*/*'] }] })],
    };
  if (reason === 'bad-host')
    value.serviceEntries!.items[1].spec = { ...spec, hosts: ['\u0130.example.test'] };
  if (reason === 'bad-number')
    value.serviceEntries!.items[1].spec = { ...spec, ports: [{ number: -1, protocol: 'HTTP' }] };
  const result = check(value);
  expect(result.findings).toEqual([]);
  expect(result.skipped.length).toBeGreaterThan(0);
});
it('handles duplicate hosts/ports within one resource and deduplicates related object identities', () => {
  const duplicates = { ...spec, hosts: ['API.EXAMPLE.TEST', 'api.example.test'] };
  const value = context();
  value.serviceEntries = { complete: true, items: [record('selected', 'bookinfo', duplicates)] };
  const result = check(value, duplicates);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0].references?.[0].name).toBe('selected');
});
it('bounds record counts and exact host/port contribution thresholds', () => {
  const ports = Array.from({ length: 100 }, (_, index) => ({ number: index, protocol: 'HTTP' }));
  const hosts = Array.from({ length: 100 }, (_, index) => `host${index}.example.test`);
  expect(serviceEntryCollisions([record('one', 'bookinfo', { hosts, ports })])).toEqual([]);
  expect(() =>
    serviceEntryCollisions([
      record('one', 'bookinfo', { hosts, ports }),
      record('two', 'other', spec),
    ])
  ).toThrow(/10000/);
  expect(() =>
    serviceEntryCollisions(
      Array.from({ length: 1001 }, (_, index) => record(`entry-${index}`, 'bookinfo', spec))
    )
  ).toThrow(/1000/);
  expect(() =>
    serviceEntryCollisions([
      record('one', 'bookinfo', { hosts: [...hosts, 'extra.example.test'], ports }),
    ])
  ).toThrow(/100/);
});
it('bounds reference expansion and keeps incomplete evaluations atomic', () => {
  const repeated = {
    ...spec,
    ports: Array.from({ length: 100 }, () => ({ number: 80, protocol: 'HTTP' })),
  };
  const value = context();
  value.serviceEntries = {
    complete: true,
    items: [record('selected', 'bookinfo', repeated), record('peer', 'other', spec)],
  };
  expect(check(value, repeated).findings).toHaveLength(100);
  value.serviceEntries.items = [...value.serviceEntries.items, record('extra', 'other', spec)];
  const result = check(value, repeated);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toContain('10000-reference');
});
it('selects group-safe sources only when ServiceEntry grouping has inputs', () => {
  expect(referenceValidationSources('ServiceEntry', 'networking.istio.io', spec, null)).toEqual([
    'namespaces',
    'serviceEntries',
    'sidecars',
  ]);
  expect(referenceValidationSources('ServiceEntry', 'other.example.test', spec, null)).toEqual([]);
  expect(referenceValidationSources('ServiceEntry', 'networking.istio.io', {}, null)).toEqual([]);
  expect(
    serviceEntryChecks('ServiceEntry', 'other.example.test', 'bookinfo', spec).findings
  ).toEqual([]);
});
