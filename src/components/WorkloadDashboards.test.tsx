import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { readConfig } from '../core/config';
import { CorrelationResource } from '../core/correlation';
import { loadCorrelationSnapshot } from '../data/correlation';
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
vi.mock('../data/correlation', () => ({ loadCorrelationSnapshot: vi.fn() }));
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
  vi.mocked(loadCorrelationSnapshot).mockReset().mockResolvedValue(snapshot());
  vi.mocked(InspectionResults).mockClear();
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
  expect(loadCorrelationSnapshot).not.toHaveBeenCalled();
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
  const signal = vi.mocked(loadCorrelationSnapshot).mock.calls[0][1];
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
  expect(loadCorrelationSnapshot).toHaveBeenCalledTimes(1);
});
it('rejects invalid targets before transport and refuses changed linked UIDs', async () => {
  open('?kind=Pod&namespace=bookinfo&name=invalid%2Fname');
  await read();
  expect(screen.getByText(/valid name for dashboard annotations/)).toBeDefined();
  expect(loadCorrelationSnapshot).not.toHaveBeenCalled();
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
  vi.mocked(loadCorrelationSnapshot).mockImplementation(
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
    expect(vi.mocked(loadCorrelationSnapshot).mock.calls[0][1].aborted).toBe(true)
  );
  expect(
    screen.queryByRole('button', { name: 'Inspect workload dashboard recommendations' })
  ).toBeNull();
  expect(loadCorrelationSnapshot).toHaveBeenCalledTimes(1);
});
