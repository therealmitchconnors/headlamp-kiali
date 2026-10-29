import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('preserves a name-only disable declaration without erasing its intent or touching the cluster', async () => {
    render(<Settings />);
    fireEvent.change(screen.getByLabelText('Custom aggregate dashboards (JSON)'), {
      target: {
        value: JSON.stringify({
          namespaceLabel: 'namespace',
          clusterLabel: 'cluster',
          includeBuiltins: true,
          dashboards: [{ name: 'go' }],
        }),
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({
      clusters: {
        alpha: {
          customDashboards: {
            includeBuiltins: true,
            dashboards: [{ name: 'go', title: '', items: [] }],
          },
        },
      },
    });
    expect(state.request).not.toHaveBeenCalled();
  });
  it('opts into the pinned catalog per cluster without copying definitions or contacting Kubernetes', async () => {
    state.stored = {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null }, beta: { prometheus: null } },
    };
    render(<Settings />);
    const toggle = screen.getByLabelText('Include the bundled Kiali dashboard catalog');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({
      clusters: {
        alpha: { customDashboards: { includeBuiltins: true, dashboards: [] } },
        beta: { prometheus: null },
      },
    });
    expect(state.request).not.toHaveBeenCalled();
    cleanup();
    render(<Settings />);
    expect(
      (screen.getByLabelText('Include the bundled Kiali dashboard catalog') as HTMLInputElement)
        .checked
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Custom aggregate dashboards (JSON)'), {
      target: { value: '{' },
    });
    expect(
      (screen.getByLabelText('Include the bundled Kiali dashboard catalog') as HTMLInputElement)
        .disabled
    ).toBe(true);
  });
  it('persists custom dashboard settings and rejects unsupported chart fields', async () => {
    render(<Settings />);
    const definitions = {
      namespaceLabel: 'kubernetes_namespace',
      clusterLabel: null,
      dashboards: [
        {
          name: 'runtime',
          title: 'Runtime',
          items: [
            {
              chart: { name: 'Memory', metricName: 'memory_bytes', unit: 'bytes', dataType: 'raw' },
            },
          ],
        },
      ],
    };
    const field = screen.getByLabelText('Custom aggregate dashboards (JSON)');
    fireEvent.change(field, { target: { value: JSON.stringify(definitions) } });
    await userEvent.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({
      clusters: {
        alpha: {
          customDashboards: {
            namespaceLabel: 'kubernetes_namespace',
            clusterLabel: null,
            dashboards: [{ name: 'runtime' }],
          },
        },
      },
    });
    fireEvent.change(field, {
      target: { value: JSON.stringify({ ...definitions, includes: ['unsupported'] }) },
    });
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByText(/contains unsupported fields: includes/)).toBeDefined();
    expect(state.request).not.toHaveBeenCalled();
  });
  it('saves and restores the per-cluster bare-wildcard toggle without a cluster request', async () => {
    state.stored = {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null }, beta: { prometheus: null } },
    };
    render(<Settings />);
    const user = userEvent.setup();
    const toggle = screen.getByLabelText(
      'Skip bare wildcard hosts in Istio Gateway conflict checks'
    );
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({
      clusters: { alpha: { skipWildcardGatewayHosts: true }, beta: { prometheus: null } },
    });
    cleanup();
    render(<Settings />);
    expect(
      (
        screen.getByLabelText(
          'Skip bare wildcard hosts in Istio Gateway conflict checks'
        ) as HTMLInputElement
      ).checked
    ).toBe(true);
    await user.click(
      screen.getByLabelText('Skip bare wildcard hosts in Istio Gateway conflict checks')
    );
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({
      clusters: { alpha: { skipWildcardGatewayHosts: false } },
    });
    expect(state.request).not.toHaveBeenCalled();
  });
  it('saves an explicit telemetry identity, rejects invalid text and clears it deliberately', async () => {
    render(<Settings />);
    const user = userEvent.setup();
    const field = screen.getByLabelText('Default Istio metric cluster label');
    await user.type(field, ' mesh-id');
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    await user.clear(field);
    await user.type(field, 'Kubernetes');
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({ clusters: { alpha: { telemetryCluster: 'Kubernetes' } } });
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    expect(state.stored).toMatchObject({ clusters: { alpha: { telemetryCluster: null } } });
    expect(state.request).not.toHaveBeenCalled();
  });
  it('validates and saves Gateway class registry settings without issuing cluster mutations', async () => {
    render(<Settings />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Gateway API class registry (JSON)');
    await user.clear(input);
    await user.paste(
      JSON.stringify({
        classes: [{ name: 'Custom', className: 'custom' }],
        selector: { team: 'mesh' },
      })
    );
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    const saved = readConfig(state.stored);
    if (saved.valid === false) throw new Error(saved.message);
    expect(saved.config.clusters.alpha.gatewayClasses).toEqual({
      classes: [{ name: 'Custom', className: 'custom' }],
      selector: { team: 'mesh' },
    });
    expect(state.request).not.toHaveBeenCalled();
    await user.clear(input);
    await user.paste(JSON.stringify({ classes: [], selector: { 'bad key': 'value' } }));
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    expect(state.writes).toHaveLength(1);
  });
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
        healthRates: [],
        identityDomain: null,
        tracing: null,
      });
    }
    expect(state.request).not.toHaveBeenCalled();
  });

  it('validates and persists health tolerances without making a network request', async () => {
    render(<Settings />);
    const user = userEvent.setup();
    const rules = screen.getByLabelText('Custom health rules (JSON)');
    await user.clear(rules);
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    await user.click(rules);
    await user.paste(
      JSON.stringify([
        {
          kind: 'workload',
          name: 'reviews.*',
          tolerance: [
            { code: '5xx', degraded: 1, failure: 5, protocol: 'http', direction: 'inbound' },
          ],
        },
      ])
    );
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    const saved = readConfig(state.stored);
    expect(saved.valid).toBe(true);
    if (saved.valid) expect(saved.config.clusters.alpha.healthRates?.[0].name).toBe('reviews.*');
    expect(state.request).not.toHaveBeenCalled();
  });

  it('requires an explicit valid DNS suffix without conflating the selected cluster name', async () => {
    render(<Settings />);
    const user = userEvent.setup();
    const domain = screen.getByLabelText('Service DNS identity domain');
    expect((domain as HTMLInputElement).value).toBe('');
    await user.type(domain, 'https://bad');
    expect(
      screen.getByRole('button', { name: 'Save cluster settings' }).hasAttribute('disabled')
    ).toBe(true);
    await user.clear(domain);
    await user.type(domain, 'svc.mesh.example');
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    const saved = readConfig(state.stored);
    if (!saved.valid) throw new Error('Expected valid saved configuration');
    expect(saved.config.clusters.alpha.identityDomain).toBe('svc.mesh.example');
    expect(state.request).not.toHaveBeenCalled();
  });

  it('persists tracing independently and cancels checks when provider, endpoint or enablement changes', async () => {
    state.stored = {
      schemaVersion: 1,
      clusters: {
        alpha: {
          prometheus: null,
          tracing: {
            provider: 'jaeger',
            endpoint: { namespace: 'observability', service: 'query', port: 'http', basePath: '' },
          },
        },
      },
    };
    state.request.mockImplementation(() => new Promise(() => {}));
    render(<Settings />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Check tracing connection' }));
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
    const providerSignal: AbortSignal = state.request.mock.calls[0][1].signal;
    await user.click(screen.getByRole('combobox', { name: 'Tracing provider' }));
    await user.click(screen.getByRole('option', { name: 'Tempo' }));
    expect(providerSignal.aborted).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Check tracing connection' }));
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
    expect(state.request.mock.calls[1][0]).toContain('/api/search/tags');
    const endpointSignal: AbortSignal = state.request.mock.calls[1][1].signal;
    await user.type(screen.getByLabelText(/^Tracing Service \*/), '-new');
    expect(endpointSignal.aborted).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save cluster settings' }));
    const saved = readConfig(state.stored);
    if (!saved.valid) throw new Error('Expected valid saved tracing');
    expect(saved.config.clusters.alpha.prometheus).toBeNull();
    expect(saved.config.clusters.alpha.tracing?.provider).toBe('tempo');
    expect(saved.config.clusters.alpha.tracing?.endpoint.service).toBe('query-new');
    await user.click(screen.getByRole('button', { name: 'Check tracing connection' }));
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
    const enabledSignal: AbortSignal = state.request.mock.calls[2][1].signal;
    await user.click(screen.getByLabelText('Connect to an existing tracing Service'));
    expect(enabledSignal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Check tracing connection' })).toBeNull();
  });
});
