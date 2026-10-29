import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { initialCircuitBreaker, planCircuitBreaker } from '../../core/circuitBreaker';
import {
  gatewayWeightedRules,
  GatewayWeightsDraft,
  planGatewayWeights,
} from '../../core/gatewayRouteWeights';
import { initialHttpMatchEdit, planHttpMatchEdit } from '../../core/httpMatchEditing';
import { initialHttpMirroring, planHttpMirroring } from '../../core/httpMirroring';
import {
  allHttpRoutes,
  editableHttpRoutes,
  initialHttpBehavior,
  planHttpBehavior,
} from '../../core/httpRouteBehavior';
import { planHttpRouteOrder } from '../../core/httpRouteOrder';
import { initialLoadBalancer, planLoadBalancer } from '../../core/loadBalancer';
import { initialOutboundTls, planOutboundTls } from '../../core/outboundTls';
import { initialPeerMtls, planPeerMtls } from '../../core/peerMtlsEditing';
import {
  initialRouteWeights,
  planTrafficWeights,
  TrafficWeightPlan,
  weightedRoutes,
} from '../../core/trafficWeights';
import {
  initialValidationExclusionDraft,
  VALIDATION_IGNORE_ANNOTATION,
  ValidationExclusionDraft,
  validationExclusionValue,
} from '../../core/validationAnnotations';
import {
  executeMutation,
  MutationTarget,
  PreparedMutation,
  prepareMutation,
  prepareValidationExclusions,
} from '../../data/mutations';
import { ConfigurationObject, ConfigurationResource } from '../../resources/common';
import { ConfigurationDefinition } from '../../resources/registry';
import CircuitBreakerEditor from './CircuitBreakerEditor';
import CodeBlock from './CodeBlock';
import GatewayWeightsEditor, { GatewayWeightsWarning } from './GatewayWeightsEditor';
import HttpMatchEditEditor, { HttpMatchEditWarning } from './HttpMatchEditEditor';
import HttpMirroringEditor, { MirroringWarning } from './HttpMirroringEditor';
import HttpRouteBehaviorEditor, { HttpBehaviorWarning } from './HttpRouteBehaviorEditor';
import HttpRouteOrderEditor, { RouteOrderWarning } from './HttpRouteOrderEditor';
import LoadBalancerEditor from './LoadBalancerEditor';
import OutboundTlsEditor, { OutboundTlsWarning } from './OutboundTlsEditor';
import PeerMtlsEditor, { PeerMtlsWarning } from './PeerMtlsEditor';
import TrafficWeightsEditor, { TrafficWeightsDraft } from './TrafficWeightsEditor';
import ValidationExclusionsEditor from './ValidationExclusionsEditor';

type MutationEditorMode =
  | 'spec'
  | 'weights'
  | 'http'
  | 'order'
  | 'match'
  | 'mirror'
  | 'validation'
  | 'circuit'
  | 'balancer'
  | 'tls'
  | 'peer'
  | 'gatewayWeights';

function MutationDialog({
  target,
  action,
  original,
  mode = 'spec',
  onClose,
  onDone,
}: {
  target: MutationTarget;
  action: PreparedMutation['action'];
  original?: ConfigurationObject<object>;
  mode?: MutationEditorMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(target.name);
  const [namespace, setNamespace] = useState(target.namespace);
  const [text, setText] = useState(JSON.stringify(original?.spec ?? {}, null, 2));
  const gatewayOptions = useMemo(() => {
    try {
      return {
        rules: mode === 'gatewayWeights' ? gatewayWeightedRules(original?.spec) : [],
        error: undefined,
      };
    } catch (error) {
      return {
        rules: [],
        error: error instanceof Error ? error.message : 'Unable to read Gateway backend weights',
      };
    }
  }, [mode, original?.spec]);
  const [gatewayDraft, setGatewayDraft] = useState<GatewayWeightsDraft>(() => ({
    ruleIndex: gatewayOptions.rules[0]?.index ?? -1,
    weights: gatewayOptions.rules[0]?.backends.map(backend => String(backend.weight)) ?? [],
  }));
  const gatewayResult = useMemo<{
    plan?: ReturnType<typeof planGatewayWeights>;
    error?: string;
  }>(() => {
    if (mode !== 'gatewayWeights') return {};
    if (gatewayOptions.error) return { error: gatewayOptions.error };
    try {
      return { plan: planGatewayWeights(original?.spec, gatewayDraft) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Invalid Gateway backend weight proposal',
      };
    }
  }, [mode, original?.spec, gatewayDraft, gatewayOptions.error]);
  const options = useMemo(() => {
    try {
      return { routes: mode === 'weights' ? weightedRoutes(original?.spec) : [], error: undefined };
    } catch (error) {
      return {
        routes: [],
        error: error instanceof Error ? error.message : 'Unable to read traffic weights',
      };
    }
  }, [original?.spec, mode]);
  const [weightDraft, setWeightDraft] = useState<TrafficWeightsDraft>(() => ({
    routeKey: options.routes[0]?.key ?? '',
    weights: options.routes[0] ? initialRouteWeights(options.routes[0]).map(String) : [],
  }));
  const httpOptions = useMemo(() => {
    try {
      return {
        routes:
          mode === 'order' || mode === 'match'
            ? allHttpRoutes(original?.spec)
            : mode === 'http' || mode === 'mirror'
            ? editableHttpRoutes(original?.spec)
            : [],
        error: undefined,
      };
    } catch (error) {
      return {
        routes: [],
        error: error instanceof Error ? error.message : 'Unable to read HTTP routes',
      };
    }
  }, [original?.spec, mode]);
  const [httpDraft, setHttpDraft] = useState(() => initialHttpBehavior(httpOptions.routes[0]));
  const [matchDraft, setMatchDraft] = useState(() => initialHttpMatchEdit(httpOptions.routes[0]));
  const matchResult = useMemo<{
    plan?: ReturnType<typeof planHttpMatchEdit>;
    error?: string;
  }>(() => {
    if (mode !== 'match') return {};
    if (httpOptions.error) return { error: httpOptions.error };
    try {
      return { plan: planHttpMatchEdit(original?.spec, matchDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid HTTP match condition' };
    }
  }, [mode, original?.spec, matchDraft, httpOptions.error]);
  const [orderDraft, setOrderDraft] = useState({ from: 0, to: 0 });
  const orderResult = useMemo<{
    plan?: ReturnType<typeof planHttpRouteOrder>;
    error?: string;
  }>(() => {
    if (mode !== 'order') return {};
    if (httpOptions.error) return { error: httpOptions.error };
    try {
      return { plan: planHttpRouteOrder(original?.spec, orderDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid HTTP route order' };
    }
  }, [mode, original?.spec, orderDraft, httpOptions.error]);
  const [mirrorDraft, setMirrorDraft] = useState(() => initialHttpMirroring(httpOptions.routes[0]));
  const mirrorResult = useMemo<{
    plan?: ReturnType<typeof planHttpMirroring>;
    error?: string;
  }>(() => {
    if (mode !== 'mirror') return {};
    if (httpOptions.error) return { error: httpOptions.error };
    try {
      return { plan: planHttpMirroring(original?.spec, mirrorDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid HTTP mirroring proposal' };
    }
  }, [mode, original?.spec, mirrorDraft, httpOptions.error]);
  const [circuitDraft, setCircuitDraft] = useState(() => initialCircuitBreaker(original?.spec));
  const [balancerDraft, setBalancerDraft] = useState(() => initialLoadBalancer(original?.spec));
  const [tlsDraft, setTlsDraft] = useState(() => initialOutboundTls(original?.spec));
  const [peerDraft, setPeerDraft] = useState(() => initialPeerMtls(original?.spec));
  const peerResult = useMemo<{ plan?: ReturnType<typeof planPeerMtls>; error?: string }>(() => {
    if (mode !== 'peer') return {};
    try {
      return { plan: planPeerMtls(original?.spec, peerDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid inbound mTLS proposal' };
    }
  }, [mode, original?.spec, peerDraft]);
  const tlsResult = useMemo<{ plan?: ReturnType<typeof planOutboundTls>; error?: string }>(() => {
    if (mode !== 'tls') return {};
    try {
      return { plan: planOutboundTls(original?.spec, tlsDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid outbound TLS proposal' };
    }
  }, [mode, original?.spec, tlsDraft]);
  const balancerResult = useMemo<{
    plan?: ReturnType<typeof planLoadBalancer>;
    error?: string;
  }>(() => {
    if (mode !== 'balancer') return {};
    try {
      return { plan: planLoadBalancer(original?.spec, balancerDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid load-balancer proposal' };
    }
  }, [mode, original?.spec, balancerDraft]);
  const circuitResult = useMemo<{
    plan?: ReturnType<typeof planCircuitBreaker>;
    error?: string;
  }>(() => {
    if (mode !== 'circuit') return {};
    try {
      return { plan: planCircuitBreaker(original?.spec, circuitDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid circuit-breaker proposal' };
    }
  }, [mode, original?.spec, circuitDraft]);
  const exclusionInitial = useMemo<{ draft: ValidationExclusionDraft; error?: string }>(() => {
    try {
      return {
        draft:
          mode === 'validation'
            ? initialValidationExclusionDraft(original?.metadata.annotations)
            : { mode: 'none', codes: '' },
      };
    } catch (error) {
      return {
        draft: { mode: 'none', codes: '' },
        error: error instanceof Error ? error.message : 'Unable to read validation exclusions',
      };
    }
  }, [mode, original]);
  const [exclusionDraft, setExclusionDraft] = useState(exclusionInitial.draft);
  const exclusionResult = useMemo<{ value?: string | null; error?: string }>(() => {
    if (mode !== 'validation') return {};
    if (exclusionInitial.error) return { error: exclusionInitial.error };
    try {
      return { value: validationExclusionValue(exclusionDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid validation exclusions' };
    }
  }, [mode, exclusionInitial.error, exclusionDraft]);
  const httpResult = useMemo<{ plan?: ReturnType<typeof planHttpBehavior>; error?: string }>(() => {
    if (mode !== 'http') return {};
    if (httpOptions.error) return { error: httpOptions.error };
    try {
      return { plan: planHttpBehavior(original?.spec, httpDraft) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid HTTP behavior proposal' };
    }
  }, [mode, original?.spec, httpDraft, httpOptions.error]);
  const weightResult = useMemo<{ plan?: TrafficWeightPlan; error?: string }>(() => {
    if (mode !== 'weights') return {};
    if (options.error) return { error: options.error };
    try {
      return {
        plan: planTrafficWeights(
          original?.spec,
          weightDraft.routeKey,
          weightDraft.weights.map(value => (value.trim() === '' ? NaN : Number(value)))
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid traffic weights' };
    }
  }, [mode, original?.spec, options.error, weightDraft]);
  const [prepared, setPrepared] = useState<PreparedMutation>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController>();
  const inFlight = useRef(false);
  const [sent, setSent] = useState(false);
  useEffect(() => () => active.current?.abort(), []);

  async function run(commit: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    active.current = controller;
    try {
      if (!commit && mode === 'weights' && !weightResult.plan)
        throw new Error(weightResult.error ?? 'Invalid traffic weights');
      if (!commit && mode === 'gatewayWeights' && !gatewayResult.plan)
        throw new Error(gatewayResult.error ?? 'Invalid Gateway backend weight proposal');
      if (!commit && mode === 'http' && !httpResult.plan)
        throw new Error(httpResult.error ?? 'Invalid HTTP behavior proposal');
      if (!commit && mode === 'order' && !orderResult.plan)
        throw new Error(orderResult.error ?? 'Invalid HTTP route order');
      if (!commit && mode === 'match' && !matchResult.plan)
        throw new Error(matchResult.error ?? 'Invalid HTTP match condition');
      if (!commit && mode === 'mirror' && !mirrorResult.plan)
        throw new Error(mirrorResult.error ?? 'Invalid HTTP mirroring proposal');
      if (!commit && mode === 'circuit' && !circuitResult.plan)
        throw new Error(circuitResult.error ?? 'Invalid circuit-breaker proposal');
      if (!commit && mode === 'balancer' && !balancerResult.plan)
        throw new Error(balancerResult.error ?? 'Invalid load-balancer proposal');
      if (!commit && mode === 'tls' && !tlsResult.plan)
        throw new Error(tlsResult.error ?? 'Invalid outbound TLS proposal');
      if (!commit && mode === 'peer' && !peerResult.plan)
        throw new Error(peerResult.error ?? 'Invalid inbound mTLS proposal');
      let mutation: PreparedMutation | undefined;
      if (commit) mutation = prepared;
      else if (mode === 'validation') {
        if (!original || exclusionResult.value === undefined)
          throw new Error(
            exclusionResult.error ?? 'The original resource and valid exclusions are required'
          );
        mutation = prepareValidationExclusions(
          { ...target, name, namespace },
          exclusionResult.value,
          original
        );
      } else {
        mutation = prepareMutation(
          { ...target, name, namespace },
          action,
          mode === 'weights'
            ? JSON.stringify(weightResult.plan?.spec)
            : mode === 'gatewayWeights'
            ? JSON.stringify(gatewayResult.plan?.spec)
            : mode === 'http'
            ? JSON.stringify(httpResult.plan?.spec)
            : mode === 'order'
            ? JSON.stringify(orderResult.plan?.spec)
            : mode === 'match'
            ? JSON.stringify(matchResult.plan?.spec)
            : mode === 'mirror'
            ? JSON.stringify(mirrorResult.plan?.spec)
            : mode === 'circuit'
            ? JSON.stringify(circuitResult.plan?.spec)
            : mode === 'balancer'
            ? JSON.stringify(balancerResult.plan?.spec)
            : mode === 'tls'
            ? JSON.stringify(tlsResult.plan?.spec)
            : mode === 'peer'
            ? JSON.stringify(peerResult.plan?.spec)
            : text,
          original
        );
      }
      if (!mutation) throw new Error('Review the change before confirming');
      if (commit) setSent(true);
      await executeMutation(mutation, !commit, controller.signal);
      if (controller.signal.aborted) return;
      if (commit) onDone();
      else setPrepared(mutation);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : t('The operation failed.'));
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      aria-labelledby="kiali-mutation-title"
    >
      <DialogTitle id="kiali-mutation-title">
        {mode === 'weights'
          ? t('Adjust traffic weights')
          : mode === 'gatewayWeights'
          ? t('Adjust Gateway backend weights')
          : mode === 'http'
          ? t('Edit HTTP route behavior')
          : mode === 'order'
          ? t('Reorder HTTP routes')
          : mode === 'match'
          ? t('Edit HTTP match conditions')
          : mode === 'mirror'
          ? t('Edit HTTP mirroring')
          : mode === 'validation'
          ? t('Edit validation exclusions')
          : mode === 'circuit'
          ? t('Edit circuit breaking')
          : mode === 'balancer'
          ? t('Edit load balancing')
          : mode === 'tls'
          ? t('Edit outbound TLS')
          : mode === 'peer'
          ? t('Edit inbound mTLS')
          : action === 'create'
          ? t('Create configuration')
          : action === 'update'
          ? t('Edit specification')
          : t('Delete configuration')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>
            {t('Cluster: {{cluster}}; kind: {{kind}}', {
              cluster: target.cluster,
              kind: target.definition.kind,
            })}
          </Typography>
          <Typography>{t('API version: {{version}}', { version: target.apiVersion })}</Typography>
          {!target.definition.resourceClass.isNamespaced && (
            <Alert severity="warning">
              {t(
                'This resource is cluster-scoped. The operation is not restricted to a namespace.'
              )}
            </Alert>
          )}
          {action === 'create' && !prepared ? (
            <>
              {target.definition.resourceClass.isNamespaced && (
                <TextField
                  label={t('Namespace')}
                  value={namespace}
                  disabled={busy}
                  onChange={event => setNamespace(event.target.value)}
                />
              )}
              <TextField
                label={t('Name')}
                value={name}
                disabled={busy}
                onChange={event => setName(event.target.value)}
              />
            </>
          ) : (
            <Typography>{namespace ? `${namespace}/${name}` : name}</Typography>
          )}
          <Alert severity={action === 'delete' || mode === 'validation' ? 'warning' : 'info'}>
            {mode === 'validation'
              ? t(
                  'Only kiali.io/ignore-validations is changed. Exclusions hide findings; they do not fix configuration or change policy enforcement. Specifications, labels and other annotations are preserved.'
                )
              : action === 'delete'
              ? t(
                  'Deleting this resource changes mesh configuration. Review the exact target before confirming.'
                )
              : t(
                  'Only the specification is edited. Review the replacement; server dry-run and permission checks run before confirmation.'
                )}
          </Alert>
          {mode === 'weights' && (
            <div hidden={!!prepared}>
              <TrafficWeightsEditor
                routes={options.routes}
                draft={weightDraft}
                onChange={setWeightDraft}
                error={weightResult.error}
                disabled={busy}
              />
            </div>
          )}
          {mode === 'http' && (
            <div hidden={!!prepared}>
              <HttpRouteBehaviorEditor
                routes={httpOptions.routes}
                draft={httpDraft}
                onChange={setHttpDraft}
                error={httpResult.error}
                disabled={busy}
              />
            </div>
          )}
          {mode === 'gatewayWeights' && (
            <div hidden={!!prepared}>
              <GatewayWeightsEditor
                rules={gatewayOptions.rules}
                draft={gatewayDraft}
                onChange={setGatewayDraft}
                disabled={busy}
                error={gatewayResult.error}
              />
            </div>
          )}
          {mode === 'mirror' && (
            <div hidden={!!prepared}>
              <HttpMirroringEditor
                routes={httpOptions.routes}
                draft={mirrorDraft}
                onChange={setMirrorDraft}
                error={mirrorResult.error}
                disabled={busy}
              />
            </div>
          )}
          {mode === 'order' && (
            <div hidden={!!prepared}>
              <HttpRouteOrderEditor
                routes={httpOptions.routes}
                draft={orderDraft}
                onChange={setOrderDraft}
                order={orderResult.plan?.order}
                error={orderResult.error}
                disabled={busy}
              />
            </div>
          )}
          {mode === 'validation' && !prepared && (
            <ValidationExclusionsEditor
              draft={exclusionDraft}
              onChange={setExclusionDraft}
              disabled={busy || !!exclusionInitial.error}
              error={exclusionResult.error}
            />
          )}
          {mode === 'match' && (
            <div hidden={!!prepared}>
              <HttpMatchEditEditor
                routes={httpOptions.routes}
                draft={matchDraft}
                onChange={setMatchDraft}
                error={matchResult.error}
                disabled={busy}
              />
            </div>
          )}
          {mode === 'circuit' && (
            <div hidden={!!prepared}>
              <CircuitBreakerEditor
                draft={circuitDraft}
                onChange={setCircuitDraft}
                disabled={busy}
                error={circuitResult.error}
              />
            </div>
          )}
          {mode === 'balancer' && (
            <div hidden={!!prepared}>
              <LoadBalancerEditor
                draft={balancerDraft}
                onChange={setBalancerDraft}
                disabled={busy}
                error={balancerResult.error}
              />
            </div>
          )}
          {mode === 'tls' && (
            <div hidden={!!prepared}>
              <OutboundTlsEditor
                draft={tlsDraft}
                onChange={setTlsDraft}
                disabled={busy}
                error={tlsResult.error}
              />
            </div>
          )}
          {mode === 'spec' && action !== 'delete' && !prepared && (
            <TextField
              label={t('Specification (JSON)')}
              multiline
              minRows={12}
              maxRows={24}
              value={text}
              disabled={busy}
              onChange={event => setText(event.target.value)}
              inputProps={{ spellCheck: false }}
            />
          )}
          {mode === 'peer' && (
            <div hidden={!!prepared}>
              <PeerMtlsEditor
                draft={peerDraft}
                onChange={setPeerDraft}
                disabled={busy}
                error={peerResult.error}
              />
            </div>
          )}
          {prepared && (
            <>
              {mode === 'mirror' && mirrorDraft.mode === 'set' && <MirroringWarning />}
              {mode === 'tls' && <OutboundTlsWarning draft={tlsDraft} />}
              {mode === 'peer' && <PeerMtlsWarning draft={peerDraft} />}
              {mode === 'gatewayWeights' && <GatewayWeightsWarning />}
              {mode === 'http' && <HttpBehaviorWarning draft={httpDraft} />}
              {mode === 'order' && <RouteOrderWarning />}
              {mode === 'match' && <HttpMatchEditWarning />}
              <Alert severity="success">
                {t('Server dry-run succeeded. Confirm to perform this operation.')}
              </Alert>
              {action !== 'delete' && (
                <Typography variant="body2">
                  {mode === 'validation'
                    ? t(
                        'The preview shows the exclusion annotation change. Kubernetes admission may modify the resource.'
                      )
                    : t(
                        'The preview shows the submitted specification. Kubernetes admission may apply defaults.'
                      )}
                </Typography>
              )}
              {mode === 'validation' && (
                <>
                  <Typography variant="h6" component="h3">
                    {t('Current exclusion annotation')}
                  </Typography>
                  <CodeBlock
                    value={JSON.stringify(
                      {
                        [VALIDATION_IGNORE_ANNOTATION]:
                          original?.metadata.annotations?.[VALIDATION_IGNORE_ANNOTATION],
                      },
                      null,
                      2
                    )}
                    label={t('Current exclusion annotation')}
                  />
                  <Typography variant="h6" component="h3">
                    {t('Proposed exclusion annotation')}
                  </Typography>
                  <CodeBlock
                    value={JSON.stringify(
                      prepared.validationExclusions?.value === null
                        ? {}
                        : {
                            [VALIDATION_IGNORE_ANNOTATION]: prepared.validationExclusions?.value,
                          },
                      null,
                      2
                    )}
                    label={t('Proposed exclusion annotation')}
                  />
                  <Typography>
                    {t(
                      'An empty object means the annotation is removed; an empty string means all findings are ignored.'
                    )}
                  </Typography>
                </>
              )}
              {action === 'update' && mode !== 'validation' && (
                <>
                  {mode === 'weights' && weightResult.plan && (
                    <>
                      <Typography>
                        {t('{{protocol}} route {{index}}', {
                          protocol: weightResult.plan.route.protocol.toUpperCase(),
                          index: weightResult.plan.route.index + 1,
                        })}
                      </Typography>
                      <SimpleTable
                        data={weightResult.plan.route.destinations.map((destination, index) => ({
                          ...destination,
                          next: weightResult.plan!.weights[index],
                        }))}
                        columns={[
                          { label: t('Host'), getter: item => item.host },
                          { label: t('Subset'), getter: item => item.subset ?? '-' },
                          {
                            label: t('Stored weight'),
                            getter: item => item.weight ?? t('Implicit'),
                          },
                          { label: t('Proposed weight'), getter: item => item.next },
                        ]}
                      />
                    </>
                  )}
                  <Typography variant="h6" component="h3">
                    {t('Current specification')}
                  </Typography>
                  <CodeBlock
                    value={JSON.stringify(original?.spec, null, 2) ?? t('Not specified')}
                    label={t('Current specification')}
                  />
                </>
              )}
              {action !== 'delete' && mode !== 'validation' && (
                <>
                  <Typography variant="h6" component="h3">
                    {t('Proposed specification')}
                  </Typography>
                  <CodeBlock
                    value={JSON.stringify(prepared.spec, null, 2)}
                    label={t('Proposed specification')}
                  />
                </>
              )}
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {sent && error && (
            <Alert severity="warning">
              {t(
                'The server may have received the operation. Close this dialog and refresh the resource before trying again; no automatic retry was made.'
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {t('Cancel')}
        </Button>
        {prepared && !sent && (
          <Button disabled={busy} onClick={() => setPrepared(undefined)}>
            {t('Back to edit')}
          </Button>
        )}
        <Button
          variant="contained"
          color={action === 'delete' ? 'error' : 'primary'}
          disabled={
            busy ||
            sent ||
            (mode === 'weights' && !weightResult.plan) ||
            (mode === 'gatewayWeights' && !gatewayResult.plan) ||
            (mode === 'http' && !httpResult.plan) ||
            (mode === 'order' && !orderResult.plan) ||
            (mode === 'match' && !matchResult.plan) ||
            (mode === 'mirror' && !mirrorResult.plan) ||
            (mode === 'circuit' && !circuitResult.plan) ||
            (mode === 'balancer' && !balancerResult.plan) ||
            (mode === 'tls' && !tlsResult.plan) ||
            (mode === 'peer' && !peerResult.plan) ||
            (mode === 'validation' && exclusionResult.value === undefined)
          }
          onClick={() => run(!!prepared)}
        >
          {busy ? t('Working...') : prepared ? t('Confirm operation') : t('Check and review')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ConfigurationActions({
  definition,
  apiVersion,
  cluster,
  resource,
  onChanged,
}: {
  definition: ConfigurationDefinition;
  apiVersion: string;
  cluster: string;
  resource?: ConfigurationResource;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const scopeKey = JSON.stringify([
    cluster,
    apiVersion,
    definition.id,
    resource?.metadata.namespace ?? '',
    resource?.metadata.name ?? '',
    resource?.metadata.uid ?? '',
  ]);
  const [session, setSession] = useState<{
    scopeKey: string;
    target: MutationTarget;
    action: PreparedMutation['action'];
    original?: ConfigurationObject<object>;
    mode?: MutationEditorMode;
  }>();
  const { enqueueSnackbar } = useSnackbar();
  const [success, setSuccess] = useState(false);
  const [captureError, setCaptureError] = useState<string>();
  useEffect(() => {
    setSession(undefined);
    setSuccess(false);
    setCaptureError(undefined);
  }, [scopeKey]);
  function start(action: PreparedMutation['action'], mode: MutationEditorMode = 'spec') {
    setSuccess(false);
    setCaptureError(undefined);
    try {
      const original = resource ? structuredClone(resource.jsonData) : undefined;
      setSession({
        scopeKey,
        target: {
          cluster,
          definition,
          apiVersion,
          namespace: original?.metadata.namespace ?? '',
          name: original?.metadata.name ?? '',
        },
        action,
        mode,
        original,
      });
    } catch (error) {
      setCaptureError(
        error instanceof Error ? error.message : t('Unable to capture the resource for review.')
      );
    }
  }
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        {resource ? (
          <>
            <Button onClick={() => start('update')}>{t('Edit specification')}</Button>
            <Button onClick={() => start('update', 'validation')}>
              {t('Edit validation exclusions')}
            </Button>
            {definition.kind === 'VirtualService' && definition.group === 'networking.istio.io' && (
              <>
                <Button onClick={() => start('update', 'weights')}>
                  {t('Adjust traffic weights')}
                </Button>
                <Button onClick={() => start('update', 'http')}>
                  {t('Edit HTTP route behavior')}
                </Button>
                <Button onClick={() => start('update', 'mirror')}>
                  {t('Edit HTTP mirroring')}
                </Button>
                <Button onClick={() => start('update', 'order')}>{t('Reorder HTTP routes')}</Button>
                <Button onClick={() => start('update', 'match')}>
                  {t('Edit HTTP match conditions')}
                </Button>
              </>
            )}
            {definition.kind === 'DestinationRule' &&
              definition.group === 'networking.istio.io' && (
                <>
                  <Button onClick={() => start('update', 'circuit')}>
                    {t('Edit circuit breaking')}
                  </Button>
                  <Button onClick={() => start('update', 'balancer')}>
                    {t('Edit load balancing')}
                  </Button>
                  <Button onClick={() => start('update', 'tls')}>{t('Edit outbound TLS')}</Button>
                </>
              )}
            {['HTTPRoute', 'GRPCRoute'].includes(definition.kind) &&
              definition.group === 'gateway.networking.k8s.io' && (
                <Button onClick={() => start('update', 'gatewayWeights')}>
                  {t('Adjust Gateway backend weights')}
                </Button>
              )}
            <Button color="error" onClick={() => start('delete')}>
              {t('Delete configuration')}
            </Button>
            {definition.kind === 'PeerAuthentication' &&
              definition.group === 'security.istio.io' && (
                <Button onClick={() => start('update', 'peer')}>{t('Edit inbound mTLS')}</Button>
              )}
          </>
        ) : (
          <Button onClick={() => start('create')}>{t('Create configuration')}</Button>
        )}
        <Button onClick={() => window.location.reload()}>{t('Reload page')}</Button>
      </Stack>
      {captureError && <Alert severity="error">{captureError}</Alert>}
      {success && (
        <Alert severity="success">
          {t(
            'The configuration operation succeeded. Reload the page if live updates have not refreshed the displayed data.'
          )}
        </Alert>
      )}
      {session && session.scopeKey === scopeKey && (
        <MutationDialog
          {...session}
          onClose={() => setSession(undefined)}
          onDone={() => {
            setSession(undefined);
            setSuccess(true);
            enqueueSnackbar(t('The configuration operation succeeded.'), { variant: 'success' });
            onChanged();
          }}
        />
      )}
    </Stack>
  );
}
