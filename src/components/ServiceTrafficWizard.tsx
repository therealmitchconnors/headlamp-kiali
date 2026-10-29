import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prompt, useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { initialCircuitBreaker } from '../core/circuitBreaker';
import { getClusterConfig } from '../core/config';
import { initialHttpBehavior } from '../core/httpRouteBehavior';
import { AppLabels } from '../core/labels';
import { initialLoadBalancer } from '../core/loadBalancer';
import { isDnsLabel, isDnsSubdomain } from '../core/object';
import { initialOutboundTls } from '../core/outboundTls';
import { ServiceTrafficDraft } from '../core/serviceTraffic';
import {
  commitMutationBatch,
  MutationOutcome,
  ReviewedMutationBatch,
  reviewMutationBatch,
} from '../data/mutationBatch';
import {
  assertTrafficProposalFresh,
  assertTrafficSourceCurrent,
  assertTrafficTargetsAbsent,
  loadServiceTrafficSource,
  prepareServiceTraffic,
  ServiceTrafficQuery,
  ServiceTrafficSource,
} from '../data/serviceTraffic';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import CircuitBreakerEditor from './configuration/CircuitBreakerEditor';
import CodeBlock from './configuration/CodeBlock';
import HttpMatchBuilder, { HttpMatchingWarning } from './configuration/HttpMatchBuilder';
import { MirroringWarning } from './configuration/HttpMirroringEditor';
import HttpRouteBehaviorEditor, {
  HttpBehaviorWarning,
} from './configuration/HttpRouteBehaviorEditor';
import LoadBalancerEditor from './configuration/LoadBalancerEditor';
import OutboundTlsEditor, { OutboundTlsWarning } from './configuration/OutboundTlsEditor';
import RequestStatus from './RequestStatus';

function TrafficProposal({
  source,
  onBusy,
}: {
  source: ServiceTrafficSource;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ServiceTrafficDraft>(() => ({
    destinationRuleName: source.service.name,
    virtualServiceName: source.service.name,
    protocol: 'http',
    port: source.service.ports.find(port => port.protocol === 'TCP')!.port,
    subsets: source.versions.map(version => ({
      name: version.subset,
      version: version.value,
      weight: version.weight,
    })),
    circuitBreaker: initialCircuitBreaker(),
    loadBalancer: initialLoadBalancer(),
    outboundTls: initialOutboundTls(),
    httpBehavior: initialHttpBehavior({ index: 0, value: {} }),
    httpMatches: [],
  }));
  const [reviewed, setReviewed] = useState<ReviewedMutationBatch>();
  const [outcomes, setOutcomes] = useState<MutationOutcome[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const active = useRef<AbortController>();
  const inFlight = useRef(false);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(
    () => () => {
      active.current?.abort();
      onBusy(false);
    },
    [onBusy]
  );
  useEffect(() => {
    if (!busy || !sent) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, sent]);
  const proposal = useMemo(() => {
    try {
      return { mutations: prepareServiceTraffic(source, draft), error: '' };
    } catch (error) {
      return {
        mutations: undefined,
        error: error instanceof Error ? error.message : 'Invalid traffic proposal',
      };
    }
  }, [source, draft]);
  const guard = (signal: AbortSignal) => assertTrafficSourceCurrent(source.service, signal);
  async function run(commit: boolean) {
    if (inFlight.current || sent) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    active.current = controller;
    try {
      if (commit) {
        if (!reviewed) throw new Error(t('Review both changes before confirming'));
        setSent(true);
        await assertTrafficProposalFresh(source, controller.signal);
        await assertTrafficTargetsAbsent(reviewed.mutations, controller.signal);
        const result = await commitMutationBatch(reviewed, controller.signal, guard);
        if (!controller.signal.aborted) setOutcomes(result);
      } else {
        if (!proposal.mutations) throw new Error(proposal.error);
        await assertTrafficProposalFresh(source, controller.signal);
        await assertTrafficTargetsAbsent(proposal.mutations, controller.signal);
        const batch = await reviewMutationBatch(proposal.mutations, controller.signal, guard);
        if (!controller.signal.aborted) setReviewed(batch);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : t('Unable to prepare or apply routing'));
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const statusLabels = {
    'not-attempted': t('Not attempted'),
    succeeded: t('API operation succeeded'),
    blocked: t('Blocked before writing'),
    'failed-or-unknown': t('Failed or outcome unknown'),
  };
  return (
    <SectionBox title={t('Traffic routing proposal')}>
      <Stack spacing={2}>
        <Prompt
          when={busy && sent}
          message={t(
            'Routing writes are in progress. Leaving may interrupt the attempt; inspect both resources before any further changes.'
          )}
        />
        <Typography>
          {source.service.cluster}: {source.service.namespace}/{source.service.name} (
          {t('Version label')}: {source.versionLabel})
        </Typography>
        <Alert severity="warning">
          {t(
            'This creates a namespace-local DestinationRule followed by a VirtualService for one TCP Service port. It does not install a gateway or prove backend readiness. TLS policy is included only when explicitly selected below. Existing or potentially overlapping routing must be edited separately.'
          )}
        </Alert>
        <Typography>
          {t('Routing protocol: {{protocol}}', {
            protocol: draft.protocol === 'tcp' ? 'TCP' : 'HTTP/gRPC',
          })}
        </Typography>
        {draft.protocol === 'tcp' && (
          <Alert severity="warning">
            {t(
              'TCP rules route connections, not individual HTTP requests. This does not change Service port names/appProtocol or the protocol classification used by Istio. Request mirroring and HTTP header/cookie affinity are not supported here.'
            )}
          </Alert>
        )}
        {draft.mirror && <MirroringWarning />}
        {source.conflicts.length > 0 && (
          <SimpleTable
            data={source.conflicts}
            columns={[
              {
                label: t('Existing configuration'),
                getter: item => `${item.kind} ${item.namespace}/${item.name}`,
              },
            ]}
          />
        )}
        <SimpleTable
          data={source.versions}
          columns={[
            { label: t('Observed version'), getter: item => item.value || t('Empty label') },
            { label: t('Matching workloads'), getter: item => item.workloads.join(', ') },
          ]}
        />
        {!reviewed && !sent && (
          <>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <TextField
                select
                label={t('Routing protocol')}
                value={draft.protocol ?? 'http'}
                disabled={busy}
                helperText={t(
                  'Choose explicitly; protocol is not inferred from the Service port. Existing draft settings are retained when switching.'
                )}
                onChange={event => {
                  const protocol = event.target.value;
                  if (protocol === 'http' || protocol === 'tcp')
                    setDraft(value => ({ ...value, protocol }));
                }}
              >
                <MenuItem value="http">HTTP/gRPC</MenuItem>
                <MenuItem value="tcp">TCP</MenuItem>
              </TextField>
              <TextField
                label={t('DestinationRule name')}
                value={draft.destinationRuleName}
                disabled={busy}
                onChange={event =>
                  setDraft(value => ({ ...value, destinationRuleName: event.target.value }))
                }
              />
              <TextField
                label={t('VirtualService name')}
                value={draft.virtualServiceName}
                disabled={busy}
                onChange={event =>
                  setDraft(value => ({ ...value, virtualServiceName: event.target.value }))
                }
              />
              <TextField
                select
                label={t('Service port')}
                value={draft.port}
                disabled={busy}
                onChange={event =>
                  setDraft(value => ({ ...value, port: Number(event.target.value) }))
                }
              >
                {source.service.ports
                  .filter(port => port.protocol === 'TCP')
                  .map(port => (
                    <MenuItem key={port.port} value={port.port}>
                      {port.name ? `${port.name}: ` : ''}
                      {port.port}
                    </MenuItem>
                  ))}
              </TextField>
            </Stack>
            <TextField
              select
              label={t('Mirrored version')}
              value={
                draft.mirror
                  ? draft.subsets.findIndex(item => item.version === draft.mirror?.version)
                  : -1
              }
              disabled={busy || (draft.protocol === 'tcp' && !draft.mirror)}
              helperText={t(
                'The mirrored version is excluded from forwarding in this generated rule, not from other or default routing. Set the remaining forwarding weights to total 100; no automatic redistribution is performed.'
              )}
              onChange={event => {
                const subset = draft.subsets[Number(event.target.value)];
                setDraft(value => ({
                  ...value,
                  mirror: subset
                    ? { version: subset.version, percentage: value.mirror?.percentage ?? '100' }
                    : undefined,
                }));
              }}
            >
              <MenuItem value={-1}>{t('No mirrored version')}</MenuItem>
              {draft.subsets.map((subset, index) => (
                <MenuItem key={subset.version} value={index}>
                  {subset.version || t('Empty label')}
                </MenuItem>
              ))}
            </TextField>
            {draft.mirror && (
              <TextField
                label={t('Mirror percentage')}
                value={draft.mirror.percentage}
                disabled={busy}
                helperText={t(
                  'Decimal percentage from 0 to 100. Zero explicitly mirrors no requests.'
                )}
                onChange={event =>
                  setDraft(value => ({
                    ...value,
                    mirror: value.mirror
                      ? { ...value.mirror, percentage: event.target.value }
                      : undefined,
                  }))
                }
              />
            )}
            {draft.subsets.map((subset, index) => (
              <Stack key={subset.version} direction="row" spacing={2} alignItems="center">
                <Typography>{subset.version || t('Empty label')}</Typography>
                <TextField
                  label={t('Subset name for version {{version}}', {
                    version: subset.version || t('Empty label'),
                  })}
                  value={subset.name}
                  disabled={busy}
                  onChange={event =>
                    setDraft(value => ({
                      ...value,
                      subsets: value.subsets.map((item, position) =>
                        position === index ? { ...item, name: event.target.value } : item
                      ),
                    }))
                  }
                />
                <TextField
                  type="number"
                  label={t('Weight for version {{version}}', {
                    version: subset.version || t('Empty label'),
                  })}
                  value={Number.isNaN(subset.weight) ? '' : subset.weight}
                  disabled={busy || draft.mirror?.version === subset.version}
                  helperText={
                    draft.mirror?.version === subset.version
                      ? t('Shadow for this rule; this forwarding weight is ignored.')
                      : undefined
                  }
                  inputProps={{ min: 0, max: 100, step: 1 }}
                  onChange={event =>
                    setDraft(value => ({
                      ...value,
                      subsets: value.subsets.map((item, position) =>
                        position === index
                          ? {
                              ...item,
                              weight: event.target.value === '' ? NaN : Number(event.target.value),
                            }
                          : item
                      ),
                    }))
                  }
                />
              </Stack>
            ))}
            <CircuitBreakerEditor
              creating
              draft={draft.circuitBreaker ?? initialCircuitBreaker()}
              onChange={circuitBreaker => setDraft(value => ({ ...value, circuitBreaker }))}
              disabled={busy}
            />
            <HttpRouteBehaviorEditor
              creating
              routes={[]}
              draft={draft.httpBehavior ?? initialHttpBehavior({ index: 0, value: {} })}
              onChange={httpBehavior => setDraft(value => ({ ...value, httpBehavior }))}
              disabled={busy}
            />
            <HttpMatchBuilder
              conditions={draft.httpMatches ?? []}
              onChange={httpMatches => setDraft(value => ({ ...value, httpMatches }))}
              disabled={busy}
            />
            <LoadBalancerEditor
              creating
              draft={draft.loadBalancer ?? initialLoadBalancer()}
              onChange={loadBalancer => setDraft(value => ({ ...value, loadBalancer }))}
              disabled={busy}
            />
            <OutboundTlsEditor
              creating
              draft={draft.outboundTls ?? initialOutboundTls()}
              onChange={outboundTls => setDraft(value => ({ ...value, outboundTls }))}
              disabled={busy}
            />
            {proposal.error && <Alert severity="warning">{proposal.error}</Alert>}
            <Button
              variant="contained"
              disabled={busy || !proposal.mutations}
              onClick={() => run(false)}
            >
              {t('Review and dry-run both changes')}
            </Button>
          </>
        )}
        {reviewed && (
          <>
            {draft.outboundTls && <OutboundTlsWarning draft={draft.outboundTls} />}
            {draft.httpBehavior && <HttpBehaviorWarning draft={draft.httpBehavior} />}
            {!!draft.httpMatches?.length && <HttpMatchingWarning />}
            {!sent && (
              <Alert severity="success">
                {t(
                  'Both server dry-runs succeeded. No configuration has been persisted by this review.'
                )}
              </Alert>
            )}
            <SimpleTable
              data={draft.subsets}
              columns={[
                { label: t('Version'), getter: item => item.version || t('Empty label') },
                { label: t('Subset'), getter: item => item.name },
                {
                  label: t('Proposed weight'),
                  getter: item =>
                    draft.mirror?.version === item.version
                      ? t('Shadow for this rule')
                      : item.weight,
                },
                {
                  label: t('Mirror percentage'),
                  getter: item =>
                    draft.mirror?.version === item.version ? draft.mirror.percentage : '-',
                },
              ]}
            />
            {reviewed.mutations.map(mutation => (
              <SectionBox
                key={mutation.target.definition.kind}
                title={`${mutation.target.definition.kind}: ${mutation.target.namespace}/${mutation.target.name}`}
              >
                <Typography>{mutation.target.apiVersion}</Typography>
                <CodeBlock
                  label={t('Proposed {{kind}}', { kind: mutation.target.definition.kind })}
                  value={JSON.stringify(
                    {
                      apiVersion: mutation.target.apiVersion,
                      kind: mutation.target.definition.kind,
                      metadata: {
                        namespace: mutation.target.namespace,
                        name: mutation.target.name,
                      },
                      spec: mutation.spec,
                    },
                    null,
                    2
                  )}
                />
              </SectionBox>
            ))}
            <Alert severity="warning">
              {t(
                'These are two separate writes, not a transaction. Execution stops at the first failure; earlier changes remain. There is no automatic retry or rollback. Workload membership may change as labels and controllers change. Inspect both resources after any interrupted or uncertain attempt.'
              )}
            </Alert>
            {!sent && (
              <Stack direction="row" spacing={1}>
                <Button disabled={busy} onClick={() => setReviewed(undefined)}>
                  {t('Back to edit')}
                </Button>
                <Button
                  color="warning"
                  variant="contained"
                  disabled={busy}
                  onClick={() => run(true)}
                >
                  {t('Confirm creation of both resources')}
                </Button>
              </Stack>
            )}
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {busy && (
          <Typography role="status">
            {sent
              ? t('Applying the reviewed routing operations...')
              : t('Checking current evidence and server dry-runs...')}
          </Typography>
        )}
        {outcomes && (
          <Alert
            severity={
              outcomes.every(result => result.status === 'succeeded') ? 'success' : 'warning'
            }
          >
            {outcomes.every(result => result.status === 'succeeded')
              ? t(
                  'Both API operations completed. Controller acceptance and actual traffic are not verified.'
                )
              : t(
                  'The attempt stopped. Earlier successful changes remain; inspect every outcome before making further changes.'
                )}
          </Alert>
        )}
        {outcomes && (
          <SimpleTable
            data={outcomes}
            columns={[
              {
                label: t('Resource'),
                getter: item =>
                  `${item.mutation.target.definition.kind} ${item.mutation.target.namespace}/${item.mutation.target.name}`,
              },
              { label: t('Outcome'), getter: item => statusLabels[item.status] },
              { label: t('Message'), getter: item => item.error?.message ?? '' },
              {
                label: t('Inspect'),
                getter: item => (
                  <Link
                    routeName={item.mutation.target.definition.resourceClass.detailsRoute}
                    activeCluster={item.mutation.target.cluster}
                    params={{
                      namespace: item.mutation.target.namespace,
                      name: item.mutation.target.name,
                    }}
                  >
                    {t('Open configuration')}
                  </Link>
                ),
              },
            ]}
          />
        )}
        {sent && (
          <Alert severity="info">
            {t(
              'This attempt cannot be repeated from this form. Inspect the outcomes and reload before preparing any further changes.'
            )}
          </Alert>
        )}
        <Button disabled={busy} onClick={() => window.location.reload()}>
          {t('Reload page')}
        </Button>
      </Stack>
    </SectionBox>
  );
}

function TrafficSource({
  cluster,
  query,
  labels,
  onBusy,
}: {
  cluster: string;
  query: ServiceTrafficQuery;
  labels: AppLabels | null;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadServiceTrafficSource(cluster, query, labels, signal),
    [cluster, query, labels]
  );
  const result = useRequest(JSON.stringify([cluster, query, labels]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading Service routing evidence...')}>
      {source => (
        <TrafficProposal
          key={JSON.stringify([source.service.uid, source.service.resourceVersion, query])}
          source={source}
          onBusy={onBusy}
        />
      )}
    </RequestStatus>
  );
}
function ServiceTrafficScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const params = new URLSearchParams(useLocation().search);
  const state = useKialiConfig();
  const settings = state.valid ? getClusterConfig(state.config, cluster) : undefined;
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [service, setService] = useState(params.get('service') ?? '');
  const [domain, setDomain] = useState(settings?.identityDomain ?? '');
  const [versionLabel, setVersionLabel] = useState(settings?.appLabels?.version ?? '');
  const [query, setQuery] = useState<ServiceTrafficQuery>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <SectionBox title={t('Create Service traffic routing')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Load readable Service/workload evidence, choose version weights, review the complete generated specifications and explicitly confirm. Nothing is written when loading evidence.'
            )}
          </Typography>
          <Alert severity="info">
            {t(
              'Enter the actual Service DNS suffix, such as svc.cluster.local. It is not inferred from the Headlamp cluster name. A blank version label is inferred only when all observed workloads use one label key.'
            )}{' '}
            <Link routeName="kiali-mesh">{t('Mesh inventory')}</Link>
          </Alert>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              label={t('Namespace')}
              value={namespace}
              disabled={busy}
              onChange={event => {
                setNamespace(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={t('Service name')}
              value={service}
              disabled={busy}
              onChange={event => {
                setService(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={t('Service DNS identity domain')}
              value={domain}
              disabled={busy}
              onChange={event => {
                setDomain(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={t('Version label key')}
              value={versionLabel}
              disabled={busy}
              onChange={event => {
                setVersionLabel(event.target.value);
                setQuery(undefined);
              }}
            />
            <Button
              variant="contained"
              disabled={!state.valid || busy}
              onClick={() => {
                if (!isDnsLabel(namespace) || !isDnsLabel(service) || !isDnsSubdomain(domain)) {
                  setError(t('Enter a valid namespace, Service name and Service DNS suffix'));
                  return;
                }
                setError('');
                setQuery({
                  namespace,
                  service,
                  identityDomain: domain,
                  versionLabel: versionLabel || undefined,
                });
              }}
            >
              {t('Load Service versions')}
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          {state.valid === false && <Alert severity="error">{state.message}</Alert>}
        </Stack>
      </SectionBox>
      {query && state.valid && (
        <TrafficSource
          cluster={cluster}
          query={query}
          labels={settings?.appLabels ?? null}
          onBusy={setBusy}
        />
      )}
    </>
  );
}
export default function ServiceTrafficWizard() {
  return (
    <ClusterScope>
      {scope => <ServiceTrafficScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
