import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { CustomDashboardQuery } from '../core/customDashboards';
import { loadCustomDashboard } from './customDashboards';
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const provider = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const query = (): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  minutes: 15,
  end: 10000,
  dashboard: {
    name: 'runtime',
    title: 'Runtime',
    items: Array.from({ length: 8 }, (_, i) => ({
      chart: {
        name: `chart-${i}`,
        metricName: `metric_${i}`,
        unit: 'bytes',
        dataType: i === 1 ? 'rate' : 'raw',
        unitScale: 0.001,
      },
    })),
  },
});
const matrix = (
  values: [number, string][] = [
    [9985, 'NaN'],
    [10000, '-2000'],
  ],
  labels = {}
) => ({
  status: 'success',
  data: { resultType: 'matrix', result: [{ metric: labels, values }] },
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures settings/range and bounds eight jobs to three workers with independent errors', async () => {
  let active = 0;
  let peak = 0;
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      const url = new URL(String(path), 'http://example.test');
      expect(url.searchParams.get('start')).toBe('9100');
      expect(url.searchParams.get('end')).toBe('10000');
      expect(url.searchParams.get('step')).toBe('15');
      const expression = url.searchParams.get('query') ?? '';
      if (expression.includes('metric_2')) throw { status: 403, message: 'Metric denied' };
      return matrix(undefined, expression.includes('metric_3') ? { leftover: 'label' } : {});
    } finally {
      active--;
    }
  });
  const scope = { cluster: 'alpha' };
  const endpoint = { ...provider };
  const input = query();
  input.templateReferences = [
    { name: 'runtime', title: 'Runtime' },
    { name: 'shared', title: 'Shared charts' },
  ];
  const expected = structuredClone(input);
  const pending = loadCustomDashboard(scope, endpoint, input, new AbortController().signal);
  scope.cluster = 'other';
  endpoint.service = 'other';
  input.dashboard.items.length = 0;
  input.templateReferences[1].title = 'mutated';
  input.end = 0;
  const result = await pending;
  expect(result.query).toEqual(expected);
  expect(peak).toBe(3);
  expect(result.charts).toHaveLength(8);
  expect(result.charts[0].read).toMatchObject({
    ok: true,
    result: { series: [{ samples: [{ value: null }, { value: -2 }] }] },
  });
  expect(result.charts[1].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  expect(result.charts[2].read).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  expect(result.charts[3].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(path).toContain('/services/prometheus:9090/');
    expect(options?.cluster).toBe('alpha');
  }
});
it.each(['overflow', 'underflow', 'budget', 'time'])(
  'reports %s failures instead of substituting zero',
  async mode => {
    const input = query();
    input.dashboard.items = input.dashboard.items.slice(0, 1);
    input.dashboard.items[0].chart.unitScale =
      mode === 'overflow' ? 1e12 : mode === 'underflow' ? 1e-300 : 1;
    vi.mocked(ApiProxy.request).mockResolvedValue(
      matrix(
        mode === 'budget'
          ? Array.from({ length: 62 }, (_, i) => [9100 + i * 15, '1'])
          : [
              [
                mode === 'time' ? 10005 : 10000,
                mode === 'overflow' ? '1e308' : mode === 'underflow' ? '1e-300' : '1',
              ],
            ]
      )
    );
    const result = await loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      input,
      new AbortController().signal
    );
    expect(result.charts[0].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  }
);
it('times out active charts and cancels queued jobs, including transports ignoring abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      query(),
      new AbortController().signal
    );
    const failure = expect(pending).rejects.toThrow('Custom dashboard reads exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it('does not send an unscoped or invalid template request', async () => {
  await expect(
    loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      { ...query(), clusterLabel: null },
      new AbortController().signal
    )
  ).rejects.toThrow('Confirm');
  await expect(
    loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      { ...query(), namespace: '' },
      new AbortController().signal
    )
  ).rejects.toThrow('namespace');
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('captures histogram summaries, permits signed observations and isolates a quantile failure', async () => {
  const input = query();
  input.dashboard.items = [
    {
      chart: {
        name: 'Temperature',
        unit: 'C',
        metricName: 'temperature',
        dataType: 'histogram',
        unitScale: 0.1,
      },
    },
  ];
  input.histogramSummaries = ['avg', 'p50', 'p90', 'p95', 'p99'];
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const expression = new URL(String(path), 'http://example.test').searchParams.get('query') || '';
    if (expression.includes('histogram_quantile(0.95'))
      throw { status: 403, message: 'Quantile denied' };
    return matrix();
  });
  const pending = loadCustomDashboard(
    { cluster: 'alpha' },
    provider,
    input,
    new AbortController().signal
  );
  input.histogramSummaries.length = 0;
  const result = await pending;
  expect(result.query.histogramSummaries).toEqual(['avg', 'p50', 'p90', 'p95', 'p99']);
  expect(result.charts.map(chart => chart.summary)).toEqual(['avg', 'p50', 'p90', 'p95', 'p99']);
  expect(result.charts[0].read).toMatchObject({
    ok: true,
    result: { series: [{ samples: [{ value: null }, { value: -200 }] }] },
  });
  expect(result.charts[3].read).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  expect(ApiProxy.request).toHaveBeenCalledTimes(5);
});
it('captures label filters and rejects oversized encoded expressions before any transport', async () => {
  const input = query();
  input.dashboard.items = input.dashboard.items.slice(0, 1);
  input.labelsFilters = { job: 'captured', container: '' };
  vi.mocked(ApiProxy.request).mockResolvedValue(matrix());
  const pending = loadCustomDashboard(
    { cluster: 'alpha' },
    provider,
    input,
    new AbortController().signal
  );
  input.labelsFilters.job = 'changed';
  const result = await pending;
  expect(result.query.labelsFilters).toEqual({ container: '', job: 'captured' });
  const expression = new URL(
    String(vi.mocked(ApiProxy.request).mock.calls[0][0]),
    'http://example.test'
  ).searchParams.get('query');
  expect(expression).toContain('container="",job="captured"');
  vi.mocked(ApiProxy.request).mockReset();
  input.labelsFilters = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`key${i}`, '\u00e9'.repeat(1024)])
  );
  await expect(
    loadCustomDashboard({ cluster: 'alpha' }, provider, input, new AbortController().signal)
  ).rejects.toThrow('16 KiB');
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('captures metric declarations before awaiting and retains per-metric failures and summary identity', async () => {
  const input = query();
  input.dashboard.items = [
    {
      chart: {
        name: 'Capacity',
        unit: 'bytes',
        dataType: 'histogram',
        metricName: 'legacy_ignored',
        metrics: [
          { metricName: 'used', displayName: 'Used' },
          { metricName: 'limit', displayName: 'Limit' },
        ],
      },
    },
  ];
  input.histogramSummaries = ['avg', 'p95'];
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const expression = new URL(String(path), 'http://example.test').searchParams.get('query') || '';
    if (expression.includes('limit_bucket'))
      throw { status: 403, message: 'Limit quantile denied' };
    return matrix([[10000, '0']]);
  });
  const pending = loadCustomDashboard(
    { cluster: 'alpha' },
    provider,
    input,
    new AbortController().signal
  );
  input.dashboard.items[0].chart.metrics![0].metricName = 'changed';
  const result = await pending;
  expect(
    result.charts.map(read => [read.chartIndex, read.metric.metricName, read.summary])
  ).toEqual([
    [0, 'used', 'avg'],
    [0, 'used', 'p95'],
    [0, 'limit', 'avg'],
    [0, 'limit', 'p95'],
  ]);
  expect(result.charts[3].read).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  for (const [path] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(String(path)).not.toMatch(/legacy_ignored|changed/);
  }
});
it('rejects histogram expansion overflow before transport and caps a cancelled queue', async () => {
  const input = query();
  input.dashboard.items.forEach(item => {
    item.chart.dataType = 'histogram';
  });
  await expect(
    loadCustomDashboard({ cluster: 'alpha' }, provider, input, new AbortController().signal)
  ).rejects.toThrow('8 metric queries');
  expect(ApiProxy.request).not.toHaveBeenCalled();
  input.histogramSummaries = ['avg'];
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      input,
      new AbortController().signal
    );
    const failed = expect(pending).rejects.toThrow('15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it('captures grouping and scales independent groups without changing their labels', async () => {
  const input = query();
  input.dashboard.items = input.dashboard.items.slice(0, 1);
  input.dashboard.items[0].chart.groupLabels = ['pod'];
  vi.mocked(ApiProxy.request).mockResolvedValue({
    status: 'success',
    data: {
      resultType: 'matrix',
      result: [
        { metric: { pod: 'z' }, values: [[10000, '-2000']] },
        {
          metric: { pod: 'a' },
          values: [
            [9985, 'NaN'],
            [10000, '0'],
          ],
        },
      ],
    },
  });
  const pending = loadCustomDashboard(
    { cluster: 'alpha' },
    provider,
    input,
    new AbortController().signal
  );
  input.dashboard.items[0].chart.groupLabels[0] = 'changed';
  const result = await pending;
  expect(result.query.dashboard.items[0].chart.groupLabels).toEqual(['pod']);
  expect(result.charts[0].read).toMatchObject({
    ok: true,
    result: {
      series: [
        { labels: { pod: 'z' }, samples: [{ value: -2 }] },
        { labels: { pod: 'a' }, samples: [{ value: null }, { value: 0 }] },
      ],
    },
  });
  const expression = new URL(
    String(vi.mocked(ApiProxy.request).mock.calls[0][0]),
    'http://example.test'
  ).searchParams.get('query');
  expect(expression).toMatch(/ by \(pod\)$/);
});
it('captures optional grouping independently of fixed declarations and decodes the effective labels', async () => {
  const input = query();
  input.dashboard.items = input.dashboard.items.slice(0, 1);
  input.dashboard.items[0].chart.aggregations = [{ label: 'pod', displayName: 'Pod' }];
  input.byLabels = ['pod'];
  vi.mocked(ApiProxy.request).mockResolvedValue({
    status: 'success',
    data: {
      resultType: 'matrix',
      result: [
        { metric: { pod: 'one' }, values: [[10000, '1000']] },
        { metric: { pod: 'two' }, values: [[10000, '2000']] },
      ],
    },
  });
  const pending = loadCustomDashboard(
    { cluster: 'alpha' },
    provider,
    input,
    new AbortController().signal
  );
  input.byLabels[0] = 'changed';
  input.dashboard.items[0].chart.aggregations[0].label = 'changed';
  const result = await pending;
  expect(result.query.byLabels).toEqual(['pod']);
  expect(result.charts[0].groupLabels).toEqual(['pod']);
  expect(result.charts[0].chart.groupLabels).toBeUndefined();
  expect(result.charts[0].read).toMatchObject({
    ok: true,
    result: {
      series: [
        { labels: { pod: 'one' }, samples: [{ value: 1 }] },
        { labels: { pod: 'two' }, samples: [{ value: 2 }] },
      ],
    },
  });
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('captures explicit chart batches and original indices without querying omitted charts', async () => {
  const input = query();
  input.dashboard.items.push({
    chart: { name: 'extra', metricName: 'extra_metric', dataType: 'raw', unitScale: 0.001 },
  });
  input.chartNames = ['extra', 'chart-7'];
  vi.mocked(ApiProxy.request).mockResolvedValue(matrix());
  const pending = loadCustomDashboard(
    { cluster: 'alpha' },
    provider,
    input,
    new AbortController().signal
  );
  input.chartNames[0] = 'chart-0';
  input.dashboard.items.pop();
  const result = await pending;
  expect(result.query.dashboard.items).toHaveLength(9);
  expect(result.query.chartNames).toEqual(['extra', 'chart-7']);
  expect(result.charts.map(chart => [chart.chartIndex, chart.chart.name])).toEqual([
    [7, 'chart-7'],
    [8, 'extra'],
  ]);
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
  const requests = vi.mocked(ApiProxy.request).mock.calls.map(([path]) => String(path));
  expect(requests[0]).toContain('metric_7');
  expect(requests[1]).toContain('extra_metric');
  expect(requests.every(path => !path.includes('metric_0'))).toBe(true);
});
it.each([
  { group: 'namespace', labels: { namespace: 'other' }, ok: false },
  { group: 'namespace', labels: {}, ok: false },
  { group: 'namespace', labels: { namespace: 'bookinfo' }, ok: true },
  { group: 'cluster', labels: { cluster: 'other' }, ok: false },
  { group: 'job', labels: {}, ok: true },
  { group: 'job', labels: { job: 'nonempty' }, ok: false },
  { group: 'constructor', labels: {}, ok: true },
])(
  'checks captured equality filters on returned $group groups %#',
  async ({ group, labels, ok }) => {
    const input = query();
    input.dashboard.items = input.dashboard.items.slice(0, 1);
    input.dashboard.items[0].chart.groupLabels = [group];
    input.labelsFilters = { job: '' };
    vi.mocked(ApiProxy.request).mockResolvedValue(matrix([[10000, '0']], labels));
    const result = await loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      input,
      new AbortController().signal
    );
    expect(result.charts[0].read.ok).toBe(ok);
    if (!ok)
      expect(result.charts[0].read).toMatchObject({
        error: { message: 'Returned metric group contradicts a captured equality filter' },
      });
  }
);
it.each(['duplicate', 'overflow', 'unexpected'])(
  'isolates a %s grouped response without dropping successful siblings',
  async failure => {
    const input = query();
    input.dashboard.items = input.dashboard.items.slice(0, 2);
    input.dashboard.items.forEach(item => {
      item.chart.groupLabels = ['pod'];
    });
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (!String(path).includes('metric_0')) return matrix([[10000, '2000']], { pod: 'valid' });
      const labels =
        failure === 'duplicate'
          ? [{ pod: 'a' }, { pod: 'a' }]
          : failure === 'unexpected'
          ? [{ extra: 'x' }]
          : Array.from({ length: 9 }, (_, i) => ({ pod: `p${i}` }));
      return {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: labels.map(metric => ({ metric, values: [[10000, '1']] })),
        },
      };
    });
    const result = await loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      input,
      new AbortController().signal
    );
    expect(result.charts[0].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
    expect(result.charts[1].read).toMatchObject({
      ok: true,
      result: { series: [{ labels: { pod: 'valid' }, samples: [{ value: 2 }] }] },
    });
    expect(ApiProxy.request).toHaveBeenCalledTimes(2);
  }
);
