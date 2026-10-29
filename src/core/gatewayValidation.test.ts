import { configurationReferences } from './configuration';
import {
  gatewayReferenceValidation,
  gatewayValidationSources,
  matchingReferenceGrant,
} from './gatewayValidation';
import { decodeLabelSelector, matchesSelector } from './labels';
import { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import { initialValidation } from './validation';

const group = 'gateway.networking.k8s.io';
const record = (
  name: string,
  namespace: string,
  spec: Record<string, unknown> = {}
): ValidationRecord => ({
  name,
  namespace,
  spec,
  labels: {},
});
const context: ReferenceValidationContext = {
  cluster: 'alpha',
  identityDomain: null,
  namespaces: {
    complete: true,
    items: [
      {
        ...record('bookinfo', ''),
        labels: { team: 'mesh', 'kubernetes.io/metadata.name': 'bookinfo' },
      },
      record('edge', ''),
    ],
  },
  gateways: { complete: true, items: [] },
  services: { complete: true, items: [record('reviews', 'bookinfo'), record('remote', 'edge')] },
  referenceGrants: { complete: true, items: [] },
  destinationRules: { complete: false, items: [] },
  sidecars: { complete: false, items: [] },
};
const grant = (kind = 'HTTPRoute', name?: string) =>
  record('grant', 'edge', {
    from: [{ group, kind, namespace: 'bookinfo' }],
    to: [{ group: '', kind: 'Service', ...(name === undefined ? {} : { name }) }],
  });

it.each(['HTTPRoute', 'GRPCRoute'])(
  'retains the pinned missing-parent code/path for %s with API defaults',
  kind => {
    const spec = { parentRefs: [{ name: 'public' }] };
    expect(gatewayReferenceValidation(kind, group, 'bookinfo', spec, context).findings).toEqual([
      {
        code: 'KIA1401',
        severity: 'error',
        path: 'spec/parentRefs[0]/name/public',
        message: 'Route is pointing to a non-existent or inaccessible K8s gateway',
      },
    ]);
    const found = {
      ...context,
      gateways: { complete: true, items: [record('public', 'bookinfo')] },
    };
    expect(gatewayReferenceValidation(kind, group, 'bookinfo', spec, found).findings).toEqual([]);
    expect(
      gatewayReferenceValidation(kind, 'networking.istio.io', 'bookinfo', spec, context)
    ).toEqual({ findings: [], skipped: [] });
  }
);
it.each([
  { from: 'All', allowed: true },
  { from: 'Same', allowed: false },
  { from: undefined, allowed: false },
  { from: 'Selector', selector: { matchLabels: { team: 'mesh' } }, allowed: true },
  { from: 'Selector', selector: { matchLabels: { team: 'other' } }, allowed: false },
  {
    from: 'Selector',
    selector: { matchExpressions: [{ key: 'team', operator: 'In', values: ['mesh'] }] },
    allowed: true,
  },
  {
    from: 'Selector',
    selector: { matchExpressions: [{ key: 'missing', operator: 'NotIn', values: ['mesh'] }] },
    allowed: true,
  },
])('uses full namespace selectors for cross-namespace Gateway sharing %#', value => {
  const ctx = {
    ...context,
    gateways: {
      complete: true,
      items: [
        record('public', 'edge', {
          listeners: [
            {
              name: 'http',
              allowedRoutes: { namespaces: { from: value.from, selector: value.selector } },
            },
          ],
        }),
      ],
    },
  };
  const result = gatewayReferenceValidation(
    'HTTPRoute',
    group,
    'bookinfo',
    {
      parentRefs: [{ name: 'public', namespace: 'edge' }],
    },
    ctx
  );
  expect(result.findings.map(f => f.code)).toEqual(value.allowed ? [] : ['KIA1401']);
});
it('retains malformed-selector and partial-read uncertainty without reporting an absent Gateway', () => {
  const spec = { parentRefs: [{ name: 'public', namespace: 'edge' }] };
  const ctx = {
    ...context,
    gateways: {
      complete: true,
      items: [
        record('public', 'edge', {
          listeners: [
            {
              allowedRoutes: {
                namespaces: {
                  from: 'Selector',
                  selector: {
                    matchExpressions: [{ key: 'team', operator: 'Exists', values: ['invalid'] }],
                  },
                },
              },
            },
          ],
        }),
      ],
    },
  };
  const malformed = gatewayReferenceValidation('HTTPRoute', group, 'bookinfo', spec, ctx);
  expect(malformed.findings).toEqual([]);
  expect(malformed.skipped[0]).toContain('Existence selectors');
  for (const partial of [
    { ...context, gateways: { complete: false, items: [] } },
    { ...ctx, namespaces: { complete: false, items: [] } },
  ]) {
    const result = gatewayReferenceValidation('HTTPRoute', group, 'bookinfo', spec, partial);
    expect(result.findings).toEqual([]);
    expect(result.skipped[0]).toContain('complete');
  }
});
it.each(['HTTPRoute', 'GRPCRoute'])(
  'checks %s Service backends, parents and mirrors using shared traversal',
  kind => {
    const spec = {
      parentRefs: [{ group: '', kind: 'Service', name: 'reviews' }],
      rules: [
        {
          backendRefs: [
            { name: 'missing' },
            {
              name: 'reviews',
              filters: [{ requestMirror: { backendRef: { name: 'dotted.service' } } }],
            },
          ],
          filters: [{ requestMirror: { backendRef: { name: 'reviews' } } }],
        },
      ],
    };
    const result = gatewayReferenceValidation(kind, group, 'bookinfo', spec, context);
    expect(result.findings.map(f => [f.code, f.path])).toEqual([
      ['KIA1402', 'spec/rules[0]/backendRefs[0]/name'],
      ['KIA1402', 'spec/rules[0]/backendRefs[1]/filters[0]/requestMirror/backendRef/name'],
    ]);
    expect(configurationReferences(kind, spec, 'bookinfo', group)).toHaveLength(5);
  }
);
it('requires ReferenceGrant source/target groups, kinds, namespaces and optional target name', () => {
  const from = { namespace: 'bookinfo', kind: 'HTTPRoute', group };
  const to = { namespace: 'edge', kind: 'Service', group: '', name: 'remote' };
  expect(matchingReferenceGrant([grant()], from, to)).toBe(true);
  expect(matchingReferenceGrant([grant('HTTPRoute', 'remote')], from, to)).toBe(true);
  for (const grants of [
    [grant('GRPCRoute')],
    [grant('HTTPRoute', 'other')],
    [{ ...grant(), namespace: 'other' }],
    [
      record('wrong-group', 'edge', {
        from: [{ namespace: 'bookinfo', kind: 'HTTPRoute', group: 'foreign.example' }],
        to: [{ group: '', kind: 'Service' }],
      }),
    ],
    [
      record('wrong-target', 'edge', {
        from: [{ namespace: 'bookinfo', kind: 'HTTPRoute', group }],
        to: [{ group: 'foreign.example', kind: 'Service' }],
      }),
    ],
  ])
    expect(matchingReferenceGrant(grants, from, to)).toBe(false);
  expect(() =>
    matchingReferenceGrant(
      [
        record('malformed', 'edge', {
          from: [{ namespace: 'bookinfo', kind: 'HTTPRoute' }],
          to: [{ kind: 'Service' }],
        }),
      ],
      from,
      to
    )
  ).toThrow('Malformed ReferenceGrant');
});
it.each(['HTTPRoute', 'GRPCRoute'])(
  'never permits a cross-namespace Service for %s through another route kind',
  kind => {
    const spec = { rules: [{ backendRefs: [{ name: 'remote', namespace: 'edge' }] }] };
    const validate = (ctx: ReferenceValidationContext) =>
      gatewayReferenceValidation(kind, group, 'bookinfo', spec, ctx);
    expect(validate(context).findings.map(f => f.code)).toEqual(['KIA1402']);
    const present = { ...context, referenceGrants: { complete: true, items: [grant(kind)] } };
    expect(validate(present).findings).toEqual([]);
    const denied = validate({ ...present, referenceGrants: { complete: false, items: [] } });
    expect(denied.findings).toEqual([]);
    expect(denied.skipped[0]).toContain('complete ReferenceGrants');
  }
);
it('plans only applicable groups and keeps unknown kinds explicitly unevaluated', () => {
  const spec = {
    parentRefs: [{ name: 'public', namespace: 'edge' }],
    rules: [
      {
        backendRefs: [
          { name: 'remote', namespace: 'edge' },
          { name: 'pool', group: 'inference.networking.k8s.io', kind: 'InferencePool' },
        ],
      },
    ],
  };
  expect(gatewayValidationSources('HTTPRoute', group, 'bookinfo', spec)).toEqual([
    'gateways',
    'namespaces',
    'services',
    'referenceGrants',
  ]);
  expect(
    gatewayValidationSources('HTTPRoute', group, 'bookinfo', {
      parentRefs: [{ name: 'public' }],
      rules: [{ backendRefs: [{ name: 'reviews' }] }],
    })
  ).toEqual(['gateways', 'services']);
  const result = gatewayReferenceValidation('HTTPRoute', group, 'bookinfo', spec, context);
  expect(result.skipped.some(value => value.includes('InferencePool'))).toBe(true);
});
it('keeps bounded findings compatible with ignore annotations and explicit cluster ownership', () => {
  const input = {
    kind: 'HTTPRoute',
    group,
    cluster: 'alpha',
    namespace: 'bookinfo',
    context,
    spec: { parentRefs: [{ name: 'missing' }] },
    annotations: { 'kiali.io/ignore-validations': 'KIA1401' },
    workloads: [],
    complete: false,
  };
  expect(initialValidation(input).suppressed).toBe(1);
  expect(initialValidation(input).findings).toEqual([]);
  expect(() => initialValidation({ ...input, cluster: 'beta' })).toThrow('different cluster');
  const over = gatewayReferenceValidation(
    'HTTPRoute',
    group,
    'bookinfo',
    {
      parentRefs: Array.from({ length: 201 }, () => ({ name: 'missing' })),
    },
    context
  );
  expect(over.findings).toEqual([]);
  expect(over.skipped[0]).toContain('200-reference');
});
it('decodes unknown selectors safely and never ignores unsupported fields', () => {
  const selector = decodeLabelSelector({ matchExpressions: [{ key: 'team', operator: 'Exists' }] });
  expect(matchesSelector({ team: 'mesh' }, selector)).toBe(true);
  for (const value of [
    null,
    [],
    { unsupported: true },
    { matchLabels: { team: 3 } },
    { matchExpressions: [{ key: 'team', operator: 'Unknown' }] },
    { matchExpressions: [{ key: 'team', operator: 'In', values: [] }] },
    { matchExpressions: Array.from({ length: 101 }, () => ({ key: 'team', operator: 'Exists' })) },
  ])
    expect(() => decodeLabelSelector(value)).toThrow();
});
