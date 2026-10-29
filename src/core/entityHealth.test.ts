import { CORRELATION_SOURCES, decodeCorrelationResource } from '../data/correlation';
import { correlateResources } from './correlation';
import {
  applicationReplicaEvidence,
  entityHealthQueries,
  EntityHealthQuery,
  serviceHealthResource,
} from './entityHealth';
import { namespaceScope } from './scope';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));

const query: EntityHealthQuery = {
  kind: 'Application',
  name: 'reviews',
  telemetryApp: 'reviews',
  namespace: 'bookinfo',
  telemetryCluster: 'east',
  end: 10000,
};
it('uses canonical-service identity for apps and inbound Service-name identity for Services', () => {
  const app = entityHealthQueries(query);
  expect(app.inbound).toContain('destination_canonical_service="reviews"');
  expect(app.outbound).toContain('source_canonical_service="reviews"');
  expect(app.inbound).toContain('reporter="destination"');
  expect(app.outbound).toContain('reporter="source"');
  const service = entityHealthQueries({
    kind: 'Service',
    name: 'reviews',
    namespace: 'bookinfo',
    telemetryCluster: 'east',
    end: 10000,
  });
  expect(service.inbound).toContain('destination_service_name="reviews"');
  expect(service.inbound).toContain('destination_service_namespace="bookinfo"');
  expect(service.inbound).not.toContain('canonical_service');
  expect(service.outbound).toBeUndefined();
  const escaped = 'app"\\\n}';
  expect(entityHealthQueries({ ...query, telemetryApp: escaped }).inbound).toContain(
    `destination_canonical_service=${JSON.stringify(escaped)}`
  );
});
it('keeps empty application labels addressable but requires a nonempty explicit telemetry identity', () => {
  expect(entityHealthQueries({ ...query, name: '' }).inbound).toContain(
    'canonical_service="reviews"'
  );
  for (const invalid of ['', ' ', 'x'.repeat(257)])
    expect(() => entityHealthQueries({ ...query, telemetryApp: invalid })).toThrow();
  expect(() =>
    entityHealthQueries({
      kind: 'Service',
      name: '../bad',
      namespace: 'bookinfo',
      telemetryCluster: 'east',
      end: 10000,
    })
  ).toThrow();
});
it('extracts Service annotations only from the exact selected resource', () => {
  const service = {
    kind: 'Service',
    apiVersion: 'v1',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      annotations: { 'health.kiali.io/rate': '5xx,1,5,http,inbound' },
    },
    spec: { selector: { app: 'reviews' } },
  };
  expect(serviceHealthResource(service, query).annotations).toEqual(service.metadata.annotations);
  expect(() => serviceHealthResource({ ...service, kind: 'Endpoints' }, query)).toThrow(
    'does not match'
  );
  expect(() =>
    serviceHealthResource(
      { ...service, metadata: { ...service.metadata, namespace: 'other' } },
      query
    )
  ).toThrow();
});
it('uses top-level correlated controller replicas without double-counting owned ReplicaSets', () => {
  const source = (kind: string) => CORRELATION_SOURCES.find(source => source.kind === kind)!;
  const deployment = {
    metadata: { name: 'reviews-v1', namespace: 'bookinfo', uid: 'deployment', generation: 1 },
    spec: { replicas: 2, template: { metadata: { labels: { app: 'reviews' } } } },
    status: { observedGeneration: 1, replicas: 2, availableReplicas: 2 },
  };
  const replicaSet = {
    ...deployment,
    metadata: {
      name: 'reviews-rs',
      namespace: 'bookinfo',
      uid: 'rs',
      ownerReferences: [
        {
          kind: 'Deployment',
          apiVersion: 'apps/v1',
          uid: 'deployment',
          name: 'reviews-v1',
          controller: true,
        },
      ],
    },
  };
  const scope = namespaceScope('alpha', 'bookinfo');
  const resources = [
    decodeCorrelationResource(deployment, source('Deployment'), scope),
    decodeCorrelationResource(replicaSet, source('ReplicaSet'), scope),
  ];
  const app = correlateResources(resources).applications[0];
  const evidence = applicationReplicaEvidence(app);
  expect(evidence.issues).toEqual([]);
  expect(evidence.statuses).toHaveLength(1);
  expect(evidence.statuses[0].desiredReplicas).toBe(2);
  expect(resources[0].health).not.toHaveProperty('value.annotations');
  if (!resources[0].health?.ok) throw new Error('Expected collected replica state');
  resources[0].health.value.stale = true;
  expect(applicationReplicaEvidence(app).issues[0]).toContain('stale');
  expect(
    applicationReplicaEvidence({
      ...app,
      workloads: Array.from({ length: 101 }, () => app.workloads[0]),
    }).issues[0]
  ).toContain('100-workload');
});
