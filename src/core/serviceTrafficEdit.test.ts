import { initialHttpMatchEdit } from './httpMatchEditing';
import { editableHttpRoutes, initialHttpBehavior } from './httpRouteBehavior';
import { routingService } from './serviceTraffic';
import type { ServiceRoutingCapture } from './serviceTrafficEdit';
import {
  initialServiceTrafficEditDraft,
  planServiceTrafficEdit,
  serviceTrafficEditContext,
} from './serviceTrafficEdit';

const service = routingService(
  {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'service-uid',
      resourceVersion: '12',
    },
    spec: {
      selector: { app: 'reviews' },
      ports: [{ name: 'http', port: 9080, protocol: 'TCP' }],
    },
  },
  'alpha',
  'bookinfo',
  'reviews'
);
const host = 'reviews.bookinfo.svc.cluster.local';
const destinationRule: ServiceRoutingCapture = {
  kind: 'DestinationRule',
  apiVersion: 'networking.istio.io/v1',
  namespace: 'bookinfo',
  name: 'reviews-routing',
  object: {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      name: 'reviews-routing',
      namespace: 'bookinfo',
      uid: 'dr-uid',
      resourceVersion: '4',
      labels: { owned: 'yes' },
    },
    spec: {
      host,
      exportTo: ['.'],
      subsets: [
        { name: 'blue', labels: { version: 'v1' } },
        { name: 'green', labels: { version: 'v2' } },
        { name: 'unrelated', labels: { track: 'experimental' } },
      ],
      trafficPolicy: {
        connectionPool: { tcp: { maxConnections: 5, idleTimeout: '30s' } },
        loadBalancer: { simple: 'RANDOM', futureField: 'keep' },
        tls: { mode: 'ISTIO_MUTUAL' },
        futurePolicy: { enabled: true },
      },
      futureSpecField: ['preserve'],
    },
  },
};
const virtualService: ServiceRoutingCapture = {
  kind: 'VirtualService',
  apiVersion: 'networking.istio.io/v1',
  namespace: 'bookinfo',
  name: 'reviews-routing',
  object: {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews-routing',
      namespace: 'bookinfo',
      uid: 'vs-uid',
      resourceVersion: '7',
      annotations: { retained: 'yes' },
    },
    spec: {
      hosts: [host],
      gateways: ['mesh'],
      exportTo: ['.'],
      http: [
        {
          name: 'weighted',
          match: [
            { headers: { 'x-user': { exact: 'tester' } }, uri: { prefix: '/reviews' } },
            { method: { exact: 'GET' } },
          ],
          route: [
            { destination: { host, subset: 'blue', port: { number: 9080 } }, weight: 70 },
            { destination: { host, subset: 'green', port: { number: 9080 } }, weight: 30 },
          ],
          mirror: { host, subset: 'green', port: { number: 9080 } },
          mirrorPercentage: { value: 5 },
          timeout: '3s',
          headers: { request: { add: { 'x-review': 'preserve' } } },
          futureRouteField: { keep: true },
        },
        {
          name: 'unrelated',
          route: [{ destination: { host: 'ratings.bookinfo.svc.cluster.local' } }],
        },
      ],
      futureSpecField: 'preserve',
    },
  },
};
const versions = [
  { value: 'v1', subset: 'v1', workloads: ['Deployment/reviews-v1'], weight: 50 },
  { value: 'v2', subset: 'v2', workloads: ['Deployment/reviews-v2'], weight: 50 },
];

function context(resources: ServiceRoutingCapture[] = [destinationRule, virtualService]) {
  return serviceTrafficEditContext(service, 'svc.cluster.local', 'version', versions, resources);
}

it('composes existing route and DestinationRule changes without mutating unrelated fields or captures', () => {
  const before = JSON.stringify([destinationRule.object, virtualService.object]);
  const selected = context();
  const draft = initialServiceTrafficEditDraft(selected, service);
  draft.subsets[0].weight = 40;
  draft.subsets[1].weight = 60;
  draft.circuitBreaker = {
    ...draft.circuitBreaker!,
    connectionPoolMode: 'set',
    maxConnections: '12',
  };
  draft.httpMatchEdit = {
    ...initialHttpMatchEdit(
      editableHttpRoutes(virtualService.object.spec).find(route => route.index === 0)
    ),
    mode: 'set',
    condition: {
      field: 'uri',
      header: '',
      operator: 'prefix',
      value: '/new-reviews',
    },
  };
  draft.httpBehavior = {
    ...initialHttpBehavior(
      editableHttpRoutes(virtualService.object.spec).find(route => route.index === 0)
    ),
    retryMode: 'set',
    attempts: '4',
  };

  const planned = planServiceTrafficEdit(selected, draft);
  const nextRule = planned.destinationRule!;
  const nextService = planned.virtualService!;
  const currentRule = destinationRule.object.spec as Record<string, unknown>;
  const currentService = virtualService.object.spec as Record<string, unknown>;
  const originalHttp = (currentService.http as Record<string, unknown>[])[0];
  const originalRoutes = originalHttp.route as Record<string, unknown>[];
  const nextHttp = nextService.http as Record<string, unknown>[];

  expect(nextRule).toMatchObject({
    host,
    exportTo: ['.'],
    subsets: currentRule.subsets,
    futureSpecField: ['preserve'],
    trafficPolicy: {
      connectionPool: { tcp: { maxConnections: 12, idleTimeout: '30s' } },
      loadBalancer: { simple: 'RANDOM', futureField: 'keep' },
      tls: { mode: 'ISTIO_MUTUAL' },
      futurePolicy: { enabled: true },
    },
  });
  expect(nextService).toMatchObject({
    hosts: [host],
    gateways: ['mesh'],
    exportTo: ['.'],
    futureSpecField: 'preserve',
    http: [
      {
        ...originalHttp,
        match: [
          { headers: { 'x-user': { exact: 'tester' } }, uri: { prefix: '/new-reviews' } },
          { method: { exact: 'GET' } },
        ],
        route: [
          { ...originalRoutes[0], weight: 40 },
          { ...originalRoutes[1], weight: 60 },
        ],
        retries: { attempts: 4, retryOn: 'gateway-error,connect-failure,refused-stream' },
      },
      (currentService.http as Record<string, unknown>[])[1],
    ],
  });
  expect(nextHttp[0]).toHaveProperty('mirror', originalHttp.mirror);
  expect(nextHttp[0]).toHaveProperty('mirrorPercentage', { value: 5 });
  expect(JSON.stringify([destinationRule.object, virtualService.object])).toBe(before);
});

it('rejects ambiguous targets, unsupported gateway/VM shapes and removal of the final match predicate', () => {
  expect(() => context([destinationRule])).toThrow('exactly one existing');
  expect(() => context([destinationRule, virtualService, virtualService])).toThrow('exactly one');
  const gateway = structuredClone(virtualService);
  (gateway.object.spec as Record<string, unknown>).gateways = ['bookinfo/public'];
  expect(() => context([destinationRule, gateway])).toThrow('attached to gateways');
  const multiHost = structuredClone(virtualService);
  (multiHost.object.spec as Record<string, unknown>).hosts = [
    host,
    'ratings.bookinfo.svc.cluster.local',
  ];
  expect(() => context([destinationRule, multiHost])).toThrow(
    'exact, namespace-local Service host'
  );

  const selected = context();
  const draft = initialServiceTrafficEditDraft(selected, service);
  draft.httpMatchEdit = {
    ...draft.httpMatchEdit!,
    matchIndex: 1,
    mode: 'remove',
    condition: { field: 'method', header: '', operator: 'exact', value: 'GET' },
  };
  expect(() => planServiceTrafficEdit(selected, draft)).toThrow('unconditional alternative');
});

it('edits an existing TCP Service route without touching HTTP routes or unrelated VirtualService fields', () => {
  const tcp = structuredClone(virtualService);
  const spec = tcp.object.spec as Record<string, unknown>;
  spec.http = [{ route: [{ destination: { host: 'ratings.bookinfo.svc.cluster.local' } }] }];
  spec.tcp = [
    {
      match: [{ port: 9080 }],
      route: [
        { destination: { host, subset: 'blue' }, weight: 80 },
        { destination: { host, subset: 'green' }, weight: 20 },
      ],
      futureRouteField: 'preserve',
    },
  ];
  const selected = context([destinationRule, tcp]);
  const draft = initialServiceTrafficEditDraft(selected, service);
  draft.subsets[0].weight = 10;
  draft.subsets[1].weight = 90;
  const planned = planServiceTrafficEdit(selected, draft);

  expect(planned.destinationRule).toBeUndefined();
  expect(planned.virtualService).toMatchObject({
    hosts: [host],
    gateways: ['mesh'],
    http: spec.http,
    tcp: [
      {
        match: [{ port: 9080 }],
        route: [
          { destination: { host, subset: 'blue' }, weight: 10 },
          { destination: { host, subset: 'green' }, weight: 90 },
        ],
        futureRouteField: 'preserve',
      },
    ],
  });
});

it('rejects ambiguous routes, unobserved subset mappings and missing resource versions before mutation', () => {
  const multiple = structuredClone(virtualService);
  const multipleSpec = multiple.object.spec as Record<string, unknown>;
  (multipleSpec.http as Record<string, unknown>[]).push({
    route: [{ destination: { host, subset: 'blue' }, weight: 100 }],
  });
  expect(() => context([destinationRule, multiple])).toThrow('More than one route');

  const unknown = structuredClone(virtualService);
  const unknownSpec = unknown.object.spec as Record<string, unknown>;
  const unknownRoute = (
    (unknownSpec.http as Record<string, unknown>[])[0].route as Record<string, unknown>[]
  )[0];
  (unknownRoute.destination as Record<string, unknown>).subset = 'unknown';
  expect(() => context([destinationRule, unknown])).toThrow('no observed Service version');

  const stale = structuredClone(destinationRule);
  (stale.object.metadata as Record<string, unknown>).resourceVersion = '';
  expect(() => context([stale, virtualService])).toThrow('identity or version is incomplete');
});
