import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode, useSyncExternalStore } from 'react';
import { readConfig } from '../core/config';
import Settings from './Settings';

const state = vi.hoisted(() => ({
  stored: undefined as unknown,
  writes: [] as unknown[],
  listeners: new Set<() => void>(),
  selected: ['alpha'],
  request: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  return {
    K8s: {
      useClustersConf: () => ({ alpha: {}, beta: {} }),
      useSelectedClusters: () => state.selected,
    },
    ApiProxy: { request: state.request },
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) =>
        key.replace(/\{\{(\w+)\}\}/g, (match, name) => String(values?.[name] ?? match)),
    }),
    ConfigStore: class {
      get() {
        return state.stored;
      }
      set(value: unknown) {
        state.stored = value;
        state.writes.push(value);
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
  };
});

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
  ConfirmDialog: ({
    open,
    title,
    description,
    onConfirm,
    handleClose,
    confirmLabel,
  }: {
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
    handleClose: () => void;
    confirmLabel: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <p>{description}</p>
        <button onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={handleClose}>Cancel</button>
      </div>
    ) : null,
}));

beforeEach(() => {
  state.stored = undefined;
  state.writes.length = 0;
  state.listeners.clear();
  state.selected = ['alpha'];
  state.request.mockReset();
});
afterEach(cleanup);

async function fillEndpoint() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Connect to an existing Prometheus Service'));
  await user.type(screen.getByLabelText(/Prometheus namespace/), 'istio-system');
  await user.type(screen.getByLabelText(/^Prometheus Service/), 'prometheus');
  return user;
}

describe('native per-cluster settings', () => {
  it('does not select an arbitrary cluster or make a network request', () => {
    state.selected = [];
    render(<Settings />);
    expect(screen.getByText('Select a cluster before editing its settings.')).toBeDefined();
    expect(state.request).not.toHaveBeenCalled();
    expect(state.writes).toHaveLength(0);
  });

  it('disables save for invalid endpoints without silently changing stored configuration', async () => {
    render(<Settings />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Connect to an existing Prometheus Service'));
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    await user.type(screen.getByLabelText(/Prometheus namespace/), '../bad');
    expect(screen.getByText(/Invalid settings/)).toBeDefined();
    expect(state.writes).toHaveLength(0);
    expect(state.request).not.toHaveBeenCalled();
  });

  it('saves only the explicit cluster and preserves another cluster updated after rendering', async () => {
    render(<Settings />);
    const user = await fillEndpoint();
    act(() => {
      state.stored = {
        schemaVersion: 1,
        clusters: {
          beta: {
            prometheus: { namespace: 'monitoring', service: 'metrics', port: 'http', basePath: '' },
          },
        },
      };
    });
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(screen.getByText('Settings saved for alpha.')).toBeDefined();
    const config = readConfig(state.stored);
    expect(config.valid).toBe(true);
    if (config.valid) {
      expect(config.config.clusters.alpha.prometheus).toEqual({
        namespace: 'istio-system',
        service: 'prometheus',
        port: '9090',
        basePath: '',
      });
      expect(config.config.clusters.beta.prometheus?.service).toBe('metrics');
    }
    expect(state.request).not.toHaveBeenCalled();
  });

  it('checks the configured Service through the selected cluster without saving it', async () => {
    state.request.mockResolvedValue({ status: 'success', data: { version: '3.10.0' } });
    render(<Settings />);
    const user = await fillEndpoint();
    await user.click(screen.getByRole('button', { name: 'Check connection' }));
    await waitFor(() =>
      expect(screen.getByText('Connected to Prometheus 3.10.0 in alpha.')).toBeDefined()
    );
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/namespaces/istio-system/services/prometheus:9090/proxy/api/v1/status/buildinfo',
      expect.objectContaining({ cluster: 'alpha', signal: expect.any(AbortSignal) }),
      false
    );
    expect(state.writes).toHaveLength(0);
  });

  it('aborts a check when the endpoint draft changes', async () => {
    state.request.mockImplementation(() => new Promise(() => {}));
    render(<Settings />);
    const user = await fillEndpoint();
    await user.click(screen.getByRole('button', { name: 'Check connection' }));
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
    const signal: AbortSignal = state.request.mock.calls[0][1].signal;
    await user.type(screen.getByLabelText(/Prometheus namespace/), '-new');
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Checking connection...')).toBeNull();
  });

  it('requires confirmation before resetting invalid saved data', async () => {
    state.stored = { schemaVersion: 2, clusters: {} };
    render(<Settings />);
    const user = userEvent.setup();
    expect(screen.getByText(/Stored Kiali configuration is invalid/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Reset Kiali settings' }));
    expect(screen.getByRole('dialog', { name: 'Reset Kiali settings' })).toBeDefined();
    expect(state.writes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Reset$/ }));
    expect(state.stored).toEqual({ schemaVersion: 1, clusters: {} });
  });

  it('saves custom application labels independently of a metrics connection', async () => {
    render(<Settings />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Override application and version labels'));
    const app = screen.getByLabelText(/Application label key/);
    const version = screen.getByLabelText(/Version label key/);
    await user.clear(app);
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    await user.type(app, 'team/app');
    await user.clear(version);
    await user.type(version, 'team/version');
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    const saved = readConfig(state.stored);
    expect(saved.valid).toBe(true);
    if (saved.valid) {
      expect(saved.config.clusters.alpha).toEqual({
        prometheus: null,
        appLabels: { app: 'team/app', version: 'team/version' },
      });
    }
    expect(state.request).not.toHaveBeenCalled();
  });
});
