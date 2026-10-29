import fixtureText from '../../test-files/parity/authorization-oracle.json?raw';
import {
  authorizationPolicyChecks,
  authorizationPolicyTargets,
  matchesAuthorizationNamespace,
  validAuthorizationMethod,
} from './authorizationValidation';
import { referenceValidationSources } from './referenceValidation';
import { initialValidation } from './validation';

const fixtures: {
  commit: string;
  cases: {
    input: { operation: 'method' | 'namespace'; value: string; namespaces?: string[] };
    expected: boolean;
  }[];
} = JSON.parse(fixtureText);
it('retains the pinned authorization-pattern oracle', () => {
  expect(fixtures.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(fixtures.cases).toHaveLength(296);
});
it.each(fixtures.cases)('matches original Go authorization helper %#', ({ input, expected }) => {
  expect(
    input.operation === 'method'
      ? validAuthorizationMethod(input.value)
      : matchesAuthorizationNamespace(input.value, input.namespaces ?? [])
  ).toBe(expected);
});
const spec = {
  rules: [
    {
      from: [
        { source: { namespaces: ['book*', 'missing', '*info'], notNamespaces: ['not-checked'] } },
      ],
      to: [
        {
          operation: {
            methods: ['get', '*ST', 'grpc.Service/Method', '*GET*'],
            notMethods: ['not-checked'],
          },
        },
      ],
    },
  ],
};
it('keeps method checks local and namespace absence dependent on complete evidence', () => {
  const deferred = authorizationPolicyChecks(
    'AuthorizationPolicy',
    'security.istio.io',
    spec,
    null
  );
  expect(deferred.findings.map(item => [item.code, item.path])).toEqual([
    ['KIA0102', 'spec/rules[0]/to[0]/operation/methods[2]'],
    ['KIA0102', 'spec/rules[0]/to[0]/operation/methods[3]'],
  ]);
  expect(deferred.skipped[0]).toContain('complete bounded namespace list');
  const complete = authorizationPolicyChecks('AuthorizationPolicy', 'security.istio.io', spec, [
    'bookinfo',
  ]);
  expect(complete.findings.map(item => item.code)).toEqual(['KIA0102', 'KIA0102', 'KIA0101']);
  expect(complete.findings[2]).toMatchObject({
    severity: 'warning',
    path: 'spec/rules[0]/from[0]/source/namespaces[1]',
  });
  expect(complete.skipped).toEqual([]);
});
it('reads namespaces only for positive namespace references and respects ignore annotations', () => {
  expect(
    referenceValidationSources('AuthorizationPolicy', 'security.istio.io', spec, null)
  ).toEqual(['namespaces']);
  const local = {
    rules: [
      {
        to: [{ operation: { methods: ['invalid'] } }],
        from: [{ source: { notNamespaces: ['missing'] } }],
      },
    ],
  };
  expect(
    referenceValidationSources('AuthorizationPolicy', 'security.istio.io', local, null)
  ).toEqual([]);
  expect(
    initialValidation({
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind: 'AuthorizationPolicy',
      group: 'security.istio.io',
      spec: local,
      annotations: { 'kiali.io/ignore-validations': 'KIA0102' },
      workloads: [],
      complete: false,
    })
  ).toMatchObject({ findings: [], suppressed: 1 });
});
it.each([
  { rules: false },
  { rules: [42] },
  { rules: [{ from: [false] }] },
  { rules: [{ from: [{ source: false }] }] },
  { rules: [{ to: [{ operation: { methods: [false] } }] }] },
  { rules: [{ to: [{ operation: { methods: ['a'.repeat(513)] } }] }] },
  { rules: Array(101).fill({}) },
  { rules: Array(11).fill({ from: Array(100).fill(null) }) },
  {
    rules: [
      {
        to: [{ operation: { methods: Array(200).fill('GET') } }],
        from: [{ source: { namespaces: ['bookinfo'] } }],
      },
    ],
  },
])('defers malformed or oversized input without fabricated findings %#', value => {
  expect(authorizationPolicyTargets(value).complete).toBe(false);
  const result = authorizationPolicyChecks('AuthorizationPolicy', 'security.istio.io', value, [
    'bookinfo',
  ]);
  expect(result.findings).toEqual([]);
  expect(result.skipped.length).toBeGreaterThan(0);
});
it('preserves nil rule/group handling and does not apply to a different API kind or group', () => {
  const value = {
    rules: [null, { from: [null, { source: null }], to: [null, { operation: null }] }],
  };
  expect(authorizationPolicyChecks('AuthorizationPolicy', 'security.istio.io', value, [])).toEqual({
    findings: [],
    skipped: [],
  });
  expect(authorizationPolicyChecks('AuthorizationPolicy', 'networking.istio.io', spec, [])).toEqual(
    { findings: [], skipped: [] }
  );
  expect(authorizationPolicyChecks('RequestAuthentication', 'security.istio.io', spec, [])).toEqual(
    { findings: [], skipped: [] }
  );
});
