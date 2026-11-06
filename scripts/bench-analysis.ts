import { cpus } from 'node:os';
import { correlateResources, CorrelationKind, CorrelationResource } from '../src/core/correlation';
import { virtualServiceHostConflicts } from '../src/core/virtualServiceConflicts';
import { metricChartPoints } from '../src/core/chartDisplay';
import { projectTopology, TopologyObservation, TopologyObservations } from '../src/core/topology';
import { MetricResult } from '../src/core/telemetry';

const resource = (
  kind: CorrelationKind,
  name: string,
  labels: Record<string, string>,
  overrides: Partial<CorrelationResource> = {}
): CorrelationResource => ({
  identity: {
    cluster: 'bench',
    namespace: 'analysis',
    group: kind === 'Pod' || kind === 'Service' ? '' : 'apps',
    kind,
    name,
    uid: `${kind}:${name}`,
  },
  labels,
  workloadLabels: labels,
  owners: [],
  serviceSelector: null,
  proxyMode: 'none',
  ...overrides,
});

function measure<T>(name: string, dimensions: Record<string, number>, run: () => T) {
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  try {
    const result = run();
    return {
      name,
      dimensions,
      outcome: 'accepted',
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      retainedHeapDeltaBytes: process.memoryUsage().heapUsed - before,
      output: result,
    };
  } catch (error) {
    return {
      name,
      dimensions,
      outcome: 'rejected',
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      retainedHeapDeltaBytes: process.memoryUsage().heapUsed - before,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const resources: CorrelationResource[] = [];
for (let index = 0; index < 1000; index++) {
  const deployment = resource('Deployment', `deployment-${index}`, { shared: 'yes' });
  resources.push(deployment);
  resources.push(
    resource(
      'Pod',
      `pod-${index}`,
      { shared: 'yes' },
      { owners: [{ ...deployment.identity, controller: true }] }
    )
  );
  resources.push(
    resource(
      'Service',
      `service-${index}`,
      { shared: 'yes' },
      { serviceSelector: { shared: 'yes' } }
    )
  );
}

const graphObservations: TopologyObservation[] = [];
for (let source = 0; source < 500; source++) {
  for (let offset = 0; offset < 4; offset++) {
    const observation: TopologyObservation = {
      source: {
        cluster: 'bench',
        namespace: 'analysis',
        workload: `source-${source}`,
        app: 'bench',
        version: 'v1',
        serviceNamespace: 'analysis',
        service: '',
      },
      destination: {
        cluster: 'bench',
        namespace: 'analysis',
        workload: `destination-${(source * 4 + offset) % 500}`,
        app: 'bench',
        version: 'v1',
        serviceNamespace: 'analysis',
        service: '',
      },
      protocol: 'http',
      metric: 'istio_requests_total',
      rate: 1,
      code: '200',
      responseFlags: '-',
      security: 'mutual_tls',
      host: 'bench.analysis.svc.cluster.local',
    };
    graphObservations.push(observation, { ...observation });
  }
}
const graphInput: TopologyObservations = { observations: graphObservations, warnings: [] };

const virtualServices = [
  {
    name: 'selected',
    namespace: 'analysis',
    spec: { hosts: Array(100).fill('reviews'), gateways: Array(100).fill('mesh') },
  },
  {
    name: 'peer',
    namespace: 'analysis',
    spec: { hosts: Array(100).fill('reviews'), gateways: Array(100).fill('mesh') },
  },
];

const chart: MetricResult = {
  warnings: [],
  series: [
    {
      labels: {},
      samples: Array.from({ length: 100_000 }, (_, index) => ({
        timestamp: index,
        value: index,
      })),
    },
  ],
};

const cappedResources = [
  ...resources.filter(item => item.identity.kind !== 'Service'),
  ...resources.filter(item => item.identity.kind === 'Service').slice(0, 10),
];

const results = [
  measure(
    'correlation-dense-service-selectors-at-budget',
    {
      deployments: 1000,
      pods: 1000,
      services: 10,
      serviceRelationMatchBudget: 20_000,
      expectedReverseServiceLinks: 10_000,
    },
    () => {
      const result = correlateResources(cappedResources);
      return {
        services: result.serviceRelations.length,
        serviceWorkloadMatches: result.serviceRelations.reduce(
          (sum, relation) => sum + relation.workloads.length,
          0
        ),
        servicePodMatches: result.serviceRelations.reduce(
          (sum, relation) => sum + relation.pods.length,
          0
        ),
        reverseServiceLinks: result.workloads.reduce(
          (sum, workload) => sum + workload.services.length,
          0
        ),
      };
    }
  ),
  measure(
    'correlation-dense-service-selectors-over-budget',
    {
      deployments: 1000,
      pods: 1000,
      services: 1000,
      expectedServiceRelationMatches: 2_000_000,
      serviceRelationMatchBudget: 20_000,
    },
    () => correlateResources(resources).serviceRelations.length
  ),
  measure(
    'topology-near-projection-limits',
    {
      observations: 4000,
      observationBudget: 4000,
      distinctEdges: 2000,
      edgeBudget: 2000,
      distinctNodes: 1000,
      nodeBudget: 1000,
    },
    () => {
      const graph = projectTopology(graphInput, 'workload');
      return {
        observations: graphInput.observations.length,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      };
    }
  ),
  measure(
    'virtual-service-host-gateway-product',
    {
      records: 2,
      hostsPerRecord: 100,
      gatewaysPerRecord: 100,
      contributions: 20_000,
      contributionBudget: 20_000,
    },
    () => virtualServiceHostConflicts(virtualServices, ['analysis'], 'svc.cluster.local', 0)
  ),
  measure(
    'metric-chart-over-render-budget',
    { series: chart.series.length, samples: 100_000, chartPointBudget: 1928 },
    () => metricChartPoints(chart).length
  ),
];

console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: cpus().length,
      },
      measurements:
        'single local run; observational only, no wall-clock assertions; retained heap delta is not peak allocation and may be affected by garbage collection',
      results,
    },
    null,
    2
  )
);
