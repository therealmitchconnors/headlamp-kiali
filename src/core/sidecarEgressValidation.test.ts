import oracleText from '../../test-files/parity/sidecar-egress-oracle.json?raw';
import { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import {
  serviceExportAnnotation,
  serviceHostRegistry,
  serviceHostVisible,
} from './serviceRegistry';
import { sidecarEgressChecks, sidecarNeedsRegistry } from './sidecarEgressValidation';
import { Finding, initialValidation } from './validation';

const group = 'networking.istio.io';
const spec = (host: string) => ({ egress: [{ hosts: [host] }] });
function context(): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: 'svc.cluster.local',
    namespaces: {
      complete: true,
      items: ['bookinfo', 'other'].map(name => ({ name, namespace: '', labels: {}, spec: {} })),
    },
    sidecars: { complete: false, items: [] },
    destinationRules: { complete: false, items: [] },
    services: { complete: true, items: [] },
    serviceEntries: { complete: true, items: [] },
    namespaceMesh: new Map(
      ['bookinfo', 'other'].map(name => [
        name,
        {
          status: 'ready',
          controller: 'root/istiod',
          fields: { hasDiscoverySelectors: false },
        },
      ])
    ),
  };
}
const service = (name = 'reviews', namespace = 'bookinfo'): ValidationRecord => ({
  name,
  namespace,
  uid: `${namespace}-${name}`,
  labels: {},
  spec: {},
});
const oracle: {
  cases: {
    input: {
      domain: string;
      namespace: string;
      defaults: string[];
      entries: string[];
      hosts: string[];
      services: { name: string; namespace: string; annotations: Record<string, string> }[];
    };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original-Go egress/registry composition %#',
  ({ input, expected }) => {
    const current = context();
    current.identityDomain = input.domain;
    current.services = {
      complete: true,
      items: input.services.map(value => ({
        ...service(value.name, value.namespace),
        exportToAnnotation: value.annotations['networking.istio.io/exportTo'],
      })),
    };
    current.serviceEntries = {
      complete: true,
      items: input.entries.map((host, i) => ({
        ...service(`external-${i}`),
        spec: { hosts: [host], exportTo: ['*'] },
      })),
    };
    current.namespaceMesh = new Map([
      [
        'bookinfo',
        {
          status: 'ready',
          controller: 'root/istiod',
          fields: { hasDiscoverySelectors: false, defaultServiceExportTo: input.defaults },
        },
      ],
    ]);
    expect(
      sidecarEgressChecks(
        'Sidecar',
        group,
        input.namespace,
        { egress: [{ hosts: input.hosts }] },
        current
      )
    ).toEqual({ findings: expected, skipped: [] });
  }
);
it('retains the original JSON index after a null listener instead of the upstream compacted index', () => {
  expect(
    sidecarEgressChecks(
      'Sidecar',
      group,
      'bookinfo',
      { egress: [null, { hosts: ['*/missing'] }] },
      context()
    ).findings[0].path
  ).toBe('spec/egress[1]/hosts[0]');
});
it('does not require registry context for namespace wildcards or local parsed wildcards', () => {
  expect(sidecarNeedsRegistry('Sidecar', group, spec('other/*'), null)).toBe(false);
  expect(sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('other/*'))).toEqual({
    findings: [],
    skipped: [],
  });
  const current = context();
  current.services = { complete: false, items: [] };
  expect(
    sidecarEgressChecks(
      'Sidecar',
      group,
      'bookinfo',
      spec('*/ *.bookinfo.svc.cluster.local'),
      current
    ).skipped
  ).toHaveLength(1);
  expect(
    sidecarEgressChecks(
      'Sidecar',
      group,
      'bookinfo',
      spec('*/ *.bookinfo.svc.cluster.local'.replace(' ', '')),
      current
    )
  ).toEqual({ findings: [], skipped: [] });
});
it.each(['services', 'serviceEntries', 'namespaces'] as const)(
  'never turns incomplete %s into absence',
  key => {
    const current = context();
    current[key] = { complete: false, items: [] };
    const result = sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/missing'), current);
    expect(result.findings).toEqual([]);
    expect(result.skipped[0]).toMatch(/complete/);
  }
);
it('does not borrow unknown export defaults, but unrelated unknown Services cannot hide proven absence', () => {
  const current = context();
  current.namespaceMesh = undefined;
  current.services = { complete: true, items: [service()] };
  expect(
    sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/reviews'), current).skipped[0]
  ).toMatch(/export defaults/);
  expect(
    sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/missing'), current).findings[0].code
  ).toBe('KIA1004');
  current.services.items = [{ ...service(), exportToAnnotation: '' }];
  expect(sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/reviews'), current)).toEqual({
    findings: [],
    skipped: [],
  });
});
it('honors matching ServiceEntry export uncertainty while allowing other positive evidence', () => {
  const current = context();
  current.namespaceMesh = undefined;
  current.serviceEntries = {
    complete: true,
    items: [
      { ...service('external', 'other'), spec: { hosts: ['reviews.bookinfo.svc.cluster.local'] } },
    ],
  };
  const result = sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/reviews'), current);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/export defaults/);
  current.services = { complete: true, items: [{ ...service(), exportToAnnotation: '*' }] };
  expect(sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/reviews'), current)).toEqual({
    findings: [],
    skipped: [],
  });
});
it('keeps ServiceEntry export and ambient semantics separate from Service annotation visibility', () => {
  const current = context();
  current.serviceEntries = {
    complete: true,
    items: [
      { ...service('external', 'other'), spec: { hosts: ['api.example.test'], exportTo: ['.'] } },
    ],
  };
  expect(
    sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/api.example.test'), current).findings
  ).toHaveLength(1);
  current.serviceEntries.items[0].spec.exportTo = ['*'];
  expect(
    sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/api.example.test'), current).findings
  ).toHaveLength(0);
  current.namespaces.items[1].labels = { 'istio.io/dataplane-mode': 'ambient' };
  expect(
    sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/api.example.test'), current).findings
  ).toHaveLength(1);
});
it('retains only the three Service host aliases and does not infer ExternalName targets', () => {
  const registry = serviceHostRegistry(
    [{ ...service(), exportToAnnotation: '*', spec: { externalName: 'api.example.test' } }],
    'svc.cluster.local',
    undefined
  );
  for (const host of [
    'reviews.bookinfo.svc.cluster.local',
    'reviews.bookinfo.svc',
    'reviews.bookinfo',
  ])
    expect(serviceHostVisible(registry, host, 'other')).toBe(true);
  for (const host of ['reviews', 'api.example.test'])
    expect(serviceHostVisible(registry, host, 'other')).toBe(false);
});
it('preserves Go whitespace and explicit-empty export annotations', () => {
  expect(serviceExportAnnotation(' ,\u0085.\u0085, \ufeff.\ufeff,other,')).toEqual([
    '.',
    '\ufeff.\ufeff',
    'other',
  ]);
  expect(serviceExportAnnotation(' , ')).toEqual([]);
  expect(serviceExportAnnotation('a'.repeat(4096))).toHaveLength(1);
  expect(() => serviceExportAnnotation('a'.repeat(4097))).toThrow(/4096/);
  expect(serviceExportAnnotation(Array(100).fill('*').join(','))).toHaveLength(100);
  expect(() => serviceExportAnnotation(Array(101).fill('*').join(','))).toThrow(/100/);
});
it('enforces record identities and the 1000-record limit', () => {
  for (const records of [
    [service(), service()],
    [{ ...service(), uid: '' }],
    [service('has.dots')],
    Array.from({ length: 1001 }, (_, i) => service(`svc-${i}`)),
  ])
    expect(() => serviceHostRegistry(records, 'svc.cluster.local', undefined)).toThrow();
  expect(
    serviceHostRegistry(
      Array.from({ length: 1000 }, (_, i) => ({ ...service(`svc-${i}`), exportToAnnotation: '*' })),
      'svc.cluster.local',
      undefined
    ).size
  ).toBe(3000);
});
it('bounds comparisons and malformed listeners explicitly', () => {
  for (const input of [
    { egress: [{ hosts: ['missing-slash'] }] },
    { egress: Array(101).fill(null) },
  ]) {
    const result = sidecarEgressChecks('Sidecar', group, 'bookinfo', input, context());
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  }
  const current = context();
  current.serviceEntries = {
    complete: true,
    items: Array.from({ length: 100 }, (_, i) => ({
      ...service(`external-${i}`),
      spec: { hosts: Array(100).fill('no-match.example.test'), exportTo: ['*'] },
    })),
  };
  const result = sidecarEgressChecks(
    'Sidecar',
    group,
    'bookinfo',
    { egress: [{ hosts: ['*/first', '*/second'] }] },
    current
  );
  expect(result.findings).toHaveLength(1);
  expect(result.skipped[0]).toMatch(/10,000/);
});
it('applies annotation suppression while retaining partial coverage', () => {
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'Sidecar',
    group,
    spec: spec('*/missing'),
    annotations: { 'kiali.io/ignore-validations': 'KIA1004' },
    workloads: [],
    complete: false,
    context: context(),
  });
  expect(result.findings).toEqual([]);
  expect(result.suppressed).toBe(1);
  expect(result.coverage).toBe('partial');
});

it('enforces exact ServiceEntry host budgets without truncating records', () => {
  const current = context();
  current.serviceEntries = {
    complete: true,
    items: Array.from({ length: 200 }, (_, i) => ({
      ...service(`external-${i}`),
      spec: { hosts: Array(100).fill('*'), exportTo: ['*'] },
    })),
  };
  expect(sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/missing'), current)).toEqual({
    findings: [],
    skipped: [],
  });
  current.serviceEntries.items = [
    ...current.serviceEntries.items,
    {
      ...service('overflow'),
      spec: { hosts: ['*'], exportTo: ['*'] },
    },
  ];
  const oversized = sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/missing'), current);
  expect(oversized.findings).toEqual([]);
  expect(oversized.skipped[0]).toMatch(/20,000/);
  current.serviceEntries.items = [
    {
      ...service('overflow'),
      spec: { hosts: Array(101).fill('*'), exportTo: ['*'] },
    },
  ];
  expect(
    sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('*/missing'), current).skipped[0]
  ).toMatch(/100 hosts/);
});

it('does not exempt local wildcard hosts with malformed DNS context', () => {
  const current = context();
  current.identityDomain = 'svc.cluster.local\n';
  const result = sidecarEgressChecks('Sidecar', group, 'bookinfo', spec('./*reviews'), current);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/DNS subdomain/);
});
