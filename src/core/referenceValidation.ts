import { authorizationHostChecks, authorizationHostsNeedContext } from './authorizationHosts';
import { authorizationPolicyChecks, authorizationPolicyTargets } from './authorizationValidation';
import {
  destinationRuleNeedsPeerPolicies,
  destinationRulePolicyChecks,
} from './destinationRulePolicyValidation';
import { destinationRuleChecks } from './destinationRuleValidation';
import {
  gatewayClassChecks,
  gatewayClassNeedsRegistry,
  GatewayClassRegistry,
} from './gatewayClassRegistry';
import { gatewayCollisionChecks, gatewayNeedsCollisionContext } from './gatewayCollisions';
import { gatewayReferenceValidation, gatewayValidationSources } from './gatewayValidation';
import { filterByHost, getHost, hostString, hostWithinWildcardHost } from './hosts';
import { ImportScope, importsHost, validationExportIncluded } from './importScope';
import { istioGatewayConflictChecks, istioGatewayNeedsConflicts } from './istioGatewayConflicts';
import {
  istioGatewayReferenceChecks,
  virtualServiceGatewayReferences,
} from './istioGatewayReferences';
import type { NamespaceMeshConfiguration } from './mesh';
import { isRecord } from './object';
import {
  peerAuthenticationChecks,
  peerAuthenticationNeedsContext,
} from './peerAuthenticationValidation';
import { peerSelectorlessChecks, peerSelectorlessNeedsContext } from './peerSelectorConflicts';
import { serviceEntryChecks } from './serviceEntryValidation';
import { sidecarEgressChecks, sidecarNeedsRegistry } from './sidecarEgressValidation';
import { sidecarRootSelectorChecks } from './sidecarValidation';
import type { Finding } from './validation';
import { configurationExports, configurationImportScope } from './validationScope';
import {
  virtualServiceConflictChecks,
  virtualServiceNeedsConflicts,
} from './virtualServiceConflicts';
import {
  virtualServiceNeedsRegistry,
  virtualServiceRegistryChecks,
} from './virtualServiceRegistry';
import { workloadGroupChecks } from './workloadGroupValidation';

export interface ValidationOwner {
  name: string;
  uid: string;
}
export interface ValidationRecord {
  name: string;
  namespace: string;
  uid?: string;
  labels: Readonly<Record<string, string>>;
  spec: Record<string, unknown>;
  exportToAnnotation?: string;
}
export type ValidationSourceKey =
  | 'namespaces'
  | 'destinationRules'
  | 'serviceEntries'
  | 'virtualServices'
  | 'sidecars'
  | 'gateways'
  | 'gatewayClasses'
  | 'istioGateways'
  | 'workloadGroups'
  | 'services'
  | 'peerAuthentications'
  | 'referenceGrants';
export interface ReferenceValidationContext {
  cluster: string;
  identityDomain: string | null;
  skipWildcardGatewayHosts?: boolean;
  namespaces: { complete: boolean; items: readonly ValidationRecord[] };
  destinationRules: { complete: boolean; items: readonly ValidationRecord[] };
  serviceEntries?: { complete: boolean; items: readonly ValidationRecord[] };
  virtualServices?: { complete: boolean; items: readonly ValidationRecord[] };
  sidecars: { complete: boolean; items: readonly ValidationRecord[] };
  namespaceMesh?: ReadonlyMap<string, NamespaceMeshConfiguration>;
  gateways?: { complete: boolean; items: readonly ValidationRecord[] };
  gatewayClassRegistry?: GatewayClassRegistry;
  istioGateways?: { complete: boolean; items: readonly ValidationRecord[] };
  services?: { complete: boolean; items: readonly ValidationRecord[] };
  referenceGrants?: { complete: boolean; items: readonly ValidationRecord[] };
  peerAuthentications?: { complete: boolean; items: readonly ValidationRecord[] };
  workloadGroups?: { namespace: string; complete: boolean; items: readonly ValidationRecord[] };
}

function subsetReferences(spec: Record<string, unknown>) {
  const references: { host: string; subset: string; path: string }[] = [];
  for (const protocol of ['http', 'tcp', 'tls']) {
    const rules = spec[protocol];
    if (!Array.isArray(rules)) continue;
    for (const [ruleIndex, rule] of rules.entries()) {
      if (!isRecord(rule) || !Array.isArray(rule.route)) continue;
      for (const [index, route] of rule.route.entries()) {
        const destination = isRecord(route) ? route.destination : undefined;
        if (
          isRecord(destination) &&
          typeof destination.host === 'string' &&
          destination.host &&
          typeof destination.subset === 'string' &&
          destination.subset
        ) {
          references.push({
            host: destination.host,
            subset: destination.subset,
            path: `spec/${protocol}[${ruleIndex}]/route[${index}]/destination`,
          });
          if (references.length > 200) return references;
        }
      }
    }
  }
  return references;
}

export function referenceValidationSources(
  kind: string,
  group: string,
  spec: unknown,
  identityDomain: string | null,
  namespace = ''
): ValidationSourceKey[] {
  if (!isRecord(spec)) return [];
  if (kind === 'PeerAuthentication' && group === 'security.istio.io') {
    const policy = peerAuthenticationNeedsContext(kind, group, spec);
    const selectorless = peerSelectorlessNeedsContext(kind, group, spec);
    return [
      ...(policy || selectorless ? ['namespaces' as const] : []),
      ...(policy ? ['destinationRules' as const] : []),
      ...(selectorless ? ['peerAuthentications' as const] : []),
    ];
  }
  if (kind === 'AuthorizationPolicy' && group === 'security.istio.io') {
    const targets = authorizationPolicyTargets(spec);
    const hosts = authorizationHostsNeedContext(kind, group, spec, namespace);
    return [
      ...(hosts || (targets.complete && targets.namespaces.length) ? ['namespaces' as const] : []),
      ...(hosts && identityDomain
        ? (['services', 'serviceEntries', 'virtualServices'] as const)
        : []),
    ];
  }
  if (group === 'gateway.networking.k8s.io' && kind === 'ReferenceGrant') return ['namespaces'];
  if (kind === 'Gateway' && group === 'gateway.networking.k8s.io') {
    const sources: ValidationSourceKey[] = [];
    if (gatewayClassNeedsRegistry(kind, group, spec)) sources.push('gatewayClasses');
    if (gatewayNeedsCollisionContext(kind, group, spec)) sources.push('gateways');
    return sources;
  }
  if (group === 'gateway.networking.k8s.io')
    return gatewayValidationSources(kind, group, namespace, spec);
  if (group !== 'networking.istio.io') return [];
  if (kind === 'Gateway')
    return istioGatewayNeedsConflicts(kind, group, spec) ? ['istioGateways'] : [];
  if (kind === 'WorkloadGroup')
    return spec.metadata === undefined || spec.metadata === null ? [] : ['workloadGroups'];
  if (sidecarNeedsRegistry(kind, group, spec, identityDomain))
    return ['namespaces', 'services', 'serviceEntries'];
  const keys = new Set<ValidationSourceKey>();
  if (virtualServiceNeedsConflicts(kind, group, spec, identityDomain)) {
    keys.add('namespaces');
    keys.add('virtualServices');
    keys.add('sidecars');
  }
  if (destinationRuleNeedsPeerPolicies(kind, group, namespace, spec, identityDomain)) {
    keys.add('namespaces');
    keys.add('destinationRules');
    keys.add('peerAuthentications');
  }
  if (virtualServiceNeedsRegistry(kind, group, spec, identityDomain)) {
    keys.add('namespaces');
    keys.add('services');
    keys.add('serviceEntries');
  }
  if (
    ['VirtualService', 'DestinationRule', 'ServiceEntry'].includes(kind) &&
    Array.isArray(spec.exportTo) &&
    spec.exportTo.length
  )
    keys.add('namespaces');
  if (
    kind === 'ServiceEntry' &&
    Array.isArray(spec.hosts) &&
    spec.hosts.length > 0 &&
    spec.hosts.length <= 100 &&
    Array.isArray(spec.ports) &&
    spec.ports.length > 0 &&
    spec.ports.length <= 100 &&
    spec.ports.some(port => port !== null)
  ) {
    keys.add('namespaces');
    keys.add('serviceEntries');
    keys.add('sidecars');
  }
  if (kind === 'DestinationRule' && identityDomain && typeof spec.host === 'string' && spec.host) {
    keys.add('namespaces');
    keys.add('destinationRules');
    keys.add('sidecars');
  }
  if (kind !== 'VirtualService') return [...keys];
  const gatewayReferences = virtualServiceGatewayReferences(spec);
  if (
    gatewayReferences.complete &&
    gatewayReferences.references.some(
      reference =>
        reference.name !== 'mesh' &&
        (identityDomain || reference.name.includes('/') || !reference.name.includes('.'))
    )
  )
    keys.add('istioGateways');
  if (!identityDomain) return [...keys];
  if (subsetReferences(spec).length) {
    keys.add('namespaces');
    keys.add('destinationRules');
    keys.add('sidecars');
  }
  if (
    ['http', 'tcp', 'tls'].some(
      protocol =>
        Array.isArray(spec[protocol]) &&
        spec[protocol].some(
          rule => isRecord(rule) && Array.isArray(rule.route) && rule.route.length > 1
        )
    )
  )
    keys.add('namespaces');
  return [...keys];
}

export function referenceValidation(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  const classes = gatewayClassChecks(kind, group, spec, context?.gatewayClassRegistry);
  findings.push(...classes.findings);
  skipped.push(...classes.skipped);
  const collisions = gatewayCollisionChecks(kind, group, namespace, spec, context, owner);
  findings.push(...collisions.findings);
  skipped.push(...collisions.skipped);
  const peer = peerAuthenticationChecks(kind, group, namespace, spec, context);
  findings.push(...peer.findings);
  skipped.push(...peer.skipped);
  const gateway = gatewayReferenceValidation(kind, group, namespace, spec, context);
  findings.push(...gateway.findings);
  skipped.push(...gateway.skipped);
  const istioGateway = istioGatewayReferenceChecks(kind, group, namespace, spec, context);
  findings.push(...istioGateway.findings);
  skipped.push(...istioGateway.skipped);
  const authorization = authorizationPolicyChecks(
    kind,
    group,
    spec,
    context?.namespaces.complete && context.namespaces.items.length <= 1000
      ? context.namespaces.items.map(item => item.name)
      : null
  );
  findings.push(...authorization.findings);
  skipped.push(...authorization.skipped);
  const authorizationHosts = authorizationHostChecks(kind, group, namespace, spec, context);
  findings.push(...authorizationHosts.findings);
  skipped.push(...authorizationHosts.skipped);
  const workloadGroup = workloadGroupChecks(kind, group, namespace, spec, context, owner);
  findings.push(...workloadGroup.findings);
  skipped.push(...workloadGroup.skipped);
  const serviceEntry = serviceEntryChecks(kind, group, namespace, spec, context, owner);
  findings.push(...serviceEntry.findings);
  skipped.push(...serviceEntry.skipped);
  const destinationRule = destinationRuleChecks(kind, group, namespace, spec, context, owner);
  findings.push(...destinationRule.findings);
  skipped.push(...destinationRule.skipped);
  const gatewayConflicts = istioGatewayConflictChecks(kind, group, namespace, spec, context, owner);
  findings.push(...gatewayConflicts.findings);
  skipped.push(...gatewayConflicts.skipped);
  const selectorlessPeers = peerSelectorlessChecks(kind, group, namespace, spec, context, owner);
  findings.push(...selectorlessPeers.findings);
  skipped.push(...selectorlessPeers.skipped);
  const virtualService = virtualServiceConflictChecks(kind, group, namespace, spec, context, owner);
  findings.push(...virtualService.findings);
  skipped.push(...virtualService.skipped);
  const peerPolicies = destinationRulePolicyChecks(kind, group, namespace, spec, context, owner);
  findings.push(...peerPolicies.findings);
  skipped.push(...peerPolicies.skipped);
  const sidecar = sidecarRootSelectorChecks(kind, group, namespace, spec, context);
  findings.push(...sidecar.findings);
  skipped.push(...sidecar.skipped);
  const egress = sidecarEgressChecks(kind, group, namespace, spec, context);
  findings.push(...egress.findings);
  skipped.push(...egress.skipped);
  const destinations = virtualServiceRegistryChecks(kind, group, namespace, spec, context);
  findings.push(...destinations.findings);
  skipped.push(...destinations.skipped);
  if (
    group === 'networking.istio.io' &&
    ['VirtualService', 'DestinationRule', 'ServiceEntry'].includes(kind) &&
    spec.exportTo !== undefined
  ) {
    try {
      const exports = configurationExports(spec);
      if (exports.length && !context?.namespaces.complete)
        skipped.push('Export namespace checks require a complete namespace list');
      else if (
        context?.namespaces.complete &&
        !context.namespaces.items.some(
          item => item.name === namespace && item.labels['istio.io/dataplane-mode'] === 'ambient'
        )
      )
        exports.forEach((target, index) => {
          if (
            target !== '.' &&
            target !== '*' &&
            !context.namespaces.items.some(item => item.name === target)
          )
            findings.push({
              code: 'KIA0005',
              severity: 'error',
              path: `spec/exportTo[${index}]`,
              message: 'No matching namespace found or namespace is not accessible',
            });
        });
    } catch (error) {
      skipped.push(error instanceof Error ? error.message : 'Unable to evaluate export namespaces');
    }
  }
  if (
    kind === 'Gateway' &&
    group === 'gateway.networking.k8s.io' &&
    Array.isArray(spec.listeners)
  ) {
    const listeners = spec.listeners;
    listeners.forEach((listener: unknown, index) => {
      if (!isRecord(listener) || typeof listener.hostname !== 'string') return;
      if (
        listeners.some(
          (peer: unknown) =>
            isRecord(peer) &&
            listener.name !== peer.name &&
            listener.hostname === peer.hostname &&
            listener.port === peer.port &&
            listener.protocol === peer.protocol
        )
      )
        findings.push({
          code: 'KIA1503',
          severity: 'error',
          path: `spec/listeners[${index}]/name`,
          message: 'Each listener must have a unique combination of Hostname, Port, and Protocol',
        });
    });
  }
  if (
    kind === 'ReferenceGrant' &&
    group === 'gateway.networking.k8s.io' &&
    Array.isArray(spec.from)
  ) {
    if (!context?.namespaces.complete)
      skipped.push('Namespace references require a complete namespace list');
    else
      spec.from.forEach((from: unknown, index) => {
        if (!isRecord(from) || typeof from.namespace !== 'string') {
          skipped.push(`spec/from[${index}]: malformed namespace reference`);
        } else if (!context.namespaces.items.some(namespace => namespace.name === from.namespace))
          findings.push({
            code: 'KIA1601',
            severity: 'error',
            path: `spec/from[${index}]/namespace`,
            message: 'Namespace is not found or is not accessible',
          });
      });
  }
  if (kind === 'VirtualService' && group === 'networking.istio.io') {
    const references = subsetReferences(spec);
    if (!references.length) return { findings, skipped };
    if (references.length > 200)
      skipped.push('Subset checks exceed the 200-destination evaluation limit');
    else if (!context?.identityDomain)
      skipped.push(
        'Subset checks require an explicit Service DNS identity domain in cluster settings'
      );
    else if (
      !context.namespaces.complete ||
      !context.destinationRules.complete ||
      !context.sidecars.complete
    )
      skipped.push('Subset checks require complete namespace, DestinationRule and Sidecar lists');
    else {
      const domain = context.identityDomain;
      const namespaces = context.namespaces.items.map(namespace => namespace.name);
      let scope: ImportScope;
      try {
        scope = configurationImportScope(namespace, context);
      } catch (error) {
        skipped.push(error instanceof Error ? error.message : 'Unable to resolve Sidecar imports');
        return { findings, skipped };
      }
      if (scope.limited) {
        if (!Array.isArray(spec.hosts) || spec.hosts.some(host => typeof host !== 'string')) {
          skipped.push(
            'VirtualService hosts are required to evaluate its Sidecar import visibility'
          );
          return { findings, skipped };
        }
        if (!spec.hosts.some(host => importsHost(scope, String(host), namespace))) {
          skipped.push(
            'Subset checks do not apply: this VirtualService has no Sidecar-imported host'
          );
          return { findings, skipped };
        }
      }
      const importedRules = context.destinationRules.items.filter(
        rule =>
          typeof rule.spec.host === 'string' && importsHost(scope, rule.spec.host, rule.namespace)
      );
      for (const reference of references) {
        const host = getHost(reference.host, namespace, namespaces, domain);
        let unresolved: string | undefined;
        const present = importedRules.some(rule => {
          if (
            typeof rule.spec.host !== 'string' ||
            !Array.isArray(rule.spec.subsets) ||
            !rule.spec.subsets.some(subset => isRecord(subset) && subset.name === reference.subset)
          )
            return false;
          const ruleHost = getHost(rule.spec.host, rule.namespace, namespaces, domain);
          const matches =
            filterByHost(
              hostString(host),
              host.namespace,
              ruleHost.service,
              ruleHost.namespace,
              domain
            ) || hostWithinWildcardHost(hostString(host), hostString(ruleHost));
          if (!matches) return false;
          const sourceNamespace = context.namespaces.items.find(
            item => item.name === rule.namespace
          );
          if (!sourceNamespace) {
            unresolved = `DestinationRule namespace ${rule.namespace} is missing from namespace evidence`;
            return false;
          }
          const ambient = sourceNamespace.labels['istio.io/dataplane-mode'] === 'ambient';
          let exports: readonly string[];
          try {
            exports = configurationExports(rule.spec);
          } catch (error) {
            unresolved =
              error instanceof Error ? error.message : 'Invalid DestinationRule export scope';
            return false;
          }
          if (!exports.length && !ambient) {
            const mesh = context.namespaceMesh?.get(rule.namespace);
            if (mesh?.status !== 'ready') {
              unresolved =
                mesh?.status === 'unavailable'
                  ? mesh.message
                  : `DestinationRule export defaults are unresolved for ${rule.namespace}`;
              return false;
            }
            exports = mesh.fields.defaultDestinationRuleExportTo ?? [];
          }
          return validationExportIncluded(exports, rule.namespace, namespace, namespaces, ambient);
        });
        if (!present && unresolved) skipped.push(`${reference.path}: ${unresolved}`);
        else if (!present)
          findings.push({
            code: 'KIA1107',
            severity: 'warning',
            path: reference.path,
            message: 'Subset not found',
          });
      }
    }
  }
  return { findings, skipped };
}
