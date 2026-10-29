import oracleText from '../../test-files/parity/authorization-host-oracle.json?raw';
import {
  authorizationHostChecks,
  authorizationHostHeaderMatcher,
  authorizationHostsNeedContext,
  authorizationVirtualServiceHostMatch,
} from './authorizationHosts';
import { getHost } from './hosts';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { Finding, initialValidation } from './validation';

const group = 'security.istio.io';
const domain = 'svc.cluster.local';
const spec = (hosts: string[]) => ({ rules: [null, { to: [null, { operation: { hosts } }] }] });
const resource = (
  name: string,
  namespace = 'bookinfo',
  fields: Record<string, unknown> = {}
): ValidationRecord => ({
  name,
  namespace,
  uid: `${namespace}-${name}`,
  labels: {},
  spec: fields,
});
function context(): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: domain,
    namespaces: {
      complete: true,
      items: ['bookinfo', 'other'].map(name => ({ name, namespace: '', labels: {}, spec: {} })),
    },
    services: { complete: true, items: [] },
    serviceEntries: { complete: true, items: [] },
    virtualServices: { complete: true, items: [] },
    destinationRules: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
    namespaceMesh: new Map(
      ['bookinfo', 'other'].map(name => [
        name,
        { status: 'ready', controller: 'root/istiod', fields: { hasDiscoverySelectors: false } },
      ])
    ),
  };
}
const check = (hosts: string[], current = context()) =>
  authorizationHostChecks('AuthorizationPolicy', group, 'bookinfo', spec(hosts), current);

const oracle: {
  cases: {
    input: {
      domain: string;
      namespace: string;
      allowAny: boolean;
      ambient: boolean;
      defaults: { service: string[]; virtual: string[] };
      services: { name: string; namespace: string; annotations: Record<string, string> }[];
      serviceEntries: { name: string; namespace: string; spec: Record<string, unknown> }[];
      virtualServices: { name: string; namespace: string; spec: Record<string, unknown> }[];
      spec: Record<string, unknown>;
    };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches the original-Go host checker and export-filter pipeline %#',
  ({ input, expected }) => {
    const current = context();
    current.identityDomain = input.domain;
    current.namespaces = {
      complete: true,
      items: current.namespaces.items.map(item => ({
        ...item,
        labels:
          input.ambient && item.name === 'bookinfo' ? { 'istio.io/dataplane-mode': 'ambient' } : {},
      })),
    };
    current.services = {
      complete: true,
      items: input.services.map(item => ({
        ...resource(item.name, item.namespace),
        exportToAnnotation: item.annotations['networking.istio.io/exportTo'],
      })),
    };
    current.serviceEntries = {
      complete: true,
      items: input.serviceEntries.map(item => resource(item.name, item.namespace, item.spec)),
    };
    current.virtualServices = {
      complete: true,
      items: input.virtualServices.map(item => resource(item.name, item.namespace, item.spec)),
    };
    current.namespaceMesh = new Map(
      ['bookinfo', 'other'].map(name => [
        name,
        {
          status: 'ready',
          controller: 'root/istiod',
          fields: {
            hasDiscoverySelectors: false,
            defaultServiceExportTo: input.defaults.service,
            defaultVirtualServiceExportTo: input.defaults.virtual,
            outboundTrafficPolicy: {
              mode: input.allowAny ? 'ALLOW_ANY' : 'REGISTRY_ONLY',
              basis: 'explicit',
            },
          },
        },
      ])
    );
    expect(
      authorizationHostChecks('AuthorizationPolicy', group, input.namespace, input.spec, current)
    ).toEqual({
      findings: expected,
      skipped: [],
    });
  }
);

it('exempts HTTP Host-header matchers, not known service.namespace shorthand', () => {
  for (const host of [
    '*',
    '*suffix',
    'prefix*',
    '*.bookinfo',
    'api.info',
    'api.example.test',
    'missing.bookinfo.svc',
    '\u0085*.other\u0085',
  ])
    expect(authorizationHostHeaderMatcher(host, 'bookinfo', ['bookinfo', 'other'])).toBe(true);
  for (const host of ['', 'reviews', 'missing.bookinfo', 'missing.other', ' reviews '])
    expect(authorizationHostHeaderMatcher(host, 'bookinfo', ['bookinfo', 'other'])).toBe(false);
  expect(authorizationHostHeaderMatcher('api.info', 'bookinfo')).toBeUndefined();
  expect(authorizationHostHeaderMatcher('reviews.bookinfo', 'bookinfo')).toBe(false);
  const result = check(['missing', 'missing.other', 'api.info', 'missing.bookinfo.svc']);
  expect(result.findings.map(finding => finding.path)).toEqual([
    'spec/rules[1]/to[1]/operation/hosts[0]',
    'spec/rules[1]/to[1]/operation/hosts[1]',
  ]);
  expect(
    result.findings.every(finding => finding.code === 'KIA0104' && finding.severity === 'warning')
  ).toBe(true);
  expect(result.skipped).toEqual([]);
});
it('keeps raw host text for lookup after the trimmed matcher classification', () => {
  const current = context();
  current.services = {
    complete: true,
    items: [{ ...resource('reviews'), exportToAnnotation: '*' }],
  };
  expect(
    check(['reviews', ' reviews ', ''], current).findings.map(finding => finding.path)
  ).toEqual(['spec/rules[1]/to[1]/operation/hosts[1]', 'spec/rules[1]/to[1]/operation/hosts[2]']);
});
it.each(['ALLOW_ANY', 'REGISTRY_ONLY', 'ALLOW_ANY_DYNAMIC_DNS'] as const)(
  'preserves %s missing-host severity without asserting access decisions',
  mode => {
    const current = context();
    current.namespaceMesh = new Map([
      [
        'bookinfo',
        {
          status: 'ready',
          controller: 'root/istiod',
          fields: {
            hasDiscoverySelectors: false,
            outboundTrafficPolicy: { mode, basis: 'explicit' },
          },
        },
      ],
    ]);
    expect(check(['missing'], current).findings[0].severity).toBe(
      mode === 'ALLOW_ANY' ? 'warning' : 'error'
    );
  }
);
it.each(['namespaces', 'services', 'serviceEntries', 'virtualServices'] as const)(
  'defers missing-host claims with incomplete %s',
  key => {
    const current = context();
    current[key] = { complete: false, items: [] };
    expect(check(['missing'], current)).toMatchObject({
      findings: [],
      skipped: [expect.stringMatching(/complete/)],
    });
  }
);
it('requires namespace evidence only for potentially internal names and never guesses the DNS domain', () => {
  expect(
    authorizationHostChecks(
      'AuthorizationPolicy',
      group,
      'bookinfo',
      spec(['*.bookinfo', 'api.example.test'])
    )
  ).toEqual({ findings: [], skipped: [] });
  expect(
    authorizationHostsNeedContext('AuthorizationPolicy', group, spec(['*.bookinfo']), 'bookinfo')
  ).toBe(false);
  expect(
    referenceValidationSources('AuthorizationPolicy', group, spec(['reviews']), null, 'bookinfo')
  ).toEqual(['namespaces']);
  const current = context();
  current.identityDomain = null;
  expect(check(['api.info'], current)).toEqual({ findings: [], skipped: [] });
  expect(check(['reviews'], current)).toMatchObject({
    findings: [],
    skipped: [expect.stringMatching(/DNS identity domain/)],
  });
  current.namespaceMesh = undefined;
  current.identityDomain = domain;
  expect(check(['reviews'], current)).toMatchObject({
    findings: [],
    skipped: [expect.stringMatching(/Outbound policy/)],
  });
});
it('matches pinned VirtualService host forms without treating the short .svc form as a full DNS alias', () => {
  const host = getHost('reviews', 'bookinfo', ['bookinfo'], domain);
  for (const value of [
    '*',
    'reviews',
    'reviews.bookinfo',
    `reviews.bookinfo.${domain}`,
    `*.bookinfo.${domain}`,
  ])
    expect(authorizationVirtualServiceHostMatch(host, value, 'bookinfo', domain)).toBe(true);
  for (const value of ['reviews.bookinfo.svc', 'review', '*.other.svc.cluster.local'])
    expect(authorizationVirtualServiceHostMatch(host, value, 'bookinfo', domain)).toBe(false);
  expect(authorizationVirtualServiceHostMatch(host, 'reviews', 'other', domain)).toBe(false);
  expect(
    authorizationVirtualServiceHostMatch(
      getHost('api.external.test', 'bookinfo', [], domain),
      '*.external.test',
      'other',
      domain
    )
  ).toBe(true);
});
it('filters autogenerated VirtualServices and preserves per-kind export defaults and ambient ownership', () => {
  const current = context();
  current.virtualServices = {
    complete: true,
    items: [resource('route', 'other', { hosts: ['reviews.bookinfo'] })],
  };
  current.namespaceMesh = new Map(
    ['bookinfo', 'other'].map(name => [
      name,
      {
        status: 'ready',
        controller: 'root/istiod',
        fields: {
          hasDiscoverySelectors: false,
          defaultVirtualServiceExportTo: ['.'],
          defaultServiceExportTo: ['*'],
        },
      },
    ])
  );
  expect(check(['reviews'], current).findings).toHaveLength(1);
  current.serviceEntries = {
    complete: true,
    items: [resource('entry', 'other', { hosts: [`reviews.bookinfo.${domain}`] })],
  };
  expect(check(['reviews'], current)).toEqual({ findings: [], skipped: [] });
  current.serviceEntries = { complete: true, items: [] };
  current.virtualServices = {
    complete: true,
    items: [resource('route', 'other', { hosts: ['reviews.bookinfo'], exportTo: ['*'] })],
  };
  expect(check(['reviews'], current)).toEqual({ findings: [], skipped: [] });
  current.namespaces = {
    complete: true,
    items: current.namespaces.items.map(item =>
      item.name === 'other' ? { ...item, labels: { 'istio.io/dataplane-mode': 'ambient' } } : item
    ),
  };
  expect(check(['reviews'], current).findings).toHaveLength(1);
  current.virtualServices = {
    complete: true,
    items: [
      resource('route-autogenerated-k8s-test', 'bookinfo', { hosts: ['*'], exportTo: ['*'] }),
    ],
  };
  expect(check(['reviews'], current).findings).toHaveLength(1);
});
it('accepts positive registry evidence despite another matching source having unresolved export defaults', () => {
  const current = context();
  current.namespaceMesh = undefined;
  current.virtualServices = {
    complete: true,
    items: [resource('route', 'other', { hosts: ['reviews.bookinfo'] })],
  };
  expect(check(['reviews'], current).findings).toEqual([]);
  expect(check(['reviews'], current).skipped[0]).toMatch(/VirtualService export defaults/);
  current.services = {
    complete: true,
    items: [{ ...resource('reviews'), exportToAnnotation: '*' }],
  };
  expect(check(['reviews'], current)).toEqual({ findings: [], skipped: [] });
});
it('does not apply Sidecar imports, negative-host predicates or findings from a different kind/group', () => {
  const current = context();
  current.sidecars = {
    complete: true,
    items: [resource('sidecar', 'bookinfo', { egress: [{ hosts: ['~/*'] }] })],
  };
  current.services = {
    complete: true,
    items: [{ ...resource('reviews'), exportToAnnotation: '*' }],
  };
  expect(check(['reviews'], current)).toEqual({ findings: [], skipped: [] });
  const negative = { rules: [{ to: [{ operation: { notHosts: ['missing'] } }] }] };
  expect(authorizationHostChecks('AuthorizationPolicy', group, 'bookinfo', negative)).toEqual({
    findings: [],
    skipped: [],
  });
  expect(
    authorizationHostChecks(
      'AuthorizationPolicy',
      'networking.istio.io',
      'bookinfo',
      spec(['missing'])
    )
  ).toEqual({ findings: [], skipped: [] });
  expect(
    initialValidation({
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind: 'AuthorizationPolicy',
      group,
      spec: spec(['missing']),
      annotations: { 'kiali.io/ignore-validations': 'KIA0104' },
      workloads: [],
      complete: false,
      context: current,
    })
  ).toMatchObject({ findings: [], suppressed: 1 });
});
it.each([
  { rules: 1 },
  { rules: [false] },
  { rules: [{ to: [false] }] },
  { rules: [{ to: [{ operation: false }] }] },
  { rules: [{ to: [{ operation: { hosts: [null] } }] }] },
  spec(['x'.repeat(1025)]),
  spec(Array(201).fill('x')),
  { rules: Array(101).fill(null) },
  { rules: Array(11).fill({ to: Array(100).fill(null) }) },
])(
  'defers malformed or oversized host predicates %# without making requests or findings',
  value => {
    expect(authorizationHostsNeedContext('AuthorizationPolicy', group, value, 'bookinfo')).toBe(
      false
    );
    const result = authorizationHostChecks(
      'AuthorizationPolicy',
      group,
      'bookinfo',
      value,
      context()
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  }
);
it('enforces the exact VirtualService comparison budget without inventing absence for later targets', () => {
  const current = context();
  current.virtualServices = {
    complete: true,
    items: Array.from({ length: 100 }, (_, index) =>
      resource(`route-${index}`, 'bookinfo', {
        hosts: Array(100).fill('unrelated'),
        exportTo: ['*'],
      })
    ),
  };
  const result = check(['first', 'second'], current);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0].path).toBe('spec/rules[1]/to[1]/operation/hosts[0]');
  expect(result.skipped).toEqual([expect.stringMatching(/10,000 VirtualService comparisons/)]);
});
