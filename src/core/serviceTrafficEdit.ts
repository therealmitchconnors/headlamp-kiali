import { circuitBreakerChanges, initialCircuitBreaker, planCircuitBreaker } from './circuitBreaker';
import { initialHttpMatchEdit, planHttpMatchEdit } from './httpMatchEditing';
import { initialHttpMirroring, planHttpMirroring } from './httpMirroring';
import { editableHttpRoutes, initialHttpBehavior, planHttpBehavior } from './httpRouteBehavior';
import { initialLoadBalancer, loadBalancerChange, planLoadBalancer } from './loadBalancer';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import { initialOutboundTls, outboundTlsChange, planOutboundTls } from './outboundTls';
import type { RoutingService, ServiceTrafficDraft, ServiceVersion } from './serviceTraffic';
import type { WeightedRoute } from './trafficWeights';
import { planTrafficWeights, weightedRoutes } from './trafficWeights';

export interface ServiceRoutingCapture {
  kind: 'DestinationRule' | 'VirtualService';
  apiVersion: string;
  namespace: string;
  name: string;
  object: Record<string, unknown>;
}

export interface ServiceTrafficEditContext {
  destinationRule: ServiceRoutingCapture;
  virtualService: ServiceRoutingCapture;
  host: string;
  servicePorts: number[];
  route: WeightedRoute;
  routeValue: Record<string, unknown>;
  routeVersions: { version: ServiceVersion; subset: string; weight: number }[];
}

function capturedResource(
  resource: ServiceRoutingCapture,
  kind: ServiceRoutingCapture['kind'],
  service: RoutingService
) {
  const { object } = resource;
  const metadata = object.metadata;
  if (
    resource.kind !== kind ||
    resource.apiVersion !== 'networking.istio.io/v1' ||
    resource.namespace !== service.namespace ||
    !isRecord(metadata) ||
    metadata.name !== resource.name ||
    metadata.namespace !== service.namespace ||
    typeof metadata.uid !== 'string' ||
    !metadata.uid ||
    typeof metadata.resourceVersion !== 'string' ||
    !metadata.resourceVersion ||
    object.kind !== kind ||
    object.apiVersion !== resource.apiVersion ||
    !isRecord(object.spec)
  )
    throw new Error(`The existing ${kind} identity or version is incomplete`);
  return object.spec;
}

export function serviceTrafficEditContext(
  service: RoutingService,
  identityDomain: string,
  versionLabel: string,
  versions: readonly ServiceVersion[],
  resources: readonly ServiceRoutingCapture[]
): ServiceTrafficEditContext {
  if (resources.length !== 2)
    throw new Error(
      'Editing requires exactly one existing DestinationRule and one existing VirtualService; mixed create/update is not supported'
    );
  const destinationRules = resources.filter(resource => resource.kind === 'DestinationRule');
  const virtualServices = resources.filter(resource => resource.kind === 'VirtualService');
  if (destinationRules.length !== 1 || virtualServices.length !== 1)
    throw new Error(
      'Existing routing is ambiguous; exactly one DestinationRule and one VirtualService must match this Service'
    );
  const destinationRule = destinationRules[0];
  const virtualService = virtualServices[0];
  const destinationRuleSpec = capturedResource(destinationRule, 'DestinationRule', service);
  const virtualServiceSpec = capturedResource(virtualService, 'VirtualService', service);
  const host = `${service.name}.${service.namespace}.${identityDomain}`;
  if (
    !isDnsSubdomain(identityDomain) ||
    !versionLabel ||
    destinationRuleSpec.host !== host ||
    !Array.isArray(virtualServiceSpec.hosts) ||
    virtualServiceSpec.hosts.length !== 1 ||
    virtualServiceSpec.hosts[0] !== host
  )
    throw new Error('Only an exact, namespace-local Service host can be edited by this workflow');
  const gateways = virtualServiceSpec.gateways;
  if (
    gateways !== undefined &&
    gateways !== null &&
    (!Array.isArray(gateways) || gateways.some(gateway => gateway !== 'mesh'))
  )
    throw new Error('VirtualServices attached to gateways are outside this Service workflow');
  if (!Array.isArray(destinationRuleSpec.subsets) || destinationRuleSpec.subsets.length > 100)
    throw new Error(
      'The existing DestinationRule subsets are unavailable or exceed the edit limit'
    );

  const versionsByValue = new Map(versions.map(version => [version.value, version]));
  const versionsBySubset = new Map<string, ServiceVersion>();
  const subsetByVersion = new Map<string, string>();
  for (const subset of destinationRuleSpec.subsets) {
    if (!isRecord(subset) || !isRecord(subset.labels)) continue;
    const name = subset.name;
    const version = subset.labels[versionLabel];
    if (!isDnsLabel(name) || typeof version !== 'string' || !versionsByValue.has(version)) continue;
    if (versionsBySubset.has(name) || subsetByVersion.has(version))
      throw new Error('The existing DestinationRule has ambiguous Service version subsets');
    versionsBySubset.set(name, versionsByValue.get(version)!);
    subsetByVersion.set(version, name);
  }

  const spec = virtualServiceSpec;
  if (spec.tls !== undefined && spec.tls !== null && (!Array.isArray(spec.tls) || spec.tls.length))
    throw new Error('TLS VirtualService routes are outside this Service workflow');
  const routes = weightedRoutes(spec);
  const serviceRoutes = routes.filter(route =>
    route.destinations.some(destination => destination.host === host)
  );
  if (serviceRoutes.length !== 1)
    throw new Error(
      serviceRoutes.length
        ? 'More than one route targets this Service; select a route in the configuration editor'
        : 'No weighted HTTP or TCP route targets this Service'
    );
  const route = serviceRoutes[0];
  if (route.protocol !== 'http' && route.protocol !== 'tcp')
    throw new Error('Only existing HTTP and TCP Service routes can be edited here');
  const routeVersions = route.destinations.map(destination => {
    if (destination.host !== host || !destination.subset) {
      throw new Error('Every selected route destination must use a known Service subset');
    }
    const version = versionsBySubset.get(destination.subset);
    if (!version) throw new Error('A selected route subset has no observed Service version');
    return {
      version,
      subset: destination.subset,
      weight: destination.weight ?? (route.destinations.length === 1 ? 100 : 0),
    };
  });
  if (
    routeVersions.length !== route.destinations.length ||
    new Set(routeVersions.map(item => item.version.value)).size !== routeVersions.length
  )
    throw new Error('Selected route destinations do not map one-to-one to Service versions');
  const rules = spec[route.protocol];
  if (!Array.isArray(rules) || !isRecord(rules[route.index]))
    throw new Error('The selected Service route is malformed');
  return {
    destinationRule,
    virtualService,
    host,
    servicePorts: service.ports.filter(port => port.protocol === 'TCP').map(port => port.port),
    route,
    routeValue: rules[route.index],
    routeVersions,
  };
}

export function initialServiceTrafficEditDraft(
  context: ServiceTrafficEditContext,
  service: RoutingService
): ServiceTrafficDraft {
  const tcpPort = service.ports.find(port => port.protocol === 'TCP')!.port;
  const destinationRuleSpec = context.destinationRule.object.spec;
  const httpRoute = editableHttpRoutes(context.virtualService.object.spec).find(
    route => route.index === context.route.index
  );
  const mirroring = initialHttpMirroring(httpRoute);
  return {
    destinationRuleName: context.destinationRule.name,
    virtualServiceName: context.virtualService.name,
    protocol: context.route.protocol === 'tcp' ? 'tcp' : 'http',
    port: tcpPort,
    subsets: context.routeVersions.map(({ version, subset, weight }) => ({
      name: subset,
      version: version.value,
      workloads: version.workloads,
      weight,
    })),
    circuitBreaker: initialCircuitBreaker(destinationRuleSpec),
    loadBalancer: initialLoadBalancer(destinationRuleSpec),
    outboundTls: initialOutboundTls(destinationRuleSpec),
    httpBehavior: context.route.protocol === 'http' ? initialHttpBehavior(httpRoute) : undefined,
    httpMatchEdit: context.route.protocol === 'http' ? initialHttpMatchEdit(httpRoute) : undefined,
    httpMirroring:
      context.route.protocol === 'http'
        ? {
            ...mirroring,
            host: mirroring.host || context.host,
            subset: mirroring.subset || context.routeVersions[0].subset,
          }
        : undefined,
  };
}

export function planServiceTrafficEdit(
  context: ServiceTrafficEditContext,
  draft: ServiceTrafficDraft
): { destinationRule?: Record<string, unknown>; virtualService?: Record<string, unknown> } {
  if (draft.protocol !== context.route.protocol)
    throw new Error('The selected route protocol cannot be changed while editing');
  if (draft.subsets.length !== context.routeVersions.length)
    throw new Error('The selected route destination set changed; reload before editing');
  for (const [index, subset] of draft.subsets.entries()) {
    const expected = context.routeVersions[index];
    if (subset.name !== expected.subset || subset.version !== expected.version.value)
      throw new Error('Service routing targets cannot be renamed while editing existing resources');
  }
  const originalDestinationRule = context.destinationRule.object.spec as Record<string, unknown>;
  let destinationRule = { ...originalDestinationRule };
  const circuitBreaker = draft.circuitBreaker;
  if (circuitBreaker && Object.keys(circuitBreakerChanges(circuitBreaker)).length)
    destinationRule = planCircuitBreaker(destinationRule, circuitBreaker).spec;
  const loadBalancer = draft.loadBalancer;
  if (loadBalancer && loadBalancerChange(loadBalancer) !== undefined)
    destinationRule = planLoadBalancer(destinationRule, loadBalancer).spec;
  const outboundTls = draft.outboundTls;
  if (outboundTls && outboundTlsChange(outboundTls) !== undefined)
    destinationRule = planOutboundTls(destinationRule, outboundTls).spec;

  const originalVirtualService = context.virtualService.object.spec as Record<string, unknown>;
  let virtualService = planTrafficWeights(
    originalVirtualService,
    context.route.key,
    draft.subsets.map(subset => subset.weight)
  ).spec;
  if (draft.httpMatchEdit && draft.httpMatchEdit.mode !== 'keep') {
    if (draft.httpMatchEdit.routeIndex !== context.route.index)
      throw new Error('HTTP match editing must remain on the selected Service route');
    virtualService = planHttpMatchEdit(virtualService, draft.httpMatchEdit).spec;
  }
  if (draft.httpMirroring && draft.httpMirroring.mode !== 'keep') {
    if (context.route.protocol !== 'http')
      throw new Error('HTTP mirroring cannot be applied to a TCP route');
    if (draft.httpMirroring.routeIndex !== context.route.index)
      throw new Error('HTTP mirroring must remain on the selected Service route');
    if (
      draft.httpMirroring.mode === 'set' &&
      (draft.httpMirroring.host !== context.host ||
        !context.routeVersions.some(item => item.subset === draft.httpMirroring?.subset) ||
        (draft.httpMirroring.port !== '' &&
          !context.servicePorts.includes(Number(draft.httpMirroring.port))))
    )
      throw new Error('Mirroring must target an observed subset and TCP port of this Service');
    if (
      ['mirrors', 'mirrorPercent', 'mirror_percent'].some(key =>
        Object.prototype.hasOwnProperty.call(context.routeValue, key)
      )
    )
      throw new Error('Legacy or multiple HTTP mirrors are outside this Service workflow');
    virtualService = planHttpMirroring(virtualService, draft.httpMirroring).spec;
  }
  const behavior = draft.httpBehavior;
  if (
    behavior &&
    [behavior.timeoutMode, behavior.retryMode, behavior.delayMode, behavior.abortMode].some(
      mode => mode !== 'keep'
    )
  ) {
    if (context.route.protocol !== 'http')
      throw new Error('HTTP behavior cannot be applied to a TCP route');
    if (behavior.routeIndex !== context.route.index)
      throw new Error('HTTP behavior editing must remain on the selected Service route');
    virtualService = planHttpBehavior(virtualService, behavior).spec;
  }
  const result: {
    destinationRule?: Record<string, unknown>;
    virtualService?: Record<string, unknown>;
  } = {};
  if (JSON.stringify(destinationRule) !== JSON.stringify(originalDestinationRule))
    result.destinationRule = destinationRule;
  if (JSON.stringify(virtualService) !== JSON.stringify(originalVirtualService))
    result.virtualService = virtualService;
  if (!result.destinationRule && !result.virtualService)
    throw new Error('Choose at least one routing change before reviewing');
  return result;
}
