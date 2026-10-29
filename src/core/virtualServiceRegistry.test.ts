import oracleText from '../../test-files/parity/virtual-service-registry-oracle.json?raw';
import { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import { Finding, initialValidation } from './validation';
import {
  virtualServiceNeedsRegistry,
  virtualServiceRegistryChecks,
} from './virtualServiceRegistry';

const group = 'networking.istio.io';
const service: ValidationRecord = {
  name: 'reviews',
  namespace: 'bookinfo',
  uid: 'svc',
  labels: {},
  spec: {},
  exportToAnnotation: '*',
};
const spec = (host: string) => ({ http: [{ route: [{ destination: { host } }] }] });
function context(): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: 'svc.cluster.local',
    namespaces: {
      complete: true,
      items: ['bookinfo', 'other'].map(name => ({
        name,
        namespace: '',
        labels: {},
        spec: {},
      })),
    },
    services: { complete: true, items: [service] },
    serviceEntries: { complete: true, items: [] },
    destinationRules: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
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
const oracle: {
  cases: {
    input: {
      domain: string;
      namespace: string;
      defaults: string[];
      entries: string[];
      services: { name: string; namespace: string; annotations: Record<string, string> }[];
      mode?: number;
      spec: Record<string, unknown>;
    };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original-Go host lookup, aliases and outbound severity %#',
  ({ input, expected }) => {
    const current = context();
    current.identityDomain = input.domain;
    current.services = {
      complete: true,
      items: input.services.map(value => ({
        ...service,
        name: value.name,
        namespace: value.namespace,
        exportToAnnotation: value.annotations['networking.istio.io/exportTo'],
      })),
    };
    current.serviceEntries = {
      complete: true,
      items: input.entries.map((host, i) => ({
        name: `external-${i}`,
        namespace: 'bookinfo',
        uid: `se-${i}`,
        labels: {},
        spec: { hosts: [host], exportTo: ['*'] },
      })),
    };
    current.namespaceMesh = new Map(
      ['bookinfo', 'other'].map(name => [
        name,
        {
          status: 'ready',
          controller: 'root/istiod',
          fields: {
            hasDiscoverySelectors: false,
            defaultServiceExportTo: input.defaults,
            outboundTrafficPolicy:
              input.mode === undefined
                ? undefined
                : {
                    mode:
                      input.mode === 1
                        ? 'ALLOW_ANY'
                        : input.mode === 3
                        ? 'ALLOW_ANY_DYNAMIC_DNS'
                        : 'REGISTRY_ONLY',
                    basis: 'explicit',
                  },
          },
        },
      ])
    );
    expect(
      virtualServiceRegistryChecks('VirtualService', group, input.namespace, input.spec, current)
    ).toEqual({ findings: expected, skipped: [] });
  }
);
it('does not turn unresolved outbound policy into a default severity', () => {
  const current = context();
  current.namespaceMesh = undefined;
  const absent = virtualServiceRegistryChecks(
    'VirtualService',
    group,
    'bookinfo',
    spec('missing'),
    current
  );
  expect(absent.findings).toEqual([]);
  expect(absent.skipped[0]).toMatch(/Outbound policy requires resolved/);
  expect(
    virtualServiceRegistryChecks('VirtualService', group, 'bookinfo', spec('reviews'), current)
  ).toEqual({ findings: [], skipped: [] });
});
it.each(['namespaces', 'services', 'serviceEntries'] as const)(
  'requires complete %s before reporting absence',
  key => {
    const current = context();
    current[key] = { complete: false, items: [] };
    const result = virtualServiceRegistryChecks(
      'VirtualService',
      group,
      'bookinfo',
      spec('missing'),
      current
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped[0]).toMatch(/complete/);
  }
);
it('does not invent DNS context or apply Sidecar imports to this checker', () => {
  const current = context();
  current.identityDomain = null;
  expect(
    virtualServiceRegistryChecks('VirtualService', group, 'bookinfo', spec('reviews'), current)
      .skipped[0]
  ).toMatch(/DNS identity/);
  current.identityDomain = 'svc.cluster.local';
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
    virtualServiceRegistryChecks('VirtualService', group, 'bookinfo', spec('reviews'), current)
  ).toEqual({ findings: [], skipped: [] });
});
it('checks forwarding destinations only and does not invent mirror/redirect coverage', () => {
  const current = context();
  const input = {
    http: [{ route: [{ destination: { host: 'reviews' } }], mirror: { host: 'missing' } }],
  };
  expect(virtualServiceRegistryChecks('VirtualService', group, 'bookinfo', input, current)).toEqual(
    { findings: [], skipped: [] }
  );
  for (const empty of [
    {},
    { http: [null, { redirect: { authority: 'external.test' } }] },
    spec(''),
  ]) {
    expect(virtualServiceNeedsRegistry('VirtualService', group, empty, 'svc.cluster.local')).toBe(
      false
    );
    expect(virtualServiceRegistryChecks('VirtualService', group, 'bookinfo', empty)).toEqual({
      findings: [],
      skipped: [],
    });
  }
});
it('preserves actual route and destination indexes for HTTP, TCP and TLS', () => {
  const input = Object.fromEntries(
    ['http', 'tcp', 'tls'].map(protocol => [
      protocol,
      [null, { route: [null, { destination: { host: 'missing' } }] }],
    ])
  );
  const result = virtualServiceRegistryChecks(
    'VirtualService',
    group,
    'bookinfo',
    input,
    context()
  );
  expect(result.findings.map(finding => finding.path)).toEqual(
    ['http', 'tcp', 'tls'].map(protocol => `spec/${protocol}[1]/route[1]/destination/host`)
  );
});
it('accepts 1000 destinations but rejects overflow before returning incomplete findings', () => {
  const route = () => ({
    route: Array.from({ length: 100 }, () => ({ destination: { host: 'reviews' } })),
  });
  const input = { http: Array.from({ length: 10 }, route) };
  expect(
    virtualServiceRegistryChecks('VirtualService', group, 'bookinfo', input, context())
  ).toEqual({ findings: [], skipped: [] });
  input.http.push({ route: [{ destination: { host: 'missing' } }] });
  const result = virtualServiceRegistryChecks(
    'VirtualService',
    group,
    'bookinfo',
    input,
    context()
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/1000 destinations/);
});
it.each([
  { http: Array(101).fill(null) },
  { http: [{ route: Array(101).fill(null) }] },
  { http: [{ route: [{ destination: null }] }] },
  { http: [{ route: [{ destination: { host: 'a'.repeat(1025) } }] }] },
])('defers malformed or oversized forwarding data %#', input => {
  const result = virtualServiceRegistryChecks(
    'VirtualService',
    group,
    'bookinfo',
    input,
    context()
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped).toHaveLength(1);
});
it('integrates exclusion annotations without implying complete validity', () => {
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'VirtualService',
    group,
    spec: spec('missing'),
    annotations: { 'kiali.io/ignore-validations': 'KIA1101' },
    workloads: [],
    complete: false,
    context: context(),
  });
  expect(result.findings).toEqual([]);
  expect(result.suppressed).toBe(1);
  expect(result.coverage).toBe('partial');
});
