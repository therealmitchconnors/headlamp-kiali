import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  ResourceListView,
  SectionBox,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import Alert from '@mui/material/Alert';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useHistory, useLocation } from 'react-router-dom';
import { replicaReadiness } from '../core/readiness';
import ClusterScope from './ClusterScope';

const browseOnly = {
  enableRowActions: false,
  enableRowSelection: false,
  headerProps: { titleSideActions: [] },
};

export function Namespaces() {
  const { t } = useTranslation();
  return (
    <ClusterScope>
      {scope => (
        <ResourceListView
          key={scope.cluster}
          id="kiali-namespaces"
          title={t('Namespaces')}
          resourceClass={K8s.ResourceClasses.Namespace}
          columns={[
            'name',
            {
              id: 'mesh-revision',
              label: t('Istio revision / injection'),
              getValue: item =>
                item.metadata.labels?.['istio.io/rev'] ??
                item.metadata.labels?.['istio-injection'] ??
                '-',
            },
            {
              id: 'phase',
              label: t('Phase'),
              getValue: item => item.jsonData.status?.phase ?? '-',
            },
            'age',
          ]}
          reflectInURL="kiali-namespaces"
          {...browseOnly}
        />
      )}
    </ClusterScope>
  );
}

export function Services() {
  const { t } = useTranslation();
  return (
    <ClusterScope>
      {scope => (
        <ResourceListView
          key={scope.cluster}
          id="kiali-services"
          title={t('Services')}
          resourceClass={K8s.ResourceClasses.Service}
          columns={[
            'name',
            'namespace',
            { id: 'type', label: t('Type'), getValue: item => item.spec.type },
            { id: 'cluster-ip', label: t('Cluster IP'), getValue: item => item.spec.clusterIP },
            {
              id: 'health',
              label: t('Request health'),
              getValue: () => t('Inspect health'),
              render: item => (
                <Link
                  routeName="kiali-health"
                  activeCluster={scope.cluster}
                  search={new URLSearchParams({
                    kind: 'Service',
                    namespace: item.metadata.namespace ?? '',
                    name: item.metadata.name,
                  }).toString()}
                >
                  {t('Inspect health')}
                </Link>
              ),
            },
            {
              id: 'create-routing',
              label: t('Traffic configuration'),
              getValue: () => t('Create traffic routing'),
              render: item => (
                <Link
                  routeName="kiali-service-traffic"
                  activeCluster={scope.cluster}
                  search={new URLSearchParams({
                    namespace: item.metadata.namespace ?? '',
                    service: item.metadata.name,
                  }).toString()}
                >
                  {t('Create traffic routing')}
                </Link>
              ),
            },
            {
              id: 'ports',
              label: t('Ports'),
              getValue: item =>
                item.spec.ports
                  ?.map(
                    port =>
                      `${port.port}${port.nodePort ? `:${port.nodePort}` : ''}/${
                        port.protocol ?? 'TCP'
                      }`
                  )
                  .join(', ') ?? '-',
            },
            {
              id: 'selector',
              label: t('Selector'),
              getValue: item =>
                Object.entries(item.spec.selector ?? {})
                  .map(([name, value]) => `${name}=${value}`)
                  .join(', ') || '-',
              show: false,
            },
            'age',
          ]}
          reflectInURL="kiali-services"
          {...browseOnly}
        />
      )}
    </ClusterScope>
  );
}

export function Workloads() {
  const { t } = useTranslation();
  const location = useLocation();
  const history = useHistory();
  const choices: {
    key: string;
    label: string;
    resourceClass: KubeObjectClass;
    replicas: boolean;
  }[] = [
    {
      key: 'deployments',
      label: t('Deployments'),
      resourceClass: K8s.ResourceClasses.Deployment,
      replicas: true,
    },
    {
      key: 'statefulsets',
      label: t('StatefulSets'),
      resourceClass: K8s.ResourceClasses.StatefulSet,
      replicas: true,
    },
    {
      key: 'daemonsets',
      label: t('DaemonSets'),
      resourceClass: K8s.ResourceClasses.DaemonSet,
      replicas: true,
    },
    { key: 'jobs', label: t('Jobs'), resourceClass: K8s.ResourceClasses.Job, replicas: false },
    {
      key: 'cronjobs',
      label: t('CronJobs'),
      resourceClass: K8s.ResourceClasses.CronJob,
      replicas: false,
    },
  ];
  const kind = new URLSearchParams(location.search).get('kind') ?? 'deployments';
  const choice = choices.find(candidate => candidate.key === kind);
  return (
    <ClusterScope>
      {scope => (
        <>
          <SectionBox title={t('Workloads')} headerProps={{ headerStyle: 'main' }}>
            <Tabs
              value={choice?.key ?? false}
              variant="scrollable"
              scrollButtons="auto"
              aria-label={t('Workload kind')}
              onChange={(_, value: string) => {
                const params = new URLSearchParams(location.search);
                params.set('kind', value);
                history.replace({ ...location, search: params.toString() });
              }}
            >
              {choices.map(option => (
                <Tab key={option.key} value={option.key} label={option.label} />
              ))}
            </Tabs>
          </SectionBox>
          {choice ? (
            <ResourceListView
              key={JSON.stringify([scope.cluster, choice.key])}
              id={`kiali-${choice.key}`}
              title={choice.label}
              resourceClass={choice.resourceClass}
              columns={[
                'name',
                'namespace',
                ...(choice.replicas
                  ? [
                      {
                        id: 'health',
                        label: t('Request health'),
                        getValue: () => t('Inspect health'),
                        render: (item: InstanceType<KubeObjectClass>) => (
                          <Link
                            routeName="kiali-health"
                            search={new URLSearchParams({
                              kind: item.kind,
                              namespace: item.metadata.namespace ?? '',
                              name: item.metadata.name,
                            }).toString()}
                          >
                            {t('Inspect health')}
                          </Link>
                        ),
                      },
                      {
                        id: 'readiness',
                        label: t('Ready replicas'),
                        getValue: (item: InstanceType<KubeObjectClass>) => {
                          const readiness = replicaReadiness(item.jsonData);
                          return readiness
                            ? `${readiness.ready}/${readiness.desired}`
                            : t('Not reported');
                        },
                        render: (item: InstanceType<KubeObjectClass>) => {
                          const readiness = replicaReadiness(item.jsonData);
                          return readiness ? (
                            <StatusLabel
                              status={
                                readiness.desired > 0 && readiness.ready >= readiness.desired
                                  ? 'success'
                                  : 'warning'
                              }
                            >
                              {`${readiness.ready}/${readiness.desired}`}
                            </StatusLabel>
                          ) : (
                            t('Not reported')
                          );
                        },
                      },
                    ]
                  : []),
                'age',
              ]}
              reflectInURL={`kiali-${choice.key}`}
              {...browseOnly}
              headerProps={{ ...browseOnly.headerProps, headerStyle: 'subsection' }}
            >
              <Alert severity="info">
                {t(
                  "Readiness reflects Kubernetes replicas, not mesh health. Resource names open Headlamp's built-in resource details."
                )}
              </Alert>
            </ResourceListView>
          ) : (
            <Alert severity="error">
              {t('Unknown workload kind. Select one of the available kinds.')}
            </Alert>
          )}
        </>
      )}
    </ClusterScope>
  );
}
