import { isDnsLabel, isDnsSubdomain as dns, isRecord } from './object';

export interface ConfigurationReference {
  kind:
    | 'Service'
    | 'Gateway'
    | 'VirtualService'
    | 'GatewayClass'
    | 'InferencePool'
    | 'Secret'
    | 'ConfigMap'
    | 'Namespace';
  group?: string;
  namespace: string;
  name: string;
  path: string;
  subset?: string;
  sectionName?: string;
}

export interface GatewayRouteReference {
  value: unknown;
  path: string;
  defaultKind: 'Gateway' | 'Service';
}

export function gatewayRouteReferences(spec: Record<string, unknown>): GatewayRouteReference[] {
  const result: GatewayRouteReference[] = [];
  if (Array.isArray(spec.parentRefs))
    spec.parentRefs.forEach((value, index) =>
      result.push({ value, path: `spec.parentRefs[${index}]`, defaultKind: 'Gateway' })
    );
  const filters = (value: unknown, path: string) => {
    if (!Array.isArray(value)) return;
    value.forEach((filter, index) => {
      if (isRecord(filter) && isRecord(filter.requestMirror))
        result.push({
          value: filter.requestMirror.backendRef,
          path: `${path}[${index}].requestMirror.backendRef`,
          defaultKind: 'Service',
        });
    });
  };
  if (Array.isArray(spec.rules))
    spec.rules.forEach((rule, index) => {
      if (!isRecord(rule)) return;
      filters(rule.filters, `spec.rules[${index}].filters`);
      if (Array.isArray(rule.backendRefs))
        rule.backendRefs.forEach((value, backendIndex) => {
          const path = `spec.rules[${index}].backendRefs[${backendIndex}]`;
          result.push({ value, path, defaultKind: 'Service' });
          if (isRecord(value)) filters(value.filters, `${path}.filters`);
        });
    });
  return result;
}

export function serviceHost(
  host: string,
  namespace: string
): { namespace: string; name: string } | null {
  const parts = host.replace(/\.$/, '').split('.');
  if (!dns(host.replace(/\.$/, ''))) return null;
  if (parts.length === 1) return { namespace, name: parts[0] };
  if (
    parts.length === 2 ||
    (parts.length === 3 && parts[2] === 'svc') ||
    (parts.length === 5 && parts.slice(2).join('.') === 'svc.cluster.local')
  ) {
    return { namespace: parts[1], name: parts[0] };
  }
  return null;
}

export function configurationReferences(
  kind: string,
  spec: unknown,
  namespace: string,
  group = 'networking.istio.io'
): ConfigurationReference[] {
  if (!isRecord(spec)) return [];
  if (group === 'gateway.networking.k8s.io' || group === 'inference.networking.k8s.io')
    return gatewayReferences(kind, spec, namespace);
  const result: ConfigurationReference[] = [];
  function destination(value: unknown, path: string) {
    if (!isRecord(value) || typeof value.host !== 'string') return;
    const target = serviceHost(value.host, namespace);
    if (target)
      result.push({
        kind: 'Service',
        ...target,
        path,
        ...(typeof value.subset === 'string' ? { subset: value.subset } : {}),
      });
  }
  if (kind === 'DestinationRule') destination(spec, 'spec.host');
  if (kind === 'VirtualService') {
    if (Array.isArray(spec.gateways))
      for (const [index, gateway] of spec.gateways.entries()) {
        if (typeof gateway !== 'string' || gateway === 'mesh') continue;
        const parts = gateway.split('/');
        const name = parts[parts.length - 1];
        const targetNamespace = parts.length === 2 ? parts[0] : namespace;
        if (parts.length <= 2 && dns(name) && dns(targetNamespace)) {
          result.push({
            kind: 'Gateway',
            namespace: targetNamespace,
            name,
            path: `spec.gateways[${index}]`,
          });
        }
      }
    for (const protocol of ['http', 'tcp', 'tls']) {
      const rules = spec[protocol];
      if (!Array.isArray(rules)) continue;
      rules.forEach((rule: unknown, index) => {
        if (!isRecord(rule)) return;
        const path = `spec.${protocol}[${index}]`;
        if (Array.isArray(rule.route))
          rule.route.forEach((route: unknown, routeIndex) => {
            if (isRecord(route))
              destination(route.destination, `${path}.route[${routeIndex}].destination`);
          });
        destination(rule.mirror, `${path}.mirror`);
        if (Array.isArray(rule.mirrors))
          rule.mirrors.forEach((mirror: unknown, mirrorIndex) => {
            if (isRecord(mirror))
              destination(mirror.destination, `${path}.mirrors[${mirrorIndex}].destination`);
          });
        if (
          isRecord(rule.delegate) &&
          typeof rule.delegate.name === 'string' &&
          dns(rule.delegate.name)
        ) {
          const targetNamespace =
            typeof rule.delegate.namespace === 'string' && rule.delegate.namespace
              ? rule.delegate.namespace
              : namespace;
          if (dns(targetNamespace))
            result.push({
              kind: 'VirtualService',
              name: rule.delegate.name,
              namespace: targetNamespace,
              path: `${path}.delegate`,
            });
        }
      });
    }
  }
  return result;
}

function gatewayReferences(
  kind: string,
  spec: Record<string, unknown>,
  namespace: string
): ConfigurationReference[] {
  const result: ConfigurationReference[] = [];
  function reference(value: unknown, path: string, defaultKind: 'Gateway' | 'Service' | 'Secret') {
    if (!isRecord(value) || typeof value.name !== 'string' || !dns(value.name)) return;
    const refKind = value.kind ?? defaultKind;
    const group = value.group ?? (defaultKind === 'Gateway' ? 'gateway.networking.k8s.io' : '');
    const ns = value.namespace ?? namespace;
    if (!isDnsLabel(ns) || typeof refKind !== 'string' || typeof group !== 'string') return;
    if (
      !(
        (group === '' && ['Service', 'Secret', 'ConfigMap'].includes(refKind)) ||
        (group === 'gateway.networking.k8s.io' && refKind === 'Gateway') ||
        (group === 'inference.networking.k8s.io' && refKind === 'InferencePool')
      )
    )
      return;
    const targetKind =
      refKind === 'Gateway'
        ? 'Gateway'
        : refKind === 'InferencePool'
        ? 'InferencePool'
        : refKind === 'Secret'
        ? 'Secret'
        : refKind === 'ConfigMap'
        ? 'ConfigMap'
        : 'Service';
    result.push({
      kind: targetKind,
      group,
      name: value.name,
      namespace: ns,
      path,
      ...(typeof value.sectionName === 'string' ? { sectionName: value.sectionName } : {}),
    });
  }
  if (kind === 'Gateway') {
    if (typeof spec.gatewayClassName === 'string' && dns(spec.gatewayClassName))
      result.push({
        kind: 'GatewayClass',
        group: 'gateway.networking.k8s.io',
        namespace: '',
        name: spec.gatewayClassName,
        path: 'spec.gatewayClassName',
      });
    if (Array.isArray(spec.listeners))
      spec.listeners.forEach((listener: unknown, index) => {
        if (
          isRecord(listener) &&
          isRecord(listener.tls) &&
          Array.isArray(listener.tls.certificateRefs)
        )
          listener.tls.certificateRefs.forEach((ref: unknown, refIndex) =>
            reference(ref, `spec.listeners[${index}].tls.certificateRefs[${refIndex}]`, 'Secret')
          );
      });
  }
  if (
    kind === 'GatewayClass' &&
    isRecord(spec.parametersRef) &&
    typeof spec.parametersRef.group === 'string' &&
    typeof spec.parametersRef.kind === 'string'
  )
    reference(spec.parametersRef, 'spec.parametersRef', 'Service');
  if (kind === 'InferencePool')
    reference(spec.endpointPickerRef, 'spec.endpointPickerRef', 'Service');
  if (['HTTPRoute', 'GRPCRoute', 'TCPRoute', 'TLSRoute', 'UDPRoute'].includes(kind)) {
    for (const ref of gatewayRouteReferences(spec)) reference(ref.value, ref.path, ref.defaultKind);
  }
  if (kind === 'ReferenceGrant') {
    if (Array.isArray(spec.from))
      spec.from.forEach((from: unknown, index) => {
        if (isRecord(from) && typeof from.namespace === 'string' && dns(from.namespace))
          result.push({
            kind: 'Namespace',
            group: '',
            namespace: '',
            name: from.namespace,
            path: `spec.from[${index}].namespace`,
          });
      });
    if (Array.isArray(spec.to))
      spec.to.forEach((ref: unknown, index) => reference(ref, `spec.to[${index}]`, 'Service'));
  }
  return result;
}

export function configurationSections(spec: unknown): { name: string; value: unknown }[] {
  return isRecord(spec) ? Object.entries(spec).map(([name, value]) => ({ name, value })) : [];
}
