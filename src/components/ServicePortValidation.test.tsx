import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { readConfig } from '../core/config';
import { loadServicePortValidation } from '../data/servicePortValidation';
import ServicePortValidation from './ServicePortValidation';

const selection = vi.hoisted(() => ({ clusters: ['alpha'] }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => selection.clusters },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/servicePortValidation', async importOriginal => ({
  ...(await importOriginal<typeof import('../data/servicePortValidation')>()),
  loadServicePortValidation: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SimpleTable: ({
    data,
    columns,
  }: {
    data: unknown[];
    columns: { label: string; getter: (value: unknown) => ReactNode }[];
  }) => (
    <table>
      <tbody>
        {data.map((value, i) => (
          <tr key={i}>
            {columns.map(column => (
              <td key={column.label}>{column.getter(value)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
const settings = {
  schemaVersion: 1,
  clusters: { alpha: { prometheus: null, meshClusterName: 'logical' } },
};
function result(): Awaited<ReturnType<typeof loadServicePortValidation>> {
  return {
    disabled: false,
    service: {
      uid: 'svc',
      resourceVersion: '1',
      namespace: 'bookinfo',
      name: 'reviews',
      labels: {},
      annotations: {},
      spec: {},
    },
    managed: {
      cluster: 'alpha',
      logicalName: 'logical',
      visibility: 'pinned-default-system-exclusion',
      membership: [{ namespace: 'bookinfo', controllers: [] }],
      controllerNamespaces: ['istio-system'],
      excludedSystemNamespaces: [],
      unmanagedNamespaces: [],
    },
    sources: [{ namespace: 'bookinfo', resourceVersion: '2', count: 0 }],
    deploymentSource: { resourceVersion: '3', count: 1 },
    result: {
      findings: [
        {
          code: 'KIA0601',
          severity: 'error',
          path: 'spec/ports[0]',
          message: 'Port name must follow <protocol>[-suffix] form',
        },
      ],
      suppressed: 0,
      coverage: 'partial',
      matchedPods: 0,
      inMesh: true,
      mappingExcluded: false,
      deployment: undefined,
    },
  };
}
beforeEach(() => {
  selection.clusters = ['alpha'];
  vi.mocked(useKialiConfig).mockReturnValue(readConfig(settings));
  vi.mocked(loadServicePortValidation).mockReset().mockResolvedValue(result());
});
afterEach(cleanup);
const open = (search = '?namespace=bookinfo&name=reviews&uid=svc') =>
  render(
    <MemoryRouter initialEntries={[`/kiali/service-validation${search}`]}>
      <ServicePortValidation />
    </MemoryRouter>
  );
const run = () => userEvent.click(screen.getByRole('button', { name: 'Run Service port checks' }));
it('requires explicit submission, renders findings/source outcomes and warns about bounded semantics', async () => {
  open();
  expect(loadServicePortValidation).not.toHaveBeenCalled();
  await run();
  await screen.findByText('KIA0601');
  expect(loadServicePortValidation).toHaveBeenCalledWith(
    { cluster: 'alpha' },
    { namespace: 'bookinfo', name: 'reviews', uid: 'svc' },
    'logical',
    expect.any(AbortSignal)
  );
  expect(screen.getByText(/empty match is mesh-positive/)).toBeDefined();
  expect(screen.getByText(/emits no missing-Deployment finding/)).toBeDefined();
  expect(screen.getByText('Deployment/cluster-wide')).toBeDefined();
});
it('keeps denial unavailable, with no success-shaped findings', async () => {
  vi.mocked(loadServicePortValidation).mockRejectedValue({ status: 403, message: 'Pods denied' });
  open();
  await run();
  await screen.findByText('Access denied: Pods denied');
  expect(screen.queryByText('KIA0601')).toBeNull();
  expect(screen.queryByText(/No findings in this bounded/)).toBeNull();
});
it('explicit retry rereads evidence instead of retaining earlier findings', async () => {
  open();
  await run();
  await screen.findByText('KIA0601');
  vi.mocked(loadServicePortValidation).mockRejectedValue(new Error('Incomplete Pod pool'));
  await run();
  await screen.findByText('Unavailable: Incomplete Pod pool');
  expect(screen.queryByText('KIA0601')).toBeNull();
  expect(loadServicePortValidation).toHaveBeenCalledTimes(2);
});
it('scope draft changes cancel captures without replay or resurrection', async () => {
  open();
  await run();
  await screen.findByText('KIA0601');
  const signal = vi.mocked(loadServicePortValidation).mock.calls[0][3];
  fireEvent.change(screen.getByLabelText('Service validation name'), {
    target: { value: 'other' },
  });
  expect(signal.aborted).toBe(true);
  fireEvent.change(screen.getByLabelText('Service validation name'), {
    target: { value: 'reviews' },
  });
  expect(screen.queryByText('KIA0601')).toBeNull();
  expect(loadServicePortValidation).toHaveBeenCalledTimes(1);
  await run();
  expect(vi.mocked(loadServicePortValidation).mock.calls[1][1].uid).toBeUndefined();
});
it('logical mesh setting changes cancel pending work and ignore late results without replay', async () => {
  let finish: (data: Awaited<ReturnType<typeof loadServicePortValidation>>) => void = () => {
    throw new Error('Read not started');
  };
  vi.mocked(loadServicePortValidation).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const view = open();
  await run();
  const signal = vi.mocked(loadServicePortValidation).mock.calls[0][3];
  vi.mocked(useKialiConfig).mockReturnValue(
    readConfig({
      ...settings,
      clusters: { alpha: { ...settings.clusters.alpha, meshClusterName: 'changed' } },
    })
  );
  view.rerender(
    <MemoryRouter>
      <ServicePortValidation />
    </MemoryRouter>
  );
  expect(signal.aborted).toBe(true);
  finish(result());
  expect(screen.queryByText('KIA0601')).toBeNull();
  expect(loadServicePortValidation).toHaveBeenCalledTimes(1);
});
it('unrelated telemetry settings do not replay or invalidate a captured check', async () => {
  const view = open();
  await run();
  await screen.findByText('KIA0601');
  vi.mocked(useKialiConfig).mockReturnValue(
    readConfig({
      ...settings,
      clusters: { alpha: { ...settings.clusters.alpha, telemetryCluster: 'other' } },
    })
  );
  view.rerender(
    <MemoryRouter>
      <ServicePortValidation />
    </MemoryRouter>
  );
  expect(screen.getByText('KIA0601')).toBeDefined();
  expect(loadServicePortValidation).toHaveBeenCalledTimes(1);
});
it('invalid targets do not issue reads and cluster groups are not silently reduced', async () => {
  open('?namespace=bookinfo&name=invalid%2Fname');
  await run();
  expect(screen.getByText(/require a valid namespace/)).toBeDefined();
  expect(loadServicePortValidation).not.toHaveBeenCalled();
  cleanup();
  selection.clusters = ['alpha', 'beta'];
  open();
  expect(screen.queryByRole('button', { name: 'Run Service port checks' })).toBeNull();
  expect(screen.getByText(/supports one cluster at a time/)).toBeDefined();
});
it('renders all-excluded captures explicitly without a no-findings verdict', async () => {
  vi.mocked(loadServicePortValidation).mockResolvedValue({
    disabled: true,
    service: result().service,
  });
  open();
  await run();
  await screen.findByText(/All validation checks are disabled/);
  expect(screen.queryByText(/No findings in this bounded/)).toBeNull();
});
it('requires explicit logical mesh identity before allowing the read', () => {
  vi.mocked(useKialiConfig).mockReturnValue(
    readConfig({
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null } },
    })
  );
  open();
  expect(screen.getByText(/Set an explicit logical mesh cluster name/)).toBeDefined();
  expect(
    screen.getByRole('button', { name: 'Run Service port checks' }).hasAttribute('disabled')
  ).toBe(true);
  expect(loadServicePortValidation).not.toHaveBeenCalled();
});
