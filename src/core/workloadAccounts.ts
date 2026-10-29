import type { CorrelatedWorkload, CorrelationResource } from './correlation';
import { isDnsSubdomain } from './object';

export function observedPodAccount(
  spec: Record<string, unknown>
): NonNullable<CorrelationResource['podAccount']> {
  const name = spec.serviceAccountName;
  if (name === undefined || name === '')
    return {
      ok: false,
      message: 'Pod service account name was not reported; no default was inferred',
    };
  if (!isDnsSubdomain(name)) return { ok: false, message: 'Pod service account name is malformed' };
  return { ok: true, name };
}

export function workloadPodAccounts(workload: CorrelatedWorkload) {
  const accounts = new Map<string, number>();
  const unavailable: { name: string; uid: string; message: string }[] = [];
  if (workload.pods.length > 1000)
    throw new Error('Workload account evidence exceeds 1000 attributed Pods');
  if (workload.identity.kind === 'WorkloadGroup' && workload.pods.length)
    throw new Error('WorkloadEntries cannot be used as attributed Pod account evidence');
  const uids = new Set<string>();
  for (const pod of workload.pods) {
    if (
      pod.identity.kind !== 'Pod' ||
      pod.identity.group !== '' ||
      pod.identity.cluster !== workload.identity.cluster ||
      pod.identity.namespace !== workload.identity.namespace ||
      !isDnsSubdomain(pod.identity.name) ||
      !pod.identity.uid ||
      pod.identity.uid.length > 1024 ||
      pod.identity.uid.trim() !== pod.identity.uid ||
      uids.has(pod.identity.uid)
    )
      throw new Error('Attributed Pod account evidence is duplicate or outside the workload scope');
    uids.add(pod.identity.uid);
    const account = pod.podAccount;
    if (account?.ok === true) {
      if (!isDnsSubdomain(account.name))
        throw new Error('Attributed Pod account name is malformed');
      accounts.set(account.name, (accounts.get(account.name) ?? 0) + 1);
    } else {
      unavailable.push({
        name: pod.identity.name,
        uid: pod.identity.uid,
        message:
          account?.ok === false
            ? account.message
            : 'Pod service account evidence was not collected',
      });
    }
  }
  return {
    accounts: [...accounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unavailable,
    observedPods: workload.pods.length,
  };
}
