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
    spec,
    complete: false,
  });
  expect(incomplete.findings).toEqual([]);
  expect(incomplete.skipped).toContain(
    'Workload-selector check requires a complete namespace snapshot'
  );
  expect(
    initialValidation({ ...context, kind: 'AuthorizationPolicy', spec }).findings[0].code
  ).toBe('KIA0004');
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
