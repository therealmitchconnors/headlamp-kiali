import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EntityHealthSnapshot, loadEntityHealth } from '../data/entityHealth';
import { loadWorkloadHealth } from '../data/health';
import HealthSummary from './HealthSummary';
import WorkloadHealth from './WorkloadHealth';

const state = vi.hoisted(() => ({ cluster: 'alpha' }));
const config = {
  valid: true as const,
  config: {
    schemaVersion: 1 as const,
    clusters: {
      alpha: {
        prometheus: { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' },
      },
    },
  },
};
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useSelectedClusters: () => [state.cluster],
    useClustersConf: () => ({ alpha: {}, beta: {} }),
  },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../config', () => ({ useKialiConfig: () => config }));
vi.mock('../data/entityHealth', () => ({ loadEntityHealth: vi.fn() }));
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
  SimpleTable: () => <table aria-label="Application workload replicas" />,
}));
beforeEach(() => {
  state.cluster = 'alpha';
  vi.mocked(loadEntityHealth).mockReset();
  vi.mocked(loadWorkloadHealth).mockReset();
  vi.mocked(loadEntityHealth).mockImplementation(async (_scope, _endpoint, query) => ({
    query,
    issues: [],
    calculation: { status: 'Degraded', totalRequestRate: 10, errorRatio: 1, warnings: [] },
  }));
});
afterEach(cleanup);

it('labels zero-rate application results as replica-only rather than healthy request traffic', () => {
  render(
    <HealthSummary
      calculation={{ status: 'Healthy', errorRatio: -1, totalRequestRate: 0, warnings: [] }}
      label="Replica and request health"
      includesReplicas
    />
  );
  expect(screen.getByText('Replica health (requests not assessed): Healthy')).toBeDefined();
  expect(screen.getByText(/Request errors cannot be assessed from zero traffic/)).toBeDefined();
  expect(screen.queryByText('Replica and request health: Healthy')).toBeNull();
});

it('retains Service deep links and uses inbound-only request health without refetch loops', async () => {
  render(
    <MemoryRouter initialEntries={['/health?kind=Service&namespace=bookinfo&name=reviews']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  expect((screen.getByLabelText('Service name') as HTMLInputElement).value).toBe('reviews');
  await user.type(screen.getByLabelText('Istio metric cluster label'), 'east');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await screen.findByText('Service request health: Degraded');
  expect(loadEntityHealth).toHaveBeenCalledTimes(1);
  expect(loadWorkloadHealth).not.toHaveBeenCalled();
  expect(vi.mocked(loadEntityHealth).mock.calls[0][2]).toMatchObject({
    kind: 'Service',
    namespace: 'bookinfo',
    name: 'reviews',
    telemetryCluster: 'east',
  });
  const signal = vi.mocked(loadEntityHealth).mock.calls[0][5];
  await user.type(screen.getByLabelText('Service name'), '-other');
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Service request health: Degraded')).toBeNull();
});
it('makes Kiali reporter combination explicit and permits the previous single-reporter mode', async () => {
  render(
    <MemoryRouter initialEntries={['/health?kind=Service&namespace=bookinfo&name=reviews']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Istio metric cluster label'), 'east');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await screen.findByText('Service request health: Degraded');
  expect(vi.mocked(loadEntityHealth).mock.calls[0][2].reporterMode).toBe('combined');
  const signal = vi.mocked(loadEntityHealth).mock.calls[0][5];
  await user.click(screen.getByRole('combobox', { name: 'Health reporters' }));
  await user.click(screen.getByRole('option', { name: 'Single reporter' }));
  expect(signal.aborted).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await waitFor(() => expect(loadEntityHealth).toHaveBeenCalledTimes(2));
  expect(vi.mocked(loadEntityHealth).mock.calls[1][2].reporterMode).toBe('single');
});
it('requires explicit canonical-service identity without replacing the selected application label', async () => {
  render(
    <MemoryRouter initialEntries={['/health?kind=Application&namespace=bookinfo&name=custom-app']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Istio metric cluster label'), 'east');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  expect(loadEntityHealth).not.toHaveBeenCalled();
  expect(
    screen.getByText('An explicit nonempty Istio canonical service label is required')
  ).toBeDefined();
  await user.type(screen.getByLabelText('Istio canonical service label'), 'reviews');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await screen.findByText('Replica and request health: Degraded');
  expect(loadEntityHealth).toHaveBeenCalledTimes(1);
  expect(vi.mocked(loadEntityHealth).mock.calls[0][2]).toMatchObject({
    kind: 'Application',
    name: 'custom-app',
    telemetryApp: 'reviews',
  });
});
it('does not present successful health when Service evidence is forbidden', async () => {
  vi.mocked(loadEntityHealth).mockImplementation(async (_scope, _endpoint, query) => ({
    query,
    issues: [],
    resourceError: { kind: 'forbidden', message: 'Service denied' },
    calculation: null,
  }));
  render(
    <MemoryRouter initialEntries={['/health?kind=Service&namespace=bookinfo&name=reviews']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Istio metric cluster label'), 'east');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await screen.findByText('Service denied');
  expect(screen.getByText(/Health is unavailable/)).toBeDefined();
  expect(screen.queryByText(/Service request health:/)).toBeNull();
});
it('aborts and ignores a late entity response after cluster selection changes', async () => {
  let resolve!: (value: EntityHealthSnapshot) => void;
  vi.mocked(loadEntityHealth).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const content = (
    <MemoryRouter initialEntries={['/health?kind=Service&namespace=bookinfo&name=reviews']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  const view = render(content);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Istio metric cluster label'), 'east');
  await user.click(screen.getByRole('button', { name: 'Load health' }));
  await waitFor(() => expect(loadEntityHealth).toHaveBeenCalledTimes(1));
  const args = vi.mocked(loadEntityHealth).mock.calls[0];
  state.cluster = 'beta';
  view.rerender(
    <MemoryRouter initialEntries={['/health?kind=Service&namespace=bookinfo&name=reviews']}>
      <WorkloadHealth />
    </MemoryRouter>
  );
  expect(args[5].aborted).toBe(true);
  await act(async () =>
    resolve({
      query: args[2],
      issues: [],
      calculation: { status: 'Healthy', errorRatio: 0, totalRequestRate: 10, warnings: [] },
    })
  );
  expect(screen.queryByText('Service request health: Healthy')).toBeNull();
  expect(screen.getByRole('button', { name: 'Load health' }).hasAttribute('disabled')).toBe(true);
});
