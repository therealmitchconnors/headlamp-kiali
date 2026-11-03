import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode, useSyncExternalStore } from 'react';
import ExternalDashboards from './ExternalDashboards';

const state = vi.hoisted(() => ({
  stored: undefined as unknown,
  listeners: new Set<() => void>(),
  selected: ['alpha'],
  request: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => state.selected },
  ApiProxy: { request: state.request },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(values?.[name] ?? `{{${name}}}`)),
  }),
  ConfigStore: class {
    get() {
      return state.stored;
    }
    set(value: unknown) {
      state.stored = value;
      state.listeners.forEach(listener => listener());
    }
    useConfig() {
      return function useConfig() {
        return useSyncExternalStore(
          listener => {
            state.listeners.add(listener);
            return () => state.listeners.delete(listener);
          },
          () => state.stored
        );
      };
    }
  },
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));

const grafana = {
  endpoint: {
    namespace: 'observability',
    service: 'grafana',
    port: '3000',
    basePath: '',
  },
  externalURL: 'https://grafana.example.test',
  datasourceUID: 'prom',
  dashboards: [
    {
      name: 'Istio Service Dashboard',
      variables: {
        cluster: 'var-cluster',
        namespace: 'var-namespace',
        service: 'var-service',
        app: 'var-app',
      },
    },
  ],
};

function config(url = grafana.externalURL) {
  return {
    schemaVersion: 1,
    clusters: {
      alpha: {
        prometheus: null,
        telemetryCluster: 'mesh-east',
        externalDashboards: {
          grafana: { ...grafana, externalURL: url },
        },
      },
    },
  };
}
function setStored(value: unknown) {
  state.stored = value;
  state.listeners.forEach(listener => listener());
}

beforeEach(() => {
  state.stored = config();
  state.listeners.clear();
  state.selected = ['alpha'];
  state.request.mockReset();
  state.request.mockResolvedValue([
    { title: 'Istio Service Dashboard', url: '/d/service-uid/istio-service' },
  ]);
});
afterEach(cleanup);

describe('external dashboard links', () => {
  it('discovers and opens a mapped historical dashboard explicitly, then discards stale settings results', async () => {
    render(<ExternalDashboards />);
    fireEvent.change(screen.getByLabelText('Dashboard namespace variable'), {
      target: { value: 'bookinfo' },
    });
    fireEvent.change(screen.getByLabelText('Dashboard service variable'), {
      target: { value: 'ratings' },
    });
    fireEvent.change(screen.getByLabelText('Historical range start'), {
      target: { value: '2023-11-14T22:13' },
    });
    fireEvent.change(screen.getByLabelText('Historical range end'), {
      target: { value: '2023-11-14T22:28' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discover grafana dashboards' }));

    const link = await screen.findByRole('link', {
      name: 'Open Istio Service Dashboard in grafana in a new tab',
    });
    const url = new URL((link as HTMLAnchorElement).href);
    expect(url.searchParams.get('var-cluster')).toBe('mesh-east');
    expect(url.searchParams.get('var-namespace')).toBe('bookinfo');
    expect(url.searchParams.get('var-service')).toBe('ratings.bookinfo.svc.cluster.local');
    expect(url.searchParams.has('var-app')).toBe(true);
    expect(url.searchParams.get('var-app')).toBe('');
    expect(url.searchParams.get('from')).toBe(String(Date.parse('2023-11-14T22:13')));
    expect(url.searchParams.get('to')).toBe(String(Date.parse('2023-11-14T22:28')));
    expect((link as HTMLAnchorElement).target).toBe('_blank');
    expect((link as HTMLAnchorElement).rel).toBe('noopener noreferrer');
    expect(state.request).toHaveBeenCalledTimes(1);

    await act(async () => setStored(config('https://new-grafana.example.test')));
    await waitFor(() => {
      expect(
        screen.queryByRole('link', { name: 'Open Istio Service Dashboard in grafana in a new tab' })
      ).toBeNull();
    });
    expect(screen.getByText(/Previous discovery results were discarded/)).toBeTruthy();
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it('does not discover against a multi-cluster group', () => {
    state.selected = ['alpha', 'beta'];
    render(<ExternalDashboards />);
    expect(
      screen.getByText(
        'Select exactly one cluster before discovering external dashboards. Grouped cluster selections are not used as link targets.'
      )
    ).toBeTruthy();
    expect(state.request).not.toHaveBeenCalled();
  });

  it('distinguishes missing provider configuration from a failed discovery', () => {
    state.stored = { schemaVersion: 1, clusters: { alpha: { prometheus: null } } };
    render(<ExternalDashboards />);
    expect(
      screen.getByText(
        'External dashboard endpoints are not configured. Add provider settings under Kiali > Connection settings; no provider credentials are stored.'
      )
    ).toBeTruthy();
    expect(state.request).not.toHaveBeenCalled();
  });

  it('cancels an in-flight provider read when the saved endpoint changes', async () => {
    state.request.mockImplementation(
      (_path, options) =>
        new Promise(resolve => {
          options?.signal?.addEventListener(
            'abort',
            () => resolve([{ title: 'Istio Service Dashboard', url: '/d/stale/dashboard' }]),
            { once: true }
          );
        })
    );
    render(<ExternalDashboards />);
    fireEvent.click(screen.getByRole('button', { name: 'Discover grafana dashboards' }));
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
    const requestSignal = state.request.mock.calls[0][1]?.signal;
    await act(async () => setStored(config('https://replacement.example.test')));
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(screen.queryByRole('link', { name: /Open Istio Service Dashboard/ })).toBeNull();
    expect(state.request).toHaveBeenCalledTimes(1);
  });
});
