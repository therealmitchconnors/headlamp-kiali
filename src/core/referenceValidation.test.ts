import {
  referenceValidation,
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { initialValidation } from './validation';

const record = (name: string, namespace = '', spec = {}): ValidationRecord => ({
  name,
  namespace,
  spec,
  labels: {},
});
const context: ReferenceValidationContext = {
  cluster: 'alpha',
  identityDomain: 'svc.cluster.local',
  namespaces: { complete: true, items: [record('bookinfo'), record('preview')] },
  destinationRules: { complete: true, items: [] },
  sidecars: { complete: true, items: [] },
  services: {
    complete: true,
    items: [{ ...record('reviews', 'bookinfo'), uid: 'reviews-uid', exportToAnnotation: '*' }],
  },
  serviceEntries: { complete: true, items: [] },
  namespaceMesh: new Map(
    ['bookinfo', 'preview'].map(namespace => [
      namespace,
      {
        status: 'ready' as const,
        controller: 'istio-system/istiod',
        fields: { rootNamespace: 'istio-system', hasDiscoverySelectors: false },
      },
    ])
  ),
};
const routes = { http: [{ route: [{ destination: { host: 'reviews', subset: 'v1' } }] }] };

it('emits the pinned missing-subset warning only for a complete unrestricted context', () => {
  expect(
    referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', routes, context)
      .findings
  ).toEqual([
    {
      code: 'KIA1107',
      severity: 'warning',
      path: 'spec/http[0]/route[0]/destination',
      message: 'Subset not found',
    },
  ]);
  for (const partial of [
    { ...context, identityDomain: null },
    { ...context, namespaces: { ...context.namespaces, complete: false } },
    { ...context, destinationRules: { ...context.destinationRules, complete: false } },
    { ...context, sidecars: { ...context.sidecars, complete: false } },
    {
      ...context,
      namespaceMesh: undefined,
      sidecars: { complete: true, items: [record('root', 'unknown-root')] },
    },
  ]) {
    const result = referenceValidation(
      'VirtualService',
      'networking.istio.io',
      'bookinfo',
      routes,
      partial
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  }
});

it('filters subset candidates by namespace-wide Sidecar imports and explicit exportTo', () => {
  const spec = { ...routes, hosts: ['reviews'] };
  const scoped: ReferenceValidationContext = {
    ...context,
    virtualServices: {
      complete: true,
      items: [{ ...record('selected', 'bookinfo', spec), uid: 'selected-uid' }],
    },
    destinationRules: {
      complete: true,
      items: [
        record('remote', 'preview', {
          host: 'reviews.bookinfo.svc.cluster.local',
          subsets: [{ name: 'v1' }],
          exportTo: ['.'],
        }),
      ],
    },
    sidecars: {
      complete: true,
      items: [record('imports', 'bookinfo', { egress: [{ hosts: ['./*'] }] })],
    },
  };
  const validate = (input = scoped) =>
    referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', spec, input, {
      name: 'selected',
      uid: 'selected-uid',
    });
  expect(validate().findings.map(f => f.code)).toEqual(['KIA1107']);
  const exported = {
    ...scoped,
    destinationRules: {
      complete: true,
      items: [
        record('remote', 'preview', {
          host: 'reviews.bookinfo.svc.cluster.local',
          subsets: [{ name: 'v1' }],
          exportTo: ['bookinfo'],
        }),
      ],
    },
  };
  expect(validate(exported)).toEqual({ findings: [], skipped: [] });
  const excluded = {
    ...exported,
    sidecars: {
      complete: true,
      items: [record('imports', 'bookinfo', { egress: [{ hosts: ['*/*', '~bookinfo/*'] }] })],
    },
  };
  expect(
    validate(excluded).skipped.some(message => message.includes('no Sidecar-imported host'))
  ).toBe(true);
  expect(validate(excluded).findings).toEqual([]);
});

it('uses root fallback, preserves local precedence and refuses ambiguous Sidecars', () => {
  const spec = { ...routes, hosts: ['reviews'] };
  const scoped = {
    ...context,
    virtualServices: {
      complete: true,
      items: [{ ...record('selected', 'bookinfo', spec), uid: 'selected-uid' }],
    },
    sidecars: {
      complete: true,
      items: [record('root', 'istio-system', { egress: [{ hosts: ['~/*'] }] })],
    },
  };
  const validate = (input: ReferenceValidationContext) =>
    referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', spec, input, {
      name: 'selected',
      uid: 'selected-uid',
    });
  expect(
    validate(scoped).skipped.some(message => message.includes('no Sidecar-imported host'))
  ).toBe(true);
  const local = record('local', 'bookinfo', { egress: [{ hosts: ['./*'] }] });
  expect(
    validate({ ...scoped, sidecars: { complete: true, items: [...scoped.sidecars.items, local] } })
      .findings[0].code
  ).toBe('KIA1107');
  const conflict = validate({
    ...scoped,
    sidecars: { complete: true, items: [local, { ...local, name: 'other' }] },
  });
  expect(conflict.findings).toEqual([]);
  expect(conflict.skipped[0]).toContain('Conflicting');
});

it('applies mesh export defaults and defers only uncertain matching subset references', () => {
  const scoped = {
    ...context,
    namespaceMesh: new Map([
      [
        'preview',
        {
          status: 'ready' as const,
          controller: 'istio-system/istiod',
          fields: { hasDiscoverySelectors: false, defaultDestinationRuleExportTo: ['.'] },
        },
      ],
    ]),
    destinationRules: {
      complete: true,
      items: [record('remote', 'preview', { host: 'reviews.bookinfo', subsets: [{ name: 'v1' }] })],
    },
  };
  expect(
    referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', routes, scoped)
      .findings[0].code
  ).toBe('KIA1107');
  const unknown = referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', routes, {
    ...scoped,
    namespaceMesh: undefined,
  });
  expect(unknown.findings).toEqual([]);
  expect(unknown.skipped[0]).toContain('export defaults are unresolved');
  const absent = referenceValidation(
    'VirtualService',
    'networking.istio.io',
    'bookinfo',
    {
      http: [{ route: [{ destination: { host: 'ratings', subset: 'v1' } }] }],
    },
    { ...scoped, namespaceMesh: undefined }
  );
  expect(absent.findings[0].code).toBe('KIA1107');
});

it('retains the pinned export-namespace finding and ambient source exception', () => {
  const validate = (kind: string, input = context) =>
    referenceValidation(
      kind,
      'networking.istio.io',
      'bookinfo',
      {
        exportTo: ['.', '*', 'preview', 'missing', '~'],
      },
      input
    );
  for (const kind of ['VirtualService', 'DestinationRule', 'ServiceEntry']) {
    expect(validate(kind).findings.map(f => [f.code, f.path, f.severity])).toEqual([
      ['KIA0005', 'spec/exportTo[3]', 'error'],
      ['KIA0005', 'spec/exportTo[4]', 'error'],
    ]);
  }
  const ambient = {
    ...context,
    namespaces: {
      complete: true,
      items: [
        { ...record('bookinfo'), labels: { 'istio.io/dataplane-mode': 'ambient' } },
        record('preview'),
      ],
    },
  };
  expect(validate('VirtualService', ambient).findings).toEqual([]);
  expect(
    referenceValidationSources(
      'DestinationRule',
      'networking.istio.io',
      { exportTo: ['missing'] },
      null
    )
  ).toEqual(['namespaces']);
});

it('skips Sidecar filtering for ambient namespaces and bounds destination evaluation', () => {
  const ambient = {
    ...context,
    namespaces: {
      complete: true,
      items: [{ ...record('bookinfo'), labels: { 'istio.io/dataplane-mode': 'ambient' } }],
    },
    sidecars: {
      complete: true,
      items: [record('imports', 'bookinfo', { egress: [{ hosts: ['~/*'] }] })],
    },
  };
  expect(
    referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', routes, ambient)
      .findings[0].code
  ).toBe('KIA1107');
  const large = { http: [{ route: Array.from({ length: 201 }, () => routes.http[0].route[0]) }] };
  const result = referenceValidation(
    'VirtualService',
    'networking.istio.io',
    'bookinfo',
    large,
    context
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped.some(message => message.includes('200-destination'))).toBe(true);
});
it.each([
  'reviews',
  'reviews.bookinfo',
  'reviews.bookinfo.svc',
  'reviews.bookinfo.svc.cluster.local',
  '*.bookinfo.svc.cluster.local',
  '*',
])('matches a named subset using the upstream host semantics for %s', host => {
  const known = {
    ...context,
    destinationRules: {
      complete: true,
      items: [record('reviews', 'bookinfo', { host, subsets: [{ name: 'v1' }] })],
    },
  };
  expect(
    referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', routes, known).findings
  ).toEqual([]);
});
it('retains the correct TLS/TCP paths and does not apply the checker to a similarly named foreign kind', () => {
  for (const protocol of ['tcp', 'tls']) {
    const spec = { [protocol]: routes.http };
    expect(
      referenceValidation('VirtualService', 'networking.istio.io', 'bookinfo', spec, context)
        .findings[0].path
    ).toBe(`spec/${protocol}[0]/route[0]/destination`);
    expect(
      referenceValidation('VirtualService', 'example.test', 'bookinfo', spec, context).findings
    ).toEqual([]);
  }
});
it('preserves the pinned listener-uniqueness code, severity, hostname and name rules', () => {
  const listener = { name: 'first', hostname: 'example.test', port: 443, protocol: 'HTTPS' };
  const findings = referenceValidation('Gateway', 'gateway.networking.k8s.io', 'edge', {
    listeners: [listener, { ...listener, name: 'second' }],
  }).findings;
  expect(findings.map(finding => [finding.code, finding.severity, finding.path])).toEqual([
    ['KIA1503', 'error', 'spec/listeners[0]/name'],
    ['KIA1503', 'error', 'spec/listeners[1]/name'],
  ]);
  expect(
    referenceValidation('Gateway', 'networking.istio.io', 'edge', {
      listeners: [listener, { ...listener, name: 'second' }],
    }).findings
  ).toEqual([]);
  expect(
    referenceValidation('Gateway', 'gateway.networking.k8s.io', 'edge', {
      listeners: [
        { ...listener, hostname: undefined },
        { ...listener, name: 'second', hostname: undefined },
      ],
    }).findings
  ).toEqual([]);
});
it('requires complete namespace discovery before a ReferenceGrant absence finding', () => {
  const spec = { from: [{ namespace: 'bookinfo' }, { namespace: 'missing' }] };
  expect(
    referenceValidation('ReferenceGrant', 'gateway.networking.k8s.io', 'edge', spec, context)
      .findings
  ).toEqual([
    {
      code: 'KIA1601',
      severity: 'error',
      path: 'spec/from[1]/namespace',
      message: 'Namespace is not found or is not accessible',
    },
  ]);
  expect(
    referenceValidation('ReferenceGrant', 'gateway.networking.k8s.io', 'edge', spec).findings
  ).toEqual([]);
});
it('plans only needed source reads and retains ignored findings and scope safeguards', () => {
  expect(referenceValidationSources('Gateway', 'gateway.networking.k8s.io', {}, null)).toEqual([]);
  expect(
    referenceValidationSources(
      'Gateway',
      'gateway.networking.k8s.io',
      { gatewayClassName: 'istio' },
      null
    )
  ).toEqual(['gatewayClasses']);
  expect(
    referenceValidationSources(
      'Gateway',
      'gateway.networking.k8s.io',
      { gatewayClassName: 'bad/class' },
      null
    )
  ).toEqual([]);
  expect(
    referenceValidationSources('ReferenceGrant', 'gateway.networking.k8s.io', {}, null)
  ).toEqual(['namespaces']);
  expect(referenceValidationSources('VirtualService', 'networking.istio.io', routes, null)).toEqual(
    []
  );
  expect(
    referenceValidationSources('VirtualService', 'networking.istio.io', routes, 'svc.cluster.local')
  ).toEqual(['namespaces', 'services', 'serviceEntries', 'destinationRules', 'sidecars']);
  const input = {
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'VirtualService',
    spec: routes,
    context,
    annotations: { 'kiali.io/ignore-validations': 'KIA1107' },
    workloads: [],
    complete: false,
  };
  expect(initialValidation(input).suppressed).toBe(1);
  expect(initialValidation(input).findings).toEqual([]);
  expect(() => initialValidation({ ...input, cluster: 'different' })).toThrow('different cluster');
});
it('does not collapse external hostname suffixes or guess aliases without domain evidence', () => {
  const spec = {
    http: [
      {
        route: ['api.example.test', 'api.example.other'].map(host => ({
          destination: { host, subset: 'v1' },
        })),
      },
    ],
  };
  const input = {
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'VirtualService',
    annotations: {},
    workloads: [],
    complete: false,
    spec,
  };
  expect(
    initialValidation({ ...input, context }).findings.filter(f => f.code === 'KIA1105')
  ).toEqual([]);
  expect(
    initialValidation({
      ...input,
      spec: {
        http: [
          {
            route: ['reviews', 'reviews.bookinfo.svc.cluster.local'].map(host => ({
              destination: { host },
            })),
          },
        ],
      },
    }).skipped.some(message => message.includes('host-alias'))
  ).toBe(true);
});
