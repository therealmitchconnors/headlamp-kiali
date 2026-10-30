import { cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import MetricComparisonChart from './MetricComparisonChart';
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
      <thead>
        <tr>
          {columns.map(column => (
            <th key={column.label}>{column.label}</th>
          ))}
        </tr>
      </thead>
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
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: ({ domain }: { domain?: [number, number] }) => (
    <span data-testid="axis" data-domain={JSON.stringify(domain)} />
  ),
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: ({ name, stackId }: { name: string; stackId?: string }) => (
    <span data-testid={name} data-stack={stackId} />
  ),
  Area: ({
    name,
    connectNulls,
    stackId,
  }: {
    name: string;
    connectNulls: boolean;
    stackId?: string;
  }) => <span data-testid={name} data-stack={stackId} data-connect={String(connectNulls)} />,
  Line: ({
    name,
    connectNulls,
    stroke,
  }: {
    name: string;
    connectNulls: boolean;
    stroke: string;
  }) => <span data-testid={name} data-connect={String(connectNulls)} data-color={stroke} />,
}));
afterEach(cleanup);
it.each(['bar', 'area'] as const)(
  'keeps named %s series separate and retains exact numeric tables',
  chartType => {
    render(
      <MetricComparisonChart
        title="Independent"
        unit={null}
        chartType={chartType}
        metrics={[
          {
            name: 'First',
            result: {
              warnings: [],
              series: [{ labels: {}, samples: [{ timestamp: 1, value: -2 }] }],
            },
          },
          {
            name: 'Second',
            result: {
              warnings: [],
              series: [{ labels: {}, samples: [{ timestamp: 1, value: 3 }] }],
            },
          },
        ]}
      />
    );
    expect(screen.getByTestId('First').getAttribute('data-stack')).toBeNull();
    expect(screen.getByTestId('Second').getAttribute('data-stack')).toBeNull();
    expect(screen.getByText('-2.0000')).toBeDefined();
    expect(screen.getByText('3.0000')).toBeDefined();
  }
);
it('renders distinct named series and a numeric table preserving gaps and zero', () => {
  render(
    <MetricComparisonChart
      title="Capacity"
      unit="bytes"
      metrics={[
        {
          name: 'Used',
          result: {
            warnings: [],
            series: [{ labels: {}, samples: [{ timestamp: 1, value: -2 }] }],
          },
        },
        {
          name: 'Limit',
          colorIndex: 2,
          result: { warnings: [], series: [{ labels: {}, samples: [{ timestamp: 2, value: 0 }] }] },
        },
      ]}
    />
  );
  expect(screen.getByRole('img', { name: 'Capacity' })).toBeDefined();
  expect(screen.getByTestId('Used').getAttribute('data-connect')).toBe('false');
  expect(screen.getByTestId('Used').getAttribute('data-color')).not.toBe(
    screen.getByTestId('Limit').getAttribute('data-color')
  );
  expect(screen.getByRole('columnheader', { name: 'Used' })).toBeDefined();
  expect(screen.getByRole('columnheader', { name: 'Limit' })).toBeDefined();
  expect(screen.getByText('-2.0000')).toBeDefined();
  expect(screen.getByText('0.0000')).toBeDefined();
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
});
it('does not claim a shared physical unit when a comparison omits its unit', () => {
  render(
    <MetricComparisonChart
      title="Unknown dimensions"
      unit={null}
      metrics={[
        {
          name: 'Observed',
          result: { warnings: [], series: [{ labels: {}, samples: [{ timestamp: 1, value: 0 }] }] },
        },
      ]}
    />
  );
  expect(screen.getByText('Unit not specified by the chart definition.')).toBeDefined();
  expect(
    screen.getByText('No unit is declared. Check metric dimensions before comparing these values.')
  ).toBeDefined();
  expect(screen.getByRole('columnheader', { name: 'Observed' })).toBeDefined();
  expect(screen.getByText('0.0000')).toBeDefined();
});
it('keeps out-of-bounds numeric values and an explicit error for unsafe display geometry', () => {
  const metrics = [
    {
      name: 'Observed',
      result: {
        warnings: [],
        series: [
          {
            labels: {},
            samples: [
              { timestamp: 1, value: -2 },
              { timestamp: 2, value: 12 },
            ],
          },
        ],
      },
    },
  ];
  const view = render(
    <MetricComparisonChart title="Bounded" unit="bytes" metrics={metrics} min={0} max={10} />
  );
  expect(screen.getByTestId('axis').getAttribute('data-domain')).toBe('[0,10]');
  expect(screen.getByText('-2.0000')).toBeDefined();
  expect(screen.getByText('12.000')).toBeDefined();
  expect(screen.getByText(/outside the display bounds: 2/)).toBeDefined();
  metrics[0].result.series[0].samples[0].value = Number.MAX_VALUE;
  view.rerender(
    <MetricComparisonChart title="Bounded" unit="bytes" metrics={metrics} min={0} max={1} />
  );
  expect(screen.getByText(/cannot represent these samples safely/)).toBeDefined();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(Number.MAX_VALUE.toPrecision(5))).toBeDefined();
});
it('shows all-unavailable and invalid inputs without fabricating a chart', () => {
  const view = render(
    <MetricComparisonChart
      title="Capacity"
      unit="bytes"
      metrics={[{ name: 'Used', result: { warnings: [], series: [] } }]}
    />
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/No zero values have been substituted/)).toBeDefined();
  view.rerender(<MetricComparisonChart title="Capacity" unit="bytes" metrics={[]} />);
  expect(screen.getByRole('alert').textContent).toContain('1 to 8');
});

it('shows unambiguous group captions on legends and numeric columns', () => {
  render(
    <MetricComparisonChart
      title="Grouped"
      unit="bytes"
      metrics={[
        {
          name: 'Used',
          group: '{pod="a"}',
          result: { warnings: [], series: [{ labels: {}, samples: [{ timestamp: 1, value: 0 }] }] },
        },
        {
          name: 'Used',
          group: '{pod=<absent>}',
          result: {
            warnings: [],
            series: [{ labels: {}, samples: [{ timestamp: 2, value: -2 }] }],
          },
        },
      ]}
    />
  );
  expect(screen.getByTestId('"Used" {pod="a"}').getAttribute('data-connect')).toBe('false');
  expect(screen.getByRole('columnheader', { name: '"Used" {pod="a"}' })).toBeDefined();
  expect(screen.getByRole('columnheader', { name: '"Used" {pod=<absent>}' })).toBeDefined();
  expect(screen.getByText('0.0000')).toBeDefined();
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
});
