import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { loadTelemetry } from '../data/telemetry';
import Traffic from './Traffic';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useSelectedClusters: () => ['alpha'] },
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '')),
  }),
}));
vi.mock('../config', () => ({ useKialiConfig: vi.fn() }));
vi.mock('../data/telemetry', () => ({ loadTelemetry: vi.fn() }));
vi.mock('./MetricChart', () => ({ default: () => null }));
vi.mock('./TrafficGraph', () => ({ default: () => null }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  SectionBox: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SimpleTable: ({
    data,
    columns,
  }: {
    data: unknown[];
    columns: Array<{ label: string; getter: (row: never) => ReactNode }>;
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
        {data.map((row, index) => (
          <tr key={index}>
            {columns.map(column => (
              <td key={column.label}>{column.getter(row as never)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const emptyRead = { ok: true as const, result: { warnings: [], series: [] } };

beforeEach(() => {
  vi.mocked(useKialiConfig).mockReturnValue({
    valid: true,
    config: {
      schemaVersion: 1,
      clusters: {
        alpha: {
          prometheus: {
            namespace: 'monitoring',
            service: 'prometheus',
            port: '9090',
            basePath: '',
          },
          telemetryCluster: 'mesh-east',
        },
      },
    },
  });
  vi.mocked(loadTelemetry).mockImplementation(async (_scope, _endpoint, capturedQuery) => ({
    query: capturedQuery,
    requests: emptyRead,
    latency: emptyRead,
    tcp: emptyRead,
    traffic: emptyRead,
    security: {
      ok: true,
      result: {
        warnings: [],
        series: [
          {
            labels: { request_protocol: 'http', connection_security_policy: 'mutual_tls' },
            samples: [{ timestamp: capturedQuery.end, value: 3 }],
          },
          {
            labels: { request_protocol: 'http', connection_security_policy: 'none' },
            samples: [{ timestamp: capturedQuery.end, value: 2 }],
          },
        ],
      },
    },
  }));
});
afterEach(cleanup);

it('names observed categories and displays their destination-reporter range provenance', async () => {
  render(
    <MemoryRouter initialEntries={['/traffic?namespace=bookinfo']}>
      <Traffic />
    </MemoryRouter>
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load metrics' }));
  expect(await screen.findByText('Both mTLS and none labels observed')).toBeDefined();
  expect(
    screen.getByText(
      /^Reporter: destination; namespace: bookinfo; metric cluster: mesh-east; range: 15 minutes ending /
    )
  ).toBeDefined();
  expect(
    screen.getByText(
      'This is a destination-reported istio_requests_total view for the selected namespace and explicit telemetry identity, regardless of inbound/outbound scope. It uses a five-minute rate window over the captured range, sampled every 15 seconds. Categories describe returned HTTP/gRPC request labels only; they do not prove all traffic, configured policy, proxy synchronization, certificate validity, authorization, or ambient/waypoint security. TCP and ambient security are unsupported by this request-level query.'
    )
  ).toBeDefined();
});
