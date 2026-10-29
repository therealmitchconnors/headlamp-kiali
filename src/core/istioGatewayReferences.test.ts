import {
  istioGatewayReferenceChecks,
  virtualServiceGatewayReferences,
} from './istioGatewayReferences';
import { ReferenceValidationContext,referenceValidationSources } from './referenceValidation';
import { initialValidation } from './validation';

const empty = { complete: false, items: [] };
const context: ReferenceValidationContext = {
  cluster: 'alpha',
  identityDomain: null,
  namespaces: empty,
  destinationRules: empty,
  sidecars: empty,
  istioGateways: {
    complete: true,
    items: [
      { name: 'local', namespace: 'bookinfo', labels: {}, spec: {} },
      { name: 'public', namespace: 'edge', labels: {}, spec: {} },
      { name: 'dotted.name', namespace: 'edge', labels: {}, spec: {} },
    ],
  },
};
const check = (spec: Record<string, unknown>, source: ReferenceValidationContext = context) =>
  istioGatewayReferenceChecks('VirtualService', 'networking.istio.io', 'bookinfo', spec, source);

it('resolves current namespace and explicit namespace/name references without guessing DNS', () => {
  expect(check({ gateways: ['mesh', 'local', 'edge/public', 'edge/dotted.name'] })).toEqual({
    findings: [],
    skipped: [],
  });
  expect(
    referenceValidationSources(
      'VirtualService',
      'networking.istio.io',
      { gateways: ['edge/public'] },
      null
    )
  ).toEqual(['istioGateways']);
});
it('keeps API groups separate and never uses Gateway API objects as Istio Gateways', () => {
  const source = {
    ...context,
    istioGateways: { complete: true, items: [] },
    gateways: context.istioGateways,
  };
  expect(check({ gateways: ['edge/public'] }, source).findings).toMatchObject([
    { code: 'KIA1102', path: 'spec/gateways[0]', severity: 'error' },
  ]);
  expect(
    istioGatewayReferenceChecks(
      'Gateway',
      'gateway.networking.k8s.io',
      'bookinfo',
      { gateways: ['missing'] },
      source
    )
  ).toEqual({ findings: [], skipped: [] });
});
it('evaluates every top-level and HTTP/TCP/TLS match reference with precise field paths', () => {
  const result = check({
    gateways: ['missing'],
    http: [
      { match: [{ gateways: ['a'] }, { gateways: ['b', 'mesh'] }] },
      { match: [{ gateways: ['c'] }] },
    ],
    tcp: [{ match: [{ gateways: ['d'] }] }],
    tls: [{ match: [{ gateways: ['e'] }] }],
  });
  expect(result.findings.map(item => item.path)).toEqual([
    'spec/gateways[0]',
    'spec/http[0]/match[0]/gateways[0]',
    'spec/http[0]/match[1]/gateways[0]',
    'spec/http[1]/match[0]/gateways[0]',
    'spec/tcp[0]/match[0]/gateways[0]',
    'spec/tls[0]/match[0]/gateways[0]',
  ]);
});
it('reports legacy nomenclature locally but defers DNS-dependent absence checks', () => {
  const spec = { http: [{ match: [{ gateways: ['public.edge'] }] }] };
  const result = check(spec);
  expect(result.findings).toMatchObject([
    { code: 'KIA1108', severity: 'unknown', path: 'spec/http[0]/match[0]/gateways[0]' },
  ]);
  expect(result.skipped[0]).toContain('DNS identity domain');
  expect(referenceValidationSources('VirtualService', 'networking.istio.io', spec, null)).toEqual(
    []
  );
  expect(
    check(spec, { ...context, identityDomain: 'svc.cluster.local' }).findings.map(item => item.code)
  ).toEqual(['KIA1108']);
  expect(
    check(
      { gateways: ['public.edge.svc.cluster.local'] },
      { ...context, identityDomain: 'svc.cluster.local' }
    ).findings.map(item => item.code)
  ).toEqual(['KIA1108']);
  expect(
    check(
      { gateways: ['public.edge.svc.other'] },
      { ...context, identityDomain: 'svc.cluster.local' }
    ).findings.map(item => item.code)
  ).toEqual(['KIA1108', 'KIA1102']);
});
it('requires complete bounded evidence before asserting a missing Gateway', () => {
  for (const istioGateways of [
    undefined,
    { complete: false, items: [] },
    {
      complete: true,
      items: Array(1001).fill({ name: 'public', namespace: 'edge', labels: {}, spec: {} }),
    },
  ]) {
    const result = check({ gateways: ['missing'] }, { ...context, istioGateways });
    expect(result.findings).toEqual([]);
    expect(result.skipped[0]).toContain('complete bounded');
  }
});
it.each([
  { gateways: 'missing' },
  { gateways: [null] },
  { gateways: [''] },
  { gateways: Array(201).fill('mesh') },
  { http: [null] },
  { http: [{ match: [null] }] },
  { tcp: [{ match: false }] },
  { tls: Array(101).fill({}) },
  { http: Array(11).fill({ match: Array(100).fill({}) }) },
  { gateways: Array(200).fill('mesh'), http: [{ match: [{ gateways: ['mesh'] }] }] },
])('defers malformed or oversized reference extraction without partial findings %#', spec => {
  expect(virtualServiceGatewayReferences(spec).complete).toBe(false);
  const result = check(spec);
  expect(result.findings).toEqual([]);
  expect(result.skipped.length).toBeGreaterThan(0);
});
it('honors ignore annotations and retains other source requirements', () => {
  const spec = {
    gateways: ['missing'],
    http: [{ route: [{ destination: { host: 'reviews', subset: 'v1' } }] }],
  };
  expect(
    referenceValidationSources('VirtualService', 'networking.istio.io', spec, 'svc.cluster.local')
  ).toEqual([
    'namespaces',
    'services',
    'serviceEntries',
    'istioGateways',
    'destinationRules',
    'sidecars',
  ]);
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'VirtualService',
    spec,
    annotations: { 'kiali.io/ignore-validations': 'KIA1102' },
    workloads: [],
    complete: false,
    context,
  });
  expect(result.findings.some(item => item.code === 'KIA1102')).toBe(false);
  expect(result.suppressed).toBe(1);
});
