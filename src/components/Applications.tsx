import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import {
  Application,
  CorrelatedWorkload,
  correlateResources,
  CorrelationResource,
} from '../core/correlation';
import { AppLabels } from '../core/labels';
import { isDnsLabel } from '../core/object';
import { namespaceScope } from '../core/scope';
import { loadCorrelationSnapshot } from '../data/correlation';
import { useRequest } from '../hooks/useRequest';
import ApplicationDashboards from './ApplicationDashboards';
import ClusterScope from './ClusterScope';
import ResourceName from './CorrelatedResourceName';
import RequestStatus from './RequestStatus';
import WorkloadAccounts from './WorkloadAccounts';
import WorkloadLabelSource from './WorkloadLabelSource';

function ApplicationDetails({
  app,
  complete,
  labels,
}: {
  app: Application;
  complete: boolean;
  labels: AppLabels | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SectionBox
        title={t('Application: {{name}}', { name: app.name || t('Empty application label') })}
      >
        <Typography>
          {t('Cluster: {{cluster}}; namespace: {{namespace}}', {
            cluster: app.cluster,
            namespace: app.namespace,
          })}
        </Typography>
        <Link
          routeName="kiali-health"
          activeCluster={app.cluster}
          search={new URLSearchParams({
            kind: 'Application',
            namespace: app.namespace,
            name: app.name,
          }).toString()}
        >
          {t('Inspect application health')}
        </Link>
        {!complete && (
          <Alert severity="warning">
            {t(
              'These relationships are incomplete. Counts and missing links must not be interpreted as complete mesh state.'
            )}
          </Alert>
        )}
      </SectionBox>
      <ApplicationDashboards
        key={JSON.stringify([app.id, app.pods.map(pod => [pod.identity.uid, pod.resourceVersion])])}
        app={app}
        complete={complete}
        labels={labels}
      />
      <SectionBox title={t('Associated workloads')}>
        <Alert severity="info">
          {t(
            'Pod account names come from spec.serviceAccountName on UID-attributed Pods in this captured namespace. They do not prove ServiceAccount existence, permissions, a trust domain or complete mesh account coverage. Missing names do not become default, and VM entry accounts are separate.'
          )}
        </Alert>
        {app.workloads.some(workload => workload.resource.virtualMachine) && (
          <Alert severity="info">
            {t(
              'VM workload labels follow the first selector-matched WorkloadEntry in the captured list, or the WorkloadGroup selector labels when none match. Entry order can affect labels. WorkloadEntries are not Pods; proxy, account and replica-health evidence is not inferred, and VM traffic creation is not supported by the current wizard.'
            )}
          </Alert>
        )}
        <SimpleTable
          data={app.workloads}
          columns={[
            {
              label: t('Name'),
              sort: (a: CorrelatedWorkload, b: CorrelatedWorkload) =>
                a.identity.name.localeCompare(b.identity.name),
              getter: (workload: CorrelatedWorkload) => (
                <ResourceName resource={workload.resource} />
              ),
            },
            { label: t('Kind'), getter: (workload: CorrelatedWorkload) => workload.identity.kind },
            {
              label: t('Observed Pod accounts'),
              getter: (workload: CorrelatedWorkload) => <WorkloadAccounts workload={workload} />,
            },
            {
              label: t('Label evidence'),
              getter: (workload: CorrelatedWorkload) => (
                <WorkloadLabelSource {...workload.resource} />
              ),
            },
            {
              label: t('Application label'),
              getter: (workload: CorrelatedWorkload) => workload.app?.key,
            },
            {
              label: t('Version'),
              getter: (workload: CorrelatedWorkload) =>
                workload.version === null
                  ? t('Not labeled')
                  : workload.version.value === ''
                  ? t('Empty label')
                  : workload.version.value,
            },
          ]}
        />
      </SectionBox>
      <SectionBox title={t('Services matching workload labels')}>
        <SimpleTable
          data={app.services}
          columns={[
            {
              label: t('Name'),
              sort: (a: CorrelationResource, b: CorrelationResource) =>
                a.identity.name.localeCompare(b.identity.name),
              getter: (service: CorrelationResource) => <ResourceName resource={service} />,
            },
            {
              label: t('Selector'),
              getter: (service: CorrelationResource) =>
                Object.entries(service.serviceSelector ?? {})
                  .map(([key, value]) => `${key}=${value}`)
                  .join(', '),
            },
          ]}
          emptyMessage={
            complete
              ? t('No Service selectors match these workload labels.')
              : t('No Service matches could be established from the available data.')
          }
        />
      </SectionBox>
      <SectionBox title={t('Observed owned pods')}>
        <SimpleTable
          data={app.pods}
          columns={[
            {
              label: t('Name'),
              sort: (a: CorrelationResource, b: CorrelationResource) =>
                a.identity.name.localeCompare(b.identity.name),
              getter: (pod: CorrelationResource) => <ResourceName resource={pod} />,
            },
            {
              label: t('Proxy container'),
              getter: (pod: CorrelationResource) =>
                pod.proxyMode === 'native-sidecar'
                  ? t('Native sidecar')
                  : pod.proxyMode === 'sidecar'
                  ? t('Sidecar')
                  : t('Not detected'),
            },
            {
              label: t('Observed service account'),
              getter: (pod: CorrelationResource) =>
                pod.podAccount?.ok
                  ? pod.podAccount.name
                  : pod.podAccount?.ok === false
                  ? pod.podAccount.message
                  : t('Not collected'),
            },
            {
              label: t('Diagnostics'),
              getter: (pod: CorrelationResource) => (
                <Link
                  routeName="kiali-diagnostics"
                  activeCluster={pod.identity.cluster}
                  search={new URLSearchParams({
                    namespace: pod.identity.namespace,
                    pod: pod.identity.name,
                  }).toString()}
                >
                  {t('Inspect pod diagnostics')}
                </Link>
              ),
            },
          ]}
          emptyMessage={
            complete
              ? t('No owned pods were found.')
              : t('Pod ownership could not be completely determined.')
          }
        />
      </SectionBox>
    </>
  );
}

function ApplicationSnapshot({
  cluster,
  namespace,
  labels,
  refresh,
  selected,
}: {
  cluster: string;
  namespace: string;
  labels: AppLabels | null;
  refresh: number;
  selected: string | null;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const load = useCallback(
    async (signal: AbortSignal) => {
      const snapshot = await loadCorrelationSnapshot(namespaceScope(cluster, namespace), signal);
      return { snapshot, correlation: correlateResources(snapshot.resources, labels) };
    },
    [cluster, namespace, labels]
  );
  const result = useRequest(JSON.stringify([cluster, namespace, labels, refresh]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading application relationships...')}>
      {({ snapshot, correlation }) => {
        const complete = snapshot.complete && correlation.issues.length === 0;
        const app = correlation.applications.find(app => app.name === selected);
        function count(value: number) {
          return complete
            ? String(value)
            : value > 0
            ? t('At least {{count}}', { count: value })
            : t('Unavailable');
        }
        return (
          <>
            <Alert severity="info">
              {t(
                'Namespace correlation includes supported WorkloadGroups, with a 15-second deadline. VM entry labels require complete entry evidence; denied or limited reads remain partial and never fall back silently to group labels.'
              )}
            </Alert>
            {snapshot.sources.some(source => source.notServed) && (
              <Alert severity="info">
                {t(
                  'No supported WorkloadGroup API is served; the current correlation contains only the observed Kubernetes workload kinds.'
                )}
              </Alert>
            )}
            {!snapshot.complete && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t(
                  'Some resource lists are incomplete. The results below include only available data.'
                )}
                <ul>
                  {snapshot.sources
                    .filter(source => !source.complete)
                    .map(source => (
                      <li key={source.source.kind}>
                        {source.source.kind}:{' '}
                        {source.limited
                          ? t(
                              'The read limit of four pages per kind was reached. Results are partial.'
                            )
                          : source.error?.message}
                      </li>
                    ))}
                </ul>
              </Alert>
            )}
            {correlation.issues.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t(
                  'Some owner references could not be resolved safely. No name-only ownership fallback was used.'
                )}
                <ul>
                  {correlation.issues.map((issue, index) => (
                    <li key={index}>
                      {issue.resource.kind}/{issue.resource.name}: {issue.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {selected !== null ? (
              app ? (
                <ApplicationDetails app={app} complete={complete} labels={labels} />
              ) : (
                <Alert severity={complete ? 'info' : 'warning'}>
                  {complete
                    ? t('No application with this label is present in the selected namespace.')
                    : t('This application could not be established from the available data.')}
                </Alert>
              )
            ) : (
              <SectionBox
                id="kiali-applications-list"
                title={t('Applications in {{namespace}}', { namespace })}
              >
                <Stack spacing={2}>
                  <TextField
                    label={t('Filter applications')}
                    value={filter}
                    onChange={event => setFilter(event.target.value)}
                    sx={{ maxWidth: 420 }}
                  />
                  <SimpleTable
                    data={correlation.applications.filter(app =>
                      app.name.toLowerCase().includes(filter.toLowerCase())
                    )}
                    columns={[
                      {
                        label: t('Application'),
                        sort: (a: Application, b: Application) => a.name.localeCompare(b.name),
                        getter: (app: Application) => (
                          <Link
                            routeName="kiali-applications"
                            activeCluster={app.cluster}
                            search={new URLSearchParams({
                              namespace: app.namespace,
                              application: app.name,
                            }).toString()}
                          >
                            {app.name || t('Empty application label')}
                          </Link>
                        ),
                      },
                      {
                        label: t('Health'),
                        getter: (app: Application) => (
                          <Link
                            routeName="kiali-health"
                            activeCluster={app.cluster}
                            search={new URLSearchParams({
                              kind: 'Application',
                              namespace: app.namespace,
                              name: app.name,
                            }).toString()}
                          >
                            {t('Inspect health')}
                          </Link>
                        ),
                      },
                      {
                        label: t('Versions'),
                        getter: (app: Application) =>
                          app.versions
                            .map(version =>
                              version === null
                                ? t('Not labeled')
                                : version === ''
                                ? t('Empty label')
                                : version
                            )
                            .join(', '),
                      },
                      {
                        label: t('Workloads'),
                        sort: (a: Application, b: Application) =>
                          a.workloads.length - b.workloads.length,
                        getter: (app: Application) => count(app.workloads.length),
                      },
                      {
                        label: t('Services'),
                        sort: (a: Application, b: Application) =>
                          a.services.length - b.services.length,
                        getter: (app: Application) => count(app.services.length),
                      },
                      {
                        label: t('Observed pods'),
                        sort: (a: Application, b: Application) => a.pods.length - b.pods.length,
                        getter: (app: Application) => count(app.pods.length),
                      },
                    ]}
                    emptyMessage={
                      complete
                        ? t('No labeled applications match this view.')
                        : t('No applications could be established from the available data.')
                    }
                  />
                  <Typography variant="body2">
                    {t(
                      '{{count}} known workloads have no application label; {{infra}} infrastructure workloads are excluded.',
                      {
                        count: correlation.unlabelledWorkloads.length,
                        infra: correlation.infrastructure.length,
                      }
                    )}
                  </Typography>
                </Stack>
              </SectionBox>
            )}
          </>
        );
      }}
    </RequestStatus>
  );
}

function ScopedApplications({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const history = useHistory();
  const config = useKialiConfig();
  const [namespaces, namespaceError] = K8s.ResourceClasses.Namespace.useList({ cluster });
  const [refresh, setRefresh] = useState(0);
  const params = new URLSearchParams(location.search);
  const namespace = params.get('namespace') ?? '';
  const selected = params.get('application');
  const configured = config.valid ? getClusterConfig(config.config, cluster).appLabels : null;
  const appKey = configured?.app;
  const versionKey = configured?.version;
  const labels = useMemo(
    () => (appKey && versionKey ? { app: appKey, version: versionKey } : null),
    [appKey, versionKey]
  );
  return (
    <>
      <SectionBox title={t('Applications')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Applications group workloads by their application labels. Service selectors and owner references describe configuration relationships, not observed traffic or health.'
            )}
          </Typography>
          <Typography variant="body2">
            {t(
              'This view covers supported Kubernetes controllers, Pods and WorkloadGroup-backed VM workloads. Arbitrary external workloads, custom controllers and OpenShift-specific controllers are not fully represented.'
            )}
          </Typography>
          <Autocomplete
            freeSolo
            value={namespace || null}
            options={(namespaces ?? []).map(item => item.metadata.name).sort()}
            onChange={(_, value) => {
              const next = new URLSearchParams(location.search);
              if (value) next.set('namespace', value);
              else next.delete('namespace');
              next.delete('application');
              history.replace({ ...location, search: next.toString() });
            }}
            renderInput={props => (
              <TextField
                {...props}
                label={t('Namespace')}
                helperText={t(
                  'Select or enter one namespace and press Enter. Reads are limited to that namespace.'
                )}
              />
            )}
            sx={{ maxWidth: 520 }}
          />
          {namespaceError && (
            <Alert severity="warning">
              {t('Namespace suggestions are unavailable. You can enter a namespace directly.')}{' '}
              {namespaceError.message}
            </Alert>
          )}
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="outlined"
              disabled={!isDnsLabel(namespace)}
              onClick={() => setRefresh(value => value + 1)}
            >
              {t('Refresh applications')}
            </Button>
            <Link routeName="kiali-settings">{t('Application label settings')}</Link>
            {selected !== null && (
              <Link
                routeName="kiali-applications"
                search={new URLSearchParams({ namespace }).toString()}
              >
                {t('All applications')}
              </Link>
            )}
          </Stack>
        </Stack>
      </SectionBox>
      {config.valid === false ? (
        <Alert severity="error">
          {t('Stored Kiali configuration is invalid: {{message}}', { message: config.message })}
        </Alert>
      ) : isDnsLabel(namespace) ? (
        <ApplicationSnapshot
          key={JSON.stringify([cluster, namespace])}
          cluster={cluster}
          namespace={namespace}
          labels={labels}
          refresh={refresh}
          selected={selected}
        />
      ) : (
        <Alert severity="info">
          {t(
            'Select one valid namespace to load application relationships. Multi-namespace correlation is not enabled yet.'
          )}
        </Alert>
      )}
    </>
  );
}

export default function Applications() {
  return (
    <ClusterScope>
      {scope => <ScopedApplications key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
