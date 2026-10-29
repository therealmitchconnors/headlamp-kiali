import type { DestinationRuleSpec, VirtualServiceSpec } from '../resources/schema-types';
import { circuitBreakerChanges, CircuitBreakerDraft } from './circuitBreaker';
import { ServiceRelations } from './correlation';
import { buildHttpMatches, HttpMatchCondition } from './httpMatches';
import { mirrorTarget } from './httpMirroring';
import { HttpBehaviorDraft, planHttpBehavior } from './httpRouteBehavior';
import { isLabelKey } from './labels';
import { loadBalancerChange, LoadBalancerDraft } from './loadBalancer';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import { outboundTlsChange, OutboundTlsDraft } from './outboundTls';
import { planTrafficWeights } from './trafficWeights';

export interface RoutingService {
  cluster: string;
  namespace: string;
  name: string;
  uid: string;
  resourceVersion: string;
  selector: Record<string, string>;
  ports: { port: number; name?: string; protocol: string }[];
}
export interface ServiceVersion {
  value: string;
  workloads: string[];
  subset: string;
  weight: number;
}
export interface ServiceTrafficDraft {
  destinationRuleName: string;
  virtualServiceName: string;
  protocol?: 'http' | 'tcp';
  port: number;
  subsets: { name: string; version: string; weight: number }[];
  circuitBreaker?: CircuitBreakerDraft;
  loadBalancer?: LoadBalancerDraft;
  mirror?: { version: string; percentage: string };
  outboundTls?: OutboundTlsDraft;
  httpBehavior?: HttpBehaviorDraft;
  httpMatches?: HttpMatchCondition[];
}

export function routingService(
  value: unknown,
  cluster: string,
  namespace: string,
  name: string
): RoutingService {
  if (
    !cluster ||
    !isDnsLabel(namespace) ||
    !isDnsLabel(name) ||
    !isRecord(value) ||
    value.kind !== 'Service' ||
    value.apiVersion !== 'v1' ||
    !isRecord(value.metadata) ||
    value.metadata.name !== name ||
    value.metadata.namespace !== namespace ||
    typeof value.metadata.uid !== 'string' ||
    !value.metadata.uid ||
    typeof value.metadata.resourceVersion !== 'string' ||
    !value.metadata.resourceVersion ||
    !isRecord(value.spec) ||
    !isRecord(value.spec.selector) ||
    !Object.keys(value.spec.selector).length ||
    value.spec.type === 'ExternalName' ||
    Object.entries(value.spec.selector).some(
      ([key, value]) => !isLabelKey(key) || typeof value !== 'string'
    ) ||
    !Array.isArray(value.spec.ports) ||
    value.spec.ports.length > 100
  )
    throw new Error(
      'A named, versioned Service with a valid nonempty selector and ports is required'
    );
  const ports = value.spec.ports.map(port => {
    if (
      !isRecord(port) ||
      typeof port.port !== 'number' ||
      !Number.isInteger(port.port) ||
      port.port < 1 ||
      port.port > 65535 ||
      (port.protocol !== undefined && !['TCP', 'UDP', 'SCTP'].includes(String(port.protocol))) ||
      (port.name !== undefined && typeof port.name !== 'string')
    )
      throw new Error('Invalid Service port');
    return {
      port: port.port,
      protocol: typeof port.protocol === 'string' ? port.protocol : 'TCP',
      ...(typeof port.name === 'string' ? { name: port.name } : {}),
    };
  });
  if (!ports.some(port => port.protocol === 'TCP'))
    throw new Error('Traffic routing requires a TCP Service port');
  return {
    cluster,
    namespace,
    name,
    uid: value.metadata.uid,
    resourceVersion: value.metadata.resourceVersion,
    selector: Object.fromEntries(
      Object.entries(value.spec.selector).map(([key, value]) => [key, String(value)])
    ),
    ports,
  };
}

export function serviceTrafficVersions(
  relation: ServiceRelations,
  requestedLabel?: string
): {
  label: string;
  versions: ServiceVersion[];
} {
  if (!relation.workloads.length || relation.workloads.length > 100)
    throw new Error('Traffic creation requires between 1 and 100 observed Service workloads');
  if (relation.workloads.some(workload => workload.identity.kind === 'WorkloadGroup'))
    throw new Error(
      'VM WorkloadGroup traffic creation requires per-entry version evidence and is not supported by this wizard'
    );
  const keys = new Set(
    relation.workloads.map(workload => workload.version?.key).filter((key): key is string => !!key)
  );
  const label = requestedLabel || (keys.size === 1 ? [...keys][0] : '');
  if (!isLabelKey(label))
    throw new Error('Choose an explicit version label shared by the Service workloads');
  const values = new Map<string, string[]>();
  const weights = new Map<string, number>();
  const perWorkload = Math.floor(100 / relation.workloads.length);
  for (const [index, workload] of relation.workloads.entries()) {
    const labels = workload.resource.workloadLabels;
    if (!Object.prototype.hasOwnProperty.call(labels, label))
      throw new Error(
        `${workload.identity.kind}/${workload.identity.name} does not have version label ${label}`
      );
    const version = labels[label];
    values.set(version, [
      ...(values.get(version) ?? []),
      `${workload.identity.kind}/${workload.identity.name}`,
    ]);
    weights.set(
      version,
      (weights.get(version) ?? 0) +
        perWorkload +
        (index === relation.workloads.length - 1 ? 100 % relation.workloads.length : 0)
    );
  }
  if (values.size > 20) throw new Error('Traffic creation supports at most 20 distinct versions');
  const ordered = [...values].sort(([a], [b]) => a.localeCompare(b));
  return {
    label,
    versions: ordered.map(([value, workloads]) => ({
      value,
      workloads,
      subset: isDnsLabel(value) ? value : '',
      weight: weights.get(value)!,
    })),
  };
}

export function serviceTrafficPlan(
  service: RoutingService,
  identityDomain: string,
  label: string,
  observed: readonly ServiceVersion[],
  draft: ServiceTrafficDraft
): {
  destinationRule: DestinationRuleSpec;
  virtualService: Record<string, unknown>;
  host: string;
} {
  const protocol = draft.protocol === undefined ? 'http' : draft.protocol;
  if (protocol !== 'http' && protocol !== 'tcp') throw new Error('Choose HTTP/gRPC or TCP routing');
  const matches = buildHttpMatches(draft.httpMatches === undefined ? [] : draft.httpMatches);
  if (protocol !== 'http' && matches.length)
    throw new Error('Remove HTTP request conditions before reviewing TCP routing');
  if (protocol === 'tcp' && draft.mirror)
    throw new Error(
      'Remove the mirrored version before reviewing TCP routing; request mirroring requires HTTP/gRPC'
    );
  if (
    protocol === 'tcp' &&
    draft.loadBalancer?.mode === 'set' &&
    (draft.loadBalancer.strategy === 'header' || draft.loadBalancer.strategy === 'cookie')
  )
    throw new Error(
      'TCP routing cannot use HTTP header or cookie affinity; choose a simple algorithm or source IP affinity'
    );
  if (
    !isDnsSubdomain(identityDomain) ||
    !isLabelKey(label) ||
    !isDnsSubdomain(draft.destinationRuleName) ||
    !isDnsSubdomain(draft.virtualServiceName)
  )
    throw new Error(
      'Valid configuration names, version label and explicit Service DNS suffix are required'
    );
  if (!service.ports.some(port => port.port === draft.port && port.protocol === 'TCP'))
    throw new Error('Choose an observed TCP Service port for routing');
  if (
    !draft.subsets.length ||
    draft.subsets.length > 20 ||
    draft.subsets.some(
      subset =>
        !isDnsLabel(subset.name) || !observed.some(version => version.value === subset.version)
    ) ||
    new Set(draft.subsets.map(subset => subset.name)).size !== draft.subsets.length ||
    new Set(draft.subsets.map(subset => subset.version)).size !== draft.subsets.length
  )
    throw new Error('Choose 1 to 20 distinct observed versions with unique DNS-label subset names');
  const host = `${service.name}.${service.namespace}.${identityDomain}`;
  if (!isDnsSubdomain(host)) throw new Error('The fully qualified Service host exceeds DNS limits');
  const mirrored = draft.mirror
    ? draft.subsets.find(subset => subset.version === draft.mirror?.version)
    : undefined;
  if (draft.mirror && !mirrored) throw new Error('Choose an observed subset version for mirroring');
  const forwarding = draft.subsets.filter(subset => subset !== mirrored);
  if (!forwarding.length)
    throw new Error('Mirroring requires at least one other forwarding version');
  const destinationRule: DestinationRuleSpec = {
    host,
    exportTo: ['.'],
    subsets: draft.subsets.map(subset => ({
      name: subset.name,
      labels: { [label]: subset.version },
    })),
  };
  const trafficPolicy: NonNullable<DestinationRuleSpec['trafficPolicy']> = {};
  if (draft.circuitBreaker) {
    const changes = circuitBreakerChanges(draft.circuitBreaker);
    if (changes.connectionPool) trafficPolicy.connectionPool = changes.connectionPool;
    if (changes.outlierDetection) trafficPolicy.outlierDetection = changes.outlierDetection;
  }
  if (draft.loadBalancer) {
    const change = loadBalancerChange(draft.loadBalancer);
    if (change) trafficPolicy.loadBalancer = change;
  }
  if (draft.outboundTls) {
    const change = outboundTlsChange(draft.outboundTls);
    if (change) trafficPolicy.tls = change;
  }
  if (Object.keys(trafficPolicy).length) destinationRule.trafficPolicy = trafficPolicy;
  const base: VirtualServiceSpec = {
    hosts: [host],
    gateways: ['mesh'],
    exportTo: ['.'],
    [protocol]: [
      {
        match: matches.length
          ? matches.map(match => ({ ...match, port: draft.port }))
          : [{ port: draft.port }],
        route: forwarding.map(subset => ({
          destination: { host, subset: subset.name, port: { number: draft.port } },
        })),
        ...(mirrored && draft.mirror
          ? mirrorTarget({
              host,
              subset: mirrored.name,
              port: String(draft.port),
              percentage: draft.mirror.percentage,
            })
          : {}),
      },
    ],
  };
  let virtualService = planTrafficWeights(
    base,
    `${protocol}:0`,
    forwarding.map(subset => subset.weight)
  ).spec;
  if (
    draft.httpBehavior &&
    [
      draft.httpBehavior.timeoutMode,
      draft.httpBehavior.retryMode,
      draft.httpBehavior.delayMode,
      draft.httpBehavior.abortMode,
    ].some(mode => mode !== 'keep')
  ) {
    if (protocol !== 'http')
      throw new Error(
        'Exclude HTTP timeout, retry and fault settings before reviewing TCP routing'
      );
    virtualService = planHttpBehavior(virtualService, draft.httpBehavior).spec;
  }
  return { destinationRule, virtualService, host };
}
