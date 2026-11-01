import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { GatewayClassSettings } from '../../core/gatewayClassRegistry';
import {
  captureGateway,
  loadScopedGatewayValidation,
  ScopedGatewayValidation as Result,
} from '../../data/gatewayValidation';
import { Gateway } from '../../resources/gateway';
import ScopedGatewayValidation from './ScopedGatewayValidation';

const settings = vi.hoisted(() => ({
  logicalName: 'logical-alpha' as string | undefined,
  classes: undefined as GatewayClassSettings | undefined,
  wildcard: false,
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
vi.mock('../../data/gatewayValidation', async importOriginal => ({
  ...(await importOriginal<typeof import('../../data/gatewayValidation')>()),
  loadScopedGatewayValidation: vi.fn(),
}));
vi.mock('../../config', () => ({
  useKialiConfig: () => ({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: {
        alpha: {
          prometheus: null,
          meshClusterName: settings.logicalName,
          gatewayClasses: settings.classes,
          skipWildcardGatewayHosts: settings.wildcard,
        },
      },
    },
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ children, title }: { children: ReactNode; title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
  Link: ({
    routeName,
    params,
    children,
  }: {
    routeName: string;
    params: { cluster: string; namespace?: string; name?: string };
    children: ReactNode;
  }) => (
    <a href={`/c/${params.cluster}/${routeName}/${params.namespace ?? ''}/${params.name ?? ''}`}>
      {children}
    </a>
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
        ? data.map((row, index) => (
            <div key={index}>
              {columns.map((column, index) => (
                <span key={index}>{column.getter(row)}</span>
              ))}
            </div>
          ))
        : emptyMessage}
    </div>
  ),
}));
const object = () => ({
  kind: 'Gateway',
  apiVersion: 'networking.istio.io/v1',
  metadata: {
    name: 'gateway',
    namespace: 'bookinfo',
    uid: 'gateway',
    resourceVersion: '1',
    creationTimestamp: '2026-01-01T00:00:00Z',
  },
  spec: { selector: { app: 'gateway' }, servers: [] },
});
function result(): Result {
  return {
    target: captureGateway(object()),
    workloads: [],
    excluded: false,
    controller: {
      name: 'istio-system/istiod',
      uid: 'cp',
      resourceVersion: '1',
      scopeToNamespace: false,
    },
    scope: {
      cluster: 'alpha',
      logicalName: 'logical-alpha',
      visibility: 'pinned-default-system-exclusion',
      membership: [
        {
          namespace: 'bookinfo',
          controllers: [{ name: 'istio-system/istiod', uid: 'cp', basis: 'revision' }],
        },
      ],
      excludedSystemNamespaces: [],
      unmanagedNamespaces: [],
      controllerNamespaces: ['istio-system'],
    },
    result: {
      findings: [
        {
          code: 'KIA0302',
          severity: 'warning',
          path: 'spec/selector',
          message: 'No matching workload found for gateway selector in this namespace',
        },
      ],
      skipped: [],
      suppressed: 0,
      coverage: 'partial',
    },
  };
}
beforeEach(() => {
  vi.mocked(loadScopedGatewayValidation).mockReset();
  settings.logicalName = 'logical-alpha';
  settings.classes = undefined;
  settings.wildcard = false;
});
afterEach(cleanup);
it('requires an explicit action and logical mesh mapping before scope reads', async () => {
  settings.logicalName = undefined;
  const resource = new Gateway(object(), 'alpha');
  const rendered = render(<ScopedGatewayValidation resource={resource} />);
  expect(
    screen.getByRole('button', { name: 'Run scoped Gateway checks' }).hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen.getByRole('link', { name: 'Configure logical mesh cluster name' }).getAttribute('href')
  ).toContain('/c/alpha/');
  expect(loadScopedGatewayValidation).not.toHaveBeenCalled();
  settings.logicalName = 'logical-alpha';
  rendered.rerender(<ScopedGatewayValidation resource={resource} />);
  vi.mocked(loadScopedGatewayValidation).mockResolvedValue(result());
  await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
  await screen.findByText('KIA0302');
  expect(
    screen.getByText('No matching workload found for gateway selector in this namespace')
  ).toBeTruthy();
  expect(screen.getByText(/Captured controller: istio-system\/istiod/)).toBeTruthy();
  expect(loadScopedGatewayValidation).toHaveBeenCalledTimes(1);
});
it('reports unavailable evidence rather than a no-findings verdict, and retries only explicitly', async () => {
  vi.mocked(loadScopedGatewayValidation).mockRejectedValueOnce(new Error('Pod list denied'));
  vi.mocked(loadScopedGatewayValidation).mockResolvedValueOnce(result());
  render(<ScopedGatewayValidation resource={new Gateway(object(), 'alpha')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
  await screen.findByText('Unavailable: Pod list denied');
  expect(screen.queryByText(/No findings from these scoped checks/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
  await screen.findByText('KIA0302');
  expect(loadScopedGatewayValidation).toHaveBeenCalledTimes(2);
});
it.each(['logicalName', 'classes', 'wildcard', 'target'] as const)(
  'invalidates captured %s changes without replay or resurrection after restoring them',
  async field => {
    vi.mocked(loadScopedGatewayValidation).mockResolvedValue(result());
    const original = new Gateway(object(), 'alpha');
    const rendered = render(<ScopedGatewayValidation resource={original} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
    await screen.findByText('KIA0302');
    if (field === 'logicalName') settings.logicalName = 'new-logical';
    if (field === 'classes')
      settings.classes = { classes: [{ name: 'custom', className: 'custom' }], selector: {} };
    if (field === 'wildcard') settings.wildcard = true;
    rendered.rerender(
      <ScopedGatewayValidation
        resource={
          field === 'target'
            ? new Gateway(
                { ...object(), metadata: { ...object().metadata, resourceVersion: '2' } },
                'alpha'
              )
            : original
        }
      />
    );
    expect(screen.queryByText('KIA0302')).toBeNull();
    settings.logicalName = 'logical-alpha';
    settings.classes = undefined;
    settings.wildcard = false;
    rendered.rerender(<ScopedGatewayValidation resource={original} />);
    expect(screen.queryByText('KIA0302')).toBeNull();
    expect(loadScopedGatewayValidation).toHaveBeenCalledTimes(1);
  }
);
it('cancels pending captures on settings replacement, keeping the original immutable resource snapshot', async () => {
  let resolve: (data: Result) => void = () => {};
  let signal: AbortSignal | undefined;
  vi.mocked(loadScopedGatewayValidation).mockImplementation(
    async (_scope, _target, _settings, requestedSignal) => {
      signal = requestedSignal;
      return new Promise(done => {
        resolve = done;
      });
    }
  );
  const live = object();
  const resource = new Gateway(live, 'alpha');
  const rendered = render(<ScopedGatewayValidation resource={resource} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
  expect(screen.getByRole('status').textContent).toContain(
    'Running declared-scope Gateway checks...'
  );
  live.metadata.resourceVersion = '2';
  expect(vi.mocked(loadScopedGatewayValidation).mock.calls[0][1]).toMatchObject({
    metadata: { resourceVersion: '1' },
  });
  settings.logicalName = 'replacement';
  rendered.rerender(<ScopedGatewayValidation resource={resource} />);
  expect(signal?.aborted).toBe(true);
  resolve(result());
  expect(screen.queryByText('KIA0302')).toBeNull();
  expect(loadScopedGatewayValidation).toHaveBeenCalledTimes(1);
});
it('reports malformed capture errors before transport', async () => {
  const invalid = new Gateway(
    { ...object(), metadata: { ...object().metadata, resourceVersion: '' } },
    'alpha'
  );
  render(<ScopedGatewayValidation resource={invalid} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
  await screen.findByText('Gateway resourceVersion is missing or malformed');
  expect(loadScopedGatewayValidation).not.toHaveBeenCalled();
});
it('discloses name-based navigation for observed Istio Gateway peers without a class registry', async () => {
  const captured = result();
  captured.result.findings = [
    {
      code: 'KIA0301',
      severity: 'warning',
      path: 'spec/servers/0/hosts/0',
      message: 'More than one Gateway for the same host port combination',
      references: [
        {
          kind: 'Gateway',
          group: 'networking.istio.io',
          namespace: 'bookinfo',
          name: 'peer',
          uid: 'peer-uid',
        },
      ],
    },
  ];
  vi.mocked(loadScopedGatewayValidation).mockResolvedValue(captured);
  render(<ScopedGatewayValidation resource={new Gateway(object(), 'alpha')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run scoped Gateway checks' }));
  await screen.findByText('KIA0301');
  expect(screen.getByText(/Navigation uses namespace and name/)).toBeTruthy();
  expect(screen.getByText('Observed UID: peer-uid')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'bookinfo/peer' }).getAttribute('href')).toBe(
    `/c/alpha/${Gateway.detailsRoute}/bookinfo/peer`
  );
});
