import {
  healthRequestRates,
  healthWorkloadPath,
  workloadHealthQueries,
  WorkloadHealthQuery,
  workloadHealthResource,
} from './workloadHealth';

const query: WorkloadHealthQuery = {
  kind: 'Deployment',
  namespace: 'bookinfo',
  name: 'reviews-v1',
  telemetryCluster: 'east',
  end: 10000,
};
const resource = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { namespace: 'bookinfo', name: 'reviews-v1', generation: 2 },
  spec: { replicas: 3 },
  status: { replicas: 3, availableReplicas: 2, readyReplicas: 3, observedGeneration: 2 },
};

it('matches upstream workload availability rather than equating ready and available replicas', () => {
  expect(workloadHealthResource(resource, query).replicas).toEqual({
    desiredReplicas: 3,
    currentReplicas: 3,
    availableReplicas: 2,
    syncedProxies: -1,
  });
  expect(
    workloadHealthResource({ ...resource, kind: 'StatefulSet' }, { ...query, kind: 'StatefulSet' })
      .replicas?.availableReplicas
  ).toBe(3);
  expect(
    workloadHealthResource(
      {
        ...resource,
        kind: 'DaemonSet',
        status: { desiredNumberScheduled: 4, currentNumberScheduled: 4, numberAvailable: 2 },
      },
      { ...query, kind: 'DaemonSet' }
    ).replicas
  ).toEqual({ desiredReplicas: 4, currentReplicas: 4, availableReplicas: 2, syncedProxies: -1 });
});
it('keeps missing replica state and stale generations explicit', () => {
  expect(workloadHealthResource({ ...resource, status: undefined }, query).replicas).toBeNull();
  expect(workloadHealthResource({ ...resource, spec: {} }, query).replicas).toBeNull();
  expect(
    workloadHealthResource(
      { ...resource, status: { ...resource.status, observedGeneration: 1 } },
      query
    ).stale
  ).toBe(true);
});
it('uses template annotations, including present empty maps, except for DaemonSet overrides', () => {
  const annotation = { 'health.kiali.io/rate': '5xx,1,5,http,inbound' };
  const annotated = {
    ...resource,
    metadata: { ...resource.metadata, annotations: annotation },
    spec: { ...resource.spec, template: { metadata: { annotations: {} } } },
  };
  expect(workloadHealthResource(annotated, query).annotations).toEqual({});
  expect(
    workloadHealthResource({ ...annotated, kind: 'DaemonSet' }, { ...query, kind: 'DaemonSet' })
      .annotations
  ).toEqual(annotation);
});
it('rejects resource identity mismatches and invalid scope before issuing requests', () => {
  expect(() =>
    workloadHealthResource(
      { ...resource, metadata: { ...resource.metadata, namespace: 'different' } },
      query
    )
  ).toThrow('does not match');
  expect(() => healthWorkloadPath({ ...query, name: '../reviews' })).toThrow();
  expect(healthWorkloadPath({ ...query, kind: 'ReplicationController' })).toBe(
    '/api/v1/namespaces/bookinfo/replicationcontrollers/reviews-v1'
  );
  expect(healthWorkloadPath({ ...query, name: 'valid.dotted.name' })).toContain(
    'valid.dotted.name'
  );
});
it('queries separate reporters with exact workload, namespace, cluster, protocol and code labels', () => {
  const queries = workloadHealthQueries(query);
  expect(queries.inbound).toContain(
    'reporter="destination",destination_workload_namespace="bookinfo",destination_cluster="east",destination_workload="reviews-v1"'
  );
  expect(queries.outbound).toContain(
    'reporter="source",source_workload_namespace="bookinfo",source_cluster="east",source_workload="reviews-v1"'
  );
  expect(queries.inbound).toContain('sum by (request_protocol,response_code,grpc_response_status)');
  expect(queries.inbound).toContain('[5m]');
});
it('preserves no-response codes and gRPC statuses and sums duplicate code buckets safely', () => {
  const series = [
    {
      labels: { request_protocol: 'http', response_code: '-' },
      samples: [{ timestamp: 10000, value: 1 }],
    },
    {
      labels: { request_protocol: 'http', response_code: '-' },
      samples: [{ timestamp: 10000, value: 2 }],
    },
    {
      labels: { request_protocol: 'grpc', response_code: '200', grpc_response_status: '14' },
      samples: [{ timestamp: 10000, value: 3 }],
    },
  ];
  expect(healthRequestRates({ series, warnings: [] })).toEqual({
    http: { '-': 3 },
    grpc: { '14': 3 },
  });
  expect(() =>
    healthRequestRates({
      series: [{ ...series[0], samples: [{ timestamp: 10000, value: null }] }],
      warnings: [],
    })
  ).toThrow();
  expect(() =>
    healthRequestRates({
      series: [{ ...series[0], labels: { request_protocol: 'grpc' } }],
      warnings: [],
    })
  ).toThrow();
});
