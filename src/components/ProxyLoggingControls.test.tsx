import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { DiagnosticPod } from '../core/diagnostics';
import { ProxyLoggingSnapshot } from '../core/proxyLogging';
import {
  applyProxyLoggingProposal,
  loadProxyLoggingSnapshot,
  ProxyLoggingOutcomeError,
} from '../data/proxyLogging';
import ProxyLoggingControls from './ProxyLoggingControls';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SimpleTable: ({
    data,
    columns,
  }: {
    data: Record<string, unknown>[];
    columns: { getter: (row: Record<string, unknown>) => ReactNode }[];
  }) => (
    <div>
      {data.map((row, index) => (
        <div key={index}>
          {columns.map((column, columnIndex) => (
            <span key={columnIndex}>{column.getter(row)}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('../data/proxyLogging', () => ({
  applyProxyLoggingProposal: vi.fn(),
  loadProxyLoggingSnapshot: vi.fn(),
  ProxyLoggingOutcomeError: class ProxyLoggingOutcomeError extends Error {},
}));

const pod: DiagnosticPod = {
  namespace: 'bookinfo',
  name: 'reviews-v1',
  uid: 'owned-fixture-pod-uid',
  containers: [
    { name: 'istio-proxy', type: 'regular', nativeSidecar: false, ready: true, restarts: 2 },
  ],
};
const snapshot: ProxyLoggingSnapshot = {
  cluster: 'alpha',
  target: {
    namespace: pod.namespace,
    pod: pod.name,
    uid: pod.uid,
    container: 'istio-proxy',
    restarts: 2,
  },
  capturedAt: '2026-10-29T12:00:00.000Z',
  loggers: [
    { logger: 'router', level: 'warning' },
    { logger: 'upstream', level: 'info' },
  ],
};
const updated = {
  ...snapshot,
  capturedAt: '2026-10-29T12:01:00.000Z',
  loggers: snapshot.loggers.map(logger => ({ ...logger, level: 'debug' as const })),
};

beforeEach(() => {
  vi.mocked(loadProxyLoggingSnapshot).mockReset().mockResolvedValue(snapshot);
  vi.mocked(applyProxyLoggingProposal).mockReset().mockResolvedValue(updated);
});

afterEach(cleanup);

it('requires an explicit read and final confirmation before changing the fixture proxy', async () => {
  const user = userEvent.setup();
  render(<ProxyLoggingControls cluster="alpha" pod={pod} />);
  expect(loadProxyLoggingSnapshot).not.toHaveBeenCalled();
  expect(applyProxyLoggingProposal).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Read current proxy log levels' }));
  await screen.findByText('Captured current logger levels (2)');
  expect(screen.getByText(/owned-fixture-pod-uid/)).toBeDefined();
  expect(screen.getByText('router')).toBeDefined();

  await user.click(screen.getByRole('combobox', { name: 'Proposed proxy log level' }));
  await user.click(await screen.findByRole('option', { name: 'debug' }));
  await user.click(screen.getByRole('button', { name: 'Review proposed log-level change' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirm proxy log-level change' });
  expect(dialog.textContent).toContain('All proxy loggers');
  expect(dialog.textContent).toContain('runtime-wide proxy change');
  await user.click(screen.getByRole('button', { name: 'Apply confirmed log-level change' }));
  await screen.findByText(/Proxy logging levels updated and verified at/);
  expect(vi.mocked(applyProxyLoggingProposal).mock.calls[0][0]).toEqual({ cluster: 'alpha' });
  expect(vi.mocked(applyProxyLoggingProposal).mock.calls[0][1]).toBe(pod);
  expect(vi.mocked(applyProxyLoggingProposal).mock.calls[0][2].level).toBe('debug');
  expect(vi.mocked(applyProxyLoggingProposal)).toHaveBeenCalledTimes(1);
});

it('shows a post-confirmation failure as unknown and does not retry or report success', async () => {
  vi.mocked(applyProxyLoggingProposal).mockRejectedValueOnce(
    new ProxyLoggingOutcomeError('Final state could not be verified')
  );
  const user = userEvent.setup();
  render(<ProxyLoggingControls cluster="alpha" pod={pod} />);
  await user.click(screen.getByRole('button', { name: 'Read current proxy log levels' }));
  await screen.findByText('Captured current logger levels (2)');
  await user.click(screen.getByRole('combobox', { name: 'Proposed proxy log level' }));
  await user.click(await screen.findByRole('option', { name: 'debug' }));
  await user.click(screen.getByRole('button', { name: 'Review proposed log-level change' }));
  await user.click(screen.getByRole('button', { name: 'Apply confirmed log-level change' }));
  await screen.findByText('Final state could not be verified');
  expect(screen.queryByText(/updated and verified/)).toBeNull();
  expect(applyProxyLoggingProposal).toHaveBeenCalledTimes(1);
});

it('disables controls when the exact proxy restart state is unavailable', () => {
  render(
    <ProxyLoggingControls
      cluster="alpha"
      pod={{
        ...pod,
        containers: [{ ...pod.containers[0], restarts: null }],
      }}
    />
  );
  expect(screen.getByRole('button', { name: 'Read current proxy log levels' })).toHaveProperty(
    'disabled',
    true
  );
  expect(loadProxyLoggingSnapshot).not.toHaveBeenCalled();
});
