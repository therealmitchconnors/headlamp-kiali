import { cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import MetricCategoryChart from './MetricCategoryChart';
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? '')),
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SimpleTable: <T,>({
    data,
    columns,
  }: {
    data: T[];
    columns: { label: string; getter: (row: T) => ReactNode }[];
  }) => (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {columns.map(column => (
              <td key={column.label}>{column.getter(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
    <div data-testid="plot" data-values={JSON.stringify(data)}>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Bar: ({ children, stackId }: { children: ReactNode; stackId?: string }) => (
    <div data-testid="bar" data-stack={stackId}>
      {children}
    </div>
  ),
  Cell: ({ fill }: { fill: string }) => <span data-testid="color" data-color={fill} />,
  Line: ({ dataKey, connectNulls }: { dataKey: string; connectNulls: boolean }) => (
    <span data-testid={dataKey} data-connect={String(connectNulls)} />
  ),
  Area: ({ dataKey, connectNulls }: { dataKey: string; connectNulls: boolean }) => (
    <span data-testid={dataKey} data-connect={String(connectNulls)} />
  ),
}));
afterEach(cleanup);
const metrics = [
  {
    name: 'Zero',
    result: {
      warnings: [],
      series: [
        {
          labels: {},
          samples: [
            { timestamp: 10, value: 0 },
            { timestamp: 20, value: null },
          ],
        },
      ],
    },
  },
  {
    name: 'Negative',
    result: { warnings: [], series: [{ labels: {}, samples: [{ timestamp: 5, value: -3 }] }] },
  },
  { name: 'Missing', result: { warnings: [], series: [] } },
];
it('defaults to independent colored bars with exact latest samples, times and missing-series evidence', () => {
  render(<MetricCategoryChart title="Latest" unit={null} metrics={metrics} />);
  expect(screen.getByRole('img', { name: 'Latest' })).toBeDefined();
  expect(screen.getByTestId('bar').getAttribute('data-stack')).toBeNull();
  expect(screen.getByText('0.0000')).toBeDefined();
  expect(screen.getByText('-3.0000')).toBeDefined();
  expect(screen.getByText(new Date(10000).toLocaleString())).toBeDefined();
  expect(screen.getByText(/Selected sample times differ/)).toBeDefined();
  expect(screen.getByText(/Series without finite samples: 1/)).toBeDefined();
  const rows = JSON.parse(screen.getByTestId('plot').getAttribute('data-values')!);
  expect(rows.map((row: { value: number | null }) => row.value)).toEqual([0, -3, null]);
  expect(
    new Set(screen.getAllByTestId('color').map(cell => cell.getAttribute('data-color'))).size
  ).toBe(3);
});
it.each(['line', 'area', 'scatter'] as const)(
  'isolates each %s category so different series cannot be joined',
  chartType => {
    render(
      <MetricCategoryChart
        title="Independent"
        unit={null}
        metrics={metrics}
        chartType={chartType}
      />
    );
    const rows = JSON.parse(screen.getByTestId('plot').getAttribute('data-values')!);
    expect(
      rows.map((row: Record<string, unknown>) => [row.series0, row.series1, row.series2])
    ).toEqual([
      [0, null, null],
      [null, -3, null],
      [null, null, null],
    ]);
    expect(screen.getByTestId('series0').getAttribute('data-connect')).toBe('false');
    expect(screen.getByTestId('series1').getAttribute('data-connect')).toBe('false');
  }
);
it('keeps unavailable categories without fabricating a plot and preserves data when bounds are unsafe', () => {
  const view = render(<MetricCategoryChart title="Empty" unit={null} metrics={[metrics[2]]} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/Series without finite samples: 1/)).toBeDefined();
  const large = [
    {
      name: 'Large',
      result: {
        warnings: [],
        series: [{ labels: {}, samples: [{ timestamp: 1, value: Number.MAX_VALUE }] }],
      },
    },
  ];
  view.rerender(
    <MetricCategoryChart title="Overflow" unit={null} metrics={large} min={0} max={1} />
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/cannot represent these samples safely/)).toBeDefined();
  expect(screen.getByText(Number.MAX_VALUE.toPrecision(5))).toBeDefined();
});
