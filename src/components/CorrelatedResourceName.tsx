import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { CorrelationResource } from '../core/correlation';

const RESOURCE_ROUTES: Partial<Record<CorrelationResource['identity']['kind'], string>> = {
  Deployment: 'Deployment',
  StatefulSet: 'StatefulSet',
  DaemonSet: 'DaemonSet',
  ReplicaSet: 'ReplicaSet',
  Job: 'Job',
  CronJob: 'CronJob',
  Pod: 'Pod',
  Service: 'service',
};
export default function CorrelatedResourceName({
  resource,
}: {
  resource: Pick<CorrelationResource, 'identity'>;
}) {
  const { cluster, namespace, name, kind } = resource.identity;
  if (kind === 'WorkloadGroup')
    return (
      <Link routeName="kiali-config-workload-group-detail" params={{ cluster, namespace, name }}>
        {name}
      </Link>
    );
  const routeName = RESOURCE_ROUTES[kind];
  return routeName ? (
    <Link routeName={routeName} activeCluster={cluster} params={{ namespace, name }}>
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}
