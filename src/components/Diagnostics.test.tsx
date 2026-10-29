import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DiagnosticPod } from '../core/diagnostics';
import { loadDiagnosticPod, loadPodLogSnapshot } from '../data/diagnostics';
import Diagnostics from './Diagnostics';

const pod: DiagnosticPod = {
  namespace: 'bookinfo',
  name: 'reviews-123',
  uid: 'uid',
  containers: [
    { name: 'reviews', type: 'regular', nativeSidecar: false, ready: true, restarts: 0 },
    { name: 'istio-proxy', type: 'init', nativeSidecar: true, ready: true, restarts: 0 },
  ],
};
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'], useClustersConf: () => ({ alpha: {} }) },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../data/diagnostics', () => ({ loadDiagnosticPod: vi.fn(), loadPodLogSnapshot: vi.fn() }));
vi.mock('../data/proxyConfigurationReference', () => ({
  loadProxyConfigurationCandidate: vi.fn(),
}));
vi.mock('../config', () => ({
  useKialiConfig: () => ({ valid: true, config: { schemaVersion: 1, clusters: {} } }),
}));
vi.mock('./configuration/CodeBlock', () => ({
  default: ({ value, label }: { value: string; label: string }) => (
    <pre aria-label={label}>{value}</pre>
  ),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/pod">{children}</a>,
  SimpleTable: () => <table aria-label="Containers" />,
}));
beforeEach(() => {
  vi.mocked(loadDiagnosticPod).mockReset().mockResolvedValue(pod);
  vi.mocked(loadPodLogSnapshot).mockReset().mockResolvedValue({
    pod,
    container: pod.containers[1],
    text: 'synthetic diagnostic text',
    bytes: 25,
    limited: false,
    capturedAt: '2026-10-27T00:00:00Z',
  });
});
afterEach(cleanup);
function open() {
  render(
    <MemoryRouter initialEntries={['/diagnostics?namespace=bookinfo&pod=reviews-123']}>
      <Diagnostics />
    </MemoryRouter>
  );
}
it('retains the linked pod, explicitly loads identity, and prefers the observed native sidecar', async () => {
  open();
  const user = userEvent.setup();
  expect(loadPodLogSnapshot).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Load pod' }));
  await user.click(await screen.findByRole('button', { name: 'Read log snapshot' }));
  await screen.findByText('synthetic diagnostic text');
  expect(loadPodLogSnapshot).toHaveBeenCalledTimes(1);
  expect(vi.mocked(loadPodLogSnapshot).mock.calls[0][1]).toMatchObject({
    namespace: 'bookinfo',
    pod: 'reviews-123',
    uid: 'uid',
    container: 'istio-proxy',
    tailLines: 200,
    previous: false,
    sinceSeconds: 900,
  });
  expect(screen.getByRole('link', { name: 'Open native Pod details' })).toBeDefined();
  const signal = vi.mocked(loadPodLogSnapshot).mock.calls[0][2];
  await user.click(screen.getByRole('checkbox', { name: 'Previous container instance' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('synthetic diagnostic text')).toBeNull();
});
it('keeps bounded/empty log state explicit and never initiates a stream on field edits', async () => {
  vi.mocked(loadPodLogSnapshot).mockResolvedValue({
    pod,
    container: pod.containers[1],
    text: '',
    bytes: 0,
    limited: true,
    capturedAt: '2026-10-27T00:00:00Z',
  });
  open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load pod' }));
  await user.click(await screen.findByRole('button', { name: 'Read log snapshot' }));
  await screen.findByText('The 256 KiB log limit was reached; output may be truncated.');
  expect(
    screen.getByText('No log text was returned for the selected container and time window.')
  ).toBeDefined();
  await user.type(screen.getByLabelText('Pod name'), '-other');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Read log snapshot' })).toBeNull()
  );
  expect(loadPodLogSnapshot).toHaveBeenCalledTimes(1);
});
it('offers ztunnel diagnostics for an explicitly named ztunnel container without starting a read', async () => {
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce({
    ...pod,
    containers: [
      { name: 'ztunnel', type: 'regular', nativeSidecar: false, ready: true, restarts: 0 },
    ],
  });
  open();
  await userEvent.click(screen.getByRole('button', { name: 'Load pod' }));
  await screen.findByRole('button', { name: 'Read ztunnel configuration' });
  expect(screen.getByRole('radio', { name: 'ztunnel' })).toHaveProperty('checked', true);
  expect(loadPodLogSnapshot).not.toHaveBeenCalled();
});
it('keeps regular-container logging available without exposing proxy controls on non-proxy pods', async () => {
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce({ ...pod, containers: [pod.containers[0]] });
  open();
  await userEvent.click(screen.getByRole('button', { name: 'Load pod' }));
  await screen.findByRole('button', { name: 'Read log snapshot' });
  expect(screen.queryByText('Read-only proxy diagnostics')).toBeNull();
  expect(loadPodLogSnapshot).not.toHaveBeenCalled();
});
