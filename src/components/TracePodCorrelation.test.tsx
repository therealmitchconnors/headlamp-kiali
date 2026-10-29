import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import fixtureText from '../../test-files/tracing/fixtures.json?raw';
import { decodeTraceDetail } from '../core/tracing';
import { verifyTracePod } from '../data/traceCorrelation';
import TracePodCorrelation from './TracePodCorrelation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
vi.mock('../data/traceCorrelation', () => ({ verifyTracePod: vi.fn() }));
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
          : `/c/${activeCluster}/kiali/diagnostics?${search}`
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
beforeEach(() => {
  vi.mocked(verifyTracePod).mockReset().mockResolvedValue(verified);
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
