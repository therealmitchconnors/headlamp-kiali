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
import { useCallback, useMemo, useState } from 'react';
import { MeshConfigFields, NamespaceAssociation, namespaceAssociations } from '../core/mesh';
import { namespaceRevisionSelection } from '../core/namespaceRevision';
import { clusterScope } from '../core/scope';
import {
  ConfigurationRead,
  loadMeshSnapshot,
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

export function MeshResults({ snapshot }: { snapshot: MeshSnapshot }) {
  const { t } = useTranslation();
  const [labelledOnly, setLabelledOnly] = useState(true);
  const display = (value: string | undefined) =>
    value === undefined ? t('Not reported') : value === '' ? t('Empty string') : value;
  const complete =
    snapshot.namespaces.complete && snapshot.controllers.complete && snapshot.tags.complete;
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
            'Discovery selects Deployments labeled app=istiod. Standard revision ConfigMaps are inspected without applying Istio defaults or reading Secrets.'
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
            {plane.controller.configurationWarnings.map(message => (
              <Alert key={message} severity="warning">
                {message}
              </Alert>
            ))}
            <Typography>
              {t(
                'Standard and local shared sources are shown below. Only selected fields are merged, without Istio defaults; mounted and external overrides remain unresolved. These are not effective-security findings.'
              )}
            </Typography>
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
                      'The referenced shared ConfigMap is absent. Only the standard configuration contributes to the selected fields.'
                    )}
                  </Alert>
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
                getter: (row: NamespaceAssociation) =>
                  row.complete &&
                  row.controllers.length === 1 &&
                  namespaceContexts.get(row.namespace.name)?.status === 'ready' ? (
                    <Link
                      routeName="kiali-mtls"
                      activeCluster={snapshot.cluster}
                      search={new URLSearchParams({
                        namespace: row.namespace.name,
                        controllerNamespace: row.controllers[0].namespace,
                        controller: row.controllers[0].name,
                      }).toString()}
                    >
                      {t('Inspect configured mTLS')}
                    </Link>
                  ) : (
                    t('Select a controller explicitly')
                  ),
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

function Results({ cluster, attempt }: { cluster: string; attempt: number }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadMeshSnapshot(clusterScope(cluster), signal),
    [cluster]
  );
  const state = useRequest(JSON.stringify([cluster, attempt]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Discovering mesh inventory...')}>
      {snapshot => <MeshResults snapshot={snapshot} />}
    </RequestStatus>
  );
}

function MeshScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <SectionBox title={t('Mesh inventory')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Discover readable namespace labels, local istiod Deployments, revision tags and standard configuration in the selected cluster. Nothing is installed or modified.'
            )}
          </Typography>
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setAttempt(value => value + 1)}
          >
            {t('Discover mesh')}
          </Button>
        </Stack>
      </SectionBox>
      {attempt > 0 && <Results cluster={cluster} attempt={attempt} />}
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
