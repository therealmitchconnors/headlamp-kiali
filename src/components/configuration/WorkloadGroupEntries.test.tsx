import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { namespaceScope } from '../../core/scope';
import { readFailure } from '../../data/requests';
import { loadWorkloadGroupEntries } from '../../data/workloadGroupEntries';
import { WorkloadGroup } from '../../resources/workload-group';
import WorkloadGroupEntries from './WorkloadGroupEntries';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '')),
  }),
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
vi.mock('../../data/workloadGroupEntries', () => ({ loadWorkloadGroupEntries: vi.fn() }));
vi.mock('./StructuredValue', () => ({
  default: ({ value }: { value: unknown }) => <span>{JSON.stringify(value)}</span>,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
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
    emptyMessage,
  }: {
    data: T[];
    columns: { label: string; getter: (row: T) => ReactNode }[];
    emptyMessage: string;
  }) =>
    data.length ? (
      <table>
        <tbody>
          {data.map((row, index) => (
            <tr key={index}>
              {columns.map(column => (
                <td key={column.label}>{column.getter(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p>{emptyMessage}</p>
    ),
}));
const group = (labels?: Record<string, string>) =>
  new WorkloadGroup(
    {
      kind: 'WorkloadGroup',
      apiVersion: 'networking.istio.io/v1',
      metadata: {
        name: 'group',
        namespace: 'bookinfo',
        uid: 'group-uid',
        resourceVersion: '1',
        creationTimestamp: '2026-01-01T00:00:00Z',
      },
      spec: { metadata: labels === undefined ? undefined : { labels }, template: {} },
    },
    'alpha'
  );
const response = () => ({
  scope: namespaceScope('alpha', 'bookinfo'),
  selector: { app: 'vm' },
  examined: 2,
  complete: true,
  resourceVersion: '1',
  items: [
    {
      name: 'matching-vm',
      namespace: 'bookinfo',
      uid: 'entry-uid',
      labels: { app: 'vm' },
      address: '10.0.0.8',
      network: '',
      serviceAccount: undefined,
      health: {
        ok: true as const,
        evidence: { basis: 'disabled-checks' as const, kialiAvailable: true },
      },
    },
  ],
});
const view = (resource: WorkloadGroup) => (
  <WorkloadGroupEntries
    key={JSON.stringify([
      resource.cluster,
      resource.metadata.uid,
      resource.metadata.resourceVersion,
      resource.spec?.metadata,
    ])}
    resource={resource}
  />
);
beforeEach(() => {
  vi.mocked(loadWorkloadGroupEntries).mockReset();
  vi.mocked(loadWorkloadGroupEntries).mockResolvedValue(response());
});
afterEach(cleanup);
it.each([undefined, {}])('does not query for missing or empty group labels %#', labels => {
  render(view(group(labels)));
  expect(
    screen.getByRole('button', { name: 'Load matching WorkloadEntries' }).hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen.getByText(/A missing or empty group label selector matches no WorkloadEntries/)
  ).toBeDefined();
  expect(loadWorkloadGroupEntries).not.toHaveBeenCalled();
});
it('loads on demand, captures labels and exposes scoped links and UID without health or ownership claims', async () => {
  const resource = group({ app: 'vm' });
  const rendered = render(view(resource));
  const user = userEvent.setup();
  expect(loadWorkloadGroupEntries).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Load matching WorkloadEntries' }));
  const link = await screen.findByRole('link', { name: 'matching-vm' });
  expect(link.getAttribute('href')).toBe(
    '/c/alpha/kiali-config-workload-entry-detail/bookinfo/matching-vm'
  );
  expect(screen.getByText('entry-uid')).toBeDefined();
  expect(screen.getByText('Empty')).toBeDefined();
  expect(screen.getByText('Not reported')).toBeDefined();
  expect(screen.getByText(/not owner references or proof of connectivity/)).toBeDefined();
  expect(vi.mocked(loadWorkloadGroupEntries).mock.calls[0][0]).toEqual(
    namespaceScope('alpha', 'bookinfo')
  );
  expect(vi.mocked(loadWorkloadGroupEntries).mock.calls[0][1]).toEqual({ app: 'vm' });
  rendered.rerender(view(resource));
  expect(loadWorkloadGroupEntries).toHaveBeenCalledTimes(1);
});
it('keeps incomplete results explicit and removes prior matches before an explicit retry', async () => {
  render(view(group({ app: 'vm' })));
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Load matching WorkloadEntries' });
  await user.click(button);
  await screen.findByRole('link', { name: 'matching-vm' });
  vi.mocked(loadWorkloadGroupEntries).mockResolvedValueOnce({
    ...response(),
    complete: false,
    examined: 0,
    items: [],
    error: readFailure({ status: 403, message: 'Entries denied' }),
  });
  await user.click(button);
  await screen.findByText(/WorkloadEntry inventory is incomplete: .*Entries denied/);
  expect(screen.queryByRole('link', { name: 'matching-vm' })).toBeNull();
  expect(
    screen.getByText('No matches in the returned pages; the inventory is incomplete.')
  ).toBeDefined();
  expect(screen.queryByText('No WorkloadEntries matched the captured group labels.')).toBeNull();
  await user.click(button);
  await screen.findByRole('link', { name: 'matching-vm' });
  expect(loadWorkloadGroupEntries).toHaveBeenCalledTimes(3);
});
it('discards pending matches when the group identity/selector binding changes, without replay', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  vi.mocked(loadWorkloadGroupEntries).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const resource = group({ app: 'vm' });
  const rendered = render(view(resource));
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Load matching WorkloadEntries' }));
  await waitFor(() => expect(loadWorkloadGroupEntries).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadWorkloadGroupEntries).mock.calls[0][2];
  const next = group({ app: 'different' });
  rendered.rerender(view(next));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response()));
  expect(screen.queryByRole('link', { name: 'matching-vm' })).toBeNull();
  expect(loadWorkloadGroupEntries).toHaveBeenCalledTimes(1);
});
it('reports malformed selector metadata without turning it into an empty successful lookup', () => {
  const resource = group({ app: 'vm' });
  if (!resource.jsonData.spec) throw new Error('Missing fixture specification');
  Object.assign(resource.jsonData.spec, { metadata: false });
  render(view(resource));
  expect(screen.getByText('WorkloadGroup template metadata is malformed')).toBeDefined();
  expect(
    screen.getByRole('button', { name: 'Load matching WorkloadEntries' }).hasAttribute('disabled')
  ).toBe(true);
  expect(loadWorkloadGroupEntries).not.toHaveBeenCalled();
});
