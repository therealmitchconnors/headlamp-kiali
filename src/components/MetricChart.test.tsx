import { cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import MetricChart from './MetricChart';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? ''),
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SimpleTable: ({ columns }: { columns: { label: string }[] }) => (
    <table>
      <thead>
        <tr>
          {columns.map(column => (
            <th key={column.label}>{column.label}</th>
          ))}
        </tr>
      </thead>
    </table>
  ),
}));
vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: ({
    domain,
    allowDataOverflow,
  }: {
    domain?: [number, number];
    allowDataOverflow?: boolean;
  }) => (
    <span
      data-testid="axis"
      data-domain={JSON.stringify(domain)}
      data-overflow={String(allowDataOverflow)}
    />
  ),
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
    <div data-testid="composed" data-values={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Bar: ({ stackId }: { stackId?: string }) => <span data-testid="bar" data-stack={stackId} />,
  Area: ({ connectNulls, stackId }: { connectNulls: boolean; stackId?: string }) => (
    <span data-testid="area" data-connect={String(connectNulls)} data-stack={stackId} />
  ),
  Line: ({
    dot,
    connectNulls,
    name,
    stroke,
  }: {
    dot: boolean;
    connectNulls: boolean;
    name: string;
    stroke: string;
  }) => (
    <span
      data-testid="line"
      data-dot={String(dot)}
      data-connect={String(connectNulls)}
      data-name={name}
      data-stroke={stroke}
    />
  ),
}));
afterEach(cleanup);
it.each(['bar', 'area'] as const)(
  'renders %s with unchanged signed/zero/missing samples and no stacking',
  chartType => {
    const samples = [
      { timestamp: 1, value: -1 },
      { timestamp: 2, value: null },
      { timestamp: 3, value: 0 },
    ];
    render(
      <MetricChart
        title="Styled"
        unit={null}
        chartType={chartType}
        result={{ warnings: [], series: [{ labels: {}, samples }] }}
      />
    );
    expect(screen.getByTestId(chartType).getAttribute('data-stack')).toBeNull();
    expect(JSON.parse(screen.getByTestId('composed').getAttribute('data-values')!)).toEqual(
      samples
    );
    if (chartType === 'area')
      expect(screen.getByTestId('area').getAttribute('data-connect')).toBe('false');
  }
);
it('renders scatter as points without a connecting stroke or null interpolation', () => {
  render(
    <MetricChart
      title="Points"
      unit={null}
      chartType="scatter"
      result={{ warnings: [], series: [{ labels: {}, samples: [{ timestamp: 1, value: -1 }] }] }}
    />
  );
  expect(screen.getByTestId('line').getAttribute('data-stroke')).toBe('none');
  expect(screen.getByTestId('line').getAttribute('data-connect')).toBe('false');
});
it.each([
  [null, 0],
  [null, 2],
  [0, null, 2],
])('shows an isolated finite sample visibly without connecting null gaps: %j', (...values) => {
  render(
    <MetricChart
      title="Request size"
      unit="bytes"
      result={{
        warnings: [],
        series: [
          { labels: {}, samples: values.map((value, index) => ({ timestamp: index + 1, value })) },
        ],
      }}
    />
  );
  expect(screen.getByText('Unit: bytes')).toBeDefined();
  expect(screen.getByTestId('line').getAttribute('data-dot')).toBe('true');
  expect(screen.getByTestId('line').getAttribute('data-connect')).toBe('false');
});
it('keeps unavailable samples explicit rather than drawing a zero series', () => {
  render(
    <MetricChart
      title="Request size"
      unit="bytes"
      result={{ warnings: [], series: [{ labels: {}, samples: [{ timestamp: 1, value: null }] }] }}
    />
  );
  expect(screen.queryByTestId('line')).toBeNull();
  expect(
    screen.getByText('Samples are unavailable or non-finite. No zero values have been substituted.')
  ).toBeDefined();
});
it('uses an optional declared series label without changing the default unit label', () => {
  const props = {
    title: 'Capacity',
    unit: 'bytes',
    result: { warnings: [], series: [{ labels: {}, samples: [{ timestamp: 1, value: 1 }] }] },
  };
  const view = render(<MetricChart {...props} />);
  expect(screen.getByTestId('line').getAttribute('data-name')).toBe('bytes');
  view.rerender(<MetricChart {...props} seriesName="Used" />);
  expect(screen.getByTestId('line').getAttribute('data-name')).toBe('Used');
});
it('uses an explicit unspecified-unit disclosure and neutral value labels', () => {
  const props = {
    title: 'Untyped measurement',
    unit: null,
    result: { warnings: [], series: [{ labels: {}, samples: [{ timestamp: 1, value: 0 }] }] },
  };
  const view = render(<MetricChart {...props} />);
  expect(screen.getByText('Unit not specified by the chart definition.')).toBeDefined();
  expect(screen.getByTestId('line').getAttribute('data-name')).toBe('Value');
  expect(screen.getByRole('columnheader', { name: 'Value' })).toBeDefined();
  view.rerender(<MetricChart {...props} seriesName="Observed count" />);
  expect(screen.getByTestId('line').getAttribute('data-name')).toBe('Observed count');
});
it('passes captured display bounds to the axis and discloses excluded samples', () => {
  render(
    <MetricChart
      title="Bounded"
      unit="bytes"
      min={0}
      max={10}
      result={{
        warnings: [],
        series: [
          {
            labels: {},
            samples: [
              { timestamp: 1, value: -2 },
              { timestamp: 2, value: 0 },
              { timestamp: 3, value: 12 },
            ],
          },
        ],
      }}
    />
  );
  expect(screen.getByTestId('axis').getAttribute('data-domain')).toBe('[0,10]');
  expect(screen.getByTestId('axis').getAttribute('data-overflow')).toBe('true');
  expect(screen.getByText(/minimum 0; maximum 10/)).toBeDefined();
  expect(screen.getByText(/outside the display bounds: 2/)).toBeDefined();
});
