import fixtureText from '../../test-files/parity/local-checks-oracle.json?raw';
import {
  GatewayCondition,
  localConfigurationChecks,
  matchesPortName,
  problematicGatewayCondition,
} from './localValidation';
import { initialValidation } from './validation';

type Input =
  | { operation: 'port'; name: string; protocol: string }
  | { operation: 'condition'; condition: GatewayCondition };
const fixtures: { commit: string; cases: { input: Input; expected: unknown }[] } =
  JSON.parse(fixtureText);
it('retains the pinned local-helper oracle and case count', () => {
  expect(fixtures.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(fixtures.cases).toHaveLength(564);
});
it.each(fixtures.cases)('matches original Go port/condition helper %#', ({ input, expected }) => {
  expect(
    input.operation === 'port'
      ? matchesPortName(input.name, input.protocol)
      : {
          gateway: problematicGatewayCondition(input.condition),
          listener: problematicGatewayCondition(input.condition, true),
        }
  ).toEqual(expected);
});
it.each(['ServiceEntry', 'Gateway'])(
  'does not activate the pinned dormant port checker for %s',
  kind => {
    const spec = {
      ports: [{ name: 'arbitrary-name', protocol: 'HTTP' }, null, { name: 'missing-protocol' }],
      servers: [{ port: { name: 'arbitrary-name', protocol: 'HTTP', number: 80 } }],
    };
    expect(localConfigurationChecks(kind, 'networking.istio.io', spec)).toEqual({
      findings: [],
      skipped: [],
    });
    const result = initialValidation({
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind,
      spec,
      annotations: { 'kiali.io/ignore-validations': 'KIA0601' },
      workloads: [],
      complete: false,
    });
    expect(result.findings).toEqual([]);
    expect(result.suppressed).toBe(0);
    expect(result.coverage).toBe('partial');
  }
);
it('preserves explicit JSON outbound modes instead of reproducing Go zero-enum ambiguity', () => {
  expect(
    localConfigurationChecks('Sidecar', 'networking.istio.io', { outboundTrafficPolicy: {} })
      .findings
  ).toMatchObject([{ code: 'KIA1007', severity: 'unknown', path: 'spec/outboundTrafficPolicy' }]);
  for (const mode of ['ALLOW_ANY', 'REGISTRY_ONLY']) {
    expect(
      localConfigurationChecks('Sidecar', 'networking.istio.io', {
        outboundTrafficPolicy: { mode },
      })
    ).toEqual({ findings: [], skipped: [] });
  }
  expect(
    localConfigurationChecks('Sidecar', 'networking.istio.io', {
      outboundTrafficPolicy: { mode: 0 },
    }).skipped.length
  ).toBe(1);
});
it('reports current Gateway/controller problems with accurate nested listener paths', () => {
  const condition = {
    type: 'Programmed',
    status: 'False',
    reason: 'Invalid',
    message: 'Bad configuration',
    observedGeneration: 2,
  };
  const result = localConfigurationChecks(
    'Gateway',
    'gateway.networking.k8s.io',
    {},
    {
      conditions: [condition],
      listeners: [{ name: 'http', conditions: [{ ...condition, type: 'ResolvedRefs' }] }],
    },
    2
  );
  expect(result.findings.map(f => [f.code, f.path, f.severity])).toEqual([
    ['GWAPI', 'status/conditions[0]/reason/Invalid', 'warning'],
    ['GWAPI', 'status/listeners[0]/conditions[0]/reason/Invalid', 'warning'],
  ]);
  expect(
    localConfigurationChecks('Gateway', 'networking.istio.io', {}, { conditions: [condition] }, 2)
      .findings
  ).toEqual([]);
});
it('keeps stale, missing and unknown condition evidence unassessed', () => {
  const conditions = [
    { type: 'Accepted', status: 'False', reason: 'Invalid', message: 'old', observedGeneration: 1 },
    { type: 'Accepted', status: 'False', reason: 'Invalid', message: 'missing' },
    {
      type: 'Programmed',
      status: 'Unknown',
      reason: 'Pending',
      message: 'pending',
      observedGeneration: 2,
    },
    {
      type: 'Programmed',
      status: 'False',
      reason: 'Pending',
      message: 'pending',
      observedGeneration: 2,
    },
  ];
  const result = localConfigurationChecks(
    'Gateway',
    'gateway.networking.k8s.io',
    {},
    { conditions },
    2
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped).toHaveLength(3);
  expect(
    localConfigurationChecks('Gateway', 'gateway.networking.k8s.io', {}, { conditions }).skipped[0]
  ).toContain('generation');
  expect(
    localConfigurationChecks('Gateway', 'gateway.networking.k8s.io', {}, undefined, 2).skipped[0]
  ).toContain('not reported');
});
it('honors ignore annotations for unknown and dynamically generated codes', () => {
  const input = {
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'Gateway',
    group: 'gateway.networking.k8s.io',
    spec: {},
    annotations: { 'kiali.io/ignore-validations': 'GWAPI' },
    workloads: [],
    complete: false,
    generation: 1,
    status: {
      conditions: [
        {
          type: 'Accepted',
          status: 'False',
          reason: 'Invalid',
          message: 'bad',
          observedGeneration: 1,
        },
      ],
    },
  };
  expect(initialValidation(input).suppressed).toBe(1);
  expect(initialValidation(input).findings).toEqual([]);
});
it('makes condition limits explicit rather than silently dropping the remainder', () => {
  const condition = {
    type: 'Accepted',
    status: 'False',
    reason: 'Invalid',
    message: 'bad',
    observedGeneration: 1,
  };
  const result = localConfigurationChecks(
    'Gateway',
    'gateway.networking.k8s.io',
    {},
    {
      listeners: Array.from({ length: 11 }, () => ({
        conditions: Array.from({ length: 100 }, () => condition),
      })),
    },
    1
  );
  expect(result.findings).toHaveLength(1000);
  expect(result.skipped).toContain('Gateway condition checks stopped at the 1,000-condition limit');
});
