import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { readConfig } from '../core/config';
import { CorrelationResource } from '../core/correlation';
import { loadWorkloadDashboardSnapshot } from '../data/workloadDashboards';
import { InspectionResults } from './ApplicationDashboards';
import WorkloadDashboards from './WorkloadDashboards';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'] },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/workloadDashboards', () => ({ loadWorkloadDashboardSnapshot: vi.fn() }));
vi.mock('./ApplicationDashboards', () => ({
  InspectionResults: vi.fn(() => <div>Runtime inspection requested</div>),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/resource">{children}</a>,
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SimpleTable: () => <table />,
}));
const settings = {
  schemaVersion: 1,
  clusters: { alpha: { prometheus: null, telemetryCluster: 'east' } },
};
function snapshot() {
  const resource: CorrelationResource = {
    identity: {
      group: '',
      kind: 'Pod',
      name: 'reviews',
      uid: 'pod-uid',
      cluster: 'alpha',
      namespace: 'bookinfo',
    },
    resourceVersion: '17',
    labels: { app: 'reviews', version: 'v2' },
    workloadLabels: { app: 'reviews', version: 'v2' },
    owners: [],
    serviceSelector: null,
    proxyMode: 'none',
    dashboardRefs: { ok: true, refs: ['runtime'], bytes: 7 },
  };
  return {
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    resources: [resource],
    complete: true,
    sources: [],
  };
}
beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue(readConfig(settings));
  vi.mocked(loadWorkloadDashboardSnapshot).mockReset().mockResolvedValue(snapshot());
  vi.mocked(InspectionResults).mockClear();
});
it('offers a WorkloadGroup as the VM workload identity without creating Pod evidence', async () => {
  const vm = snapshot();
  vm.resources[0].identity = {
    ...vm.resources[0].identity,
    group: 'networking.istio.io',
    kind: 'WorkloadGroup',
    name: 'reviews-vm',
    uid: 'group-uid',
  };
  vm.resources[0].resourceVersion = 'group-rv';
  vm.resources[0].workloadLabels = { app: 'reviews', version: 'v2' };
  vm.resources[0].virtualMachine = {
    labelSource: 'entry',
    matchingEntries: 1,
    entry: { name: 'reviews-vm-entry', uid: 'entry-uid', resourceVersion: 'entry-rv' },
  };
  vm.resources = [vm.resources[0]];
  vi.mocked(loadWorkloadDashboardSnapshot).mockResolvedValue(vm);
  open('?kind=WorkloadGroup&namespace=bookinfo&name=reviews-vm&uid=group-uid');
  await read();
  await screen.findByText(/Application and version labels came from WorkloadEntry/);
  expect(screen.getByText(/WorkloadGroup UID group-uid, resource version group-rv/)).toBeDefined();
  await userEvent.click(
    screen.getByRole('button', { name: 'Inspect workload dashboard recommendations' })
  );
  const query = vi.mocked(InspectionResults).mock.calls[0][0].query;
  expect(query.evidence.pods).toEqual([]);
  expect(query.evidence.workload).toMatchObject({
    apiVersion: 'networking.istio.io/v1',
    uid: 'group-uid',
    resourceVersion: 'group-rv',
    virtualMachine: {
      labelSource: 'entry',
      entry: { uid: 'entry-uid', resourceVersion: 'entry-rv' },
    },
  });
});
afterEach(cleanup);
const open = (search = '?kind=Pod&namespace=bookinfo&name=reviews&uid=pod-uid') =>
  render(
    <MemoryRouter initialEntries={[`/workload-dashboards${search}`]}>
      <WorkloadDashboards />
    </MemoryRouter>
  );
const read = () =>
  userEvent.click(screen.getByRole('button', { name: 'Read workload dashboard evidence' }));
it('requires separate explicit ownership and runtime inspection, retaining workload/version identity', async () => {
  open();
  expect(loadWorkloadDashboardSnapshot).not.toHaveBeenCalled();
  expect(InspectionResults).not.toHaveBeenCalled();
  await read();
  await screen.findByRole('button', { name: 'Inspect workload dashboard recommendations' });
  expect(InspectionResults).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Inspect workload dashboard recommendations' })
  );
  const query = vi.mocked(InspectionResults).mock.calls[0][0].query;
  expect(query.metricCluster).toBe('east');
  expect(query.evidence.workload).toMatchObject({
    kind: 'Pod',
    apiVersion: 'v1',
    uid: 'pod-uid',
    resourceVersion: '17',
    version: 'v2',
  });
  expect(query.evidence.selectors[2].filters).toEqual({ app: 'reviews', version: 'v2' });
});
it('clears captures on draft changes and never resurrects them when the target returns', async () => {
  open();
  await read();
  await screen.findByRole('button', { name: 'Inspect workload dashboard recommendations' });
  const signal = vi.mocked(loadWorkloadDashboardSnapshot).mock.calls[0][2];
  fireEvent.change(screen.getByLabelText('Dashboard workload name'), {
    target: { value: 'other' },
  });
  expect(signal.aborted).toBe(true);
  fireEvent.change(screen.getByLabelText('Dashboard workload name'), {
    target: { value: 'reviews' },
  });
  expect(
    screen.queryByRole('button', { name: 'Inspect workload dashboard recommendations' })
  ).toBeNull();
  expect(loadWorkloadDashboardSnapshot).toHaveBeenCalledTimes(1);
});
it('rejects invalid targets before transport and refuses changed linked UIDs', async () => {
  open('?kind=Pod&namespace=bookinfo&name=invalid%2Fname');
  await read();
  expect(screen.getByText(/valid name for dashboard annotations/)).toBeDefined();
  expect(loadWorkloadDashboardSnapshot).not.toHaveBeenCalled();
  cleanup();
  open('?kind=Pod&namespace=bookinfo&name=reviews&uid=old');
  await read();
  await screen.findByText(/no longer matches the requested API group or UID/);
  expect(
    screen.queryByRole('button', { name: 'Inspect workload dashboard recommendations' })
  ).toBeNull();
});
it('invalidates pending ownership reads on a settings change without replaying or accepting late results', async () => {
  let resolve: (value: ReturnType<typeof snapshot>) => void = () => {
    throw new Error('Reader not started');
  };
  vi.mocked(loadWorkloadDashboardSnapshot).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const view = open();
  await read();
  const changed = structuredClone(settings);
  changed.clusters.alpha.telemetryCluster = 'west';
  vi.mocked(useKialiConfig).mockReturnValue(readConfig(changed));
  view.rerender(
    <MemoryRouter>
      <WorkloadDashboards />
    </MemoryRouter>
  );
  resolve(snapshot());
  await waitFor(() =>
    expect(vi.mocked(loadWorkloadDashboardSnapshot).mock.calls[0][2].aborted).toBe(true)
  );
  expect(
    screen.queryByRole('button', { name: 'Inspect workload dashboard recommendations' })
  ).toBeNull();
  expect(loadWorkloadDashboardSnapshot).toHaveBeenCalledTimes(1);
});
