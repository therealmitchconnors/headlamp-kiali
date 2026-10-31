import { validateMeshClusterName } from './config';
import { isLabelKey, isLabelValue, matchesSelector } from './labels';
import {
  ControlPlaneObservation,
  MeshConfigFields,
  meshDiscoverySelectors,
  NamespaceObservation,
  resolvedMeshRoot,
  RevisionTag,
  selectedRevisionTags,
} from './mesh';
import { namespaceRevisionSelection } from './namespaceRevision';
import { isDnsLabel, isDnsSubdomain } from './object';

export interface LocalMembershipController {
  controller: ControlPlaneObservation;
  fields: MeshConfigFields;
}
export interface LocalNamespaceMembership {
  namespace: string;
  controllers: {
    uid: string;
    name: string;
    basis: 'control-plane' | 'root' | 'revision' | 'maistra-key';
  }[];
}
const systemNamespace = /^(kube-.*|openshift.*|ibm.*|kiali-operator|istio-operator)/;

export function localManagedNamespaceProjection(
  logicalName: string,
  namespaces: readonly NamespaceObservation[],
  controllers: readonly LocalMembershipController[],
  tags: readonly RevisionTag[]
) {
  validateMeshClusterName(logicalName);
  if (!controllers.length || controllers.length > 20)
    throw new Error('Local managed scope requires 1 to 20 fully inspected controllers');
  if (namespaces.length > 1000 || tags.length > 200)
    throw new Error('Local managed scope exceeds namespace or revision-tag limits');
  const tagByRevision = selectedRevisionTags(tags).selected;
  const identities = new Set<string>();
  const names = new Set<string>();
  const prepared = controllers.map(({ controller, fields }) => {
    if (
      !controller.uid ||
      identities.has(controller.uid) ||
      !isDnsLabel(controller.namespace) ||
      !isDnsSubdomain(controller.name) ||
      names.has(`${controller.namespace}/${controller.name}`) ||
      !isLabelValue(controller.revision) ||
      controller.clusterId !== logicalName ||
      controller.managesExternal !== false ||
      controller.effectiveConfigBlocked ||
      typeof controller.isMaistra !== 'boolean'
    )
      throw new Error(
        'Local managed scope requires unique, mapped, non-external controllers with resolved provenance'
      );
    identities.add(controller.uid);
    names.add(`${controller.namespace}/${controller.name}`);
    return {
      controller,
      root: resolvedMeshRoot(fields, controller.namespace).namespace,
      selectors: meshDiscoverySelectors(fields),
      revision: tagByRevision.get(controller.revision)?.tag ?? controller.revision,
    };
  });
  const seen = new Set<string>();
  const membership: LocalNamespaceMembership[] = [];
  const excludedSystemNamespaces: string[] = [];
  const unmanagedNamespaces: string[] = [];
  for (const namespace of namespaces) {
    if (
      !isDnsLabel(namespace.name) ||
      seen.has(namespace.name) ||
      Object.entries(namespace.labels).some(
        ([key, value]) => !isLabelKey(key) || !isLabelValue(value)
      )
    )
      throw new Error(
        'Local managed scope requires unique namespace identities and valid label evidence'
      );
    seen.add(namespace.name);
    if (systemNamespace.test(namespace.name)) {
      excludedSystemNamespaces.push(namespace.name);
      continue;
    }
    const selected = namespaceRevisionSelection(namespace.labels);
    if (selected.ok === false) throw new Error(selected.message);
    const matches: LocalNamespaceMembership['controllers'] = [];
    for (const { controller, root, selectors, revision } of prepared) {
      let basis: LocalNamespaceMembership['controllers'][number]['basis'] | undefined;
      if (namespace.name === controller.namespace) basis = 'control-plane';
      else if (namespace.name === root) basis = 'root';
      else if (selected.revision) {
        if (
          selected.basis === 'maistra-member' &&
          !controller.isMaistra &&
          selected.revision === revision
        )
          throw new Error(
            'Maistra membership cannot be certified through a coincident non-Maistra revision'
          );
        const selectedByRevision = controller.isMaistra
          ? selected.revision === controller.namespace
          : selected.revision === revision;
        if (
          selectedByRevision &&
          (!selectors.length ||
            selectors.some(selector => matchesSelector(namespace.labels, selector)))
        )
          basis = controller.isMaistra ? 'maistra-key' : 'revision';
      }
      if (basis)
        matches.push({
          uid: controller.uid,
          name: `${controller.namespace}/${controller.name}`,
          basis,
        });
    }
    if (matches.length) membership.push({ namespace: namespace.name, controllers: matches });
    else unmanagedNamespaces.push(namespace.name);
  }
  if (prepared.some(({ controller }) => !seen.has(controller.namespace)))
    throw new Error(
      'Local managed scope requires the full namespace list, including controller namespaces'
    );
  return {
    logicalName,
    visibility: 'pinned-default-system-exclusion' as const,
    membership,
    excludedSystemNamespaces,
    unmanagedNamespaces,
    controllerNamespaces: [...new Set(prepared.map(({ controller }) => controller.namespace))],
  };
}
