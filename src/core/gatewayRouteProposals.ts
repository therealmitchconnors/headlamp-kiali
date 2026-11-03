import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type { GRPCRouteSpec, HTTPRouteSpec } from '../resources/schema-types';

const GROUP = 'gateway.networking.k8s.io';
const HTTP_VERSIONS = [`${GROUP}/v1`, `${GROUP}/v1beta1`];
const GRPC_VERSIONS = [`${GROUP}/v1`];

export type GatewayRouteKind = 'HTTPRoute' | 'GRPCRoute';
export type GatewayRouteSpec = HTTPRouteSpec | GRPCRouteSpec;

export interface GatewayRouteDraft {
  name: string;
  namespace: string;
  hostnames: string;
  parentName: string;
  parentNamespace: string;
  sectionName: string;
  parentPort: string;
  serviceName: string;
  serviceNamespace: string;
  servicePort: string;
}

export interface GatewayRouteIdentity {
  name: string;
  namespace: string;
  sectionName: string;
  port: string;
}

function port(value: string, label: string, optional = false): number | undefined {
  if (optional && value === '') return undefined;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be a port from 1 to 65535`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error(`${label} must be a port from 1 to 65535`);
  return number;
}

function hostnames(value: string, fallback: string): string[] {
  const names = value.trim() ? value.split(',').map(host => host.trim()) : [fallback];
  if (
    !names.length ||
    names.length > 16 ||
    names.some(
      host =>
        !host ||
        host.length > 253 ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
        !(host === fallback && isDnsLabel(host)) &&
        !/^(?:\*\.)?[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)+$/.test(host)
    )
  )
    throw new Error('Route hostnames must be DNS names or wildcard DNS names');
  return names;
}

function assertTarget(kind: GatewayRouteKind, apiVersion: string, namespace: string) {
  if (
    !(
      kind === 'HTTPRoute'
        ? HTTP_VERSIONS.includes(apiVersion)
        : GRPC_VERSIONS.includes(apiVersion)
    )
  )
    throw new Error(`${kind} API version is unsupported`);
  if (!isDnsLabel(namespace)) throw new Error('Route namespace must be a valid DNS label');
}

function parentReference(
  routeNamespace: string,
  parent: GatewayRouteIdentity
): NonNullable<HTTPRouteSpec['parentRefs']>[number] {
  if (!isDnsSubdomain(parent.name) || !isDnsLabel(parent.namespace))
    throw new Error('Gateway identity and namespace are required');
  const parentPort = port(parent.port, 'Gateway port', true);
  if (parent.sectionName && !isDnsSubdomain(parent.sectionName))
    throw new Error('Gateway section must be a valid DNS name');
  return {
    name: parent.name,
    ...(parent.namespace === routeNamespace ? {} : { namespace: parent.namespace }),
    ...(parent.sectionName ? { sectionName: parent.sectionName } : {}),
    ...(parentPort === undefined ? {} : { port: parentPort }),
  };
}

export function planGatewayRouteCreation(
  kind: GatewayRouteKind,
  apiVersion: string,
  draft: GatewayRouteDraft
): { name: string; namespace: string; apiVersion: string; kind: GatewayRouteKind; spec: GatewayRouteSpec } {
  assertTarget(kind, apiVersion, draft.namespace);
  if (!isDnsSubdomain(draft.name)) throw new Error('Route name must be a valid DNS subdomain');
  if (!isDnsSubdomain(draft.serviceName) || !isDnsLabel(draft.serviceNamespace))
    throw new Error('Backend Service identity and namespace are required');
  const backendPort = port(draft.servicePort, 'Backend Service port');
  const parentRef = parentReference(draft.namespace, {
    name: draft.parentName,
    namespace: draft.parentNamespace,
    sectionName: draft.sectionName,
    port: draft.parentPort,
  });
  const rule = {
    backendRefs: [
      {
        name: draft.serviceName,
        ...(draft.serviceNamespace === draft.namespace ? {} : { namespace: draft.serviceNamespace }),
        port: backendPort,
        weight: 100,
      },
    ],
  };
  const spec: GatewayRouteSpec = {
    hostnames: hostnames(draft.hostnames, draft.serviceName),
    parentRefs: [parentRef],
    rules: [rule],
  };
  if (
    !Array.isArray(spec.hostnames) ||
    spec.parentRefs.length !== 1 ||
    !isRecord(spec.parentRefs[0]) ||
    typeof spec.parentRefs[0].name !== 'string' ||
    spec.rules.length !== 1 ||
    !isRecord(spec.rules[0]) ||
    !Array.isArray(spec.rules[0].backendRefs) ||
    !isRecord(spec.rules[0].backendRefs[0]) ||
    spec.rules[0].backendRefs[0].port !== backendPort
  )
    throw new Error('The proposed route does not match the supported Gateway API schema subset');
  return { name: draft.name, namespace: draft.namespace, apiVersion, kind, spec };
}

export function planGatewayRouteAttachment(
  kind: GatewayRouteKind,
  apiVersion: string,
  namespace: string,
  spec: unknown,
  parent: GatewayRouteIdentity
): GatewayRouteSpec {
  assertTarget(kind, apiVersion, namespace);
  if (!isRecord(spec)) throw new Error('The original route specification is malformed');
  const originalRefs = spec.parentRefs;
  if (originalRefs !== undefined && !Array.isArray(originalRefs))
    throw new Error('The original route parent references are malformed');
  const next = parentReference(namespace, parent);
  const refs = (originalRefs ?? []) as unknown[];
  if (
    refs.some(
      value =>
        isRecord(value) &&
        value.name === next.name &&
        (value.namespace ?? namespace) === (next.namespace ?? namespace) &&
        (value.group ?? GROUP) === GROUP &&
        (value.kind ?? 'Gateway') === 'Gateway' &&
        value.sectionName === next.sectionName &&
        value.port === next.port
    )
  )
    throw new Error('This Gateway attachment already exists');
  const proposal = { ...spec, parentRefs: [...refs, next] };
  if (!Array.isArray(proposal.parentRefs) || proposal.parentRefs.length > 32)
    throw new Error('Gateway routes support at most 32 parent references in this form');
  return proposal as GatewayRouteSpec;
}
