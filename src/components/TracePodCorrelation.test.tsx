import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import fixtureText from '../../test-files/tracing/fixtures.json?raw';
import { decodeTraceDetail } from '../core/tracing';
import { verifyTracePod, verifyTraceWorkload } from '../data/traceCorrelation';
import TracePodCorrelation from './TracePodCorrelation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
vi.mock('../config', () => ({
  useKialiConfig: () => ({ valid: true, config: { schemaVersion: 1, clusters: {} } }),
}));
vi.mock('../data/traceCorrelation', () => ({
  verifyTracePod: vi.fn(),
  verifyTraceWorkload: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({
    activeCluster,
    routeName,
    params,
    search,
    children,
  }: {
    activeCluster: string;
    routeName: string;
    params?: Record<string, string>;
    search?: string;
    children: ReactNode;
  }) => (
    <a
      href={
        routeName === 'Pod'
          ? `/c/${activeCluster}/pods/${params?.namespace}/${params?.name}`
          : routeName === 'Deployment'
          ? `/c/${activeCluster}/deployments/${params?.namespace}/${params?.name}`
          : `/c/${activeCluster}/kiali/${
              routeName === 'kiali-graph'
                ? 'graph'
                : routeName === 'kiali-applications'
                ? 'applications'
                : 'diagnostics'
            }?${search}`
      }
    >
      {children}
    </a>
  ),
}));
const identity = { namespace: 'bookinfo', name: 'reviews-1', uid: 'reported-uid' };
const baseSpan = decodeTraceDetail('jaeger', JSON.parse(fixtureText).jaeger, '1').spans[0];
const span = {
  ...baseSpan,
  resourceAttributes: [
    { key: 'k8s.namespace.name', value: identity.namespace },
    { key: 'k8s.pod.name', value: identity.name },
    { key: 'k8s.pod.uid', value: identity.uid },
  ],
};
const verified = { ...identity, cluster: 'alpha', checkedAt: '2026-10-27T00:00:00Z' };
const currentWorkload = {
  reportedPod: identity,
  pod: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: '',
    kind: 'Pod' as const,
    name: 'reviews-1',
    uid: 'reported-uid',
  },
  workload: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: 'apps',
    kind: 'Deployment' as const,
    name: 'reviews-v1',
    uid: 'current-workload-uid',
  },
  application: { cluster: 'alpha', namespace: 'bookinfo', name: 'reviews' },
  cluster: 'alpha',
  namespace: 'bookinfo',
  checkedAt: '2026-10-27T00:00:00Z',
};
beforeEach(() => {
  vi.mocked(verifyTracePod).mockReset().mockResolvedValue(verified);
  vi.mocked(verifyTraceWorkload).mockReset().mockResolvedValue(currentWorkload);
});
afterEach(cleanup);
it('requires an explicit verification and supplies scoped native/diagnostic links only after success', async () => {
  render(<TracePodCorrelation cluster="alpha" span={span} />);
  expect(verifyTracePod).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Open verified Pod' })).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  const link = await screen.findByRole('link', { name: 'Open verified Pod' });
  expect(link.getAttribute('href')).toBe('/c/alpha/pods/bookinfo/reviews-1');
  expect(screen.getByRole('link', { name: 'Open Pod diagnostics' }).getAttribute('href')).toBe(
    '/c/alpha/kiali/diagnostics?namespace=bookinfo&pod=reviews-1'
  );
  expect(vi.mocked(verifyTracePod).mock.calls[0].slice(0, 2)).toEqual([
    { cluster: 'alpha' },
    identity,
  ]);
});
it('requires a separate complete-snapshot action before workload, application, or graph navigation', async () => {
  render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await screen.findByRole('link', { name: 'Open verified Pod' });
  expect(verifyTraceWorkload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Verify current workload owner' }));
  const workload = await screen.findByRole('link', { name: 'reviews-v1' });
  expect(workload.getAttribute('href')).toBe('/c/alpha/deployments/bookinfo/reviews-v1');
  expect(screen.getByRole('link', { name: 'Open current application' }).getAttribute('href')).toBe(
    '/c/alpha/kiali/applications?namespace=bookinfo&application=reviews'
  );
  expect(
    screen.getByRole('link', { name: 'Open traffic graph for this namespace' }).getAttribute('href')
  ).toBe('/c/alpha/kiali/graph?namespace=bookinfo');
  expect(screen.getByText(/Graph association is not established/)).toBeDefined();
  expect(vi.mocked(verifyTraceWorkload).mock.calls[0].slice(0, 3)).toEqual([
    { cluster: 'alpha' },
    identity,
    null,
  ]);
});
it('does not perform incomplete/conflicting lookups and clears a previous verification when identity changes', async () => {
  const { rerender } = render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await screen.findByRole('link', { name: 'Open verified Pod' });
  rerender(<TracePodCorrelation cluster="alpha" span={{ ...span, resourceAttributes: [] }} />);
  expect(screen.queryByRole('button', { name: 'Verify reported pod in this cluster' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open verified Pod' })).toBeNull();
  rerender(
    <TracePodCorrelation
      cluster="alpha"
      span={{ ...span, attributes: [{ key: 'k8s.pod.uid', value: 'conflicting' }] }}
    />
  );
  expect(screen.getByText(/attributes conflict/)).toBeDefined();
  expect(verifyTracePod).toHaveBeenCalledTimes(1);
});
it('suppresses a late response and requires a new action after a cluster change', async () => {
  let resolve: (value: typeof verified) => void = () => {};
  vi.mocked(verifyTracePod).mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    })
  );
  const { rerender } = render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  const signal = vi.mocked(verifyTracePod).mock.calls[0][2];
  rerender(<TracePodCorrelation cluster="beta" span={span} />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(verified));
  expect(screen.queryByRole('link', { name: 'Open verified Pod' })).toBeNull();
  expect(verifyTracePod).toHaveBeenCalledTimes(1);
  vi.mocked(verifyTracePod).mockResolvedValueOnce({ ...verified, cluster: 'beta' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Open verified Pod' }).getAttribute('href')).toContain(
      '/c/beta/'
    )
  );
});
it('shows verification errors without retaining earlier links', async () => {
  render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await screen.findByRole('link', { name: 'Open verified Pod' });
  vi.mocked(verifyTracePod).mockRejectedValueOnce(new Error('Reported UID does not match'));
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await screen.findByText('Unavailable: Reported UID does not match');
  expect(screen.queryByRole('link', { name: 'Open verified Pod' })).toBeNull();
});
it.each(['identity', 'trace'])('requires a new action after a ready %s changes', async change => {
  const { rerender } = render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await screen.findByRole('link', { name: 'Open verified Pod' });
  const next =
    change === 'trace'
      ? { ...span, traceId: '00000000000000000000000000000002' }
      : {
          ...span,
          resourceAttributes: span.resourceAttributes.map(attribute =>
            attribute.key === 'k8s.pod.uid' ? { ...attribute, value: 'replacement-uid' } : attribute
          ),
        };
  rerender(<TracePodCorrelation cluster="alpha" span={next} />);
  expect(screen.queryByRole('link', { name: 'Open verified Pod' })).toBeNull();
  expect(verifyTracePod).toHaveBeenCalledTimes(1);
});
it('clears captured workload navigation when the selected span range changes', async () => {
  const { rerender } = render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Verify current workload owner' })
  );
  await screen.findByRole('link', { name: 'Open current application' });
  rerender(
    <TracePodCorrelation
      cluster="alpha"
      span={{ ...span, durationNs: (BigInt(span.durationNs) + BigInt(1)).toString() }}
    />
  );
  expect(screen.queryByRole('link', { name: 'Open verified Pod' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open current application' })).toBeNull();
  expect(vi.mocked(verifyTraceWorkload)).toHaveBeenCalledTimes(1);
});
it('aborts a pending workload capture and suppresses its late links after a range change', async () => {
  let resolve: (value: typeof currentWorkload) => void = () => {};
  vi.mocked(verifyTraceWorkload).mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    })
  );
  const { rerender } = render(<TracePodCorrelation cluster="alpha" span={span} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify reported pod in this cluster' })
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Verify current workload owner' })
  );
  await waitFor(() => expect(verifyTraceWorkload).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(verifyTraceWorkload).mock.calls[0][3];
  rerender(
    <TracePodCorrelation
      cluster="alpha"
      span={{ ...span, durationNs: (BigInt(span.durationNs) + BigInt(1)).toString() }}
    />
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(currentWorkload));
  expect(screen.queryByRole('link', { name: 'Open current application' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open traffic graph for this namespace' })).toBeNull();
});
