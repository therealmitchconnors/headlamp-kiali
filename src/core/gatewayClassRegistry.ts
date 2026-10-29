import { decodeLabelSelector, matchesSelector } from './labels';
import { isDnsSubdomain, isRecord } from './object';
import type { ValidationRecord } from './referenceValidation';
import type { Finding } from './validation';

export interface GatewayClassSettings {
  classes: { name: string; className: string }[];
  selector: Record<string, string>;
}
export interface GatewayClassRegistry {
  basis: 'configured' | 'discovered' | 'fallback';
  classes: { name: string; className: string }[];
  uncertain: string[];
}
export function gatewayClassNeedsRegistry(kind: string, group: string, spec: unknown): boolean {
  return (
    kind === 'Gateway' &&
    group === 'gateway.networking.k8s.io' &&
    isRecord(spec) &&
    isDnsSubdomain(spec.gatewayClassName)
  );
}
export function validateGatewayClassSettings(value: unknown): GatewayClassSettings {
  if (
    !isRecord(value) ||
    Object.keys(value).some(key => key !== 'classes' && key !== 'selector') ||
    !Array.isArray(value.classes) ||
    value.classes.length > 100 ||
    !isRecord(value.selector) ||
    Object.keys(value.selector).length > 100 ||
    Object.values(value.selector).some(value => typeof value !== 'string')
  )
    throw new Error(
      'Gateway class settings require classes and an equality-label selector, each limited to 100 entries'
    );
  decodeLabelSelector({ matchLabels: value.selector });
  return {
    classes: value.classes.map(entry => {
      if (
        !isRecord(entry) ||
        Object.keys(entry).some(key => key !== 'name' && key !== 'className') ||
        typeof entry.name !== 'string' ||
        !entry.name.trim() ||
        entry.name.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(entry.name) ||
        !isDnsSubdomain(entry.className)
      )
        throw new Error('Each Gateway class needs a display name and a DNS-subdomain className');
      return { name: entry.name, className: entry.className };
    }),
    selector: Object.fromEntries(
      Object.entries(value.selector).map(([key, value]) => [key, String(value)])
    ),
  };
}
export function resolveGatewayClassRegistry(
  settings: GatewayClassSettings,
  discovered?: { complete: boolean; items: readonly ValidationRecord[] },
  mesh?: { clusterCount?: number; ambientInAnyCluster?: boolean }
): GatewayClassRegistry {
  const checked = validateGatewayClassSettings(settings);
  if (checked.classes.length)
    return { basis: 'configured', classes: checked.classes, uncertain: [] };
  if (!discovered?.complete)
    throw new Error(
      'Gateway class discovery is incomplete; defaults cannot prove registry membership'
    );
  if (discovered.items.length > 1000)
    throw new Error('Gateway class registry exceeds 1000 records');
  const selector = decodeLabelSelector({ matchLabels: checked.selector });
  const filtered = Object.keys(checked.selector).length > 0;
  const classes = discovered.items.flatMap(item => {
    if (
      !isDnsSubdomain(item.name) ||
      item.namespace !== '' ||
      typeof item.spec.controllerName !== 'string' ||
      !item.spec.controllerName
    )
      throw new Error('Malformed cluster-scoped GatewayClass registry record');
    return matchesSelector(item.labels, selector) &&
      (filtered || item.spec.controllerName.startsWith('istio.io'))
      ? [{ name: item.name, className: item.name }]
      : [];
  });
  if (classes.length) return { basis: 'discovered', classes, uncertain: [] };
  const defaults = ['istio', 'istio-remote'];
  const uncertain: string[] = [];
  if (mesh?.clusterCount === undefined) uncertain.push('istio-east-west');
  else {
    if (!Number.isInteger(mesh.clusterCount) || mesh.clusterCount < 1)
      throw new Error('Gateway class defaults require a positive configured mesh-cluster count');
    if (mesh.clusterCount > 1) defaults.push('istio-east-west');
  }
  if (mesh?.ambientInAnyCluster === undefined) uncertain.push('istio-waypoint');
  else if (mesh.ambientInAnyCluster) defaults.push('istio-waypoint');
  return {
    basis: 'fallback',
    classes: defaults.map(className => ({ name: className, className })),
    uncertain,
  };
}
export function gatewayClassChecks(
  kind: string,
  group: string,
  spec: Record<string, unknown>,
  registry?: GatewayClassRegistry
): { findings: Finding[]; skipped: string[] } {
  if (kind !== 'Gateway' || group !== 'gateway.networking.k8s.io')
    return { findings: [], skipped: [] };
  if (!isDnsSubdomain(spec.gatewayClassName))
    return { findings: [], skipped: ['Gateway class checks require a valid gatewayClassName'] };
  if (!registry)
    return {
      findings: [],
      skipped: ['Gateway class registry is unavailable; membership was not evaluated'],
    };
  if (registry.uncertain.includes(spec.gatewayClassName))
    return {
      findings: [],
      skipped: [
        'Gateway class fallback membership needs configured mesh-cluster count or ambient state across all mesh clusters',
      ],
    };
  const findings: Finding[] = registry.classes.some(
    entry => entry.className === spec.gatewayClassName
  )
    ? []
    : [
        {
          code: 'KIA1504',
          severity: 'error',
          path: 'spec/gatewayClassName',
          message: 'Gateway API Class not found in Kiali configuration',
        },
      ];
  return {
    findings,
    skipped: [
      'Gateway class registry membership does not prove object existence, controller readiness or Gateway acceptance',
    ],
  };
}
