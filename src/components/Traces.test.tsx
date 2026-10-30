import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from 'history';
import { ReactNode } from 'react';
import { Router } from 'react-router-dom';
import fixtureText from '../../test-files/tracing/fixtures.json?raw';
import { ConfigResult } from '../core/config';
import { decodeTraceDetail, decodeTraceSearch, TraceDetail } from '../core/tracing';
import { discoverTraceNames, loadTrace, searchTraces } from '../data/tracing';
import Traces from './Traces';

const fixtures = JSON.parse(fixtureText);
const trace = '00000000000000000000000000000001';
const state = vi.hoisted(() => ({
  config: undefined as ConfigResult | undefined,
  cluster: 'alpha',
}));
const configured: ConfigResult = {
  valid: true,
  config: {
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
  },
};

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useSelectedClusters: () => [state.cluster],
    useClustersConf: () => ({ alpha: {}, beta: {} }),
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (match, name) => String(values?.[name] ?? match)),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: () => state.config }));
vi.mock('../data/tracing', () => ({
  loadTrace: vi.fn(),
  searchTraces: vi.fn(),
  discoverTraceNames: vi.fn(),
}));
vi.mock('./configuration/StructuredValue', () => ({
  default: ({ value }: { value: unknown }) => <span>{JSON.stringify(value)}</span>,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Link: ({ children }: { children: ReactNode }) => <a href="/settings">{children}</a>,
  SimpleTable: ({
    data,
    columns,
    emptyMessage,
  }: {
    data: unknown[];
    columns: { label: string; getter: (row: unknown) => ReactNode }[];
    emptyMessage?: string;
  }) =>
    data.length ? (
      <table>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
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
      <p>{emptyMessage ?? 'No entries'}</p>
    ),
}));
beforeEach(() => {
  state.cluster = 'alpha';
  state.config = configured;
  vi.mocked(loadTrace).mockReset();
  vi.mocked(searchTraces).mockReset();
  vi.mocked(discoverTraceNames).mockReset();
  vi.mocked(discoverTraceNames).mockResolvedValue(['reviews']);
  vi.mocked(loadTrace).mockResolvedValue(decodeTraceDetail('jaeger', fixtures.jaeger, trace));
  vi.mocked(searchTraces).mockResolvedValue(decodeTraceSearch('jaeger', fixtures.jaeger, 20));
});
afterEach(cleanup);

function open(path = '/traces') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const view = render(
    <Router history={history}>
      <Traces />
    </Router>
  );
  return { ...view, history };
}
it('discovers names only on demand and updates drafts without submitting or persisting a search', async () => {
  const view = open();
  const user = userEvent.setup();
  expect(discoverTraceNames).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Browse tracing operations' }).hasAttribute('disabled')
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Browse tracing services' }));
  const services = await screen.findByRole('dialog', { name: 'Tracing services' });
  expect(
    within(services).getByText(/not Kubernetes identities or a complete inventory/)
  ).toBeDefined();
  await user.type(await within(services).findByLabelText('Filter returned tracing names'), 'rev');
  expect(discoverTraceNames).toHaveBeenCalledTimes(1);
  await user.click(within(services).getByRole('button', { name: 'Use tracing name reviews' }));
  expect((screen.getByLabelText('Tracing service name') as HTMLInputElement).value).toBe('reviews');
  vi.mocked(discoverTraceNames).mockResolvedValueOnce(['GET /reviews']);
  await user.click(await screen.findByRole('button', { name: 'Browse tracing operations' }));
  await user.click(await screen.findByRole('button', { name: 'Use tracing name GET /reviews' }));
  expect((screen.getByLabelText('Operation filter') as HTMLInputElement).value).toBe(
    'GET /reviews'
  );
  expect(vi.mocked(discoverTraceNames).mock.calls[1][2]).toMatchObject({
    kind: 'operations',
    service: 'reviews',
  });
  expect(searchTraces).not.toHaveBeenCalled();
  expect(view.history.location.search).toBe('');
});

it('captures the historical discovery window and permits retry after a visible failure', async () => {
  open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: 'Use current trace search time' }));
  await user.type(screen.getByLabelText('Trace search end time (local time)'), '2026-01-02T03:04');
  vi.mocked(discoverTraceNames).mockRejectedValueOnce({ status: 403, message: 'Names denied' });
  await user.click(screen.getByRole('button', { name: 'Browse tracing operations' }));
  await screen.findByText('Access denied: Names denied');
  expect(vi.mocked(discoverTraceNames).mock.calls[0][2].end).toBe(
    Math.floor(new Date('2026-01-02T03:04').getTime() / 1000)
  );
  await user.click(screen.getByRole('button', { name: 'Close tracing names' }));
  await user.click(await screen.findByRole('button', { name: 'Browse tracing operations' }));
  await screen.findByRole('button', { name: 'Use tracing name reviews' });
  expect(discoverTraceNames).toHaveBeenCalledTimes(2);
});

it('cancels name discovery when closed and discards late results after endpoint changes', async () => {
  const pending: ((names: string[]) => void)[] = [];
  vi.mocked(discoverTraceNames).mockImplementation(
    () => new Promise(resolve => pending.push(resolve))
  );
  const view = open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Browse tracing services' }));
  const first = vi.mocked(discoverTraceNames).mock.calls[0][3];
  await user.keyboard('{Escape}');
  expect(first.aborted).toBe(true);
  await user.click(await screen.findByRole('button', { name: 'Browse tracing services' }));
  const second = vi.mocked(discoverTraceNames).mock.calls[1][3];
  state.config = {
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: {
        alpha: {
          prometheus: null,
          tracing: {
            provider: 'tempo',
            endpoint: { namespace: 'observability', service: 'other', port: '3200', basePath: '' },
          },
        },
      },
    },
  };
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  expect(second.aborted).toBe(true);
  await act(async () => pending.forEach(resolve => resolve(['stale-service'])));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Use tracing name stale-service' })).toBeNull();
});

it('shows missing configuration without querying and rejects invalid IDs', async () => {
  state.config = { valid: true, config: { schemaVersion: 1, clusters: {} } };
  const view = open();
  expect(screen.getByRole('button', { name: 'Search traces' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Configure an existing Jaeger/)).toBeDefined();
  expect(loadTrace).not.toHaveBeenCalled();
  state.config = configured;
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  await userEvent.setup().type(screen.getByLabelText('Trace ID'), '../bad');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load trace' }));
  expect(screen.getByText('Invalid trace or span identity')).toBeDefined();
  expect(loadTrace).not.toHaveBeenCalled();
});
it('captures a scoped search, navigates spans and does not refetch for fresh translations or draft edits', async () => {
  open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await user.click(await screen.findByRole('button', { name: trace }));
  await user.click(await screen.findByRole('button', { name: 'Inspect span 0000000000000002' }));
  const detail = screen.getByRole('region', { name: 'Selected span' });
  expect(within(detail).getByRole('heading', { name: 'Span attributes', level: 3 })).toBeDefined();
  expect(within(detail).getByText(/1700000000000100000 \/ 400000/)).toBeDefined();
  await user.click(within(detail).getAllByRole('button', { name: '0000000000000001' })[0]);
  expect(within(detail).getByText(/GET \/productpage/)).toBeDefined();
  await user.type(screen.getByLabelText('Operation filter'), 'draft');
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect(loadTrace).toHaveBeenCalledTimes(1);
  expect(vi.mocked(searchTraces).mock.calls[0][0]).toEqual({ cluster: 'alpha' });
  expect(vi.mocked(searchTraces).mock.calls[0][2]).toMatchObject({ service: 'reviews', limit: 20 });
});
it('captures historical string filters without persisting draft edits or leaking them into navigation', async () => {
  const view = open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add tag filter' }));
  await user.type(screen.getByLabelText('Tag name 1'), 'http.method');
  await user.type(screen.getByLabelText('Tag value 1'), 'GET');
  await user.click(screen.getByRole('checkbox', { name: 'Use current trace search time' }));
  await user.type(screen.getByLabelText('Trace search end time (local time)'), '2026-01-02T03:04');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured tag filters');
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.end).toBe(Math.floor(new Date('2026-01-02T03:04').getTime() / 1000));
  expect(captured.tags).toEqual([{ key: 'http.method', value: 'GET' }]);
  await user.clear(screen.getByLabelText('Tag value 1'));
  await user.type(screen.getByLabelText('Tag value 1'), 'POST');
  expect(captured.tags?.[0].value).toBe('GET');
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect(view.history.location.search).toBe('?service=reviews');
});
it('reports duplicate/conflicting tag conditions before issuing a search and supports removal', async () => {
  open('/traces?service=reviews');
  const user = userEvent.setup();
  for (let index = 1; index <= 2; index++) {
    await user.click(screen.getByRole('button', { name: 'Add tag filter' }));
    await user.type(screen.getByLabelText(`Tag name ${index}`), 'error');
    await user.type(screen.getByLabelText(`Tag value ${index}`), 'false');
  }
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  expect(screen.getByText('Duplicate trace tag keys are not supported')).toBeDefined();
  expect(searchTraces).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Remove tag filter 1' }));
  await user.click(screen.getByRole('checkbox', { name: 'Reported errors only' }));
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  expect(screen.getByText(/error=false tag conflicts/)).toBeDefined();
  expect(searchTraces).not.toHaveBeenCalled();
});
it('captures typed Tempo filters and invalidates submissions when the connection changes without replaying them', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  const view = open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add attribute filter' }));
  await user.type(screen.getByLabelText('Attribute name 1'), 'sequence');
  await user.click(screen.getByLabelText('Attribute type 1'));
  await user.click(screen.getByRole('option', { name: 'Integer' }));
  await user.type(screen.getByLabelText('Attribute value 1'), '9007199254740993');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured attribute filters');
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.tempoFilters).toEqual([
    { scope: 'span', key: 'sequence', type: 'integer', operator: '=', value: '9007199254740993' },
  ]);
  await user.clear(screen.getByLabelText('Attribute value 1'));
  await user.type(screen.getByLabelText('Attribute value 1'), '2');
  expect(captured.tempoFilters?.[0].value).toBe('9007199254740993');
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect(view.history.location.search).toBe('?service=reviews');
  state.config = configured;
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  await waitFor(() => expect(screen.queryByText('Show captured attribute filters')).toBeNull());
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('Attribute value 1') as HTMLInputElement).value).toBe('2');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  expect(
    screen.getByText('Typed attribute filters require Tempo; remove them before searching Jaeger')
  ).toBeDefined();
  expect(searchTraces).toHaveBeenCalledTimes(1);
  state.config = tempo;
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  expect(screen.queryByText('Show captured attribute filters')).toBeNull();
  expect(searchTraces).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await waitFor(() => expect(searchTraces).toHaveBeenCalledTimes(2));
});

it('captures exact span intrinsics, validates drafts and requires explicit resubmission after provider changes', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  const view = open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add intrinsic filter' }));
  await user.click(screen.getByLabelText('Intrinsic field 1'));
  await user.click(screen.getByRole('option', { name: 'Span duration' }));
  await user.type(screen.getByLabelText('Intrinsic value 1'), '0.1ns');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  expect(screen.getByText(/must have whole-nanosecond precision/)).toBeDefined();
  expect(searchTraces).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Intrinsic value 1'));
  await user.type(screen.getByLabelText('Intrinsic value 1'), '9007199254740993ns');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured intrinsic filters');
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.tempoIntrinsics).toEqual([
    { field: 'duration', operator: '=', value: '9007199254740993ns' },
  ]);
  await user.clear(screen.getByLabelText('Intrinsic value 1'));
  await user.type(screen.getByLabelText('Intrinsic value 1'), '0ns');
  expect(captured.tempoIntrinsics?.[0].value).toBe('9007199254740993ns');
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect(view.history.location.search).toBe('?service=reviews');
  state.config = configured;
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  await waitFor(() => expect(screen.queryByText('Show captured intrinsic filters')).toBeNull());
  expect((screen.getByLabelText('Intrinsic value 1') as HTMLInputElement).value).toBe('0ns');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  expect(
    screen.getByText('Intrinsic filters require Tempo; remove them before searching Jaeger')
  ).toBeDefined();
  expect(searchTraces).toHaveBeenCalledTimes(1);
  state.config = tempo;
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  expect(screen.queryByText('Show captured intrinsic filters')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await waitFor(() => expect(searchTraces).toHaveBeenCalledTimes(2));
  expect(vi.mocked(searchTraces).mock.calls[1][2].tempoIntrinsics?.[0].value).toBe('0ns');
  await user.click(screen.getByRole('button', { name: 'Remove intrinsic filter 1' }));
  expect(screen.queryByLabelText('Intrinsic value 1')).toBeNull();
  expect(searchTraces).toHaveBeenCalledTimes(2);
});

it('captures trace-wide fields separately from span fields without relabeling submitted values', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  open('/traces?service=reviews');
  const user = userEvent.setup();
  for (const [index, label, value] of [
    [1, 'Whole trace duration', '9007199254740993ns'],
    [2, 'Trace root span name', 'GET /productpage'],
    [3, 'Trace root service name', 'productpage'],
  ] as const) {
    await user.click(screen.getByRole('button', { name: 'Add intrinsic filter' }));
    await user.click(screen.getByLabelText(`Intrinsic field ${index}`));
    await user.click(screen.getByRole('option', { name: label }));
    await user.type(screen.getByLabelText(`Intrinsic value ${index}`), value);
  }
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured intrinsic filters');
  expect(screen.getByText('trace:duration')).toBeDefined();
  expect(screen.getByText('trace:rootName')).toBeDefined();
  expect(screen.getByText('trace:rootService')).toBeDefined();
  expect(screen.queryByText('span:traceDuration')).toBeNull();
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.tempoIntrinsics).toEqual([
    { field: 'traceDuration', operator: '=', value: '9007199254740993ns' },
    { field: 'rootName', operator: '=', value: 'GET /productpage' },
    { field: 'rootServiceName', operator: '=', value: 'productpage' },
  ]);
  await user.click(screen.getByLabelText('Intrinsic field 1'));
  await user.click(screen.getByRole('option', { name: 'Span duration' }));
  expect(screen.getByText('trace:duration')).toBeDefined();
  expect(captured.tempoIntrinsics?.[0].field).toBe('traceDuration');
  expect(searchTraces).toHaveBeenCalledTimes(1);
});

it('captures event and instrumentation intrinsics separately from attributes and later drafts', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  const view = open('/traces?service=reviews');
  const user = userEvent.setup();
  for (const [index, label, value] of [
    [1, 'Event name', 'exception'],
    [2, 'Instrumentation scope name', 'otel.library'],
    [3, 'Instrumentation scope version', '2.10'],
  ] as const) {
    await user.click(screen.getByRole('button', { name: 'Add intrinsic filter' }));
    await user.click(screen.getByLabelText(`Intrinsic field ${index}`));
    await user.click(screen.getByRole('option', { name: label }));
    await user.type(screen.getByLabelText(`Intrinsic value ${index}`), value);
  }
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured intrinsic filters');
  for (const name of ['event:name', 'instrumentation:name', 'instrumentation:version'])
    expect(screen.getByText(name)).toBeDefined();
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.tempoIntrinsics).toEqual([
    { field: 'eventName', operator: '=', value: 'exception' },
    { field: 'instrumentationName', operator: '=', value: 'otel.library' },
    { field: 'instrumentationVersion', operator: '=', value: '2.10' },
  ]);
  await user.clear(screen.getByLabelText('Intrinsic value 1'));
  await user.type(screen.getByLabelText('Intrinsic value 1'), 'changed');
  await user.click(screen.getByLabelText('Intrinsic field 2'));
  await user.click(screen.getByRole('option', { name: 'Span name' }));
  expect(captured.tempoIntrinsics?.[0].value).toBe('exception');
  expect(captured.tempoIntrinsics?.[1].field).toBe('instrumentationName');
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect(view.history.location.search).toBe('?service=reviews');
});
it('captures event, link and instrumentation scopes and preserves them after draft edits', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  open('/traces?service=reviews');
  const user = userEvent.setup();
  for (const [index, label, key] of [
    [1, 'Event', 'name'],
    [2, 'Span link', 'trace:id'],
    [3, 'Instrumentation scope', 'library.version'],
  ] as const) {
    await user.click(screen.getByRole('button', { name: 'Add attribute filter' }));
    await user.click(screen.getByLabelText(`Attribute scope ${index}`));
    await user.click(screen.getByRole('option', { name: label }));
    await user.type(screen.getByLabelText(`Attribute name ${index}`), key);
    await user.type(screen.getByLabelText(`Attribute value ${index}`), `value${index}`);
  }
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.tempoFilters?.map(filter => filter.scope)).toEqual([
    'event',
    'link',
    'instrumentation',
  ]);
  await user.click(screen.getByLabelText('Attribute scope 1'));
  await user.click(screen.getByRole('option', { name: 'Span' }));
  expect(captured.tempoFilters?.[0].scope).toBe('event');
  expect(searchTraces).toHaveBeenCalledTimes(1);
});

it('retains incompatible intrinsic drafts until explicitly corrected instead of silently changing predicates', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add intrinsic filter' }));
  await user.click(screen.getByLabelText('Intrinsic comparison 1'));
  await user.click(screen.getByRole('option', { name: '=~' }));
  await user.type(screen.getByLabelText('Intrinsic value 1'), 'error');
  await user.click(screen.getByLabelText('Intrinsic field 1'));
  await user.click(screen.getByRole('option', { name: 'Reported span status' }));
  expect(screen.getByText('Choose a comparison supported by this field.')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  expect(
    screen.getByText('Unsupported Tempo intrinsic field or comparison operator')
  ).toBeDefined();
  expect(searchTraces).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText('Intrinsic comparison 1'));
  await user.click(screen.getByRole('option', { name: '=' }));
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured intrinsic filters');
  expect(vi.mocked(searchTraces).mock.calls[0][2].tempoIntrinsics).toEqual([
    { field: 'status', operator: '=', value: 'error' },
  ]);
});

it('submits literal punctuation and Unicode attribute/tag names without saving or relabeling captures', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  const view = open('/traces?service=reviews');
  const user = userEvent.setup();
  const key = 'k8s.io/label"\\\u00e9';
  await user.click(screen.getByRole('button', { name: 'Add attribute filter' }));
  await user.type(screen.getByLabelText('Attribute name 1'), key);
  await user.type(screen.getByLabelText('Attribute value 1'), 'literal');
  await user.click(screen.getByRole('button', { name: 'Add tag filter' }));
  await user.type(screen.getByLabelText('Tag name 1'), 'customer tier');
  await user.type(screen.getByLabelText('Tag value 1'), 'paid');
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured attribute filters');
  const captured = vi.mocked(searchTraces).mock.calls[0][2];
  expect(captured.tempoFilters?.[0].key).toBe(key);
  expect(captured.tags?.[0].key).toBe('customer tier');
  await user.clear(screen.getByLabelText('Attribute name 1'));
  await user.type(screen.getByLabelText('Attribute name 1'), 'changed');
  expect(captured.tempoFilters?.[0].key).toBe(key);
  expect(searchTraces).toHaveBeenCalledTimes(1);
  expect(view.history.location.search).toBe('?service=reviews');
});

it('captures missing/null predicates without retaining an irrelevant string value', async () => {
  const tempo = structuredClone(configured);
  if (!tempo.valid || !tempo.config.clusters.alpha.tracing)
    throw new Error('Missing fixture config');
  tempo.config.clusters.alpha.tracing.provider = 'tempo';
  state.config = tempo;
  open('/traces?service=reviews');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add attribute filter' }));
  await user.type(screen.getByLabelText('Attribute name 1'), 'optional');
  await user.type(screen.getByLabelText('Attribute value 1'), 'previous string');
  await user.click(screen.getByLabelText('Attribute type 1'));
  await user.click(screen.getByRole('option', { name: 'Missing/null' }));
  expect(screen.queryByLabelText('Attribute value 1')).toBeNull();
  await user.click(screen.getByLabelText('Attribute comparison 1'));
  await user.click(screen.getByRole('option', { name: '!=' }));
  await user.click(screen.getByRole('button', { name: 'Search traces' }));
  await screen.findByText('Show captured attribute filters');
  expect(vi.mocked(searchTraces).mock.calls[0][2].tempoFilters).toEqual([
    { scope: 'span', key: 'optional', type: 'nil', operator: '!=', value: '' },
  ]);
});

it('loads trace deep links, retries the same trace and follows history without retaining stale spans', async () => {
  const view = open(`/traces?trace=${trace}`);
  await screen.findByRole('region', { name: 'Trace detail' });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load trace' }));
  await waitFor(() => expect(loadTrace).toHaveBeenCalledTimes(2));
  vi.mocked(loadTrace).mockRejectedValueOnce({ status: 404, message: 'Trace missing' });
  act(() => view.history.push('/traces?trace=2'));
  await screen.findByText('Not found: Trace missing');
  expect(screen.queryByRole('region', { name: 'Trace detail' })).toBeNull();
  expect(vi.mocked(loadTrace).mock.calls[2][2]).toBe('00000000000000000000000000000002');
});
it('keeps sub-microsecond timing visible instead of rounding positive spans to zero', async () => {
  vi.mocked(loadTrace).mockResolvedValue(decodeTraceDetail('tempo', fixtures.tempoTrace, trace));
  open(`/traces?trace=${trace}`);
  expect(
    await screen.findByRole('img', {
      name: 'Span starts at 0.00001 ms and lasts 0.00008 ms',
    })
  ).toBeDefined();
});
it('aborts on cluster changes and suppresses a late response from the previous cluster', async () => {
  let resolve!: (trace: TraceDetail) => void;
  vi.mocked(loadTrace).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const view = open(`/traces?trace=${trace}`);
  await waitFor(() => expect(loadTrace).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadTrace).mock.calls[0][3];
  state.cluster = 'beta';
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(decodeTraceDetail('jaeger', fixtures.jaeger, trace)));
  expect(screen.queryByRole('region', { name: 'Trace detail' })).toBeNull();
  expect(screen.getByText(/Configure an existing Jaeger/)).toBeDefined();
});
it('inspects exact span/scope/link metadata and removes the dialog when the cluster changes', async () => {
  vi.mocked(loadTrace).mockResolvedValue(decodeTraceDetail('tempo', fixtures.tempoTrace, trace));
  const view = open(`/traces?trace=${trace}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Inspect span 0000000000000001' }));
  let selected = screen.getByRole('region', { name: 'Selected span' });
  expect(within(selected).getByRole('heading', { name: 'Span metadata', level: 3 })).toBeDefined();
  expect(within(selected).getByRole('row', { name: 'Sampling flag False' })).toBeDefined();
  expect(
    within(selected).getByRole('row', { name: 'Remote parent context Not reported' })
  ).toBeDefined();
  expect(within(selected).getByRole('row', { name: 'Trace state Empty' })).toBeDefined();
  expect(within(selected).getByRole('row', { name: 'Dropped span attributes 0' })).toBeDefined();
  expect(within(selected).getByText('https://opentelemetry.io/schemas/1.26.0')).toBeDefined();
  expect(within(selected).getByText('https://opentelemetry.io/schemas/1.25.0')).toBeDefined();
  expect(
    within(selected).getByRole('row', { name: /scope.counter.*9007199254740993/ })
  ).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Inspect span 0000000000000002' }));
  selected = screen.getByRole('region', { name: 'Selected span' });
  expect(within(selected).getByText('Synthetic upstream failure')).toBeDefined();
  expect(within(selected).getByRole('row', { name: 'Remote parent context True' })).toBeDefined();
  await user.click(within(selected).getByRole('button', { name: 'Inspect link metadata 1' }));
  let dialog = await screen.findByRole('dialog', { name: 'Span link metadata' });
  expect(within(dialog).getByRole('row', { name: 'Sampling flag False' })).toBeDefined();
  expect(within(dialog).getByRole('row', { name: 'Remote linked context False' })).toBeDefined();
  expect(within(dialog).getByText('vendor=linked')).toBeDefined();
  expect(within(dialog).getByRole('row', { name: /link.counter.*9007199254740993/ })).toBeDefined();
  expect(within(dialog).getByRole('row', { name: 'Dropped link attributes 2' })).toBeDefined();
  expect(loadTrace).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole('button', { name: 'Close link metadata' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Span link metadata' })).toBeNull()
  );
  await user.click(within(selected).getByRole('button', { name: 'Inspect link metadata 1' }));
  dialog = await screen.findByRole('dialog', { name: 'Span link metadata' });
  expect(dialog).toBeDefined();
  state.cluster = 'beta';
  view.rerender(
    <Router history={view.history}>
      <Traces />
    </Router>
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Span link metadata' })).toBeNull()
  );
  expect(screen.queryByRole('region', { name: 'Selected span' })).toBeNull();
});
