import { cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import MetricChart from './MetricChart';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? ''),
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({ SimpleTable: () => <table /> }));
vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: ({ dot, connectNulls }: { dot: boolean; connectNulls: boolean }) => (
    <span data-testid="line" data-dot={String(dot)} data-connect={String(connectNulls)} />
  ),
}));
afterEach(cleanup);
it.each([
  [null, 0],
  [null, 2],
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
