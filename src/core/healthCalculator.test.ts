import oracleText from '../../test-files/parity/health-calculator.json?raw';
import {
  CalculatedHealth,
  calculateHealth,
  EntityHealth,
  HealthRateRule,
  parseHealthAnnotation,
  validateHealthRules,
} from './healthCalculator';

const oracle: {
  commit: string;
  cases: {
    input?: EntityHealth;
    rules?: HealthRateRule[];
    expected: Omit<CalculatedHealth, 'warnings'>;
    warningCount: number;
  }[];
} = JSON.parse(oracleText);

it('uses the pinned independently executed Go calculator', () => {
  expect(oracle.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(oracle.cases.length).toBeGreaterThan(250);
});

it.each(
  [
    {},
    null,
    [{ tolerance: 'wrong' }],
    [{ tolerance: [{ code: '5xx', degraded: Infinity, failure: 10 }] }],
    [{ tolerance: [{ code: '5xx', degraded: 11, failure: 10 }] }],
    [{ name: '(?=unsupported)', tolerance: [] }],
    [{ namespace: '[', tolerance: [] }],
    [{ tolerance: [], token: 'not-supported' }],
  ].map(value => ({ value }))
)('rejects invalid saved rule configuration %#', ({ value }) => {
  expect(() => validateHealthRules(value)).toThrow();
});

it('preserves empty rule matching defaults and float32 threshold conversion', () => {
  expect(validateHealthRules([{ tolerance: [{}] }])).toEqual([
    {
      name: '',
      kind: '',
      namespace: '',
      tolerance: [{ code: '', protocol: '', direction: '', degraded: 0, failure: 0 }],
    },
  ]);
  const parsed = parseHealthAnnotation('5xx,0.1,0.3,http,inbound');
  expect(parsed.tolerances[0].degraded).toBe(Math.fround(0.1));
  expect(parseHealthAnnotation('5xx, NaN,10,http,inbound').warnings.length).toBeGreaterThan(0);
  expect(parseHealthAnnotation('5xx, 1,10,http,inbound').tolerances).toEqual([]);
});
it.each(oracle.cases)('matches upstream health semantics for oracle case %#', fixture => {
  const result = calculateHealth(fixture.input ?? null, fixture.rules);
  expect(result.status).toBe(fixture.expected.status);
  expect(result.errorRatio).toBeCloseTo(fixture.expected.errorRatio, 10);
  expect(result.totalRequestRate).toBeCloseTo(fixture.expected.totalRequestRate, 10);
  expect(result.warnings.length > 0).toBe(fixture.warningCount > 0);
});

it('preserves explicit warnings for invalid annotation entries', () => {
  const result = parseHealthAnnotation('bad;5xx,1,10,http,inbound;5xx,10,1,http,outbound');
  expect(result.tolerances).toHaveLength(1);
  expect(result.warnings).toHaveLength(2);
});

it('uses bounded linear-time patterns and rejects non-finite metric input', () => {
  const input: EntityHealth = {
    namespace: 'bookinfo',
    name: 'reviews',
    kind: 'service',
    requests: { inbound: { http: { 503: NaN } } },
  };
  expect(() => calculateHealth(input)).toThrow('invalid');
  expect(() => parseHealthAnnotation('x'.repeat(4097))).toThrow('4,096');
  expect(() =>
    calculateHealth({ ...input, requests: {} }, [{ name: 'a'.repeat(513), tolerance: [] }])
  ).toThrow('512');
});
