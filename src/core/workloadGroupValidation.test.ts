import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { initialValidation } from './validation';
import { workloadGroupChecks } from './workloadGroupValidation';

const spec = { metadata: { labels: { app: 'reviews', version: 'v1' } } };
const owner = { name: 'one', uid: 'uid-one' };
const record = (name: string, value: Record<string, unknown> = spec): ValidationRecord => ({
  name,
  uid: `uid-${name}`,
  namespace: 'bookinfo',
  labels: {},
  spec: value,
});
const empty = { complete: false, items: [] };
const context: ReferenceValidationContext = {
  cluster: 'alpha',
  identityDomain: null,
  namespaces: empty,
  destinationRules: empty,
  sidecars: empty,
  workloadGroups: {
    namespace: 'bookinfo',
    complete: true,
    items: [
      record('one'),
      record('two', { metadata: { labels: { version: 'v1', app: 'reviews' } } }),
    ],
  },
};
const check = (
  value: Record<string, unknown> = spec,
  source: ReferenceValidationContext = context,
  target = owner
) => workloadGroupChecks('WorkloadGroup', 'networking.istio.io', 'bookinfo', value, source, target);
it('matches complete label maps independent of order and excludes the captured object itself', () => {
  expect(check()).toEqual({
    findings: [
      {
        code: 'KIA1702',
        severity: 'warning',
        path: 'spec/metadata/labels',
        message: 'More than one Workload Group with duplicate labels found in the same namespace',
      },
    ],
    skipped: [],
  });
  expect(
    check(spec, {
      ...context,
      workloadGroups: { namespace: 'bookinfo', complete: true, items: [record('one')] },
    }).findings
  ).toEqual([]);
  expect(referenceValidationSources('WorkloadGroup', 'networking.istio.io', spec, null)).toEqual([
    'workloadGroups',
  ]);
});
it('keeps absent metadata distinct from present empty labels and avoids delimiter collisions', () => {
  expect(check({})).toEqual({ findings: [], skipped: [] });
  expect(referenceValidationSources('WorkloadGroup', 'networking.istio.io', {}, null)).toEqual([]);
  const source = {
    ...context,
    workloadGroups: {
      namespace: 'bookinfo',
      complete: true,
      items: [
        record('one', { metadata: {} }),
        record('two', { metadata: { labels: null } }),
        record('three', {}),
      ],
    },
  };
  expect(check({ metadata: {} }, source).findings[0].code).toBe('KIA1702');
  const own = { metadata: { labels: { a: 'b,c=d' } } };
  const separate = { metadata: { labels: { a: 'b', c: 'd' } } };
  expect(
    check(own, {
      ...context,
      workloadGroups: {
        namespace: 'bookinfo',
        complete: true,
        items: [record('one', own), record('two', separate)],
      },
    }).findings
  ).toEqual([]);
});
it.each(['partial', 'scope', 'uid', 'labels', 'peer-scope', 'peer-uid', 'peer-labels', 'limit'])(
  'defers %s evidence rather than making a stale or cross-namespace finding',
  reason => {
    const source = {
      ...context,
      workloadGroups: {
        namespace: 'bookinfo',
        complete: true,
        items: [record('one'), record('two')],
      },
    };
    if (reason === 'partial') source.workloadGroups.complete = false;
    if (reason === 'scope') source.workloadGroups.namespace = 'other';
    if (reason === 'uid') source.workloadGroups.items[0].uid = 'replacement';
    if (reason === 'labels')
      source.workloadGroups.items[0].spec = { metadata: { labels: { app: 'changed' } } };
    if (reason === 'peer-scope') source.workloadGroups.items[1].namespace = 'other';
    if (reason === 'peer-uid') source.workloadGroups.items[1].uid = undefined;
    if (reason === 'peer-labels')
      source.workloadGroups.items[1].spec = { metadata: { labels: false } };
    if (reason === 'limit') source.workloadGroups.items = Array(1001).fill(record('one'));
    const result = check(spec, source);
    expect(result.findings).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  }
);
it('requires captured identity and preserves ignore annotations', () => {
  expect(
    workloadGroupChecks('WorkloadGroup', 'networking.istio.io', 'bookinfo', spec, context)
      .skipped[0]
  ).toContain('UID');
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'WorkloadGroup',
    owner,
    spec,
    context,
    annotations: { 'kiali.io/ignore-validations': 'KIA1702' },
    workloads: [],
    complete: false,
  });
  expect(result).toMatchObject({ findings: [], suppressed: 1 });
});
