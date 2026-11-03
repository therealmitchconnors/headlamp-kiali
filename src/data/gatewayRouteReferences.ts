import { gatewayRouteReferences } from '../core/configuration';
import { gatewayReferenceValidation } from '../core/gatewayValidation';
import { isDnsLabel, isDnsSubdomain, isRecord } from '../core/object';
import {
  referenceValidationSources,
  ValidationRecord,
  ValidationSourceKey,
} from '../core/referenceValidation';
import { ClusterScope } from '../core/scope';
import { ConfigurationDefinition, configurationDefinitions } from '../resources/registry';
import { discoverConfiguration } from './configuration';
import { loadValidationSnapshot } from './validation';

const GROUP = 'gateway.networking.k8s.io';

export interface GatewayRouteReferenceReview {
  sourceVersions: Readonly<Partial<Record<ValidationSourceKey, string>>>;
  uncertainty: readonly string[];
}

function sourceMap(sources: readonly { key: ValidationSourceKey; complete: boolean; resourceVersion?: string; error?: { message: string } }[]) {
  return new Map(sources.map(source => [source.key, source]));
}

function expectedName(value: unknown, namespace: string) {
  if (!isRecord(value) || !isDnsSubdomain(value.name)) return undefined;
  const targetNamespace = value.namespace ?? namespace;
  if (!isDnsLabel(targetNamespace)) return undefined;
  return { name: value.name, namespace: targetNamespace };
}

function requireRecord(
  records: readonly ValidationRecord[],
  identity: { name: string; namespace: string },
  kind: string
) {
  const record = records.find(item => item.name === identity.name && item.namespace === identity.namespace);
  if (!record?.uid || !record.resourceVersion)
    throw new Error(`${kind} ${identity.namespace}/${identity.name} is missing from complete reference evidence`);
  return record;
}

function validateExplicitPorts(
  namespace: string,
  spec: Record<string, unknown>,
  gateways: readonly ValidationRecord[],
  services: readonly ValidationRecord[]
) {
  for (const entry of gatewayRouteReferences(spec)) {
    if (!isRecord(entry.value)) continue;
    const ref = entry.value;
    if (entry.defaultKind === 'Gateway' && (ref.group ?? GROUP) === GROUP && (ref.kind ?? 'Gateway') === 'Gateway') {
      if (ref.port !== undefined && (typeof ref.port !== 'number' || !Number.isInteger(ref.port) || ref.port < 1 || ref.port > 65535))
        throw new Error('Gateway port must be an integer from 1 to 65535');
      if (ref.sectionName !== undefined && (typeof ref.sectionName !== 'string' || !ref.sectionName))
        throw new Error('Gateway section name is malformed');
      if (ref.port !== undefined || ref.sectionName !== undefined) {
        const identity = expectedName(ref, namespace);
        if (!identity) throw new Error('Gateway parent identity is malformed');
        const gateway = requireRecord(gateways, identity, 'Gateway');
        const listeners = gateway.spec.listeners;
        if (!Array.isArray(listeners) || listeners.length > 64)
          throw new Error('Gateway listener evidence is unavailable or malformed');
        const matching = listeners.filter(
          listener =>
            isRecord(listener) &&
            (ref.sectionName === undefined || listener.name === ref.sectionName) &&
            (ref.port === undefined || listener.port === ref.port)
        );
        if (!matching.length)
          throw new Error('The selected Gateway section/port does not match an observed listener');
      }
    } else if (entry.defaultKind === 'Service' && (ref.group ?? '') === '' && (ref.kind ?? 'Service') === 'Service') {
      if (ref.port !== undefined && (typeof ref.port !== 'number' || !Number.isInteger(ref.port) || ref.port < 1 || ref.port > 65535))
        throw new Error('Backend Service port must be an integer from 1 to 65535');
      if (ref.port !== undefined) {
        const identity = expectedName(ref, namespace);
        if (!identity) throw new Error('Backend Service identity is malformed');
        const service = requireRecord(services, identity, 'Backend Service');
        const ports = service.spec.ports;
        if (
          !Array.isArray(ports) ||
          ports.length > 256 ||
          !ports.some(port => isRecord(port) && port.port === ref.port)
        )
          throw new Error(
            `Backend Service ${identity.namespace}/${identity.name} does not expose port ${ref.port}`
          );
      }
    }
  }
}

async function reviewGatewayRouteReferences(
  scope: ClusterScope,
  kind: string,
  apiVersion: string,
  namespace: string,
  spec: Record<string, unknown>,
  signal: AbortSignal
): Promise<GatewayRouteReferenceReview> {
  if (!['HTTPRoute', 'GRPCRoute'].includes(kind) || !isDnsLabel(namespace))
    throw new Error('Only namespaced HTTPRoute and GRPCRoute references are supported');
  const definition = configurationDefinitions.find(
    item => item.kind === kind && item.group === GROUP
  ) as ConfigurationDefinition | undefined;
  if (!definition) throw new Error('Gateway API route resource definition is unavailable');
  const discovery = await discoverConfiguration(scope, definition, signal);
  if (!discovery.available || discovery.apiVersion !== apiVersion)
    throw new Error(`${kind} discovery is unavailable or does not serve the selected API version`);

  const required = referenceValidationSources(kind, GROUP, spec, null, namespace);
  const snapshot = await loadValidationSnapshot(scope, kind, GROUP, spec, null, signal, namespace);
  const sources = sourceMap(snapshot.sources);
  const sourceVersions: Partial<Record<ValidationSourceKey, string>> = {};
  for (const key of required) {
    const source = sources.get(key);
    if (!source?.complete || !source.resourceVersion)
      throw new Error(
        `${key} reference evidence is incomplete: ${source?.error?.message ?? 'source unavailable'}`
      );
    sourceVersions[key] = source.resourceVersion;
  }
  const checked = gatewayReferenceValidation(kind, GROUP, namespace, spec, snapshot.context);
  const blocking = checked.findings.find(finding => finding.severity === 'error');
  if (blocking) throw new Error(blocking.message);

  validateExplicitPorts(
    namespace,
    spec,
    snapshot.context.gateways?.items ?? [],
    snapshot.context.services?.items ?? []
  );
  const uncertainty = [
    ...checked.skipped,
    'Gateway listener protocol/hostname acceptance and controller status are not verified; a proposed parentRef does not prove route attachment.',
    'Reference evidence is read-only and can change after review; it is rechecked before confirmation.',
  ];
  return { sourceVersions: Object.freeze(sourceVersions), uncertainty: Object.freeze(uncertainty) };
}

export async function inspectGatewayRouteReferences(
  scope: ClusterScope,
  kind: string,
  apiVersion: string,
  namespace: string,
  spec: Record<string, unknown>,
  signal: AbortSignal
): Promise<GatewayRouteReferenceReview> {
  return reviewGatewayRouteReferences(scope, kind, apiVersion, namespace, structuredClone(spec), signal);
}

export async function assertGatewayRouteReferencesFresh(
  scope: ClusterScope,
  kind: string,
  apiVersion: string,
  namespace: string,
  spec: Record<string, unknown>,
  expected: GatewayRouteReferenceReview,
  signal: AbortSignal
) {
  const current = await reviewGatewayRouteReferences(
    scope,
    kind,
    apiVersion,
    namespace,
    structuredClone(spec),
    signal
  );
  if (JSON.stringify(current.sourceVersions) !== JSON.stringify(expected.sourceVersions))
    throw new Error('Gateway, Service, namespace or ReferenceGrant evidence changed; review the route again');
}
