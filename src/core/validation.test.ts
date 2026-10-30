import { correlateResources } from './correlation';
import { initialValidation } from './validation';

const context = {
  cluster: 'alpha',
  namespace: 'bookinfo',
  kind: 'VirtualService',
  annotations: {},
  workloads: [],
  complete: true,
  context: {
    cluster: 'alpha',
    identityDomain: 'svc.cluster.local',
    namespaces: {
      complete: true,
      items: [{ name: 'bookinfo', namespace: '', labels: {}, spec: {} }],
    },
    destinationRules: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
  },
};

it.each(['http', 'tcp', 'tls'])(
  'preserves the pinned single-weight warning and path for %s',
  protocol => {
    const result = initialValidation({
      ...context,
      spec: { [protocol]: [{ route: [{ weight: 45, destination: { host: 'reviews' } }] }] },
    });
    expect(result.findings).toEqual([
      {
        code: 'KIA1104',
        severity: 'warning',
        path: `spec/${protocol}[0]/route[0]/weight`,
        message: 'The weight is assumed to be 100 because there is only one route destination',
      },
    ]);
    expect(result.coverage).toBe('partial');
  }
);

it.each([undefined, 0, 100])(
  'does not warn for the upstream single-route default/full weight %s',
  weight => {
    expect(
      initialValidation({
        ...context,
        spec: { http: [{ route: [{ weight, destination: { host: 'reviews' } }] }] },
      }).findings
    ).toEqual([]);
  }
);

it('marks each repeated destination but leaves different subsets distinct', () => {
  const result = initialValidation({
    ...context,
    spec: {
      http: [
        {
          route: [
            { destination: { host: 'reviews', subset: 'v1' } },
            { destination: { host: 'reviews.bookinfo.svc.cluster.local', subset: 'v1' } },
            { destination: { host: 'reviews', subset: 'v2' } },
          ],
        },
      ],
    },
  });
  expect(result.findings.map(finding => [finding.code, finding.path])).toEqual([
    ['KIA1105', 'spec/http[0]/route[0]/host'],
    ['KIA1105', 'spec/http[0]/route[1]/host'],
  ]);
});

it('does not prove a selector misses all workloads from incomplete data', () => {
  const spec = { selector: { matchLabels: { app: 'missing' } } };
  const incomplete = initialValidation({
    ...context,
    kind: 'AuthorizationPolicy',
    group: 'security.istio.io',
    spec,
    complete: false,
  });
  expect(incomplete.findings).toEqual([]);
  expect(incomplete.skipped).toContain(
    'Workload-selector check requires a complete namespace snapshot'
  );
  expect(
    initialValidation({ ...context, kind: 'AuthorizationPolicy', group: 'security.istio.io', spec })
      .findings[0].code
  ).toBe('KIA0004');
});

it.each(['AuthorizationPolicy', 'PeerAuthentication', 'RequestAuthentication'])(
  'activates KIA0004 only for the pinned security caller %s and exact field',
  kind => {
    const input = { ...context, kind, group: 'security.istio.io' };
    expect(
      initialValidation({ ...input, spec: { selector: { matchLabels: { app: 'missing' } } } })
        .findings
    ).toContainEqual({
      code: 'KIA0004',
      severity: 'warning',
      path: 'spec/selector/matchLabels',
      message: 'No matching workload found for the selector in this namespace',
    });
    expect(
      initialValidation({
        ...input,
        spec: { workloadSelector: { labels: { app: 'missing' } } },
      }).findings.some(finding => finding.code === 'KIA0004')
    ).toBe(false);
    expect(
      initialValidation({
        ...input,
        group: 'networking.istio.io',
        spec: { selector: { matchLabels: { app: 'missing' } } },
      }).findings.some(finding => finding.code === 'KIA0004')
    ).toBe(false);
  }
);
it('uses only Sidecar workloadSelector.labels, not a generic matchLabels fallback', () => {
  const input = { ...context, kind: 'Sidecar', group: 'networking.istio.io' };
  expect(
    initialValidation({ ...input, spec: { workloadSelector: { labels: { app: 'missing' } } } })
      .findings
  ).toContainEqual({
    code: 'KIA0004',
    severity: 'warning',
    path: 'spec/workloadSelector/labels',
    message: 'No matching workload found for the selector in this namespace',
  });
  expect(
    initialValidation({
      ...input,
      spec: { workloadSelector: { matchLabels: { app: 'missing' } } },
    }).findings.some(finding => finding.code === 'KIA0004')
  ).toBe(false);
});
it('matches only same-cluster, same-namespace workload labels when inclusion evidence is complete', () => {
  for (const [cluster, namespace, expected] of [
    ['alpha', 'bookinfo', false],
    ['alpha', 'other', true],
    ['beta', 'bookinfo', true],
  ] as const) {
    const labels = { app: 'reviews', version: '' };
    const workloads = correlateResources([
      {
        identity: { cluster, namespace, group: '', kind: 'Pod', name: 'known', uid: 'known' },
        labels,
        workloadLabels: labels,
        owners: [],
        serviceSelector: null,
        proxyMode: 'none',
      },
    ]).workloads;
    const result = initialValidation({
      ...context,
      kind: 'RequestAuthentication',
      group: 'security.istio.io',
      workloads,
      spec: { selector: { matchLabels: labels } },
    });
    expect(result.findings.some(finding => finding.code === 'KIA0004')).toBe(expected);
  }
});
it.each([
  ['DestinationRule', 'networking.istio.io'],
  ['ServiceEntry', 'networking.istio.io'],
  ['VirtualService', 'networking.istio.io'],
  ['Gateway', 'networking.istio.io'],
  ['EnvoyFilter', 'networking.istio.io'],
  ['Telemetry', 'telemetry.istio.io'],
  ['WasmPlugin', 'extensions.istio.io'],
  ['TrafficExtension', 'extensions.istio.io'],
  ['HTTPRoute', 'gateway.networking.k8s.io'],
  ['AuthorizationPolicy', 'example.io'],
  ['Sidecar', 'example.io'],
])('does not invent a selector check or deferral for inactive caller %s/%s', (kind, group) => {
  for (const complete of [true, false]) {
    const result = initialValidation({
      ...context,
      kind,
      group,
      complete,
      spec: {
        selector: { matchLabels: { app: 'missing' } },
        workloadSelector: { labels: { app: 'missing' }, matchLabels: { app: 'missing' } },
      },
    });
    expect(result.findings.some(finding => finding.code === 'KIA0004')).toBe(false);
    expect(result.skipped.some(message => message.includes('Workload-selector check'))).toBe(false);
  }
});
it.each(
  [undefined, null, {}, { matchLabels: null }, { matchLabels: {} }].map(selector => ({ selector }))
)('requires no workload evidence for an empty active selector $selector', ({ selector }) => {
  const result = initialValidation({
    ...context,
    kind: 'RequestAuthentication',
    group: 'security.istio.io',
    complete: false,
    spec: { selector },
  });
  expect(result.findings.some(finding => finding.code === 'KIA0004')).toBe(false);
  expect(result.skipped.some(message => message.includes('Workload-selector'))).toBe(false);
});
it.each([
  'bad',
  { matchLabels: 3 },
  { matchLabels: { app: 42 } },
  { matchLabels: { 'bad key': 'x' } },
  { matchLabels: { app: 'bad value' } },
  {
    matchLabels: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`l${index}`, 'x'])),
  },
])('defers malformed active selectors explicitly without a finding: %j', selector => {
  const result = initialValidation({
    ...context,
    kind: 'RequestAuthentication',
    group: 'security.istio.io',
    spec: { selector },
  });
  expect(result.findings).toEqual([]);
  expect(result.skipped.some(message => message.startsWith('spec/selector/matchLabels:'))).toBe(
    true
  );
});

it('honours all-check and code-specific ignore annotations', () => {
  const spec = { http: [{ route: [{ weight: 45, destination: { host: 'reviews' } }] }] };
  for (const ignored of ['', ' KIA1104 ,KIA0004']) {
    const result = initialValidation({
      ...context,
      spec,
      annotations: { 'kiali.io/ignore-validations': ignored },
    });
    expect(result.findings).toEqual([]);
    expect(result.suppressed).toBe(1);
  }
});
