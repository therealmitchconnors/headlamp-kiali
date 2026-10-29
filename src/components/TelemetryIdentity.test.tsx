import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { ConfigResult } from '../core/config';
import { loadEntityHealth } from '../data/entityHealth';
import { loadWorkloadHealth } from '../data/health';
import { loadTelemetry } from '../data/telemetry';
import { loadTopology } from '../data/topology';
import Topology from './Topology';
import Traffic from './Traffic';
import WorkloadHealth from './WorkloadHealth';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'], cluster: { KubeObject: class {} } },
  ApiProxy: { request: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/telemetry', () => ({ loadTelemetry: vi.fn() }));
vi.mock('../data/topology', () => ({ loadTopology: vi.fn() }));
vi.mock('../data/health', () => ({ loadWorkloadHealth: vi.fn() }));
vi.mock('../data/entityHealth', () => ({ loadEntityHealth: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
  SimpleTable: () => <table />,
  StatusLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const configured = (telemetryCluster?: string | null, service = 'prometheus'): ConfigResult => ({
  valid: true,
  config: {
    schemaVersion: 1,
    clusters: {
      alpha: {
        prometheus: { ...endpoint, service },
        ...(telemetryCluster === undefined ? {} : { telemetryCluster }),
      },
    },
  },
});
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue(configured('mesh-east'));
  vi.mocked(loadTelemetry)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}));
  vi.mocked(loadTopology)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}));
  vi.mocked(loadWorkloadHealth)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}));
  vi.mocked(loadEntityHealth)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);

it.each([
  {
    surface: 'metrics',
    Component: Traffic,
    button: 'Load metrics',
    loader: loadTelemetry,
    signalIndex: 3,
    kind: 'Deployment',
  },
  {
    surface: 'topology',
    Component: Topology,
    button: 'Load graph snapshot',
    loader: loadTopology,
    signalIndex: 3,
    kind: 'Deployment',
  },
  {
    surface: 'workload health',
    Component: WorkloadHealth,
    button: 'Load health',
    loader: loadWorkloadHealth,
    signalIndex: 4,
    kind: 'Deployment',
  },
  {
    surface: 'application health',
    Component: WorkloadHealth,
    button: 'Load health',
    loader: loadEntityHealth,
    signalIndex: 5,
    kind: 'Application',
  },
  {
    surface: 'service health',
    Component: WorkloadHealth,
    button: 'Load health',
    loader: loadEntityHealth,
    signalIndex: 5,
    kind: 'Service',
  },
])(
  'uses explicit saved identity, retains manual overrides and prevents replay for $surface',
  async ({ Component, button, loader, signalIndex, kind }) => {
    const tree = (
      <MemoryRouter
        initialEntries={[
          `/view?namespace=bookinfo&kind=${kind}&name=reviews-v1&telemetryApp=reviews`,
        ]}
      >
        <Component />
      </MemoryRouter>
    );
    const view = render(tree);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Istio metric cluster label');
    expect((input as HTMLInputElement).value).toBe('mesh-east');
    expect(loader).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'override');
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    const calls = vi.mocked(loader).mock.calls;
    expect(calls[0][2]).toMatchObject({ telemetryCluster: 'override' });
    const signal = calls[0][signalIndex];
    if (!(signal instanceof AbortSignal)) throw new Error('Missing captured signal');
    vi.mocked(useKialiConfig).mockReturnValue(configured('mesh-east'));
    view.rerender(
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    );
    expect(loader).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    vi.mocked(useKialiConfig).mockReturnValue(configured('mesh-west', 'other-prometheus'));
    view.rerender(
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    );
    expect(signal.aborted).toBe(true);
    expect((screen.getByLabelText('Istio metric cluster label') as HTMLInputElement).value).toBe(
      'mesh-west'
    );
    expect(loader).toHaveBeenCalledTimes(1);
    vi.mocked(useKialiConfig).mockReturnValue(configured('mesh-east'));
    view.rerender(
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    );
    expect(loader).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Istio metric cluster label') as HTMLInputElement).value).toBe(
      'mesh-east'
    );
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(vi.mocked(loader).mock.calls[1][2]).toMatchObject({ telemetryCluster: 'mesh-east' });
  }
);

it('does not infer an identity from the Headlamp cluster or persist a blank manual override', async () => {
  vi.mocked(useKialiConfig).mockReturnValue(configured());
  const view = render(
    <MemoryRouter initialEntries={['/traffic?namespace=bookinfo']}>
      <Traffic />
    </MemoryRouter>
  );
  const input = screen.getByLabelText('Istio metric cluster label');
  expect((input as HTMLInputElement).value).toBe('');
  vi.mocked(useKialiConfig).mockReturnValue(configured('explicit-label'));
  view.rerender(
    <MemoryRouter>
      <Traffic />
    </MemoryRouter>
  );
  expect((screen.getByLabelText('Istio metric cluster label') as HTMLInputElement).value).toBe(
    'explicit-label'
  );
  await userEvent.clear(input);
  await userEvent.click(screen.getByRole('button', { name: 'Load metrics' }));
  expect(loadTelemetry).not.toHaveBeenCalled();
  expect((input as HTMLInputElement).value).toBe('');
});
