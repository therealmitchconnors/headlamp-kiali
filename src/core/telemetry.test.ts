import {
  decodePrometheus,
  prometheusQueries,
  requestPoints,
  trafficEdges,
  TrafficQuery,
} from './telemetry';

const query: TrafficQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'east',
  direction: 'inbound',
  minutes: 15,
  end: 10000,
};
function matrix(result: object[]) {
  return { status: 'success', data: { resultType: 'matrix', result } };
}

describe('scoped PromQL construction', () => {
  it('uses one reporter and explicit metric identity instead of kubeconfig name inference', () => {
    const queries = prometheusQueries(query);
    expect(queries.requests).toBe(
      'sum by (request_protocol,response_code,grpc_response_status) (rate(istio_requests_total{reporter="destination",destination_workload_namespace="bookinfo",destination_cluster="east"}[5m]))'
    );
    expect(queries.latency).toContain('histogram_quantile(0.95,sum by (le)');
    expect(queries.tcp).toContain('istio_tcp_sent_bytes_total');
    expect(queries.traffic).toContain('source_cluster,source_workload_namespace');
    expect(prometheusQueries({ ...query, direction: 'outbound' }).requests).toContain(
      'reporter="source",source_workload_namespace'
    );
  });
  it('escapes label values instead of permitting query injection', () => {
    const cluster = 'east"} or vector(99) #\n\\';
    const text = prometheusQueries({ ...query, telemetryCluster: cluster }).requests;
    expect(text).toContain(`destination_cluster=${JSON.stringify(cluster)}`);
    expect(text).not.toContain('\n');
  });
  it('rejects missing scope and invalid ranges', () => {
    expect(() => prometheusQueries({ ...query, telemetryCluster: '' })).toThrow();
    expect(() => prometheusQueries({ ...query, namespace: '../wrong' })).toThrow();
    expect(() => prometheusQueries({ ...query, end: NaN })).toThrow();
  });
});

describe('Prometheus result contracts', () => {
  it('retains warnings and gaps for non-finite samples', () => {
    const decoded = decodePrometheus(
      {
        ...matrix([
          {
            metric: {},
            values: [
              [1, '0'],
              [2, 'NaN'],
              [3, '+Inf'],
              [4, '-Inf'],
              [5, '1.2e-3'],
            ],
          },
        ]),
        warnings: ['partial response'],
      },
      'matrix'
    );
    expect(decoded.warnings).toEqual(['partial response']);
    expect(decoded.series[0].samples.map(sample => sample.value)).toEqual([
      0,
      null,
      null,
      null,
      0.0012,
    ]);
  });
  it.each([
    { status: 'error', error: 'query rejected' },
    { status: 'success', data: { resultType: 'vector', result: [] } },
    matrix([{ metric: {}, values: [[1, '']] }]),
    matrix([{ metric: {}, values: [[1, '0x10']] }]),
    matrix([
      {
        metric: {},
        values: [
          [2, '1'],
          [1, '2'],
        ],
      },
    ]),
    matrix([{ metric: { bad: 2 }, values: [[1, '0']] }]),
  ])('rejects malformed or failed results %j', payload => {
    expect(() => decodePrometheus(payload, 'matrix')).toThrow();
  });
  it('enforces explicit series and sample bounds', () => {
    expect(() =>
      decodePrometheus(
        matrix(Array.from({ length: 2001 }, () => ({ metric: {}, values: [] }))),
        'matrix'
      )
    ).toThrow('2,000');
    expect(() =>
      decodePrometheus(
        matrix([{ metric: {}, values: Array.from({ length: 100001 }, (_, i) => [i, '0']) }]),
        'matrix'
      )
    ).toThrow('100,000');
  });
});

describe('operational metrics, not Kiali health semantics', () => {
  it('sums HTTP and gRPC errors without combining duplicate reporters', () => {
    const data = decodePrometheus(
      matrix([
        { metric: { request_protocol: 'http', response_code: '200' }, values: [[1, '8']] },
        { metric: { request_protocol: 'http', response_code: '503' }, values: [[1, '1']] },
        { metric: { request_protocol: 'grpc', grpc_response_status: '14' }, values: [[1, '1']] },
      ]),
      'matrix'
    );
    expect(requestPoints(data)).toEqual([
      { timestamp: 1, requests: 10, errors: 2, errorPercent: 20 },
    ]);
  });
  it('does not turn absent, invalid or incomplete samples into zero health errors', () => {
    const data = decodePrometheus(
      matrix([
        {
          metric: { request_protocol: 'http', response_code: '200' },
          values: [
            [1, '0'],
            [2, 'NaN'],
            [3, '1'],
          ],
        },
        {
          metric: { request_protocol: 'grpc', grpc_response_status: '0' },
          values: [
            [1, '0'],
            [2, '1'],
          ],
        },
      ]),
      'matrix'
    );
    expect(requestPoints(data)).toEqual([
      { timestamp: 1, requests: 0, errors: 0, errorPercent: null },
      { timestamp: 2, requests: null, errors: null, errorPercent: null },
      { timestamp: 3, requests: null, errors: null, errorPercent: null },
    ]);
  });
  it('rejects duplicate aggregated series', () => {
    const entry = {
      metric: { request_protocol: 'http', response_code: '200' },
      values: [[1, '3']],
    };
    expect(() => requestPoints(decodePrometheus(matrix([entry, entry]), 'matrix'))).toThrow(
      'Duplicate'
    );
  });
  it('creates only observed positive edges and retains unknown identities without guessing', () => {
    const data = decodePrometheus(
      {
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                source_workload: 'client',
                destination_workload: 'server',
                request_protocol: 'http',
              },
              value: [1, '2'],
            },
            { metric: { source_workload: 'idle' }, value: [1, '0'] },
            { metric: { source_workload: 'missing' }, value: [1, 'NaN'] },
          ],
        },
      },
      'vector'
    );
    expect(trafficEdges(data)).toEqual([
      {
        source: { cluster: 'unknown', namespace: 'unknown', workload: 'client' },
        destination: { cluster: 'unknown', namespace: 'unknown', workload: 'server' },
        protocol: 'http',
        rate: 2,
      },
    ]);
  });
});
