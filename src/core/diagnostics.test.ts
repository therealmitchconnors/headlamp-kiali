import { diagnosticPod, podLogPath } from './diagnostics';

const pod = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name: 'reviews-123', namespace: 'bookinfo', uid: 'pod-uid' },
  spec: {
    containers: [{ name: 'reviews' }],
    initContainers: [{ name: 'istio-proxy', restartPolicy: 'Always' }],
    ephemeralContainers: [{ name: 'debug' }],
  },
  status: {
    containerStatuses: [{ name: 'reviews', ready: true, restartCount: 0 }],
    initContainerStatuses: [{ name: 'istio-proxy', ready: true, restartCount: 1 }],
  },
};
it('retains all container categories, native sidecars and unknown status without exposing pod environment', () => {
  const result = diagnosticPod(pod, 'bookinfo', 'reviews-123');
  expect(result.containers).toEqual([
    { name: 'reviews', type: 'regular', nativeSidecar: false, ready: true, restarts: 0 },
    { name: 'istio-proxy', type: 'init', nativeSidecar: true, ready: true, restarts: 1 },
    { name: 'debug', type: 'ephemeral', nativeSidecar: false, ready: null, restarts: null },
  ]);
  expect(result).not.toHaveProperty('spec');
  expect(() =>
    diagnosticPod(
      { ...pod, metadata: { ...pod.metadata, namespace: 'other' } },
      'bookinfo',
      'reviews-123'
    )
  ).toThrow('identity');
});
it('rejects duplicate names and malformed status instead of defaulting invalid restarts to zero', () => {
  expect(() =>
    diagnosticPod(
      { ...pod, spec: { ...pod.spec, initContainers: [{ name: 'reviews' }] } },
      'bookinfo',
      'reviews-123'
    )
  ).toThrow('duplicate');
  expect(() =>
    diagnosticPod(
      { ...pod, status: { containerStatuses: [{ name: 'reviews', restartCount: -1 }] } },
      'bookinfo',
      'reviews-123'
    )
  ).toThrow('status');
  expect(() => diagnosticPod({ ...pod, status: 'invalid' }, 'bookinfo', 'reviews-123')).toThrow(
    'status'
  );
});
it('encodes only bounded fixed log options and rejects unsafe resource selectors', () => {
  const query = {
    namespace: 'bookinfo',
    pod: 'reviews-123',
    uid: 'pod-uid',
    container: 'istio-proxy',
    tailLines: 1000,
    sinceSeconds: 86400,
    previous: true,
  };
  const url = new URL(podLogPath(query), 'http://example.test');
  expect(url.pathname).toBe('/api/v1/namespaces/bookinfo/pods/reviews-123/log');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    container: 'istio-proxy',
    tailLines: '1000',
    previous: 'true',
    sinceSeconds: '86400',
    timestamps: 'true',
    follow: 'false',
    limitBytes: '262144',
  });
  for (const change of [
    { pod: '../bad' },
    { container: 'x&previous=true' },
    { tailLines: 1001 },
    { sinceSeconds: 0 },
    { uid: '' },
  ])
    expect(() => podLogPath({ ...query, ...change })).toThrow();
});
