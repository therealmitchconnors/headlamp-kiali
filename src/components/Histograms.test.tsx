import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { loadHistograms } from '../data/histograms';
import Histograms from './Histograms';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'] },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/histograms', () => ({ loadHistograms: vi.fn() }));
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
  vi.mocked(loadHistograms)
    .mockReset()
    .mockImplementation(async (_scope, _endpoint, query) => ({
      query,
      summaries: query.summaries.map(summary => ({
        summary,
        read: { ok: true, result: { warnings: [], series: [] } },
      })),
    }));
});
afterEach(cleanup);
it('captures selected summaries, metric units and historical scope only on submission', async () => {
  render(
    <MemoryRouter initialEntries={['/histograms?namespace=bookinfo']}>
      <Histograms />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  expect((screen.getByLabelText('Istio metric cluster label') as HTMLInputElement).value).toBe(
    'mesh-east'
  );
  expect(loadHistograms).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText('Histogram metric'));
  await user.click(screen.getByRole('option', { name: 'Request size' }));
  await user.click(screen.getByRole('checkbox', { name: 'P99' }));
  await user.click(screen.getByRole('checkbox', { name: 'Use current histogram time' }));
  await user.type(screen.getByLabelText('Histogram end time (local time)'), '2026-01-02T03:04');
  await user.click(screen.getByRole('button', { name: 'Load histogram summaries' }));
  await screen.findByRole('img', { name: 'Request size - P99' });
  const query = vi.mocked(loadHistograms).mock.calls[0][2];
  expect(query.summaries).toEqual(['avg', 'p95', 'p99']);
  expect(query.metric).toBe('requestSize');
  expect(query.end).toBe(Math.floor(new Date('2026-01-02T03:04').getTime() / 1000));
  await user.click(screen.getByRole('checkbox', { name: 'P99' }));
  expect(loadHistograms).toHaveBeenCalledTimes(1);
  expect(query.summaries).toEqual(['avg', 'p95', 'p99']);
});
it('does not replay a captured histogram query when provider settings change', async () => {
  const view = render(
    <MemoryRouter initialEntries={['/histograms?namespace=bookinfo']}>
      <Histograms />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load histogram summaries' }));
  await waitFor(() => expect(loadHistograms).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadHistograms).mock.calls[0][3];
  const changed = structuredClone(configured);
  changed.config.clusters.alpha.prometheus.service = 'other';
  vi.mocked(useKialiConfig).mockReturnValue(changed);
  view.rerender(
    <MemoryRouter>
      <Histograms />
    </MemoryRouter>
  );
  expect(signal.aborted).toBe(true);
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  vi.mocked(useKialiConfig).mockReturnValue(configured);
  view.rerender(
    <MemoryRouter>
      <Histograms />
    </MemoryRouter>
  );
  expect(loadHistograms).toHaveBeenCalledTimes(1);
});
