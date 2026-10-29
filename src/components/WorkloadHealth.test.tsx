import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { loadWorkloadHealth } from '../data/health';
import WorkloadHealth from './WorkloadHealth';

const state = vi.hoisted(() => ({
  config: {
    valid: true as const,
    config: {
      schemaVersion: 1 as const,
      clusters: {
        alpha: {
          prometheus: {
            namespace: 'monitoring',
            service: 'prometheus',
            port: '9090',
            basePath: '',
          },
        },
      },
    },
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: {
    cluster: { KubeObject: class {} },
    useSelectedClusters: () => ['alpha'],
    useClustersConf: () => ({ alpha: {} }),
  },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../config', () => ({ useKialiConfig: () => state.config }));
vi.mock('../data/health', () => ({ loadWorkloadHealth: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
  StatusLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SimpleTable: () => <table aria-label="Replica counts" />,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(loadWorkloadHealth).mockReset();
  vi.mocked(loadWorkloadHealth).mockImplementation(async (_scope, _endpoint, query) => ({
    query,
    calculation: null,
    resource: { ok: false, error: { kind: 'forbidden', message: 'Access denied' } },
    inbound: { ok: true, result: { series: [], warnings: [] } },
    outbound: { ok: true, result: { series: [], warnings: [] } },
  }));
});
it('retains the linked resource, sends one scoped request and never shows healthy for missing data', async () => {
  render(
    <MemoryRouter initialEntries={['/health?kind=Deployment&namespace=bookinfo&name=reviews-v1']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Istio metric cluster label'), 'east');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await waitFor(() => expect(screen.getByText(/Combined health is unavailable/)).toBeDefined());
  expect(screen.getByText(/Access denied/)).toBeDefined();
  expect(screen.queryByText(/Replica and request health/)).toBeNull();
  expect(loadWorkloadHealth).toHaveBeenCalledTimes(1);
  expect(loadWorkloadHealth).toHaveBeenCalledWith(
    { cluster: 'alpha' },
    state.config.config.clusters.alpha.prometheus,
    expect.objectContaining({
      kind: 'Deployment',
      namespace: 'bookinfo',
      name: 'reviews-v1',
      telemetryCluster: 'east',
    }),
    [],
    expect.any(AbortSignal)
  );
  const signal = vi.mocked(loadWorkloadHealth).mock.calls[0][4];
  await user.type(screen.getByLabelText('Workload name'), '-different');
  expect(screen.queryByText(/Combined health is unavailable/)).toBeNull();
  expect(signal.aborted).toBe(true);
});
