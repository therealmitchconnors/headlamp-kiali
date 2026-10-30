import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import fixtureText from '../../../test-files/configuration/fixtures.json?raw';
import { GatewayClassSettings } from '../../core/gatewayClassRegistry';
import { loadValidationSnapshot } from '../../data/validation';
import { AuthorizationPolicy } from '../../resources/authorization-policy';
import { DestinationRule } from '../../resources/destination-rule';
import { Gateway } from '../../resources/gateway';
import { K8sGateway } from '../../resources/k8s-gateway';
import { PeerAuthentication } from '../../resources/peer-authentication';
import { RequestAuthentication } from '../../resources/request-authentication';
import { ServiceEntry } from '../../resources/service-entry';
import { Sidecar } from '../../resources/sidecar';
import { Telemetry } from '../../resources/telemetry';
import { VirtualService } from '../../resources/virtual-service';
import { WasmPlugin } from '../../resources/wasm-plugin';
import Validation from './Validation';
const settingsState = vi.hoisted(() => ({
  gatewayClasses: undefined as GatewayClassSettings | undefined,
  skipWildcardGatewayHosts: false,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
  ApiProxy: { request: vi.fn() },
  K8s: {
    cluster: {
      KubeObject: class {
        constructor(public jsonData: { metadata: object; kind: string }, public cluster: string) {}
        get metadata() {
          return this.jsonData.metadata;
        }
        get kind() {
          return this.jsonData.kind;
        }
      },
    },
  },
}));
vi.mock('../../data/validation', () => ({ loadValidationSnapshot: vi.fn() }));
vi.mock('../../config', () => ({
  useKialiConfig: () => ({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: {
        alpha: {
          prometheus: null,
          identityDomain: 'svc.cluster.local',
          gatewayClasses: settingsState.gatewayClasses,
          skipWildcardGatewayHosts: settingsState.skipWildcardGatewayHosts,
        },
      },
    },
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Link: ({
    routeName,
    params,
    children,
  }: {
    routeName: string;
    params: { cluster: string; namespace: string; name: string };
    children: ReactNode;
  }) => (
    <a href={`/c/${params.cluster}/${routeName}/${params.namespace}/${params.name}`}>{children}</a>
  ),
  SimpleTable: <T,>({
    data,
    emptyMessage,
    columns,
  }: {
    data: T[];
    emptyMessage?: string;
    columns: { label: string; getter: (row: T) => ReactNode }[];
  }) => (
    <div>
      {data.length
        ? data.map((row, i) => (
            <div key={i}>
              {columns.map((column, j) => (
                <span key={j}>{column.getter(row)}</span>
              ))}
            </div>
          ))
        : emptyMessage}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  settingsState.gatewayClasses = undefined;
  settingsState.skipWildcardGatewayHosts = false;
  vi.mocked(loadValidationSnapshot).mockReset();
});

it.each(['Telemetry', 'WasmPlugin', 'RequestAuthentication'] as const)(
  'keeps workload-selector activation source-bound for %s without claiming complete inclusion',
  async kind => {
    const metadata = {
      name: 'selected',
      namespace: 'bookinfo',
      uid: 'selected-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    };
    const selector = { matchLabels: { app: 'missing' } };
    const resource =
      kind === 'Telemetry'
        ? new Telemetry(
            { apiVersion: 'telemetry.istio.io/v1', kind, metadata, spec: { selector } },
            'alpha'
          )
        : kind === 'WasmPlugin'
        ? new WasmPlugin(
            {
              apiVersion: 'extensions.istio.io/v1alpha1',
              kind,
              metadata,
              spec: { selector, url: 'oci://example.invalid/plugin' },
            },
            'alpha'
          )
        : new RequestAuthentication(
            { apiVersion: 'security.istio.io/v1', kind, metadata, spec: { selector } },
            'alpha'
          );
    vi.mocked(loadValidationSnapshot).mockResolvedValueOnce({
      sources: [],
      context: {
        cluster: 'alpha',
        identityDomain: 'svc.cluster.local',
        namespaces: { complete: false, items: [] },
        sidecars: { complete: false, items: [] },
        destinationRules: { complete: false, items: [] },
      },
    });
    render(<Validation resource={resource} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
    await screen.findByText(
      'No findings from these limited checks. This is not a validity or health verdict.'
    );
    expect(screen.queryByText('KIA0004')).toBeNull();
    expect(
      !!screen.queryByText('Workload-selector check requires a complete namespace snapshot')
    ).toBe(kind === 'RequestAuthentication');
    expect(loadValidationSnapshot).toHaveBeenCalledTimes(1);
  }
);

it('passes configured Gateway classes and displays their provenance without triggering repeated reads', async () => {
  settingsState.gatewayClasses = {
    classes: [{ name: 'Custom', className: 'custom' }],
    selector: {},
  };
  const resource = new K8sGateway(
    {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'Gateway',
      metadata: {
        name: 'gateway',
        namespace: 'bookinfo',
        uid: 'gateway-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { gatewayClassName: 'missing', listeners: [] },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
      gatewayClassRegistry: {
        basis: 'configured',
        classes: settingsState.gatewayClasses.classes,
        uncertain: [],
      },
    },
    sources: [],
  });
  render(<Validation resource={resource} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1504');
  expect(vi.mocked(loadValidationSnapshot).mock.calls[0][7]).toEqual(settingsState.gatewayClasses);
  expect(screen.getByText('Registry source: Configured classes')).toBeDefined();
  expect(screen.getByText('Custom')).toBeDefined();
  expect(loadValidationSnapshot).toHaveBeenCalledTimes(1);
});

it('presents authorization registry findings as scoped hints rather than access decisions', async () => {
  const resource = new AuthorizationPolicy(
    {
      apiVersion: 'security.istio.io/v1',
      kind: 'AuthorizationPolicy',
      metadata: {
        name: 'policy',
        namespace: 'bookinfo',
        uid: 'policy-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { rules: [{ to: [{ operation: { hosts: ['missing'] } }] }] },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: {
        complete: true,
        items: [{ name: 'bookinfo', namespace: '', labels: {}, spec: {} }],
      },
      destinationRules: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
      services: { complete: true, items: [] },
      serviceEntries: { complete: true, items: [] },
      virtualServices: { complete: true, items: [] },
      namespaceMesh: new Map([
        [
          'bookinfo',
          { status: 'ready', controller: 'root/istiod', fields: { hasDiscoverySelectors: false } },
        ],
      ]),
    },
  });
  render(<Validation resource={resource} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA0104');
  expect(screen.getByText('Warning')).toBeDefined();
  expect(screen.getByText('This host has no matching entry in the service registry')).toBeDefined();
  expect(
    screen.getByText(/Authorization host findings are scoped service-registry hints/)
  ).toBeDefined();
  expect(loadValidationSnapshot).toHaveBeenCalledTimes(1);
});

it('links Gateway collisions to the Gateway API kind with observed UID provenance', async () => {
  const spec = {
    gatewayClassName: 'istio',
    listeners: [{ name: 'http', hostname: 'example.com', port: 80, protocol: 'HTTP' }],
  };
  const resource = new K8sGateway(
    {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'Gateway',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec,
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
      gateways: {
        complete: true,
        items: [
          { name: 'selected', namespace: 'bookinfo', uid: 'selected-uid', labels: {}, spec },
          { name: 'peer', namespace: 'edge', uid: 'peer-uid', labels: {}, spec },
        ],
      },
    },
    sources: [],
  });
  render(<Validation resource={resource} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1501');
  expect(screen.getByText(/Gateway collision findings use exact hostname/)).toBeDefined();
  expect(screen.queryByText(/TLS override findings describe configuration patterns/)).toBeNull();
  await user.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'peer' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-k8s-gateway-detail/edge/peer'
  );
  expect(screen.getByText('peer-uid')).toBeDefined();
});

it('explains VirtualService conflicts and links observed peers on the captured cluster', async () => {
  const spec = { hosts: ['reviews'], exportTo: ['*'] };
  const resource = new VirtualService(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'VirtualService',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec,
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: {
        complete: true,
        items: ['bookinfo', 'other'].map(name => ({
          name,
          namespace: '',
          labels: {},
          spec: {},
        })),
      },
      destinationRules: { complete: false, items: [] },
      sidecars: { complete: true, items: [] },
      virtualServices: {
        complete: true,
        items: [
          { name: 'selected', namespace: 'bookinfo', uid: 'selected-uid', labels: {}, spec },
          {
            name: 'peer',
            namespace: 'other',
            uid: 'peer-uid',
            labels: {},
            spec: { ...spec, hosts: ['reviews.bookinfo'] },
          },
        ],
      },
    },
    sources: [],
  });
  render(<Validation resource={resource} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1106');
  expect(screen.getByText(/Host conflicts follow pinned Kiali grouping/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'peer' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-virtual-service-detail/other/peer'
  );
  expect(screen.getByText('peer-uid')).toBeDefined();
  expect(loadValidationSnapshot).toHaveBeenCalledTimes(1);
});

it('explains selectorless policy errors independently and links same-namespace peers', async () => {
  const resource = new PeerAuthentication(
    {
      apiVersion: 'security.istio.io/v1',
      kind: 'PeerAuthentication',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { selector: {}, mtls: { mode: 'PERMISSIVE' } },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: { complete: true, items: [] },
      sidecars: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      peerAuthentications: {
        complete: true,
        items: [
          {
            name: 'selected',
            namespace: 'bookinfo',
            uid: 'uid',
            labels: {},
            spec: { selector: {} },
          },
          {
            name: 'peer',
            namespace: 'bookinfo',
            uid: 'peer-uid',
            labels: {},
            spec: { selector: { matchLabels: {} } },
          },
        ],
      },
      namespaceMesh: new Map([
        [
          'bookinfo',
          { status: 'ready', controller: 'istiod', fields: { hasDiscoverySelectors: false } },
        ],
      ]),
    },
    sources: [],
  });
  render(<Validation resource={resource} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA0002');
  expect(screen.getByText('Error')).toBeDefined();
  expect(screen.getByText(/Selectorless PeerAuthentication conflicts count absent/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'peer' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-peer-authentication-detail/bookinfo/peer'
  );
  expect(screen.getByText('peer-uid')).toBeDefined();
});

it('keeps Istio Gateway links group-safe and rechecks captured wildcard settings', async () => {
  const spec = {
    servers: [{ hosts: ['*'], port: { number: 80, name: 'http', protocol: 'HTTP' } }],
  };
  const resource = new Gateway(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'Gateway',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec,
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      istioGateways: {
        complete: true,
        items: [
          { name: 'selected', namespace: 'bookinfo', uid: 'uid', labels: {}, spec },
          { name: 'peer', namespace: 'other', uid: 'peer-uid', labels: {}, spec },
        ],
      },
    },
    sources: [],
  });
  const view = render(<Validation resource={resource} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA0301');
  expect(screen.getByText(/Bare \* host comparisons are included/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'peer' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-gateway-detail/other/peer'
  );
  await user.click(screen.getByRole('button', { name: 'Close related configurations' }));
  settingsState.skipWildcardGatewayHosts = true;
  view.rerender(<Validation resource={resource} />);
  await screen.findByText(/Bare \* host comparisons are skipped/);
  expect(screen.queryByText('KIA0301')).toBeNull();
  expect(loadValidationSnapshot).toHaveBeenCalledTimes(2);
});

it('does not refetch endlessly when the host returns a fresh translation function on render', async () => {
  const resource = new VirtualService(JSON.parse(fixtureText).virtualService, 'alpha');
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
    },
    sources: [],
  });
  render(<Validation resource={resource} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Run initial checks' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        'No findings from these limited checks. This is not a validity or health verdict.'
      )
    ).toBeDefined()
  );
  expect(loadValidationSnapshot).toHaveBeenCalledTimes(1);
});

it('shows scoped related ServiceEntries and retains partial-scope language', async () => {
  const spec = {
    hosts: ['api.example.test'],
    ports: [{ name: 'arbitrary-port-name', number: 80, protocol: 'HTTP' }],
    exportTo: ['*'],
  };
  const resource = new ServiceEntry(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'ServiceEntry',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec,
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: {
        complete: true,
        items: [{ name: 'bookinfo', namespace: '', labels: {}, spec: {} }],
      },
      sidecars: { complete: true, items: [] },
      destinationRules: { complete: false, items: [] },
      serviceEntries: {
        complete: true,
        items: [
          { name: 'selected', namespace: 'bookinfo', uid: 'selected-uid', labels: {}, spec },
          {
            name: 'peer',
            namespace: 'bookinfo',
            uid: 'peer-uid',
            labels: {},
            spec: { ...spec, ports: [{ number: 80, protocol: 'TCP' }] },
          },
        ],
      },
    },
  });
  const view = render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1212');
  await userEvent.click(screen.getByText('1 related configurations'));
  expect(screen.getByRole('link', { name: 'peer' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-service-entry-detail/bookinfo/peer'
  );
  expect(screen.getByText('peer-uid')).toBeDefined();
  expect(screen.getByText(/Coverage is partial/)).toBeDefined();
  expect(screen.getByRole('dialog', { name: 'Related configurations' })).toBeDefined();
  vi.mocked(loadValidationSnapshot).mockRejectedValueOnce({
    status: 403,
    message: 'Beta validation denied',
  });
  view.rerender(<Validation resource={new ServiceEntry(resource.jsonData, 'beta')} />);
  expect(screen.queryByRole('dialog', { name: 'Related configurations' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'peer' })).toBeNull();
  await screen.findByText('Access denied: Beta validation denied');
});

it('qualifies TLS override warnings and links the related DestinationRule', async () => {
  const spec = { host: 'reviews', exportTo: ['*'] };
  const resource = new DestinationRule(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'DestinationRule',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec,
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValue({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: {
        complete: true,
        items: ['bookinfo', 'other'].map(name => ({ name, namespace: '', labels: {}, spec: {} })),
      },
      sidecars: { complete: true, items: [] },
      destinationRules: {
        complete: true,
        items: [
          { name: 'selected', namespace: 'bookinfo', uid: 'selected-uid', labels: {}, spec },
          {
            name: 'mesh-default',
            namespace: 'other',
            uid: 'peer-uid',
            labels: {},
            spec: {
              host: '*.local',
              trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } },
              exportTo: ['*'],
            },
          },
        ],
      },
    },
  });
  render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA0204');
  expect(screen.getByText(/configuration patterns, not observed encryption/)).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'mesh-default' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-destination-rule-detail/other/mesh-default'
  );
});

it('renders root-selector warnings without claiming workload absence or retaining old cluster results', async () => {
  const resource = new Sidecar(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'Sidecar',
      metadata: {
        name: 'selected',
        namespace: 'mesh-root',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { workloadSelector: { labels: { app: 'reviews' } } },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValueOnce({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: null,
      namespaces: { complete: false, items: [] },
      sidecars: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      namespaceMesh: new Map([
        [
          'mesh-root',
          {
            status: 'ready',
            controller: 'control-plane/istiod',
            fields: { rootNamespace: 'mesh-root', hasDiscoverySelectors: false },
          },
        ],
      ]),
    },
  });
  const view = render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1006');
  expect(screen.getByText('Global default sidecar should not have workloadSelector')).toBeDefined();
  expect(screen.queryByText('KIA0004')).toBeNull();
  expect(
    screen.getByText('Workload-selector check requires a complete namespace snapshot')
  ).toBeDefined();
  vi.mocked(loadValidationSnapshot).mockRejectedValueOnce({ status: 403, message: 'Beta denied' });
  view.rerender(<Validation resource={new Sidecar(resource.jsonData, 'beta')} />);
  expect(screen.queryByText('KIA1006')).toBeNull();
  await screen.findByText('Access denied: Beta denied');
});

it('qualifies registry findings and preserves the actual egress field index', async () => {
  const resource = new Sidecar(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'Sidecar',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { egress: [{ hosts: ['*/*'] }, { hosts: ['*/missing'] }] },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValueOnce({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: {
        complete: true,
        items: [{ name: 'bookinfo', namespace: '', labels: {}, spec: {} }],
      },
      sidecars: { complete: false, items: [] },
      destinationRules: { complete: false, items: [] },
      services: { complete: true, items: [] },
      serviceEntries: { complete: true, items: [] },
    },
  });
  render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1004');
  expect(screen.getByText('spec/egress[1]/hosts[0]')).toBeDefined();
  expect(screen.getByText('This host has no matching entry in the service registry')).toBeDefined();
  expect(
    screen.getByText(/not traffic reachability or effective Sidecar enforcement/)
  ).toBeDefined();
});

it('captures specification and exclusions before deferred registry reads', async () => {
  const destination = { host: 'missing' };
  const annotations: Record<string, string> = {};
  const resource = new VirtualService(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'VirtualService',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
        annotations,
      },
      spec: { http: [{ route: [{ destination }] }] },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockImplementationOnce(async (_scope, _kind, _group, spec) => {
    destination.host = 'reviews';
    annotations['kiali.io/ignore-validations'] = 'KIA1101';
    expect(spec).not.toBe(resource.spec);
    return {
      sources: [],
      context: {
        cluster: 'alpha',
        identityDomain: 'svc.cluster.local',
        namespaces: {
          complete: true,
          items: [{ name: 'bookinfo', namespace: '', labels: {}, spec: {} }],
        },
        services: {
          complete: true,
          items: [
            {
              name: 'reviews',
              namespace: 'bookinfo',
              uid: 'svc',
              labels: {},
              spec: {},
              exportToAnnotation: '*',
            },
          ],
        },
        serviceEntries: { complete: true, items: [] },
        destinationRules: { complete: false, items: [] },
        sidecars: { complete: false, items: [] },
        namespaceMesh: new Map([
          [
            'bookinfo',
            {
              status: 'ready',
              controller: 'root/istiod',
              fields: { hasDiscoverySelectors: false },
            },
          ],
        ]),
      },
    };
  });
  render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA1101');
  expect(screen.getByText('Warning')).toBeDefined();
  expect(screen.getByText(/pinned Kiali ALLOW_ANY default/)).toBeDefined();
});

it('qualifies PeerAuthentication findings and links observed conflicting rules', async () => {
  const resource = new PeerAuthentication(
    {
      apiVersion: 'security.istio.io/v1',
      kind: 'PeerAuthentication',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { mtls: { mode: 'DISABLE' } },
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValueOnce({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: {
        complete: true,
        items: ['bookinfo', 'root'].map(name => ({ name, namespace: '', labels: {}, spec: {} })),
      },
      sidecars: { complete: false, items: [] },
      destinationRules: {
        complete: true,
        items: [
          {
            name: 'mesh-client',
            namespace: 'root',
            uid: 'client-uid',
            labels: {},
            spec: {
              host: '*.local',
              exportTo: ['*'],
              trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } },
            },
          },
        ],
      },
      namespaceMesh: new Map([
        [
          'bookinfo',
          {
            status: 'ready',
            controller: 'root/istiod',
            fields: { rootNamespace: 'root', hasDiscoverySelectors: false },
          },
        ],
      ]),
    },
  });
  render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA0505');
  expect(screen.getByText(/these checks do not prove encryption or enforcement/)).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'mesh-client' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-destination-rule-detail/root/mesh-client'
  );
  expect(screen.getByText('client-uid')).toBeDefined();
});

it('routes counterpart findings to security-group PeerAuthentication details', async () => {
  const spec = {
    host: '*.local',
    exportTo: ['*'],
    trafficPolicy: { tls: { mode: 'DISABLE' as const } },
  };
  const resource = new DestinationRule(
    {
      apiVersion: 'networking.istio.io/v1',
      kind: 'DestinationRule',
      metadata: {
        name: 'selected',
        namespace: 'bookinfo',
        uid: 'selected-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec,
    },
    'alpha'
  );
  vi.mocked(loadValidationSnapshot).mockResolvedValueOnce({
    sources: [],
    context: {
      cluster: 'alpha',
      identityDomain: 'svc.cluster.local',
      namespaces: {
        complete: true,
        items: ['bookinfo', 'root'].map(name => ({ name, namespace: '', labels: {}, spec: {} })),
      },
      sidecars: { complete: true, items: [] },
      destinationRules: {
        complete: true,
        items: [{ name: 'selected', namespace: 'bookinfo', uid: 'selected-uid', labels: {}, spec }],
      },
      peerAuthentications: {
        complete: true,
        items: [
          {
            name: 'mesh-strict',
            namespace: 'root',
            uid: 'peer-uid',
            labels: {},
            spec: { mtls: { mode: 'STRICT' } },
          },
        ],
      },
      namespaceMesh: new Map([
        [
          'bookinfo',
          {
            status: 'ready',
            controller: 'root/istiod',
            fields: { rootNamespace: 'root', hasDiscoverySelectors: false, enableAutoMtls: false },
          },
        ],
      ]),
    },
  });
  render(<Validation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run initial checks' }));
  await screen.findByText('KIA0208');
  await userEvent.click(screen.getByRole('button', { name: '1 related configurations' }));
  expect(screen.getByRole('link', { name: 'mesh-strict' }).getAttribute('href')).toBe(
    '/c/alpha/kiali-config-peer-authentication-detail/root/mesh-strict'
  );
  expect(screen.getByText('PeerAuthentication')).toBeDefined();
  expect(screen.getByText('peer-uid')).toBeDefined();
});
