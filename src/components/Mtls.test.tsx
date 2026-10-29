import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { loadMtlsSnapshot } from '../data/mtls';
import Mtls from './Mtls';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { useSelectedClusters: () => ['alpha'], useClustersConf: () => ({ alpha: {} }) },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (match, name) => String(values?.[name] ?? match)),
  }),
}));
vi.mock('../config', () => ({
  useKialiConfig: () => ({
    valid: true,
    config: { schemaVersion: 1, clusters: { alpha: { prometheus: null } } },
  }),
}));
vi.mock('../data/mtls', () => ({ loadMtlsSnapshot: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/mesh">{children}</a>,
  SimpleTable: () => <table />,
}));
afterEach(cleanup);
it('retains explicit linked scope and surfaces failed assessment without a configured-status badge', async () => {
  vi.mocked(loadMtlsSnapshot).mockRejectedValue(new Error('Controller configuration unresolved'));
  render(
    <MemoryRouter
      initialEntries={[
        '/mtls?namespace=bookinfo&controllerNamespace=istio-system&controller=istiod',
      ]}
    >
      <Mtls />
    </MemoryRouter>
  );
  expect(loadMtlsSnapshot).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Assess configuration' }));
  await waitFor(() =>
    expect(screen.getByText('Unavailable: Controller configuration unresolved')).toBeDefined()
  );
  expect(loadMtlsSnapshot).toHaveBeenCalledTimes(1);
  expect(loadMtlsSnapshot).toHaveBeenCalledWith(
    { cluster: 'alpha' },
    { namespace: 'bookinfo', controllerNamespace: 'istio-system', controller: 'istiod' },
    null,
    expect.any(AbortSignal)
  );
  expect(screen.queryByText('Pinned Kiali configuration indicator')).toBeNull();
});

it('labels a resolved controller-namespace fallback instead of presenting it as reported configuration', async () => {
  const query = {
    namespace: 'bookinfo',
    controllerNamespace: 'custom-system',
    controller: 'istiod',
  };
  vi.mocked(loadMtlsSnapshot)
    .mockReset()
    .mockResolvedValue({
      query,
      rootNamespace: 'custom-system',
      rootNamespaceDefaulted: true,
      identityDomain: 'svc.cluster.local',
      autoMtlsEnabled: true,
      autoMtlsDefaulted: true,
      peers: { complete: true, items: [] },
      destinationRules: { complete: true, items: [] },
      controller: {
        controller: {
          name: 'istiod',
          namespace: 'custom-system',
          uid: 'cp',
          revision: 'default',
          replicas: null,
          stale: false,
          configurationWarnings: [],
          managesExternal: false,
          effectiveConfigBlocked: false,
        },
        mesh: { status: 'ready', name: 'istio', value: { hasDiscoverySelectors: false } },
        injector: { status: 'ready', name: 'injector', value: {} },
      },
    });
  render(
    <MemoryRouter
      initialEntries={[
        '/mtls?namespace=bookinfo&controllerNamespace=custom-system&controller=istiod',
      ]}
    >
      <Mtls />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Assess configuration' }));
  await screen.findByText(
    /uses the observed controller namespace after configuration has been resolved/
  );
  expect(screen.getByText('Mesh root namespace: custom-system')).toBeDefined();
  expect(screen.queryByText('Pinned Kiali configuration indicator')).toBeNull();
});
