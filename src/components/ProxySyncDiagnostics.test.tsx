import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { DiagnosticPod } from '../core/diagnostics';
import { loadProxySyncSnapshot } from '../data/proxySync';
import ProxySyncDiagnostics from './ProxySyncDiagnostics';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
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
    data: Record<string, unknown>[];
    columns: { getter: (row: Record<string, unknown>) => ReactNode }[];
  }) => (
    <div>
      {data.map((row, index) => (
        <div key={index}>
          {columns.map((column, columnIndex) => (
            <span key={columnIndex}>{column.getter(row)}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('../data/proxySync', () => ({ loadProxySyncSnapshot: vi.fn() }));

const pod: DiagnosticPod = {
  namespace: 'istio-system',
  name: 'istiod-123',
  uid: 'control-plane-uid',
  containers: [
    {
      name: 'discovery',
      type: 'regular',
      nativeSidecar: false,
      ready: true,
      restarts: 2,
      ports: [{ name: 'http-debug', containerPort: 8080 }],
    },
  ],
};
const snapshot = {
  cluster: 'alpha',
  target: {
    namespace: pod.namespace,
    pod: pod.name,
    uid: pod.uid,
    container: 'discovery' as const,
    restarts: 2,
    port: 8080,
  },
  capturedAt: '2026-10-29T12:00:00.000Z',
  records: [
    {
      proxy: 'reviews-v1.bookinfo',
      clusterId: 'cluster-a',
      istioVersion: '1.31.0',
      resources: [
        {
          name: 'CDS',
          sent: 'cds-4',
          acked: 'cds-4',
          state: 'synced' as const,
          lastError: undefined,
        },
        {
          name: 'EDS',
          sent: 'eds-5',
          acked: 'eds-4',
          state: 'stale' as const,
          lastError: 'NACK received',
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.mocked(loadProxySyncSnapshot).mockReset().mockResolvedValue(snapshot);
});

afterEach(cleanup);

it('projects source-reported sync values while retaining unjoined proxy IDs and control-plane provenance', async () => {
  const user = userEvent.setup();
  render(<ProxySyncDiagnostics cluster="alpha" pod={pod} />);
  expect(loadProxySyncSnapshot).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Read control-plane synchronization' }));
  await screen.findAllByText('reviews-v1.bookinfo');
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === 'P' && Boolean(element.textContent?.includes('control-plane-uid'))
    )
  ).toBeDefined();
  expect(screen.getByText('Synced')).toBeDefined();
  expect(screen.getByText('Stale')).toBeDefined();
  expect(screen.getByText(/not matched to current Kubernetes Pods or UIDs/)).toBeDefined();
  expect(vi.mocked(loadProxySyncSnapshot).mock.calls[0].slice(0, 2)).toEqual([
    { cluster: 'alpha' },
    pod,
  ]);
});

it('keeps denied endpoints visible as authorization gaps, not sync findings', async () => {
  vi.mocked(loadProxySyncSnapshot).mockRejectedValueOnce(
    Object.assign(new Error('Istiod endpoint returned HTTP 401'), { status: 401 })
  );
  const user = userEvent.setup();
  render(<ProxySyncDiagnostics cluster="alpha" pod={pod} />);
  await user.click(screen.getByRole('button', { name: 'Read control-plane synchronization' }));
  await screen.findByText('Authentication required: Istiod endpoint returned HTTP 401');
  expect(screen.queryByText('Synced')).toBeNull();
  expect(loadProxySyncSnapshot).toHaveBeenCalledTimes(1);
});

it.each([
  {
    name: 'missing discovery container',
    pod: { ...pod, containers: [] },
    message: 'Select a control-plane Pod',
  },
  {
    name: 'missing debug port',
    pod: { ...pod, containers: [{ ...pod.containers[0], ports: [] }] },
    message: 'exactly one http-debug port',
  },
  {
    name: 'unknown restart state',
    pod: { ...pod, containers: [{ ...pod.containers[0], restarts: null }] },
    message: 'restart count is unavailable',
  },
])('disables the sync reader for $name', ({ pod: selected, message }) => {
  render(<ProxySyncDiagnostics cluster="alpha" pod={selected} />);
  expect(screen.getByText(new RegExp(message))).toBeDefined();
  expect(
    screen.getByRole('button', { name: 'Read control-plane synchronization' })
  ).toHaveProperty('disabled', true);
  expect(loadProxySyncSnapshot).not.toHaveBeenCalled();
});

it('aborts captured data when the cluster scope changes and ignores the late result', async () => {
  let resolve: (value: typeof snapshot) => void = () => {};
  vi.mocked(loadProxySyncSnapshot).mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    })
  ).mockReturnValueOnce(new Promise(() => {}));
  const user = userEvent.setup();
  const { rerender } = render(<ProxySyncDiagnostics cluster="alpha" pod={pod} />);
  await user.click(screen.getByRole('button', { name: 'Read control-plane synchronization' }));
  const signal = vi.mocked(loadProxySyncSnapshot).mock.calls[0][2];
  rerender(<ProxySyncDiagnostics cluster="beta" pod={pod} />);
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(loadProxySyncSnapshot).toHaveBeenCalledTimes(2));
  await act(async () => resolve(snapshot));
  expect(screen.queryAllByText('reviews-v1.bookinfo')).toHaveLength(0);
});
