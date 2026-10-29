import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { loadProxyConfigurationCandidate } from '../data/proxyConfigurationReference';
import ProxyConfigurationCandidate from './ProxyConfigurationCandidate';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '')),
  }),
}));
vi.mock('../data/proxyConfigurationReference', () => ({
  loadProxyConfigurationCandidate: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({
    routeName,
    params,
    children,
  }: {
    routeName: string;
    params: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={`/c/${params.cluster}/${routeName}/${params.namespace}/${params.name}`}>{children}</a>
  ),
  SimpleTable: <T,>({
    data,
    columns,
  }: {
    data: T[];
    columns: { getter: (row: T) => ReactNode }[];
  }) => (
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
  ),
}));
const props = {
  cluster: 'alpha',
  kind: 'DestinationRule' as const,
  path: '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews.v1',
};
const response = () => ({
  cluster: 'alpha',
  namespace: 'bookinfo',
  name: 'reviews.v1',
  kind: 'DestinationRule' as const,
  uid: 'current-config-uid',
  resourceVersion: '12',
  observedApiVersion: 'networking.istio.io/v1',
  apiVersion: 'networking.istio.io/v1beta1',
  routeName: 'kiali-config-destination-rule-detail',
  checkedAt: '2026-10-28T13:00:00Z',
});
beforeEach(() => {
  vi.mocked(loadProxyConfigurationCandidate).mockReset().mockResolvedValue(response());
});
afterEach(cleanup);
it('requires explicit lookup and uses current UID/version evidence without a historical identity claim', async () => {
  const view = render(<ProxyConfigurationCandidate {...props} />);
  expect(loadProxyConfigurationCandidate).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Find current DestinationRule candidate' }));
  const link = await screen.findByRole('link', { name: 'bookinfo/reviews.v1' });
  expect(link.getAttribute('href')).toBe(
    '/c/alpha/kiali-config-destination-rule-detail/bookinfo/reviews.v1'
  );
  expect(screen.getByText('current-config-uid')).toBeDefined();
  expect(screen.getByText('networking.istio.io/v1beta1')).toBeDefined();
  expect(screen.getByText(/does not prove which historical object/)).toBeDefined();
  view.rerender(<ProxyConfigurationCandidate {...props} />);
  expect(loadProxyConfigurationCandidate).toHaveBeenCalledTimes(1);
});
it('does not create arbitrary API links or query mismatched metadata kinds', () => {
  render(
    <ProxyConfigurationCandidate
      {...props}
      path={props.path.replace('destinationrules', 'secrets')}
    />
  );
  expect(screen.getByText(/does not match the expected configuration kind/)).toBeDefined();
  expect(screen.queryByRole('button')).toBeNull();
  expect(loadProxyConfigurationCandidate).not.toHaveBeenCalled();
});
it('discards pending references across cluster/path changes without resurrection', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  vi.mocked(loadProxyConfigurationCandidate).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const view = render(<ProxyConfigurationCandidate {...props} />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Find current DestinationRule candidate' }));
  await waitFor(() => expect(loadProxyConfigurationCandidate).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadProxyConfigurationCandidate).mock.calls[0][2];
  view.rerender(
    <ProxyConfigurationCandidate
      {...props}
      cluster="beta"
      path={props.path.replace('reviews.v1', 'different')}
    />
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response()));
  view.rerender(<ProxyConfigurationCandidate {...props} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(loadProxyConfigurationCandidate).toHaveBeenCalledTimes(1);
});
it('removes earlier links on failure and permits explicit retry', async () => {
  render(<ProxyConfigurationCandidate {...props} />);
  const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Find current DestinationRule candidate' });
  await user.click(button);
  await screen.findByRole('link');
  vi.mocked(loadProxyConfigurationCandidate).mockRejectedValueOnce({
    status: 403,
    message: 'Configuration denied',
  });
  await user.click(button);
  await screen.findByText('Access denied: Configuration denied');
  expect(screen.queryByRole('link')).toBeNull();
  await user.click(button);
  await screen.findByRole('link');
  expect(loadProxyConfigurationCandidate).toHaveBeenCalledTimes(3);
});
