import oracleText from '../../test-files/parity/destination-tls-oracle.json?raw';
import { destinationRuleChecks, destinationRuleTlsOverrides } from './destinationRuleValidation';
import { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import { initialValidation } from './validation';
const fixture: {
  cases: {
    input: { domain: string; records: Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[] };
    expected: number[][];
  }[];
} = JSON.parse(oracleText);
it.each(fixture.cases)('matches original Go TLS override references %#', ({ input, expected }) => {
  expect(
    input.records.map((_record, index) =>
      destinationRuleTlsOverrides(input.records, input.domain, index)
    )
  ).toEqual(expected);
});
const record = (
  name: string,
  namespace: string,
  spec: Record<string, unknown> = {}
): ValidationRecord => ({ name, namespace, uid: `${namespace}-${name}`, labels: {}, spec });
const spec = { host: 'reviews', exportTo: ['*'] };
const owner = { name: 'selected', uid: 'bookinfo-selected' };
const context = (): ReferenceValidationContext => ({
  cluster: 'alpha',
  identityDomain: 'svc.cluster.local',
  namespaces: { complete: true, items: [record('bookinfo', ''), record('other', '')] },
  sidecars: { complete: true, items: [] },
  destinationRules: {
    complete: true,
    items: [
      record('selected', 'bookinfo', spec),
      record('mesh-default', 'other', {
        host: '*.local',
        trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } },
        exportTo: ['*'],
      }),
    ],
  },
});
const check = (value = context(), selected: Record<string, unknown> = spec) =>
  destinationRuleChecks(
    'DestinationRule',
    'networking.istio.io',
    'bookinfo',
    selected,
    value,
    owner
  );
it('emits the pinned configuration warning with related defaults, not an encryption verdict', () => {
  expect(check()).toEqual({
    skipped: [],
    findings: [
      {
        code: 'KIA0204',
        severity: 'warning',
        path: 'spec/trafficPolicy',
        message: 'mTLS settings of a non-local Destination Rule are overridden',
        references: [
          {
            kind: 'DestinationRule',
            group: 'networking.istio.io',
            name: 'mesh-default',
            namespace: 'other',
            uid: 'other-mesh-default',
          },
        ],
      },
    ],
  });
  const ignored = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'DestinationRule',
    spec,
    owner,
    context: context(),
    workloads: [],
    complete: false,
    annotations: { 'kiali.io/ignore-validations': 'KIA0204' },
  });
  expect(ignored.findings).toEqual([]);
  expect(ignored.suppressed).toBe(1);
});
it.each([{ tls: {} }, { tls: { mode: 'DISABLE' } }, { portLevelSettings: [{ tls: {} }] }])(
  'recognizes supplied TLS settings without interpreting them as enabled: %j',
  policy => {
    const selected = { ...spec, trafficPolicy: policy };
    const value = context();
    value.destinationRules.items = [
      record('selected', 'bookinfo', selected),
      value.destinationRules.items[1],
    ];
    expect(check(value, selected).findings).toEqual([]);
  }
);
it('retains export/import gates and rejects a stale TLS-presence snapshot', () => {
  const value = context();
  value.destinationRules.items[1].spec = {
    ...value.destinationRules.items[1].spec,
    exportTo: ['.'],
  };
  expect(check(value).findings).toEqual([]);
  const changed = context();
  changed.destinationRules.items[0].spec = {
    ...spec,
    trafficPolicy: { portLevelSettings: [{ tls: {} }] },
  };
  expect(check(changed).findings).toEqual([]);
  expect(check(changed).skipped[0]).toContain('relevant specification changed');
});
it('keeps bounded port settings and malformed TLS evidence explicit', () => {
  for (const policy of [
    { portLevelSettings: [null] },
    { portLevelSettings: [{ tls: 'bad' }] },
    { portLevelSettings: Array.from({ length: 101 }, () => ({})) },
  ]) {
    expect(() =>
      destinationRuleTlsOverrides(
        [record('bad', 'bookinfo', { ...spec, trafficPolicy: policy })],
        'svc.cluster.local',
        0
      )
    ).toThrow();
  }
});
