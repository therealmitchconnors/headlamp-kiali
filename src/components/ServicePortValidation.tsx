import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import { clusterScope } from '../core/scope';
import {
  loadServicePortValidation,
  ServicePortTarget,
  validateServicePortTarget,
} from '../data/servicePortValidation';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import RequestStatus from './RequestStatus';

function Results({
  cluster,
  target,
  logicalName,
}: {
  cluster: string;
  target: ServicePortTarget;
  logicalName?: string;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadServicePortValidation(clusterScope(cluster), target, logicalName, signal),
    [cluster, target, logicalName]
  );
  const state = useRequest(JSON.stringify([cluster, target, logicalName]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Reading complete Service port evidence...')}>
      {data => (
        <SectionBox title={t('Captured Service port checks')}>
          <Stack spacing={2}>
            <Typography>
              {t('Observed Service UID: {{uid}}; resource version: {{version}}', {
                uid: data.service.uid,
                version: data.service.resourceVersion,
              })}
            </Typography>
            {data.disabled ? (
              <Alert severity="info">
                {t(
                  'All validation checks are disabled by the captured Service annotation. No mesh or workload sources were read.'
                )}
              </Alert>
            ) : (
              <>
                <Alert severity="info">
                  {t(
                    'Partial source-backed checks, not a validity, routing or mesh-health verdict. Naming uses all matching Pods across the declared managed namespace pool; an empty match is mesh-positive by the pinned caller. Mapping uses the first cluster-wide Deployment with matching metadata labels, not Pod ownership or a namespace-local template selector.'
                  )}
                </Alert>
                <Typography>
                  {t('Declared logical cluster: {{logicalName}}; matching pooled Pods: {{count}}', {
                    logicalName: data.managed.logicalName,
                    count: data.result.matchedPods,
                  })}
                </Typography>
                {data.result.mappingExcluded && (
                  <Alert severity="info">
                    {t(
                      'Port mapping is excluded for this control-plane, waypoint or gateway Service. Naming checks are independent.'
                    )}
                  </Alert>
                )}
                {data.result.deployment ? (
                  <Typography>
                    {t(
                      'First matching Deployment: {{namespace}}/{{name}}; observed UID: {{uid}}',
                      data.result.deployment
                    )}
                  </Typography>
                ) : (
                  !data.result.mappingExcluded && (
                    <Alert severity="info">
                      {t(
                        'No matching Deployment was selected. The pinned caller emits no missing-Deployment finding; this does not prove port reachability.'
                      )}
                    </Alert>
                  )
                )}
                <SimpleTable
                  data={data.result.findings}
                  columns={[
                    { label: t('Code'), getter: item => item.code },
                    { label: t('Severity'), getter: item => t(item.severity) },
                    { label: t('Path'), getter: item => item.path },
                    { label: t('Finding'), getter: item => t(item.message) },
                  ]}
                />
                {!data.result.findings.length && (
                  <Alert severity="info">
                    {t(
                      'No findings in this bounded check slice. Unimplemented checks and live verification remain open.'
                    )}
                  </Alert>
                )}
                {!!data.result.suppressed && (
                  <Typography>
                    {t('{{count}} findings suppressed by the captured Service annotation', {
                      count: data.result.suppressed,
                    })}
                  </Typography>
                )}
                <details>
                  <summary>{t('Complete Service port source outcomes')}</summary>
                  <SimpleTable
                    data={[
                      ...data.sources.map(source => ({
                        ...source,
                        source: `Pod/${source.namespace}`,
                      })),
                      { ...data.deploymentSource, source: 'Deployment/cluster-wide' },
                    ]}
                    columns={[
                      { label: t('Source'), getter: item => item.source },
                      { label: t('Resource version'), getter: item => item.resourceVersion },
                      { label: t('Objects'), getter: item => item.count },
                    ]}
                  />
                </details>
              </>
            )}
          </Stack>
        </SectionBox>
      )}
    </RequestStatus>
  );
}

function Inspector({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [name, setName] = useState(params.get('name') ?? '');
  const [uid, setUid] = useState<string | undefined>(params.get('uid') ?? undefined);
  const [error, setError] = useState('');
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const logicalName = settings?.meshClusterName;
  const binding = JSON.stringify([cluster, namespace, name, uid, !!settings, logicalName]);
  const [request, setRequest] = useState<{
    binding: string;
    target: ServicePortTarget;
    attempt: number;
  }>();
  useEffect(() => {
    setRequest(undefined);
    setError('');
  }, [binding]);
  return (
    <>
      <SectionBox title={t('Service port validation')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Explicit read-only checks require a declared local namespace scope, every managed namespace Pod list and all cluster Deployments. Denied, malformed, truncated or stale sources make the check unavailable. Nothing is installed or written.'
            )}
          </Typography>
          <TextField
            label={t('Service validation namespace')}
            value={namespace}
            onChange={event => {
              setNamespace(event.target.value);
              setUid(undefined);
            }}
          />
          <TextField
            label={t('Service validation name')}
            value={name}
            onChange={event => {
              setName(event.target.value);
              setUid(undefined);
            }}
          />
          <Link routeName="kiali-settings" params={{ cluster }}>
            {t('Configure logical mesh cluster name')}
          </Link>
          {settings && !logicalName && (
            <Alert severity="warning">
              {t(
                'Set an explicit logical mesh cluster name in Connection settings before running Service port checks.'
              )}
            </Alert>
          )}
          <Button
            variant="contained"
            disabled={!settings || !logicalName}
            onClick={() => {
              try {
                const target = { namespace, name, uid };
                validateServicePortTarget(target);
                setError('');
                setRequest(current => ({
                  binding,
                  target,
                  attempt: (current?.attempt ?? 0) + 1,
                }));
              } catch (error) {
                setRequest(undefined);
                setError(
                  error instanceof Error ? error.message : t('Invalid Service validation target')
                );
              }
            }}
          >
            {t('Run Service port checks')}
          </Button>
          {config.valid === false && <Alert severity="error">{config.message}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </SectionBox>
      {request?.binding === binding && (
        <Results
          key={JSON.stringify([binding, request.attempt])}
          cluster={cluster}
          target={request.target}
          logicalName={logicalName}
        />
      )}
    </>
  );
}

export default function ServicePortValidation() {
  const location = useLocation();
  return (
    <ClusterScope>
      {scope => (
        <Inspector key={JSON.stringify([scope.cluster, location.search])} cluster={scope.cluster} />
      )}
    </ClusterScope>
  );
}
