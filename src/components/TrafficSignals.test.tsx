import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { loadTrafficSignals } from '../data/trafficSignals';
import TrafficSignals from './TrafficSignals';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'] },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/trafficSignals', () => ({ loadTrafficSignals: vi.fn() }));
vi.mock('./MetricChart', () => ({
  default: ({ title, unit }: { title: string; unit: string }) => (
    <div role="img" aria-label={title}>
      {unit}
    </div>
  ),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
}));
const configured = {
  valid: true as const,
  config: {
    schemaVersion: 1 as const,
    clusters: {
      alpha: {
        prometheus: { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' },
        telemetryCluster: 'mesh-east',
      },
    },
  },
};
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  vi.mocked(loadTrafficSignals)
    .mockReset()
    .mockImplementation(async (_scope, _endpoint, query) => ({
      query,
      metrics: query.signals.map(key => ({
        key,
        read: { ok: true, result: { warnings: [], series: [] } },
      })),
    }));
});
afterEach(cleanup);
it('captures historical scope and signal choices, discloses raw TCP mapping and does not refetch for drafts', async () => {
  render(
    <MemoryRouter initialEntries={['/signals?namespace=bookinfo']}>
      <TrafficSignals />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  expect((screen.getByLabelText('Istio metric cluster label') as HTMLInputElement).value).toBe(
    'mesh-east'
  );
  expect(loadTrafficSignals).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: 'TCP sent byte rate (Kiali mapping)' }));
  await user.click(screen.getByRole('checkbox', { name: 'Use current signal time' }));
  await user.type(screen.getByLabelText('Signal end time (local time)'), '2026-01-02T03:04');
  await user.click(screen.getByRole('button', { name: 'Load traffic signals' }));
  await screen.findByRole('img', { name: 'TCP sent byte rate (Kiali mapping)' });
  expect(screen.getByText('istio_tcp_received_bytes_total')).toBeDefined();
  const query = vi.mocked(loadTrafficSignals).mock.calls[0][2];
  expect(query.signals).toEqual(['request_throughput', 'response_throughput', 'tcp_sent']);
  expect(query.end).toBe(Math.floor(new Date('2026-01-02T03:04').getTime() / 1000));
  await user.click(screen.getByRole('checkbox', { name: 'TCP sent byte rate (Kiali mapping)' }));
  expect(loadTrafficSignals).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('img', { name: 'TCP sent byte rate (Kiali mapping)' })).toBeDefined();
  for (const name of ['Request throughput', 'Response throughput'])
    await user.click(screen.getByRole('checkbox', { name }));
  expect(
    screen.getByRole('button', { name: 'Load traffic signals' }).hasAttribute('disabled')
  ).toBe(true);
});
it('discards submissions on connection or saved-identity changes without resurrection', async () => {
  const view = render(
    <MemoryRouter initialEntries={['/signals?namespace=bookinfo']}>
      <TrafficSignals />
    </MemoryRouter>
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load traffic signals' }));
  await waitFor(() => expect(loadTrafficSignals).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadTrafficSignals).mock.calls[0][3];
  const changed = structuredClone(configured);
  changed.config.clusters.alpha.prometheus.service = 'other';
  changed.config.clusters.alpha.telemetryCluster = 'other-mesh';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(
    <MemoryRouter>
      <TrafficSignals />
    </MemoryRouter>
  );
  expect(signal.aborted).toBe(true);
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  view.rerender(
    <MemoryRouter>
      <TrafficSignals />
    </MemoryRouter>
  );
  expect(loadTrafficSignals).toHaveBeenCalledTimes(1);
  expect(screen.queryAllByRole('img')).toHaveLength(0);
});
