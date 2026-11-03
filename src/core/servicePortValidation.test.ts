import {
  ServicePortResource,
  servicePortResource,
  servicePortValidation,
} from './servicePortValidation';

function resource(
  kind: 'Service' | 'Pod' | 'Deployment',
  spec: Record<string, unknown> = {}
): ServicePortResource {
  return servicePortResource(
    {
      kind,
      apiVersion: kind === 'Deployment' ? 'apps/v1' : 'v1',
      metadata: {
        name: kind.toLowerCase(),
        namespace: 'bookinfo',
        uid: kind,
        resourceVersion: '1',
        labels: { app: 'reviews' },
      },
      spec,
    },
    kind
  );
}
const service = () =>
  resource('Service', {
    selector: { app: 'reviews' },
    ports: [{ name: 'bad', port: 80 }],
  });
const pod = (annotations: Record<string, string> = {}) => ({
  ...resource('Pod'),
  annotations,
});
const deployment = (ports: { name?: string; containerPort: number }[] = []) =>
  resource('Deployment', { template: { spec: { containers: [{ ports }] } } });
const codes = (value: ReturnType<typeof servicePortValidation>) =>
  value.findings.map(finding => finding.code);
const check = (
  s = service(),
  pods: ServicePortResource[] = [],
  ds: ServicePortResource[] = [],
  ns: string[] = []
) => servicePortValidation(s, pods, ds, ns);

it.each([
  [[], true],
  [[pod()], false],
  [[pod({ 'sidecar.istio.io/status': '{"containers":["proxy"]}' })], true],
  [[pod({ 'sidecar.istio.io/status': '{"initContainers":["istio-proxy"]}' })], true],
  [[pod({ 'sidecar.istio.io/status': '{"initContainers":["other"]}' })], false],
  [[pod({ 'sidecar.istio.io/status': '{"containers":[]}' })], false],
  [[pod({ 'sidecar.istio.io/status': 'null' })], false],
  [[pod({ 'sidecar.istio.io/status': '{"containers":["proxy"]}' }), pod()], false],
  [
    [
      pod({ 'sidecar.istio.io/status': '{"containers":["proxy"]}' }),
      pod({
        'ambient.istio.io/redirection': 'enabled',
      }),
    ],
    true,
  ],
  [[pod({ 'ambient.istio.io/redirection': 'enabled' }), pod()], true],
  [[pod({ 'ambient.istio.io/redirection': 'Enabled' })], false],
])('retains all-sidecar/vacuous and any-ambient semantics %#', (pods, expected) => {
  const result = check(
    service(),
    pods.map((pod, index) => ({
      ...pod,
      uid: `pod-${index}`,
      name: `pod-${index}`,
    }))
  );
  expect(result.inMesh).toBe(expected);
  expect(codes(result)).toEqual(expected ? ['KIA0601'] : []);
});

it('uses annotations rather than actual proxy/init containers or correlation hints', () => {
  const p = pod();
  p.spec = { containers: [{ name: 'istio-proxy' }], initContainers: [{ name: 'istio-proxy' }] };
  Object.assign(p, { proxyMode: 'sidecar' });
  expect(check(service(), [p]).inMesh).toBe(false);
});
it('matches encoding/json case-insensitive status fields and last-value precedence', () => {
  expect(
    check(service(), [
      pod({
        'sidecar.istio.io/status': '{"Containers":["proxy"],"InitContainers":[]}',
      }),
    ]).inMesh
  ).toBe(true);
  expect(
    check(service(), [
      pod({ 'sidecar.istio.io/status': '{"containers":["proxy"],"Containers":[]}' }),
    ]).inMesh
  ).toBe(false);
});
it('validates both status arrays even when the first is mesh-positive', () => {
  expect(() =>
    check(service(), [
      pod({
        'sidecar.istio.io/status': '{"containers":["proxy"],"initContainers":[1]}',
      }),
    ])
  ).toThrow('Malformed');
});
it('an unmatched malformed sidecar annotation is not consumed by the caller', () => {
  const p = pod({ 'sidecar.istio.io/status': '{' });
  p.labels.app = 'unrelated';
  expect(check(service(), [p]).inMesh).toBe(true);
});
it('does not add a namespace filter to pooled Pod or Deployment label matching', () => {
  const p = pod();
  p.namespace = 'other';
  expect(check(service(), [p]).inMesh).toBe(false);
  const d = deployment();
  d.namespace = 'outside-managed';
  expect(codes(check(service(), [], [d]))).toEqual(['KIA0601', 'KIA0701']);
});
it('empty Service selectors select every pooled Pod, but never a Deployment', () => {
  const s = service();
  delete s.spec.selector;
  expect(check(s, [pod()], [deployment()])).toMatchObject({
    inMesh: false,
    matchedPods: 1,
    deployment: undefined,
    findings: [],
  });
  expect(check(s, [], [deployment()])).toMatchObject({ inMesh: true, deployment: undefined });
});
it('nonmatching Pods do not prevent vacuous mesh-positive naming', () => {
  const p = pod();
  p.labels = { app: 'other' };
  expect(check(service(), [p])).toMatchObject({ inMesh: true, matchedPods: 0 });
});

it.each([
  'grpc',
  'grpc-web',
  'http',
  'http2',
  'https',
  'mongo',
  'redis',
  'tcp',
  'tls',
  'udp',
  'mysql',
])('matches pinned name protocol %s and accepts its empty/arbitrary suffix', name => {
  for (const suffix of ['', '-', '-extra', '-HTTP']) {
    const s = service();
    s.spec.ports = [{ name: name + suffix, port: 80 }];
    expect(codes(check(s))).toEqual([]);
  }
});
it.each(['', 'HTTP', 'Http-api', 'httpapi', 'h2c', 'kubernetes.io/h2c', 'unknown'])(
  'rejects pinned invalid name %s',
  name => {
    const s = service();
    s.spec.ports = [{ name, port: 80 }];
    expect(codes(check(s))).toEqual(['KIA0601']);
  }
);
it.each(['http', 'HTTP', 'grpc-web', 'KUBERNETES.IO/H2C', 'kubernetes.io/ws', 'kubernetes.io/wss'])(
  'valid appProtocol %s supersedes an invalid name',
  appProtocol => {
    const s = service();
    s.spec.ports = [{ name: 'invalid', port: 80, appProtocol }];
    expect(codes(check(s))).toEqual([]);
  }
);
it.each(['', 'http-extra', 'http ', 'unknown'])(
  'invalid present appProtocol %s never falls back to a valid name',
  appProtocol => {
    const s = service();
    s.spec.ports = [{ name: 'http', port: 80, appProtocol }];
    expect(codes(check(s))).toEqual(['KIA0602']);
  }
);
it('null appProtocol uses naming and UDP skips naming but not mapping', () => {
  const s = service();
  s.spec.ports = [
    { name: 'bad', port: 80, appProtocol: null },
    { name: 'bad', port: 53, protocol: 'uDp', appProtocol: 'bad' },
  ];
  expect(check(s, [], [deployment()]).findings).toMatchObject([
    { code: 'KIA0601', path: 'spec/ports[0]', severity: 'error' },
    { code: 'KIA0701', path: 'spec/ports[0]', severity: 'warning' },
    { code: 'KIA0701', path: 'spec/ports[1]', severity: 'warning' },
  ]);
});
it('kiali_wizard presence skips naming, including empty values, but not mapping', () => {
  const s = service();
  s.labels.kiali_wizard = '';
  expect(codes(check(s, [], [deployment()]))).toEqual(['KIA0701']);
});
it.each([
  { 'gateway.istio.io/managed': 'istio.io-mesh-controller' },
  { 'gateway.istio.io/managed': 'istio.io-gateway-controller' },
  { 'gateway.networking.k8s.io/gateway-name': 'My-WayPoint' },
  { 'operator.istio.io/component': 'IngressGateways' },
  { 'operator.istio.io/component': 'EgressGateways' },
  { istio: 'ingressgateway' },
  { istio: 'egressgateway' },
  { 'istio.io/gateway-name': '' },
])('gateway/waypoint skips mapping, not naming %#', labels => {
  const s = service();
  Object.assign(s.labels, labels);
  expect(check(s, [], [deployment()])).toMatchObject({
    mappingExcluded: true,
    deployment: undefined,
  });
  expect(codes(check(s, [], [deployment()]))).toEqual(['KIA0601']);
});
it.each([
  { 'gateway.networking.k8s.io/gateway-name': 'regular' },
  { 'gateway.istio.io/managed': 'other' },
  { istio: 'eastwestgateway' },
])('does not generalize gateway exclusions %#', labels => {
  const s = service();
  Object.assign(s.labels, labels);
  expect(codes(check(s, [], [deployment()]))).toEqual(['KIA0601', 'KIA0701']);
});
it('only controller namespace, not every mesh root, skips mapping', () => {
  expect(codes(check(service(), [], [deployment()], ['bookinfo']))).toEqual(['KIA0601']);
  expect(codes(check(service(), [], [deployment()], ['istio-system']))).toEqual([
    'KIA0601',
    'KIA0701',
  ]);
});
it.each([
  [undefined, 80, undefined],
  [0, 80, undefined],
  ['', 80, undefined],
  [8080, 8080, undefined],
  ['web', 8080, 'web'],
  ['8080', 9090, '8080'],
])(
  'matches exact named/numeric target and protobuf defaults %#',
  (targetPort, containerPort, name) => {
    const s = service();
    s.spec.ports = [{ name: 'http', port: 80, targetPort }];
    expect(codes(check(s, [], [deployment([{ name, containerPort }])]))).toEqual([]);
  }
);
it('does not parse string targets numerically or compare port protocols', () => {
  const s = service();
  s.spec.ports = [{ name: 'http', port: 80, targetPort: '8080' }];
  expect(codes(check(s, [], [deployment([{ containerPort: 8080 }])]))).toEqual(['KIA0701']);
  s.spec.ports = [{ name: 'http', port: 80, protocol: 'TCP' }];
  const d = deployment([{ containerPort: 80 }]);
  d.spec.template = { spec: { containers: [{ ports: [{ containerPort: 80, protocol: 'UDP' }] }] } };
  expect(codes(check(s, [], [d]))).toEqual([]);
});
it('first metadata-label match wins regardless of namespace, template selector or later matches', () => {
  const a = deployment();
  a.namespace = 'other';
  a.spec.selector = { matchLabels: { app: 'not-reviews' } };
  const b = deployment([{ containerPort: 80 }]);
  b.uid = 'second';
  b.name = 'second';
  expect(codes(check(service(), [], [a, b]))).toEqual(['KIA0601', 'KIA0701']);
  expect(check(service(), [], [b, a]).deployment?.uid).toBe('second');
});
it('all regular containers are checked, but init containers are not', () => {
  const d = deployment();
  d.spec.template = {
    spec: {
      containers: [{ ports: [] }, { ports: [{ containerPort: 80 }] }],
      initContainers: [{ ports: [{ containerPort: 81 }] }],
    },
  };
  const s = service();
  s.spec.ports = [
    { name: 'http', port: 80 },
    { name: 'http-other', port: 81 },
  ];
  expect(check(s, [], [d]).findings).toMatchObject([{ code: 'KIA0701', path: 'spec/ports[1]' }]);
});
it('absence of a Deployment does not create a missing-Deployment warning', () => {
  expect(codes(check())).toEqual(['KIA0601']);
});
it('mapping runs independently of mesh-positive naming', () => {
  expect(codes(check(service(), [pod()], [deployment()]))).toEqual(['KIA0701']);
});
it('reuses captured per-code validation exclusions', () => {
  const s = service();
  s.annotations['kiali.io/ignore-validations'] = ' KIA0601 ';
  expect(check(s, [], [deployment()])).toMatchObject({ suppressed: 1 });
  expect(codes(check(s, [], [deployment()]))).toEqual(['KIA0701']);
});
it.each(['{', '[]', '{"containers":[1]}', '{"initContainers":"istio-proxy"}'])(
  'malformed relevant status %s defers rather than proving no sidecar',
  status => {
    expect(() => check(service(), [pod({ 'sidecar.istio.io/status': status })])).toThrow(
      'Malformed'
    );
  }
);
it('rejects malformed selected ports and selector maps', () => {
  for (const ports of [
    [{ port: -1 }],
    [{ port: 80, targetPort: {} }],
    [{ port: 80, appProtocol: 3 }],
    {},
  ]) {
    const s = service();
    s.spec.ports = ports;
    expect(() => check(s)).toThrow();
  }
  const s = service();
  s.spec.selector = { app: 2 };
  expect(() => check(s)).toThrow();
});
it('requires versioned, correctly scoped resource identities', () => {
  for (const field of ['uid', 'resourceVersion', 'namespace']) {
    expect(() =>
      servicePortResource(
        {
          kind: 'Pod',
          apiVersion: 'v1',
          spec: {},
          metadata: {
            name: 'pod',
            namespace: 'bookinfo',
            uid: 'uid',
            resourceVersion: '1',
            [field]: '',
          },
        },
        'Pod'
      )
    ).toThrow();
  }
});
it('rejects duplicate pooled identities even across source namespaces', () => {
  expect(() => check(service(), [pod(), { ...pod(), namespace: 'other' }])).toThrow('Duplicate');
});
it('enforces exact aggregate Pod and Deployment count bounds', () => {
  const make = (base: ServicePortResource, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...base,
      uid: `uid-${i}`,
      name: `name-${i}`,
    }));
  expect(() => check(service(), make(pod(), 1000), make(deployment(), 1000))).not.toThrow();
  expect(() => check(service(), make(pod(), 1001))).toThrow('1000-resource');
  expect(() => check(service(), [], make(deployment(), 1001))).toThrow('1000-resource');
});
it('enforces exact 20000-label and million-character annotation budgets', () => {
  const pods = Array.from({ length: 100 }, (_, i) => ({
    ...pod(),
    uid: `uid-${i}`,
    name: `name-${i}`,
    labels: Object.fromEntries(Array.from({ length: 200 }, (_, j) => [`key${j}`, 'v'])),
  }));
  const s = service();
  s.labels = {};
  expect(() => check(s, pods)).not.toThrow();
  pods[0].labels.extra = '';
  expect(() => check(s, pods)).toThrow('aggregate label');
  const p = pod();
  p.annotations = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => {
      const key = `key${i}`;
      return [key, 'x'.repeat(50000 - key.length)];
    })
  );
  expect(() => check(s, [p])).not.toThrow();
  p.annotations.key0 += 'x';
  expect(() => check(s, [p])).toThrow('annotation limits');
});
it('enforces selected Deployment container and per-container port bounds', () => {
  const d = deployment(Array.from({ length: 100 }, () => ({ containerPort: 80 })));
  expect(() => check(service(), [], [d])).not.toThrow();
  d.spec.template = {
    spec: { containers: [{ ports: Array.from({ length: 101 }, () => ({ containerPort: 80 })) }] },
  };
  expect(() => check(service(), [], [d])).toThrow('container ports');
});
it('ignores malformed container ports on nonmatching later Deployments', () => {
  const first = deployment([{ containerPort: 80 }]);
  const unrelated = deployment();
  unrelated.uid = 'other';
  unrelated.name = 'other';
  unrelated.labels = { app: 'elsewhere' };
  unrelated.spec.template = { spec: { containers: [{ ports: 'invalid' }] } };
  expect(codes(check(service(), [], [first, unrelated]))).toEqual(['KIA0601']);
});
it('enforces exact per-Service port and selector bounds', () => {
  const s = service();
  s.spec.ports = Array.from({ length: 100 }, () => ({ name: 'http', port: 80 }));
  s.spec.selector = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`key${i}`, 'v']));
  expect(() => check(s)).not.toThrow();
  Object.assign(s.spec.selector, { extra: '' });
  expect(() => check(s)).toThrow('bounded string maps');
  s.spec.selector = {};
  s.spec.ports = Array.from({ length: 101 }, () => ({ name: 'http', port: 80 }));
  expect(() => check(s)).toThrow('100 ports');
});
