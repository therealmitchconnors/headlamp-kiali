import { trimGoSpace } from './goStrings';
import { isRecord } from './object';
import type { Finding } from './validation';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE'];

export function validAuthorizationMethod(value: string): boolean {
  const method = trimGoSpace(value);
  if (!method) return false;
  if (method === '*') return true;
  const prefix = method.endsWith('*') && !method.startsWith('*');
  const suffix = method.startsWith('*') && !method.endsWith('*');
  const pattern = prefix ? method.slice(0, -1) : suffix ? method.slice(1) : method;
  // Go uses simple Unicode case mappings, not multi-character JS expansions.
  const upper = Array.from(pattern, character => {
    const mapped = character.toUpperCase();
    return mapped.length === 1 ? mapped : character;
  }).join('');
  return METHODS.some(candidate =>
    prefix
      ? !!upper && candidate.startsWith(upper)
      : suffix
      ? !!upper && candidate.endsWith(upper)
      : candidate === upper
  );
}

export function matchesAuthorizationNamespace(
  pattern: string,
  namespaces: readonly string[]
): boolean {
  if (pattern === '*') return namespaces.length > 0;
  if (namespaces.includes(pattern)) return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return !!prefix && namespaces.some(namespace => namespace.startsWith(prefix));
  }
  if (pattern.startsWith('*')) {
    const suffix = pattern.slice(1);
    return !!suffix && namespaces.some(namespace => namespace.endsWith(suffix));
  }
  return false;
}

interface Target {
  value: string;
  path: string;
}
type Targets =
  | { complete: true; methods: Target[]; namespaces: Target[] }
  | { complete: false; message: string };
export function authorizationPolicyTargets(spec: Record<string, unknown>): Targets {
  const methods: Target[] = [];
  const namespaces: Target[] = [];
  let groups = 0;
  try {
    function list(value: unknown, path: string, maximum: number): unknown[] {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || value.length > maximum)
        throw new Error(`${path}: invalid list or more than ${maximum} entries`);
      return value;
    }
    list(spec.rules, 'spec/rules', 100).forEach((rule, ruleIndex) => {
      if (rule === null) return;
      if (!isRecord(rule)) throw new Error(`spec/rules[${ruleIndex}]: invalid authorization rule`);
      for (const [direction, source, field, targets] of [
        ['from', 'source', 'namespaces', namespaces],
        ['to', 'operation', 'methods', methods],
      ] as const) {
        const path = `spec/rules[${ruleIndex}]/${direction}`;
        list(rule[direction], path, 100).forEach((entry, entryIndex) => {
          if (++groups > 1000) throw new Error('Authorization checks exceed 1000 rule groups');
          if (entry === null) return;
          if (!isRecord(entry)) throw new Error(`${path}[${entryIndex}]: invalid rule group`);
          const selector = entry[source];
          if (selector === undefined || selector === null) return;
          if (!isRecord(selector))
            throw new Error(`${path}[${entryIndex}]/${source}: invalid object`);
          const location = `${path}[${entryIndex}]/${source}/${field}`;
          list(selector[field], location, 200).forEach((value, index) => {
            if (typeof value !== 'string' || value.length > 512)
              throw new Error(`${location}[${index}]: invalid or oversized pattern`);
            targets.push({ value, path: `${location}[${index}]` });
            if (methods.length + namespaces.length > 200)
              throw new Error('Authorization checks exceed 200 method/namespace patterns');
          });
        });
      }
    });
    return { complete: true, methods, namespaces };
  } catch (error) {
    return {
      complete: false,
      message: error instanceof Error ? error.message : 'Unable to read authorization targets',
    };
  }
}

export function authorizationPolicyChecks(
  kind: string,
  group: string,
  spec: Record<string, unknown>,
  namespaces: readonly string[] | null
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'AuthorizationPolicy' || group !== 'security.istio.io') return { findings, skipped };
  const targets = authorizationPolicyTargets(spec);
  if (targets.complete === false) return { findings, skipped: [targets.message] };
  for (const target of targets.methods)
    if (!validAuthorizationMethod(target.value))
      findings.push({
        code: 'KIA0102',
        severity: 'warning',
        path: target.path,
        message: 'Only HTTP methods and Istio wildcards are allowed',
      });
  if (targets.namespaces.length && (!namespaces || namespaces.length > 1000)) {
    skipped.push('Authorization namespace patterns require a complete bounded namespace list');
  } else if (namespaces) {
    for (const target of targets.namespaces)
      if (!matchesAuthorizationNamespace(target.value, namespaces))
        findings.push({
          code: 'KIA0101',
          severity: 'warning',
          path: target.path,
          message: 'Namespace not found for this rule',
        });
  }
  return { findings, skipped };
}
