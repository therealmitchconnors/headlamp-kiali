import { isLabelValue } from './labels';
import { isRecord } from './object';

const keys = {
  revision: 'istio.io/rev',
  injection: 'istio-injection',
  ambient: 'istio.io/dataplane-mode',
  member: 'maistra.io/member-of',
  ignore: 'maistra.io/ignore-namespace',
} as const;
export type NamespaceRevisionBasis =
  | 'maistra-member'
  | 'injection-enabled'
  | 'ambient-default'
  | 'revision-label'
  | 'unselected';
export type NamespaceRevisionSelection =
  | {
      ok: true;
      revision: string;
      basis: NamespaceRevisionBasis;
      labelled: boolean;
      maistraIgnored: boolean;
    }
  | { ok: false; message: string; labelled: boolean };

export function namespaceRevisionSelection(value: unknown): NamespaceRevisionSelection {
  const labels = value === undefined || value === null ? {} : value;
  const owns = (key: string) =>
    isRecord(labels) && Object.prototype.hasOwnProperty.call(labels, key);
  const labelled = Object.values(keys).some(owns);
  if (!isRecord(labels) || Object.values(keys).some(key => owns(key) && !isLabelValue(labels[key])))
    return {
      ok: false,
      labelled,
      message: 'Namespace revision labels must be bounded Kubernetes label values',
    };
  const read = (key: string): string => (owns(key) ? String(labels[key]) : '');
  const maistraIgnored = owns(keys.ignore);
  let revision = read(keys.revision);
  let basis: NamespaceRevisionBasis = owns(keys.revision) ? 'revision-label' : 'unselected';
  if (!maistraIgnored && owns(keys.member)) {
    revision = read(keys.member);
    basis = 'maistra-member';
  } else if (read(keys.injection) === 'enabled') {
    revision = 'default';
    basis = 'injection-enabled';
  } else if (!owns(keys.revision) && read(keys.ambient) === 'ambient') {
    revision = 'default';
    basis = 'ambient-default';
  }
  return { ok: true, revision, basis, labelled, maistraIgnored };
}
