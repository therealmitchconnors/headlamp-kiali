import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import {
  controllerLocalIdentity,
  MeshConfigFields,
  NamespaceAssociation,
  namespaceAssociations,
  selectedRevisionTags,
} from '../core/mesh';
import { namespaceRevisionSelection } from '../core/namespaceRevision';
import { clusterScope } from '../core/scope';
import {
  ConfigurationRead,
  loadMeshSnapshot,
  localManagedNamespaceScope,
  MeshControlPlane,
  MeshSnapshot,
  namespaceMeshConfiguration,
} from '../data/mesh';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import StructuredValue from './configuration/StructuredValue';
import RequestStatus from './RequestStatus';

function ConfigRead<T>({
  read,
  namespace,
  cluster,
  children,
}: {
  read: ConfigurationRead<T>;
  namespace: string;
  cluster: string;
  children: (value: T) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      {read.name ? (
        <Link routeName="configmap" activeCluster={cluster} params={{ namespace, name: read.name }}>
          {namespace}/{read.name}
        </Link>
      ) : (
        t('Configuration name unresolved')
      )}
      {read.status === 'ready' && read.source && (
        <Typography variant="body2">
          {t('ConfigMap key: {{key}}; UID: {{uid}}; resource version: {{version}}', {
            key: read.source.key,
            uid: read.source.uid ?? t('Not reported'),
            version: read.source.resourceVersion ?? t('Not reported'),
          })}
        </Typography>
      )}
      {read.status === 'ready' ? (
        children(read.value)
      ) : read.status === 'error' ? (
        <Alert severity="warning">{read.error.message}</Alert>
      ) : (
        <Alert severity="warning">
          {t('Configuration lookup stopped at the 20-controller limit.')}
        </Alert>
      )}
    </Stack>
  );
}

export function MeshResults({
  snapshot,
  logicalName,
}: {
  snapshot: MeshSnapshot;
  logicalName?: string;
}) {
  const { t } = useTranslation();
  const [labelledOnly, setLabelledOnly] = useState(true);
  const display = (value: string | undefined) =>
    value === undefined ? t('Not reported') : value === '' ? t('Empty string') : value;
  const complete =
    snapshot.namespaces.complete && snapshot.controllers.complete && snapshot.tags.complete;
  const tagSelection = selectedRevisionTags(snapshot.tags.items);
  const namespaceContexts = useMemo(
    () =>
      new Map(
        snapshot.namespaces.items.map(namespace => [
          namespace.name,
          namespaceMeshConfiguration(snapshot, namespace.name),
        ])
      ),
    [snapshot]
  );
  const managedScope = useMemo(() => {
    if (logicalName === undefined) return undefined;
    try {
      return { ok: true as const, value: localManagedNamespaceScope(snapshot, logicalName) };
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : 'Declared local namespace scope is unavailable',
      };
    }
  }, [snapshot, logicalName]);
  const associations = namespaceAssociations(
    snapshot.namespaces.items,
    snapshot.controllers.items,
    snapshot.tags.items,
    complete
  ).filter(
    association =>
      !labelledOnly ||
      association.mode !== 'unselected' ||
      namespaceRevisionSelection(association.namespace.labels).labelled
  );
  const modeNames: Record<NamespaceAssociation['mode'], string> = {
    ambient: t('Ambient label'),
    revision: t('Revision label'),
    default: t('Default injection label'),
    disabled: t('Injection disabled label'),
    unselected: t('No namespace injection label'),
    conflicting: t('Conflicting injection labels'),
    unknown: t('Unrecognized injection label'),
  };
  const meshFields = (mesh: MeshConfigFields) => (
    <>
      <SimpleTable
        data={[mesh]}
        columns={[
          { label: t('Configured root namespace'), getter: value => display(value.rootNamespace) },
          { label: t('Configured trust domain'), getter: value => display(value.trustDomain) },
          {
            label: t('Outbound policy in configuration'),
            getter: value =>
              value.outboundTrafficPolicy
                ? value.outboundTrafficPolicy.basis === 'explicit'
                  ? value.outboundTrafficPolicy.mode
                  : t('REGISTRY_ONLY (protobuf default for an empty policy)')
                : t('Not reported'),
          },
          {
            label: t('Trust domain aliases'),
            getter: value =>
              value.trustDomainAliases === undefined
                ? t('Not reported')
                : value.trustDomainAliases.join(', ') || t('Empty list'),
          },
          {
            label: t('Configured automatic mTLS'),
            getter: value =>
              value.enableAutoMtls === undefined
                ? t('Not reported')
                : value.enableAutoMtls
                ? t('True')
                : t('False'),
          },
        ]}
      />
      <SimpleTable
        data={[
          {
            setting: t('Default DestinationRule export'),
            values: mesh.defaultDestinationRuleExportTo,
          },
          {
            setting: t('Default VirtualService export'),
            values: mesh.defaultVirtualServiceExportTo,
          },
          { setting: t('Default Service export'), values: mesh.defaultServiceExportTo },
        ]}
        columns={[
          { label: t('Mesh export setting'), getter: item => item.setting },
          {
            label: t('Configured namespaces'),
            getter: item =>
              item.values === undefined
                ? t('Not reported')
                : item.values.join(', ') || t('Empty list'),
          },
        ]}
      />
      {mesh.hasDiscoverySelectors && (
        <details>
          <summary>{t('Configured discovery selectors')}</summary>
          <StructuredValue value={mesh.discoverySelectors} />
        </details>
      )}
    </>
  );
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {t(
          'Read-only local mesh inventory. Replica availability and configuration labels do not prove proxy synchronization, effective mTLS, certificates, connectivity or workload membership. Configured Istio discovery selectors are evaluated only for resolved local controller context. Remote control planes and Kiali-server discovery overrides are not resolved.'
        )}
      </Alert>
      <Typography variant="body2">
        {logicalName === undefined
          ? t(
              'No logical mesh cluster name was captured. Local-management comparison is unavailable; no context or telemetry identity is substituted.'
            )
          : t(
              'Captured logical mesh cluster name: {{name}} (explicit setting). ID comparison is independent of EXTERNAL_ISTIOD and does not clear configuration or topology guards.',
              { name: logicalName }
            )}
      </Typography>
      {(
        [
          [t('Namespaces'), snapshot.namespaces],
          [t('Control-plane Deployments'), snapshot.controllers],
          [t('Revision tags'), snapshot.tags],
        ] as const
      ).map(
        ([name, source]) =>
          !source.complete && (
            <Alert severity="warning" key={name}>
              {t('{{source}} inventory is incomplete.', { source: name })}{' '}
              {source.error?.message ?? t('The collection page limit was reached.')}
            </Alert>
          )
      )}
      <SectionBox title={t('Local control planes')}>
        <Typography variant="body2">
          {t(
            'Discovery selects Deployments labeled app=istiod. Configuration observations use the first declared container, matching pinned Kiali discovery, not a search for a discovery-named container. Standard revision or supported mounted ConfigMaps are inspected without applying Istio defaults or reading Secrets.'
          )}
        </Typography>
        <Typography variant="body2">
          {t(
            'Environment order is preserved: the last CLUSTER_ID and SHARED_MESH_CONFIG declarations win, including empty clears. Exact EXTERNAL_ISTIOD=true declarations accumulate; later false values do not undo them. Indirect or noncanonical external values remain unresolved. These observations do not certify managed-cluster membership.'
          )}
        </Typography>
        <SimpleTable
          data={snapshot.controlPlanes}
          emptyMessage={
            snapshot.controllers.complete
              ? t(
                  'No matching local controller Deployments were returned. A remote or custom-labeled control plane may still exist.'
                )
              : t('Controller inventory is unavailable from this incomplete response.')
          }
          columns={[
            {
              label: t('Deployment'),
              getter: (plane: MeshControlPlane) => (
                <Link
                  routeName="deployment"
                  activeCluster={snapshot.cluster}
                  params={{ namespace: plane.controller.namespace, name: plane.controller.name }}
                >
                  {plane.controller.namespace}/{plane.controller.name}
                </Link>
              ),
            },
            {
              label: t('First container'),
              getter: (plane: MeshControlPlane) => display(plane.controller.configurationContainer),
            },
            {
              label: t('Revision'),
              getter: (plane: MeshControlPlane) => display(plane.controller.revision),
            },
            {
              label: t('Available / desired replicas'),
              getter: (plane: MeshControlPlane) => {
                const replicas = plane.controller.replicas;
                return replicas ? (
                  <StatusLabel
                    status={
                      !plane.controller.stale &&
                      replicas.desiredReplicas > 0 &&
                      replicas.availableReplicas >= replicas.desiredReplicas
                        ? 'success'
                        : 'warning'
                    }
                  >
                    {replicas.availableReplicas}/{replicas.desiredReplicas}
                    {plane.controller.stale ? ` (${t('Stale status')})` : ''}
                  </StatusLabel>
                ) : (
                  t('Not reported')
                );
              },
            },
            {
              label: t('Controller CLUSTER_ID'),
              getter: (plane: MeshControlPlane) => display(plane.controller.clusterId),
            },
            {
              label: t('Controller image (not a runtime version probe)'),
              getter: (plane: MeshControlPlane) => display(plane.controller.image),
            },
          ]}
        />
      </SectionBox>
      {snapshot.controlPlanes.length > 20 && (
        <Alert severity="warning">
          {t(
            'Configuration details are limited to the first 20 controllers; the controller table retains the remaining observed entries.'
          )}
        </Alert>
      )}
      {snapshot.controlPlanes.slice(0, 20).map(plane => (
        <SectionBox
          key={plane.controller.uid}
          title={`${plane.controller.namespace}/${plane.controller.name}`}
        >
          <Stack spacing={2}>
            <Typography variant="body2">
              {
                {
                  matched: t(
                    'Declared controller ID matches the captured logical cluster name. This is the pinned local-management comparison, not a complete managed-cluster or namespace inventory.'
                  ),
                  different: t(
                    'Declared controller ID differs from the captured logical cluster name. No local-management association is inferred.'
                  ),
                  unavailable: t(
                    'Local-management comparison is unavailable without both a captured logical cluster name and a literal controller ID.'
                  ),
                }[controllerLocalIdentity(plane.controller.clusterId, logicalName)]
              }
            </Typography>
            {plane.controller.configurationWarnings.map(message => (
              <Alert key={message} severity="warning">
                {message}
              </Alert>
            ))}
            <Typography>
              {t(
                'The selected local and optional shared sources are shown below. A supported mounted mesh file replaces the standard source; local fields take precedence over shared fields. Only selected fields are merged, without Istio defaults. Unsupported overrides and external topology remain unresolved. These are not effective-security findings.'
              )}
            </Typography>
            <Typography variant="h6">
              {plane.controller.meshConfigSource?.kind === 'mounted'
                ? t('Mounted mesh configuration')
                : t('Standard mesh configuration')}
            </Typography>
            {plane.controller.meshConfigSource?.kind === 'mounted' && (
              <Typography>
                {t('Declared mesh file: {{path}}', {
                  path: plane.controller.meshConfigSource.path,
                })}
              </Typography>
            )}
            <ConfigRead
              read={plane.mesh}
              namespace={plane.controller.namespace}
              cluster={snapshot.cluster}
            >
              {meshFields}
            </ConfigRead>
            {plane.shared && (
              <>
                <Typography variant="h6">{t('Shared mesh configuration')}</Typography>
                <ConfigRead
                  read={plane.shared}
                  namespace={plane.controller.namespace}
                  cluster={snapshot.cluster}
                >
                  {meshFields}
                </ConfigRead>
              </>
            )}
            <Typography variant="h6">
              {t('Selected merged fields (no runtime defaults)')}
            </Typography>
            {plane.effective?.status === 'ready' ? (
              <>
                {plane.effective.sharedAbsent && (
                  <Alert severity="warning">
                    {t(
                      'The referenced shared ConfigMap is absent. Only the selected local configuration contributes to the selected fields.'
                    )}
                  </Alert>
                )}
                {plane.effective.sources && (
                  <details>
                    <summary>{t('Captured mesh configuration sources')}</summary>
                    <StructuredValue value={plane.effective.sources} />
                  </details>
                )}
                {meshFields(plane.effective.value)}
              </>
            ) : (
              <Alert severity="warning">
                {plane.effective?.message ?? t('Merged configuration is unavailable.')}
              </Alert>
            )}
            <ConfigRead
              read={plane.injector}
              namespace={plane.controller.namespace}
              cluster={snapshot.cluster}
            >
              {injector => (
                <SimpleTable
                  data={[injector]}
                  columns={[
                    { label: t('Configured network'), getter: value => display(value.network) },
                    { label: t('Configured mesh ID'), getter: value => display(value.meshId) },
                    {
                      label: t('Configured cluster DNS suffix'),
                      getter: value => display(value.clusterDomain),
                    },
                    {
                      label: t('Service DNS identity suffix from injector configuration'),
                      getter: value => display(value.serviceIdentityDomain),
                    },
                  ]}
                />
              )}
            </ConfigRead>
          </Stack>
        </SectionBox>
      ))}
      {managedScope && (
        <SectionBox title={t('Declared local namespace scope')}>
          <Stack spacing={1}>
            <Typography variant="body2">
              {t(
                'This projection supports only fully captured, explicitly mapped local controllers and default Kiali namespace visibility. System namespaces are excluded before visible controller/root exceptions are applied. It does not discover remote contexts, apply custom Kiali visibility overrides, choose a unique controller, or prove runtime mesh membership.'
              )}
            </Typography>
            {managedScope.ok === false ? (
              <Alert severity="warning">{managedScope.message}</Alert>
            ) : (
              <>
                <Typography>
                  {t(
                    'Captured local scope: {{managed}} eligible namespaces; {{unmanaged}} without a declared association; {{excluded}} excluded by default visibility.',
                    {
                      managed: managedScope.value.membership.length,
                      unmanaged: managedScope.value.unmanagedNamespaces.length,
                      excluded: managedScope.value.excludedSystemNamespaces.length,
                    }
                  )}
                </Typography>
                <SimpleTable
                  data={managedScope.value.membership}
                  columns={[
                    {
                      label: t('Namespace'),
                      getter: item => (
                        <Link
                          routeName="namespace"
                          params={{ cluster: snapshot.cluster, name: item.namespace }}
                        >
                          {item.namespace}
                        </Link>
                      ),
                    },
                    {
                      label: t('Declaring controllers (captured order)'),
                      getter: item =>
                        item.controllers
                          .map(
                            controller =>
                              `${controller.name}: ${
                                {
                                  'control-plane': t('Controller namespace'),
                                  root: t('Configured root namespace'),
                                  revision: t('Revision or selected tag'),
                                  'maistra-key': t('Maistra namespace key'),
                                }[controller.basis]
                              }`
                          )
                          .join(', '),
                    },
                  ]}
                />
                <details>
                  <summary>{t('Show namespaces outside the local projection')}</summary>
                  <SimpleTable
                    data={[
                      ...managedScope.value.unmanagedNamespaces.map(namespace => ({
                        namespace,
                        reason: t('No declared local association'),
                      })),
                      ...managedScope.value.excludedSystemNamespaces.map(namespace => ({
                        namespace,
                        reason: t('Excluded by default Kiali visibility'),
                      })),
                    ]}
                    columns={[
                      { label: t('Namespace'), getter: item => item.namespace },
                      { label: t('Reason'), getter: item => item.reason },
                    ]}
                  />
                </details>
              </>
            )}
          </Stack>
        </SectionBox>
      )}
      <SectionBox title={t('Namespace injection labels and revision hints')}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Matching labels and revision tags are hints, not proof of actual injection. Workload overrides, webhook selectors and discovery selectors may change behavior. Ambiguous or incomplete matches are not resolved automatically.'
            )}
          </Typography>
          <Typography variant="body2">
            {t(
              'The pinned Kiali revision selector is a separate label projection, not a resolved controller or managed-namespace inventory. It preserves Maistra membership/ignore presence, enabled-injection precedence and the ambient default. Control-plane/root namespace exceptions and actual injection require separate evidence.'
            )}
          </Typography>
          <Typography variant="body2">
            {t(
              'Same-context tag matching selects the first captured webhook for each revision. A selected tag replaces that revision as the namespace lookup key; later aliases are not combined. This is not complete cross-cluster tag assignment or mesh membership.'
            )}
          </Typography>
          <details>
            <summary>{t('Show captured revision-tag precedence')}</summary>
            <SimpleTable
              data={snapshot.tags.items}
              columns={[
                { label: t('Webhook'), getter: tag => tag.name },
                {
                  label: t('Revision label'),
                  getter: tag => tag.revision || t('Empty or missing'),
                },
                { label: t('Tag label'), getter: tag => tag.tag || t('Explicit empty tag') },
                {
                  label: t('Selection'),
                  getter: tag =>
                    tagSelection.selected.get(tag.revision) === tag
                      ? t('First webhook (selected)')
                      : t('Later webhook (ignored)'),
                },
              ]}
            />
          </details>
          <FormControlLabel
            label={t('Show only mesh-labeled namespaces')}
            control={
              <Switch
                checked={labelledOnly}
                onChange={event => setLabelledOnly(event.target.checked)}
              />
            }
          />
          <SimpleTable
            data={associations}
            columns={[
              {
                label: t('Namespace'),
                getter: (row: NamespaceAssociation) => (
                  <Link
                    routeName="namespace"
                    activeCluster={snapshot.cluster}
                    params={{ name: row.namespace.name }}
                  >
                    {row.namespace.name}
                  </Link>
                ),
              },
              {
                label: t('Label mode'),
                getter: (row: NamespaceAssociation) => modeNames[row.mode],
              },
              {
                label: t('Requested revision / tag'),
                getter: (row: NamespaceAssociation) => display(row.requestedRevision),
              },
              {
                label: t('Pinned Kiali revision candidate'),
                getter: (row: NamespaceAssociation) => {
                  const selection = namespaceRevisionSelection(row.namespace.labels);
                  if (selection.ok === false)
                    return <Typography color="warning.main">{selection.message}</Typography>;
                  const basis = {
                    'maistra-member': t('Maistra membership label'),
                    'injection-enabled': t('Enabled injection takes precedence'),
                    'ambient-default': t('Ambient without a revision uses default'),
                    'revision-label': t('Explicit revision label'),
                    unselected: t('No revision selected by labels'),
                  };
                  return (
                    <Stack spacing={0.5}>
                      <Typography>
                        {selection.revision ||
                          (selection.basis === 'unselected'
                            ? t('No candidate')
                            : t('Explicit empty selection'))}
                      </Typography>
                      <Typography variant="caption">{basis[selection.basis]}</Typography>
                      {selection.maistraIgnored && (
                        <Typography variant="caption">
                          {t('Maistra ignore label is present; its value is not a boolean switch.')}
                        </Typography>
                      )}
                    </Stack>
                  );
                },
              },
              {
                label: t('Matching local controller labels'),
                getter: (row: NamespaceAssociation) =>
                  row.controllers
                    .map(controller => `${controller.namespace}/${controller.name}`)
                    .join(', ') || t('No match'),
              },
              {
                label: t('Evidence'),
                getter: (row: NamespaceAssociation) =>
                  !row.complete
                    ? t('Incomplete discovery')
                    : row.controllers.length > 1
                    ? t('Ambiguous match')
                    : row.controllers.length === 1
                    ? t('Label match only')
                    : t('Unresolved or not selected'),
              },
              {
                label: t('Configuration assessment'),
                getter: (row: NamespaceAssociation) => {
                  const context = namespaceContexts.get(row.namespace.name);
                  const plane =
                    context?.status === 'ready'
                      ? snapshot.controlPlanes.find(
                          plane =>
                            `${plane.controller.namespace}/${plane.controller.name}` ===
                            context.controller
                        )
                      : undefined;
                  return row.complete && plane ? (
                    <Link
                      routeName="kiali-mtls"
                      params={{ cluster: snapshot.cluster }}
                      search={new URLSearchParams({
                        namespace: row.namespace.name,
                        controllerNamespace: plane.controller.namespace,
                        controller: plane.controller.name,
                      }).toString()}
                    >
                      {t('Inspect configured mTLS')}
                    </Link>
                  ) : (
                    t('Select a controller explicitly')
                  );
                },
              },
            ]}
          />
        </Stack>
      </SectionBox>
      <SectionBox title={t('Namespace configuration context')}>
        <Stack spacing={1}>
          <Typography>
            {t(
              'Discovery selector matches describe configured namespace scope, not actual injection, traffic or health. Ambiguous controller associations and malformed selectors remain unresolved.'
            )}
          </Typography>
          <SimpleTable
            data={associations}
            columns={[
              { label: t('Namespace'), getter: (row: NamespaceAssociation) => row.namespace.name },
              {
                label: t('Resolved local controller'),
                getter: (row: NamespaceAssociation) => {
                  const context = namespaceContexts.get(row.namespace.name);
                  return context?.status === 'ready' ? context.controller : t('Unavailable');
                },
              },
              {
                label: t('Configuration scope'),
                getter: (row: NamespaceAssociation) => {
                  const context = namespaceContexts.get(row.namespace.name);
                  if (context?.status !== 'ready') return context?.message ?? t('Unavailable');
                  return context.discovery === 'implicit'
                    ? t('Control-plane or root namespace exception')
                    : context.discovery === 'selector'
                    ? t('Matched configured discovery selector')
                    : t('No configured discovery restriction');
                },
              },
              {
                label: t('Resolved root namespace'),
                getter: (row: NamespaceAssociation) => {
                  const context = namespaceContexts.get(row.namespace.name);
                  if (context?.status !== 'ready' || !context.root) return t('Unavailable');
                  return context.root.basis === 'configured'
                    ? context.root.namespace
                    : t('{{namespace}} (controller-namespace fallback)', {
                        namespace: context.root.namespace,
                      });
                },
              },
            ]}
          />
        </Stack>
      </SectionBox>
    </Stack>
  );
}

function Results({
  cluster,
  attempt,
  logicalName,
}: {
  cluster: string;
  attempt: number;
  logicalName?: string;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadMeshSnapshot(clusterScope(cluster), signal),
    [cluster]
  );
  const state = useRequest(JSON.stringify([cluster, attempt]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Discovering mesh inventory...')}>
      {snapshot => <MeshResults snapshot={snapshot} logicalName={logicalName} />}
    </RequestStatus>
  );
}

function MeshScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const configuration = useKialiConfig();
  const logicalName = configuration.valid
    ? getClusterConfig(configuration.config, cluster).meshClusterName ?? undefined
    : undefined;
  const identityKey = JSON.stringify([configuration.valid, logicalName]);
  const [capture, setCapture] = useState<{
    attempt: number;
    identityKey: string;
    logicalName?: string;
  }>();
  useEffect(() => setCapture(undefined), [identityKey]);
  return (
    <>
      <SectionBox title={t('Mesh inventory')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Discover readable namespace labels, local istiod Deployments, revision tags and standard configuration in the selected cluster. Nothing is installed or modified.'
            )}
          </Typography>
          {configuration.valid === false && (
            <Alert severity="warning">{configuration.message}</Alert>
          )}
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              setCapture(current => ({
                attempt: (current?.attempt ?? 0) + 1,
                identityKey,
                logicalName,
              }))
            }
          >
            {t('Discover mesh')}
          </Button>
        </Stack>
      </SectionBox>
      {capture && capture.identityKey === identityKey && (
        <Results cluster={cluster} attempt={capture.attempt} logicalName={capture.logicalName} />
      )}
    </>
  );
}

export default function Mesh() {
  return (
    <ClusterScope>
      {scope => <MeshScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
