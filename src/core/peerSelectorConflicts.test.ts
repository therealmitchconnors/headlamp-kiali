import oracleText from '../../test-files/parity/peer-selectorless-oracle.json?raw';
import {
  peerSelectorlessChecks,
  peerSelectorlessNeedsContext,
  peerSelectorlessReferences,
} from './peerSelectorConflicts';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { initialValidation } from './validation';

const oracle: {
  cases: {
    input: { records: Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[] };
    expected: {
      references: number[];
      checks: { Code: string; Severity: string; Message: string; Path: string }[];
    }[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)('matches original Go selectorless grouping %#', ({ input, expected }) => {
  input.records.forEach((record, index) => {
    expect(peerSelectorlessReferences(input.records, index)).toEqual(expected[index].references);
    const records = input.records.map((record, i) => ({ ...record, uid: `uid-${i}`, labels: {} }));
    const ctx = context();
    ctx.peerAuthentications = { complete: true, items: records };
    ctx.namespaceMesh = new Map(
      input.records.map(record => [
        record.namespace,
        {
          status: 'ready' as const,
          controller: 'istiod',
          fields: { hasDiscoverySelectors: false },
        },
      ])
    );
    const result = peerSelectorlessChecks(
      'PeerAuthentication',
      'security.istio.io',
      record.namespace,
      record.spec,
      ctx,
      { name: record.name, uid: records[index].uid }
    );
    expect(result.skipped).toEqual([]);
    expect(
      result.findings.map(f => ({
        Code: f.code,
        Severity: f.severity,
        Message: f.message,
        Path: f.path,
      }))
    ).toEqual(expected[index].checks);
  });
});
const record = (
  name: string,
  namespace = 'bookinfo',
  spec: Record<string, unknown> = {}
): ValidationRecord => ({ name, namespace, uid: `${namespace}-${name}`, labels: {}, spec });
function context(): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: null,
    namespaces: { complete: true, items: [] },
    destinationRules: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
    peerAuthentications: { complete: true, items: [record('selected'), record('peer')] },
    namespaceMesh: new Map([
      [
        'bookinfo',
        {
          status: 'ready',
          controller: 'istiod',
          fields: { hasDiscoverySelectors: false },
        },
      ],
    ]),
  };
}
const owner = { name: 'selected', uid: 'bookinfo-selected' };
const check = (ctx = context(), spec: Record<string, unknown> = {}) =>
  peerSelectorlessChecks('PeerAuthentication', 'security.istio.io', 'bookinfo', spec, ctx, owner);
it('preserves same-namespace observed identity and error severity', () => {
  expect(check()).toEqual({
    skipped: [],
    findings: [
      {
        code: 'KIA0002',
        severity: 'error',
        path: 'spec/selector',
        message: 'More than one selector-less object in the same namespace',
        references: [
          {
            kind: 'PeerAuthentication',
            group: 'security.istio.io',
            namespace: 'bookinfo',
            name: 'peer',
            uid: 'bookinfo-peer',
          },
        ],
      },
    ],
  });
  const ctx = context();
  ctx.peerAuthentications!.items = [record('selected'), record('peer', 'root')];
  expect(check(ctx).findings).toEqual([]);
  expect(
    initialValidation({
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind: 'PeerAuthentication',
      group: 'security.istio.io',
      context: context(),
      owner,
      spec: {},
      annotations: { 'kiali.io/ignore-validations': 'KIA0002' },
      workloads: [],
      complete: false,
    }).suppressed
  ).toBe(1);
});
it.each([{}, { selector: null }, { selector: {} }, { selector: { matchLabels: {} } }])(
  'counts empty selectors separately from mTLS checker rules %#',
  spec => {
    expect(check(context(), spec).findings).toHaveLength(1);
    expect(peerSelectorlessNeedsContext('PeerAuthentication', 'security.istio.io', spec)).toBe(
      true
    );
    expect(
      referenceValidationSources('PeerAuthentication', 'security.istio.io', spec, null)
    ).toEqual(['namespaces', 'peerAuthentications']);
  }
);
it('keeps strict-mode policy reads independent and does not enable RequestAuthentication', () => {
  expect(
    referenceValidationSources(
      'PeerAuthentication',
      'security.istio.io',
      { mtls: { mode: 'STRICT' } },
      null
    )
  ).toEqual(['namespaces', 'destinationRules', 'peerAuthentications']);
  const selected = { selector: { matchLabels: { app: 'reviews' } } };
  expect(
    peerSelectorlessChecks('PeerAuthentication', 'security.istio.io', 'bookinfo', selected)
  ).toEqual({ findings: [], skipped: [] });
  expect(
    peerSelectorlessChecks('RequestAuthentication', 'security.istio.io', 'bookinfo', {})
  ).toEqual({ findings: [], skipped: [] });
  expect(peerSelectorlessChecks('PeerAuthentication', 'wrong.group', 'bookinfo', {})).toEqual({
    findings: [],
    skipped: [],
  });
});
it.each(['uid', 'selector', 'missing', 'duplicate', 'partial', 'mesh'])(
  'defers %s evidence',
  mode => {
    const ctx = context();
    const items = [...ctx.peerAuthentications!.items];
    if (mode === 'uid') items[0] = { ...items[0], uid: 'changed' };
    if (mode === 'selector')
      items[0] = { ...items[0], spec: { selector: { matchLabels: { app: 'other' } } } };
    if (mode === 'missing') items.shift();
    if (mode === 'duplicate') items.push(items[0]);
    ctx.peerAuthentications = { complete: mode !== 'partial', items };
    if (mode === 'mesh')
      ctx.namespaceMesh = new Map([
        ['bookinfo', { status: 'unavailable', message: 'Mesh denied' }],
      ]);
    expect(check(ctx).findings).toEqual([]);
    expect(check(ctx).skipped).toHaveLength(1);
  }
);
it.each([
  { selector: [] },
  { selector: { unsupported: true } },
  { selector: { matchLabels: [] } },
  { selector: { matchLabels: { app: 1 } } },
  { selector: { matchLabels: { app: 'x'.repeat(1025) } } },
])('reports malformed or unsupported selectors %#', spec => {
  expect(check(context(), spec).findings).toEqual([]);
  expect(check(context(), spec).skipped).toHaveLength(1);
  expect(peerSelectorlessNeedsContext('PeerAuthentication', 'security.istio.io', spec)).toBe(false);
});
it('bounds record counts, selector entries and aggregate text', () => {
  expect(() => peerSelectorlessReferences(Array(1001).fill(record('a')), 0)).toThrow(
    'bounded records'
  );
  const manyLabels = Object.fromEntries(
    Array.from({ length: 257 }, (_, i) => [`key${i}`, 'value'])
  );
  expect(() =>
    peerSelectorlessReferences(
      [record('a'), record('b', 'bookinfo', { selector: { matchLabels: manyLabels } })],
      0
    )
  ).toThrow('256');
  const labels = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`k${i}`, 'x'.repeat(1000)])
  );
  expect(() =>
    peerSelectorlessReferences(
      [
        record('a'),
        ...Array.from({ length: 10 }, (_, i) =>
          record(`b${i}`, 'bookinfo', { selector: { matchLabels: labels } })
        ),
      ],
      0
    )
  ).toThrow('1000000');
});

it('allows exactly the aggregate label/text budgets and rejects their next contribution', () => {
  const labels = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, 'value']));
  const records = [
    record('selected'),
    ...Array.from({ length: 100 }, (_, i) =>
      record(`peer${i}`, 'bookinfo', { selector: { matchLabels: labels } })
    ),
  ];
  expect(peerSelectorlessReferences(records, 0)).toEqual([]);
  expect(() =>
    peerSelectorlessReferences(
      [...records, record('extra', 'bookinfo', { selector: { matchLabels: { extra: '' } } })],
      0
    )
  ).toThrow('10000 labels');
  const textLabels = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`key${String(i).padStart(3, '0')}`, 'x'.repeat(994)])
  );
  const textRecords = [
    record('selected'),
    ...Array.from({ length: 10 }, (_, i) =>
      record(`peer${i}`, 'bookinfo', { selector: { matchLabels: textLabels } })
    ),
  ];
  expect(peerSelectorlessReferences(textRecords, 0)).toEqual([]);
  expect(() =>
    peerSelectorlessReferences(
      [...textRecords, record('extra', 'bookinfo', { selector: { matchLabels: { x: '' } } })],
      0
    )
  ).toThrow('1000000 label-text');
});
