import { isLabelKey, isLabelValue, Labels, matchesSelector } from './labels';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type { Finding } from './validation';
import { validationExclusions } from './validationAnnotations';

export interface ServicePortResource {
  name: string;
  namespace: string;
  uid: string;
  resourceVersion: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  spec: Record<string, unknown>;
}
interface Port {
  name: string;
  port: number;
  targetPort?: string | number;
  protocol: string;
  appProtocol?: string;
}
export const SERVICE_PORT_LIMITS = {
  resources: 1000,
  labels: 20000,
  annotationText: 1000000,
  containerPorts: 20000,
};
const protocols = [
  'grpc',
  'grpc-web',
  'http',
  'http2',
  'https',
  'mongo',
  'redis',
  'tcp',
  'tls',
  'udp',
  'mysql',
];
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && /^[\x20-\x7e]*$/.test(value);
}
function stringMap(value: unknown, labels = false): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length > 256)
    throw new Error('Service port evidence requires bounded string maps');
  const entries = Object.entries(value);
  if (
    entries.some(([key, value]) =>
      labels
        ? !isLabelKey(key) || !isLabelValue(value)
        : !text(key) || typeof value !== 'string' || value.length > 65536
    )
  )
    throw new Error('Service port evidence contains malformed labels or annotations');
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}

export function servicePortResource(
  value: unknown,
  kind: 'Service' | 'Pod' | 'Deployment'
): ServicePortResource {
  if (
    !isRecord(value) ||
    value.kind !== kind ||
    value.apiVersion !== (kind === 'Deployment' ? 'apps/v1' : 'v1') ||
    !isRecord(value.metadata) ||
    !isDnsSubdomain(value.metadata.name) ||
    !isDnsLabel(value.metadata.namespace) ||
    !text(value.metadata.uid) ||
    !value.metadata.uid ||
    value.metadata.uid.trim() !== value.metadata.uid ||
    !text(value.metadata.resourceVersion) ||
    !value.metadata.resourceVersion ||
    value.metadata.resourceVersion.trim() !== value.metadata.resourceVersion ||
    !isRecord(value.spec)
  )
    throw new Error(`Malformed versioned ${kind} in Service port evidence`);
  return {
    name: value.metadata.name,
    namespace: value.metadata.namespace,
    uid: value.metadata.uid,
    resourceVersion: value.metadata.resourceVersion,
    labels: stringMap(value.metadata.labels, true),
    annotations: stringMap(value.metadata.annotations),
    spec: structuredClone(value.spec),
  };
}

function ports(spec: Record<string, unknown>): Port[] {
  const values = spec.ports ?? [];
  if (!Array.isArray(values) || values.length > 100)
    throw new Error('Service port checks require at most 100 ports');
  return values.map(value => {
    if (
      !isRecord(value) ||
      !text(value.name ?? '') ||
      !Number.isInteger(value.port) ||
      typeof value.port !== 'number' ||
      value.port < 1 ||
      value.port > 65535 ||
      !text(value.protocol ?? 'TCP') ||
      (value.appProtocol !== undefined && value.appProtocol !== null && !text(value.appProtocol)) ||
      (value.targetPort !== undefined &&
        value.targetPort !== null &&
        !(
          text(value.targetPort) ||
          (typeof value.targetPort === 'number' &&
            Number.isInteger(value.targetPort) &&
            value.targetPort >= 0 &&
            value.targetPort <= 65535)
        ))
    )
      throw new Error('Malformed Service port prevents port validation');
    const targetPort =
      typeof value.targetPort === 'string' || typeof value.targetPort === 'number'
        ? value.targetPort
        : undefined;
    return {
      name: String(value.name ?? ''),
      port: value.port,
      protocol: String(value.protocol ?? 'TCP'),
      ...(targetPort === undefined ? {} : { targetPort }),
      ...(value.appProtocol === undefined || value.appProtocol === null
        ? {}
        : { appProtocol: String(value.appProtocol) }),
    };
  });
}

export function validateServicePortInput(service: ServicePortResource) {
  ports(service.spec);
  stringMap(service.spec.selector, true);
  return validationExclusions(service.annotations);
}

function podSidecar(pod: ServicePortResource): boolean {
  const status = pod.annotations['sidecar.istio.io/status'];
  if (status === undefined) return false;
  if (status.length > 32768) throw new Error('Pod sidecar status exceeds the analysis limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(status);
  } catch {
    throw new Error('Malformed Pod sidecar status prevents Service port validation');
  }
  if (parsed === null) return false;
  if (!isRecord(parsed)) throw new Error('Malformed Pod sidecar status');
  const containerNames = (field: string) => {
    // encoding/json accepts case-insensitive field names and later values replace earlier ones.
    const names =
      Object.entries(parsed)
        .filter(([key]) => key.toLowerCase() === field)
        .at(-1)?.[1] ?? [];
    if (!Array.isArray(names) || names.length > 100 || names.some(name => !text(name)))
      throw new Error('Malformed Pod sidecar container names');
    return names;
  };
  // The pinned Pod model trusts the annotation, not the actual proxy containers.
  const containers = containerNames('containers');
  const initContainers = containerNames('initcontainers');
  return containers.length > 0 || initContainers.includes('istio-proxy');
}

function deploymentPorts(deployment: ServicePortResource) {
  const template = deployment.spec.template;
  if (
    !isRecord(template) ||
    !isRecord(template.spec) ||
    !Array.isArray(template.spec.containers) ||
    template.spec.containers.length > 100
  )
    throw new Error('Malformed Deployment containers prevent Service port validation');
  return template.spec.containers.flatMap(container => {
    if (!isRecord(container)) throw new Error('Malformed Deployment container');
    const values = container.ports ?? [];
    if (!Array.isArray(values) || values.length > 100)
      throw new Error('Malformed Deployment container ports');
    return values.map(value => {
      if (
        !isRecord(value) ||
        !text(value.name ?? '') ||
        typeof value.containerPort !== 'number' ||
        !Number.isInteger(value.containerPort) ||
        value.containerPort < 1 ||
        value.containerPort > 65535
      )
        throw new Error('Malformed Deployment container port');
      return { name: String(value.name ?? ''), port: value.containerPort };
    });
  });
}

function gateway(labels: Labels) {
  return (
    labels['gateway.istio.io/managed'] === 'istio.io-mesh-controller' ||
    labels['gateway.istio.io/managed'] === 'istio.io-gateway-controller' ||
    (owns(labels, 'gateway.networking.k8s.io/gateway-name') &&
      labels['gateway.networking.k8s.io/gateway-name'].toLowerCase().includes('waypoint')) ||
    ['IngressGateways', 'EgressGateways'].includes(labels['operator.istio.io/component']) ||
    ['ingressgateway', 'egressgateway'].includes(labels.istio) ||
    owns(labels, 'istio.io/gateway-name')
  );
}

export function servicePortValidation(
  service: ServicePortResource,
  pods: readonly ServicePortResource[],
  deployments: readonly ServicePortResource[],
  controllerNamespaces: readonly string[]
) {
  const exclusions = validateServicePortInput(service);
  if (
    pods.length > SERVICE_PORT_LIMITS.resources ||
    deployments.length > SERVICE_PORT_LIMITS.resources
  )
    throw new Error('Service port evidence exceeds the 1000-resource per-source limit');
  let labels = 0;
  let annotationText = 0;
  for (const records of [[service], pods, deployments]) {
    const identities = new Set<string>();
    const names = new Set<string>();
    for (const record of records) {
      const name = `${record.namespace}/${record.name}`;
      if (identities.has(record.uid) || names.has(name))
        throw new Error('Duplicate Service port evidence identity');
      identities.add(record.uid);
      names.add(name);
      labels += Object.keys(record.labels).length;
      annotationText += Object.entries(record.annotations).reduce(
        (sum, [key, value]) => sum + key.length + value.length,
        0
      );
    }
  }
  if (labels > SERVICE_PORT_LIMITS.labels || annotationText > SERVICE_PORT_LIMITS.annotationText)
    throw new Error('Service port evidence exceeds aggregate label or annotation limits');
  const selector = stringMap(service.spec.selector, true);
  const selectedPods = pods.filter(pod => matchesSelector(pod.labels, { matchLabels: selector }));
  const sidecars = selectedPods.map(podSidecar);
  const inMesh =
    sidecars.every(Boolean) ||
    selectedPods.some(pod => pod.annotations['ambient.istio.io/redirection'] === 'enabled');
  const findings: Finding[] = [];
  const servicePorts = ports(service.spec);
  if (inMesh && !owns(service.labels, 'kiali_wizard')) {
    servicePorts.forEach((port, index) => {
      if (port.protocol.toLowerCase() === 'udp') return;
      if (port.appProtocol !== undefined) {
        const protocol = port.appProtocol.toLowerCase();
        if (
          ![...protocols, 'kubernetes.io/h2c', 'kubernetes.io/ws', 'kubernetes.io/wss'].includes(
            protocol
          )
        )
          findings.push({
            code: 'KIA0602',
            severity: 'error',
            path: `spec/ports[${index}]`,
            message: 'Port appProtocol must follow <protocol> form',
          });
      } else if (
        !protocols.some(
          protocol =>
            port.name.startsWith(protocol) &&
            (port.name.toLowerCase() === protocol ||
              port.name.slice(protocol.length).startsWith('-'))
        )
      )
        findings.push({
          code: 'KIA0601',
          severity: 'error',
          path: `spec/ports[${index}]`,
          message: 'Port name must follow <protocol>[-suffix] form',
        });
    });
  }
  const mappingExcluded =
    controllerNamespaces.includes(service.namespace) || gateway(service.labels);
  const deployment =
    !mappingExcluded && Object.keys(selector).length
      ? deployments.find(value => matchesSelector(value.labels, { matchLabels: selector }))
      : undefined;
  if (deployment) {
    const available = deploymentPorts(deployment);
    if (available.length > SERVICE_PORT_LIMITS.containerPorts)
      throw new Error('Service port evidence exceeds container-port limits');
    servicePorts.forEach((port, index) => {
      const named = typeof port.targetPort === 'string' && port.targetPort !== '';
      const number =
        typeof port.targetPort === 'number' && port.targetPort > 0 ? port.targetPort : port.port;
      if (
        !available.some(value => (named ? value.name === port.targetPort : value.port === number))
      )
        findings.push({
          code: 'KIA0701',
          severity: 'warning',
          path: `spec/ports[${index}]`,
          message: 'Deployment exposing same port as Service not found',
        });
    });
  }
  const visible = findings.filter(
    finding => !exclusions.all && !exclusions.codes.includes(finding.code)
  );
  return {
    findings: visible,
    suppressed: findings.length - visible.length,
    coverage: 'partial' as const,
    matchedPods: selectedPods.length,
    inMesh,
    mappingExcluded,
    deployment: deployment
      ? {
          name: deployment.name,
          namespace: deployment.namespace,
          uid: deployment.uid,
          resourceVersion: deployment.resourceVersion,
        }
      : undefined,
  };
}
