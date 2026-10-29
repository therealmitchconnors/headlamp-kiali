import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { loadProxyServiceCandidate } from '../data/proxyService';
import ProxyServiceCandidate from './ProxyServiceCandidate';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '')),
  }),
}));
vi.mock('../data/proxyService', () => ({ loadProxyServiceCandidate: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({
    activeCluster,
    routeName,
    params,
    children,
  }: {
    activeCluster: string;
    routeName: string;
    params: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={`/c/${activeCluster}/${routeName}/${params.namespace}/${params.name}`}>{children}</a>
  ),
  SimpleTable: <T,>({
    data,
    columns,
    emptyMessage,
  }: {
    data: T[];
    columns: { getter: (row: T) => ReactNode }[];
    emptyMessage?: string;
  }) =>
    data.length ? (
      <table>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map((column, j) => (
                <td key={j}>{column.getter(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p>{emptyMessage}</p>
    ),
}));
const props = {
  cluster: 'alpha',
  name: 'outbound|9080|v1|reviews.bookinfo.svc.cluster.local',
  domain: 'svc.cluster.local',
};
const response = () => ({
  scope: { cluster: 'alpha', namespace: 'bookinfo' },
  target: { namespace: 'bookinfo', name: 'reviews', port: 9080, subset: 'v1' },
  identity: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: '',
    kind: 'Service' as const,
    name: 'reviews',
    uid: 'current-service-uid',
  },
  resourceVersion: '12',
  serviceType: 'ClusterIP',
  externalName: undefined,
  ports: [{ port: 9080, name: 'http', protocol: 'TCP' }],
  portDeclared: true,
  checkedAt: '2026-10-28T13:00:00Z',
});
beforeEach(() => {
  vi.mocked(loadProxyServiceCandidate).mockReset().mockResolvedValue(response());
});
afterEach(cleanup);
it('does not infer an identity or query without explicit eligibility and action', async () => {
  const view = render(<ProxyServiceCandidate {...props} domain={null} />);
  expect(screen.getByText(/Configure an explicit Service DNS/)).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Find current Service candidate' })).toBeNull();
  view.rerender(<ProxyServiceCandidate {...props} name="PassthroughCluster" />);
  expect(screen.getByText(/not a canonical four-part/)).toBeDefined();
  expect(loadProxyServiceCandidate).not.toHaveBeenCalled();
});
it('shows verified current UID/native links while keeping port and provenance limits explicit', async () => {
  const view = render(<ProxyServiceCandidate {...props} />);
  expect(loadProxyServiceCandidate).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Find current Service candidate' }));
  const link = await screen.findByRole('link', { name: 'reviews' });
  expect(link.getAttribute('href')).toBe('/c/alpha/service/bookinfo/reviews');
  expect(screen.getByText('current-service-uid')).toBeDefined();
  expect(screen.getByText(/not historical identity, ownership, traffic origin/)).toBeDefined();
  expect(
    screen.getByText('Port 9080 is declared in the current Service specification.')
  ).toBeDefined();
  view.rerender(<ProxyServiceCandidate {...props} />);
  expect(loadProxyServiceCandidate).toHaveBeenCalledTimes(1);
});
it('shows a port mismatch without turning a matching Service name into routing proof', async () => {
  vi.mocked(loadProxyServiceCandidate).mockResolvedValue({
    ...response(),
    ports: [],
    portDeclared: false,
  });
  render(<ProxyServiceCandidate {...props} />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Find current Service candidate' }));
  await screen.findByText(/Port 9080 is not declared/);
  expect(screen.getByRole('link', { name: 'reviews' })).toBeDefined();
  expect(screen.getByText('No Service ports were reported.')).toBeDefined();
});
it.each([
  { cluster: 'beta' },
  { domain: 'svc.other.test' },
  { name: 'outbound|9080||details.bookinfo.svc.cluster.local' },
])('discards lookups on binding changes without replay or resurrection %#', async patch => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  vi.mocked(loadProxyServiceCandidate).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const view = render(<ProxyServiceCandidate {...props} />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Find current Service candidate' }));
  await waitFor(() => expect(loadProxyServiceCandidate).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadProxyServiceCandidate).mock.calls[0][2];
  view.rerender(<ProxyServiceCandidate {...props} {...patch} />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response()));
  expect(screen.queryByRole('link', { name: 'reviews' })).toBeNull();
  view.rerender(<ProxyServiceCandidate {...props} />);
  expect(screen.queryByRole('link', { name: 'reviews' })).toBeNull();
  expect(loadProxyServiceCandidate).toHaveBeenCalledTimes(1);
});
it('removes earlier links on denial and permits only explicit retry', async () => {
  render(<ProxyServiceCandidate {...props} />);
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Find current Service candidate' });
  await user.click(button);
  await screen.findByRole('link', { name: 'reviews' });
  vi.mocked(loadProxyServiceCandidate).mockRejectedValueOnce({
    status: 403,
    message: 'Service denied',
  });
  await user.click(button);
  await screen.findByText(/Access denied: Service denied/);
  expect(screen.queryByRole('link', { name: 'reviews' })).toBeNull();
  expect(loadProxyServiceCandidate).toHaveBeenCalledTimes(2);
  await user.click(button);
  await screen.findByRole('link', { name: 'reviews' });
  expect(loadProxyServiceCandidate).toHaveBeenCalledTimes(3);
});
