import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import { TlsDestinationRule, TlsPeerPolicy } from '../core/mtls';
import { clusterScope } from '../core/scope';
import { loadMtlsSnapshot, MtlsQuery } from '../data/mtls';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import RequestStatus from './RequestStatus';

function Results({
  cluster,
  query,
  domain,
}: {
  cluster: string;
  query: MtlsQuery;
  domain: string | null;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadMtlsSnapshot(clusterScope(cluster), query, domain, signal),
    [cluster, query, domain]
  );
  const state = useRequest(JSON.stringify([cluster, query, domain]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Assessing configured mTLS...')}>
      {snapshot => (
        <Stack spacing={2}>
          <SectionBox title={t('Namespace-wide configuration indicator')}>
            <Stack spacing={2}>
              <Alert severity="warning">
                {t(
                  'Configuration assessment only, not proof of encryption or secure traffic. This covers namespace/root PeerAuthentication and the pinned namespace/legacy mesh-wide DestinationRule patterns, not per-service, subset, port, authorization or ambient behavior. Full semantic validation has not run.'
                )}
              </Alert>
              <Typography>
                {t('Selected controller')}: {query.controllerNamespace}/{query.controller}
              </Typography>
              <Typography>
                {t('Mesh root namespace')}: {snapshot.rootNamespace}
              </Typography>
              {snapshot.rootNamespaceDefaulted && (
                <Alert severity="info">
                  {t(
                    'No root namespace was configured. The pinned Kiali resolver uses the observed controller namespace after configuration has been resolved.'
                  )}
                </Alert>
              )}
              <Typography>
                {t('Service DNS identity domain')}: {snapshot.identityDomain}
              </Typography>
              <Typography>
                {t('Automatic mTLS for calculation')}:{' '}
                {snapshot.autoMtlsEnabled ? t('True') : t('False')} (
                {snapshot.autoMtlsDefaulted
                  ? t('Istio default; not explicitly reported')
                  : t('Explicit configuration')}
                )
              </Typography>
              <Link
                routeName="kiali-traffic"
                activeCluster={cluster}
                search={new URLSearchParams({ namespace: query.namespace }).toString()}
              >
                {t('View observed connection security')}
              </Link>
              {[snapshot.peers, snapshot.destinationRules].map(
                (source, i) =>
                  !source.complete && (
                    <Alert severity="error" key={i}>
                      {source.error?.message ?? t('The collection page limit was reached.')}
                    </Alert>
                  )
              )}
              {snapshot.reason && <Alert severity="warning">{snapshot.reason}</Alert>}
              {snapshot.assessment && (
                <>
                  <Typography>
                    {t('Pinned Kiali configuration indicator')}:{' '}
                    <code>{snapshot.assessment.status}</code>
                  </Typography>
                  <Typography variant="body2">
                    {t(
                      'UNSET means no namespace-wide peer mode. An inherited enabled indicator does not by itself prove a STRICT peer policy or observed encryption.'
                    )}
                  </Typography>
                  <SimpleTable
                    data={[
                      { scope: t('Namespace'), ...snapshot.assessment.namespace },
                      { scope: t('Mesh root'), ...snapshot.assessment.mesh },
                    ]}
                    columns={[
                      { label: t('Scope'), getter: item => item.scope },
                      {
                        label: t('Peer mode'),
                        getter: item => item.peerAuthenticationStatus || t('Not configured'),
                      },
                      {
                        label: t('Client TLS mode'),
                        getter: item => item.destinationRuleStatus || t('Not configured'),
                      },
                      { label: t('Configuration indicator'), getter: item => item.overallStatus },
                    ]}
                  />
                </>
              )}
            </Stack>
          </SectionBox>
          <SectionBox title={t('Observed PeerAuthentication configuration')}>
            <SimpleTable
              data={snapshot.peers.items}
              columns={[
                {
                  label: t('Resource'),
                  getter: (policy: TlsPeerPolicy) => (
                    <Link
                      routeName="kiali-config-peer-authentication-detail"
                      activeCluster={cluster}
                      params={{ namespace: policy.namespace, name: policy.name }}
                    >
                      {policy.namespace}/{policy.name}
                    </Link>
                  ),
                },
                {
                  label: t('Mode'),
                  getter: (policy: TlsPeerPolicy) => policy.mode ?? t('Not configured'),
                },
                {
                  label: t('Selector scope'),
                  getter: (policy: TlsPeerPolicy) =>
                    policy.selector && Object.keys(policy.selector).length
                      ? t('Workload-specific; excluded from namespace indicator')
                      : t('Namespace-wide'),
                },
              ]}
            />
          </SectionBox>
          <SectionBox title={t('DestinationRules with top-level TLS')}>
            <SimpleTable
              data={snapshot.destinationRules.items.filter(rule => rule.mode !== undefined)}
              columns={[
                {
                  label: t('Resource'),
                  getter: (rule: TlsDestinationRule) => (
                    <Link
                      routeName="kiali-config-destination-rule-detail"
                      activeCluster={cluster}
                      params={{ namespace: rule.namespace, name: rule.name }}
                    >
                      {rule.namespace}/{rule.name}
                    </Link>
                  ),
                },
                { label: t('Host'), getter: (rule: TlsDestinationRule) => rule.host },
                { label: t('TLS mode'), getter: (rule: TlsDestinationRule) => rule.mode },
              ]}
            />
          </SectionBox>
        </Stack>
      )}
    </RequestStatus>
  );
}

function Scope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [controllerNamespace, setControllerNamespace] = useState(
    params.get('controllerNamespace') ?? ''
  );
  const [controller, setController] = useState(params.get('controller') ?? '');
  const [query, setQuery] = useState<MtlsQuery>();
  const [attempt, setAttempt] = useState(0);
  const config = useKialiConfig();
  const domain = config.valid
    ? getClusterConfig(config.config, cluster).identityDomain ?? null
    : null;
  return (
    <>
      <SectionBox title={t('mTLS configuration')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Select a namespace and its intended local control plane. Mesh inventory can prefill label-based candidates; this page does not assume that a label match proves actual injection.'
            )}
          </Typography>
          <Link routeName="kiali-mesh">{t('Mesh inventory')}</Link>
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              label={t('Namespace')}
              value={namespace}
              onChange={event => {
                setNamespace(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={t('Controller namespace')}
              value={controllerNamespace}
              onChange={event => {
                setControllerNamespace(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={t('Controller Deployment')}
              value={controller}
              onChange={event => {
                setController(event.target.value);
                setQuery(undefined);
              }}
            />
            <Button
              variant="contained"
              disabled={!config.valid || !namespace || !controllerNamespace || !controller}
              onClick={() => {
                setQuery({ namespace, controllerNamespace, controller });
                setAttempt(value => value + 1);
              }}
            >
              {t('Assess configuration')}
            </Button>
          </Stack>
          {config.valid === false && <Alert severity="error">{config.message}</Alert>}
        </Stack>
      </SectionBox>
      {query && config.valid && (
        <Results key={attempt} cluster={cluster} query={query} domain={domain} />
      )}
    </>
  );
}
export default function Mtls() {
  return (
    <ClusterScope>{scope => <Scope key={scope.cluster} cluster={scope.cluster} />}</ClusterScope>
  );
}
