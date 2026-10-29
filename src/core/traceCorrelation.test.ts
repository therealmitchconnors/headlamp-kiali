import { reportedTracePod, tracePodIdentity } from './traceCorrelation';
import { TraceAttribute, TraceValue } from './tracing';

const attrs = (values: Record<string, TraceValue>): TraceAttribute[] =>
  Object.entries(values).map(([key, value]) => ({ key, value }));
const identity = {
  'k8s.namespace.name': 'bookinfo',
  'k8s.pod.name': 'reviews-1',
  'k8s.pod.uid': 'reported-uid',
};
it('requires all three explicit identity fields and never derives them from service or cluster labels', () => {
  expect(
    reportedTracePod({
      attributes: [],
      resourceAttributes: attrs({
        'service.name': 'reviews.bookinfo',
        'k8s.cluster.name': 'alpha',
      }),
    })
  ).toEqual({ status: 'unavailable', reason: 'absent' });
  expect(
    reportedTracePod({
      attributes: [],
      resourceAttributes: attrs({ 'k8s.namespace.name': 'bookinfo', 'k8s.pod.name': 'reviews-1' }),
    })
  ).toEqual({ status: 'unavailable', reason: 'incomplete' });
  expect(reportedTracePod({ attributes: [], resourceAttributes: attrs(identity) })).toMatchObject({
    status: 'ready',
    origin: 'resource',
    identity: { namespace: 'bookinfo', name: 'reviews-1', uid: 'reported-uid' },
  });
});
it('retains explicit provenance and accepts identical repeated values without inventing precedence', () => {
  expect(reportedTracePod({ attributes: attrs(identity), resourceAttributes: [] })).toMatchObject({
    status: 'ready',
    origin: 'span',
  });
  expect(
    reportedTracePod({
      resourceAttributes: attrs({ 'k8s.namespace.name': 'bookinfo' }),
      attributes: attrs(identity),
    })
  ).toMatchObject({ status: 'ready', origin: 'mixed' });
  const repeated = [...attrs(identity), ...attrs(identity)];
  expect(reportedTracePod({ resourceAttributes: repeated, attributes: [] }).status).toBe('ready');
  expect(Object.isFrozen(tracePodIdentity('bookinfo', 'reviews-1', 'reported-uid'))).toBe(true);
});
it.each(['k8s.namespace.name', 'k8s.pod.name', 'k8s.pod.uid'])(
  'rejects conflicting %s rather than guessing which source wins',
  key => {
    expect(
      reportedTracePod({
        resourceAttributes: attrs(identity),
        attributes: attrs({ [key]: 'different' }),
      })
    ).toEqual({ status: 'unavailable', reason: 'conflicting' });
  }
);
it.each([
  { 'k8s.namespace.name': '../bookinfo' },
  { 'k8s.namespace.name': 'bookinfo\n' },
  { 'k8s.pod.name': '' },
  { 'k8s.pod.name': 'reviews/other' },
  { 'k8s.pod.uid': false },
  { 'k8s.pod.uid': '' },
  { 'k8s.pod.uid': 'uid\n' },
  { 'k8s.pod.uid': 'x'.repeat(257) },
])('rejects invalid reported identity %#', changes => {
  expect(
    reportedTracePod({ resourceAttributes: attrs({ ...identity, ...changes }), attributes: [] })
  ).toEqual({ status: 'unavailable', reason: 'invalid' });
});
it('bounds attribute inputs before attempting identity extraction', () => {
  expect(
    reportedTracePod({
      resourceAttributes: Array(257).fill({ key: 'other', value: 'x' }),
      attributes: [],
    })
  ).toEqual({ status: 'unavailable', reason: 'invalid' });
});
