export type Labels = Readonly<Record<string, string>>;

export interface AppLabels {
  app: string;
  version: string;
}

export interface LabelValue {
  key: string;
  value: string;
}

export interface LabelSelector {
  matchLabels?: Labels;
  matchExpressions?: readonly {
    key: string;
    operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
    values?: readonly string[];
  }[];
}

export const APP_LABELS = [
  'service.istio.io/canonical-name',
  'app.kubernetes.io/name',
  'app',
] as const;
export const VERSION_LABELS = [
  'service.istio.io/canonical-revision',
  'app.kubernetes.io/version',
  'version',
] as const;

const owns = (labels: Labels, key: string) => Object.prototype.hasOwnProperty.call(labels, key);

export function isLabelKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts.length > 2) return false;
  const label = parts[parts.length - 1];
  if (label.length > 63 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(label)) {
    return false;
  }
  return (
    parts.length === 1 ||
    (parts[0].length <= 253 &&
      parts[0]
        .split('.')
        .every(part => part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))
  );
}

function firstLabel(labels: Labels, keys: readonly string[]): LabelValue | null {
  const key = keys.find(key => owns(labels, key));
  return key === undefined ? null : { key, value: labels[key] };
}

/** Presence, including an empty value, determines Kiali's label precedence. */
export function applicationLabels(labels: Labels, override?: AppLabels | null) {
  const custom = override?.app && override?.version;
  return {
    app: firstLabel(labels, custom ? [override.app] : APP_LABELS),
    version: firstLabel(labels, custom ? [override.version] : VERSION_LABELS),
  };
}

function validateSelector(selector: LabelSelector) {
  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (!isLabelKey(key) || typeof value !== 'string') throw new Error('Invalid equality selector');
  }
  for (const expression of selector.matchExpressions ?? []) {
    if (!isLabelKey(expression.key)) throw new Error('Invalid selector key');
    const values = expression.values ?? [];
    if (values.some(value => typeof value !== 'string')) throw new Error('Invalid selector values');
    switch (expression.operator) {
      case 'In':
      case 'NotIn':
        if (values.length === 0) throw new Error('Set-based selectors require values');
        break;
      case 'Exists':
      case 'DoesNotExist':
        if (values.length !== 0) throw new Error('Existence selectors cannot contain values');
        break;
      default:
        throw new Error('Unsupported label selector operator');
    }
  }
}

function matchesValidatedSelector(labels: Labels, selector: LabelSelector): boolean {
  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (!owns(labels, key) || labels[key] !== value) return false;
  }
  return (selector.matchExpressions ?? []).every(expression => {
    const exists = owns(labels, expression.key);
    if (expression.operator === 'Exists') return exists;
    if (expression.operator === 'DoesNotExist') return !exists;
    const included = exists && (expression.values ?? []).includes(labels[expression.key]);
    return expression.operator === 'In' ? included : !included;
  });
}

export function matchesSelector(labels: Labels, selector: LabelSelector): boolean {
  validateSelector(selector);
  return matchesValidatedSelector(labels, selector);
}

export interface LabeledResource {
  identity: { cluster: string; namespace?: string };
}

/** Equality postings reduce the candidate set; expressions still receive full evaluation. */
export function labelIndex<T extends LabeledResource>(
  items: readonly T[],
  getLabels: (item: T) => Labels
) {
  const scopes = new Map<string, T[]>();
  const postings = new Map<string, T[]>();
  for (const item of items) {
    const scope = [item.identity.cluster, item.identity.namespace ?? ''];
    const scopeKey = JSON.stringify(scope);
    const scoped = scopes.get(scopeKey) ?? [];
    scoped.push(item);
    scopes.set(scopeKey, scoped);
    for (const [key, value] of Object.entries(getLabels(item))) {
      const postingKey = JSON.stringify([...scope, key, value]);
      const posting = postings.get(postingKey) ?? [];
      posting.push(item);
      postings.set(postingKey, posting);
    }
  }
  return {
    select(cluster: string, namespace: string, selector: LabelSelector): T[] {
      validateSelector(selector);
      const scope = [cluster, namespace];
      let candidates = scopes.get(JSON.stringify(scope)) ?? [];
      for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
        const posting = postings.get(JSON.stringify([...scope, key, value])) ?? [];
        if (posting.length < candidates.length) candidates = posting;
      }
      return candidates.filter(item => matchesValidatedSelector(getLabels(item), selector));
    },
  };
}
