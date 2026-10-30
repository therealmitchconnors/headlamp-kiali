import { configurationReferences } from './configuration';
import { CorrelatedWorkload } from './correlation';
import { getHost, hostString } from './hosts';
import { decodeLabelSelector, matchesSelector } from './labels';
import { localConfigurationChecks } from './localValidation';
import { isRecord } from './object';
import {
  referenceValidation,
  ReferenceValidationContext,
  ValidationOwner,
} from './referenceValidation';
import { validationExclusions } from './validationAnnotations';

export type FindingReference = {
  namespace: string;
  name: string;
  uid: string;
} & (
  | { kind: 'ServiceEntry' | 'DestinationRule' | 'VirtualService'; group: 'networking.istio.io' }
  | { kind: 'PeerAuthentication'; group: 'security.istio.io' }
  | { kind: 'Gateway'; group: 'gateway.networking.k8s.io' }
  | { kind: 'Gateway'; group: 'networking.istio.io' }
);

export interface Finding {
  code:
    | 'KIA1104'
    | 'KIA1105'
    | 'KIA1106'
    | 'KIA0301'
    | 'KIA0004'
    | 'KIA0002'
    | 'KIA0005'
    | 'KIA1107'
    | 'KIA1102'
    | 'KIA1101'
    | 'KIA1108'
    | 'KIA0101'
    | 'KIA0102'
    | 'KIA0104'
    | 'KIA1702'
    | 'KIA1211'
    | 'KIA1212'
    | 'KIA0201'
    | 'KIA0204'
    | 'KIA1401'
    | 'KIA1402'
    | 'KIA1503'
    | 'KIA1501'
    | 'KIA1502'
    | 'KIA1504'
    | 'KIA1601'
    | 'KIA1006'
    | 'KIA1004'
    | 'KIA0401'
    | 'KIA0501'
    | 'KIA0505'
    | 'KIA0506'
    | 'KIA0205'
    | 'KIA0206'
    | 'KIA0207'
    | 'KIA0208'
    | 'KIA1007'
    | 'GWAPI';
  severity: 'warning' | 'error' | 'unknown';
  path: string;
  message: string;
  references?: FindingReference[];
}

export interface InitialValidation {
  findings: Finding[];
  skipped: string[];
  suppressed: number;
  coverage: 'partial';
}

/** Explicitly bounded checks, never the complete validator or a validity verdict. */
export function initialValidation({
  cluster,
  namespace,
  kind,
  spec,
  annotations,
  workloads,
  complete,
  group = 'networking.istio.io',
  context,
  status,
  generation,
  owner,
}: {
  cluster: string;
  namespace: string;
  kind: string;
  spec: unknown;
  annotations: Record<string, string>;
  workloads: readonly CorrelatedWorkload[];
  complete: boolean;
  group?: string;
  context?: ReferenceValidationContext;
  status?: unknown;
  generation?: number;
  owner?: ValidationOwner;
}): InitialValidation {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (context && context.cluster !== cluster)
    throw new Error('Validation context belongs to a different cluster');
  if (!isRecord(spec))
    return {
      findings,
      skipped: ['Specification is unavailable'],
      suppressed: 0,
      coverage: 'partial',
    };
  if (kind === 'VirtualService' && group === 'networking.istio.io') {
    for (const protocol of ['http', 'tcp', 'tls']) {
      const routes = spec[protocol];
      if (!Array.isArray(routes)) continue;
      routes.forEach((rule: unknown, ruleIndex) => {
        if (!isRecord(rule) || !Array.isArray(rule.route)) return;
        const path = `spec/${protocol}[${ruleIndex}]/route`;
        if (rule.route.length === 1 && isRecord(rule.route[0])) {
          const weight = rule.route[0].weight;
          if (typeof weight === 'number' && weight > 0 && weight < 100) {
            findings.push({
              code: 'KIA1104',
              severity: 'warning',
              path: `${path}[0]/weight`,
              message:
                'The weight is assumed to be 100 because there is only one route destination',
            });
          }
        }
        const destinations = new Map<string, number[]>();
        const normalized = !!context?.identityDomain && context.namespaces.complete;
        if (rule.route.length > 1 && !normalized)
          skipped.push(
            `${path}: host-alias duplicate checks require complete namespaces and an explicit Service DNS identity domain`
          );
        let incomplete = false;
        rule.route.forEach((destination: unknown, index) => {
          if (
            !isRecord(destination) ||
            !isRecord(destination.destination) ||
            typeof destination.destination.host !== 'string'
          ) {
            incomplete = true;
            return;
          }
          const target = destination.destination;
          const host = String(target.host);
          const resolved =
            normalized && context?.identityDomain
              ? hostString(
                  getHost(
                    host,
                    namespace,
                    context.namespaces.items.map(namespace => namespace.name),
                    context.identityDomain
                  )
                )
              : host;
          const key = JSON.stringify([resolved, target.subset ?? '']);
          destinations.set(key, [...(destinations.get(key) ?? []), index]);
        });
        if (incomplete) {
          skipped.push(`${path}: malformed destinations prevent duplicate checks`);
          return;
        }
        for (const indices of destinations.values())
          if (indices.length > 1) {
            for (const index of indices)
              findings.push({
                code: 'KIA1105',
                severity: 'warning',
                path: `${path}[${index}]/host`,
                message:
                  'This host subset combination is already referenced in another route destination',
              });
          }
      });
    }
  }
  const selector =
    group === 'security.istio.io' &&
    ['AuthorizationPolicy', 'PeerAuthentication', 'RequestAuthentication'].includes(kind)
      ? { value: spec.selector, field: 'matchLabels', path: 'spec/selector/matchLabels' }
      : group === 'networking.istio.io' && kind === 'Sidecar'
      ? { value: spec.workloadSelector, field: 'labels', path: 'spec/workloadSelector/labels' }
      : null;
  if (selector && selector.value !== undefined && selector.value !== null) {
    try {
      if (!isRecord(selector.value)) throw new Error('Workload selector must be an object');
      const parsedSelector = decodeLabelSelector({
        matchLabels: selector.value[selector.field] ?? {},
      });
      if (Object.keys(parsedSelector.matchLabels ?? {}).length) {
        if (!complete)
          skipped.push('Workload-selector check requires a complete namespace snapshot');
        else if (
          !workloads.some(
            workload =>
              workload.identity.cluster === cluster &&
              workload.identity.namespace === namespace &&
              matchesSelector(workload.resource.workloadLabels, parsedSelector)
          )
        )
          findings.push({
            code: 'KIA0004',
            severity: 'warning',
            path: selector.path,
            message: 'No matching workload found for the selector in this namespace',
          });
      }
    } catch (error) {
      skipped.push(
        `${selector.path}: ${
          error instanceof Error ? error.message : 'Workload selector is unavailable'
        }`
      );
    }
  }
  const references = referenceValidation(kind, group, namespace, spec, context, owner);
  findings.push(...references.findings);
  skipped.push(...references.skipped);
  const local = localConfigurationChecks(kind, group, spec, status, generation);
  findings.push(...local.findings);
  skipped.push(...local.skipped);
  if (configurationReferences(kind, spec, namespace, group).length) {
    skipped.push('Other host, gateway, policy and reference checks remain incomplete');
  }
  let filtered = findings;
  try {
    const ignored = validationExclusions(annotations);
    const codes = new Set(ignored.codes);
    filtered = ignored.all ? [] : findings.filter(finding => !codes.has(finding.code));
  } catch (error) {
    skipped.push(error instanceof Error ? error.message : 'Unable to parse validation exclusions');
  }
  return {
    findings: filtered,
    skipped,
    suppressed: findings.length - filtered.length,
    coverage: 'partial',
  };
}
