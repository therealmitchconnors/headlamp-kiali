import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState } from 'react';
import { DiagnosticPod } from '../core/diagnostics';
import {
  ProxyLoggingProposal,
  proxyLoggingProposal,
  ProxyLoggingSnapshot,
  ProxyLogLevel,
  proxyLogLevels,
} from '../core/proxyLogging';
import { clusterScope } from '../core/scope';
import {
  applyProxyLoggingProposal,
  loadProxyLoggingSnapshot,
  ProxyLoggingOutcomeError,
} from '../data/proxyLogging';

type Outcome =
  | { kind: 'applied'; snapshot: ProxyLoggingSnapshot }
  | { kind: 'not-applied' | 'unknown'; message: string };

function LoggerTable({ loggers }: { loggers: readonly { logger: string; level: string }[] }) {
  const { t } = useTranslation();
  return (
    <SimpleTable
      data={[...loggers]}
      columns={[
        { label: t('Logger'), getter: item => item.logger },
        { label: t('Current level'), getter: item => item.level },
      ]}
    />
  );
}

export default function ProxyLoggingControls({
  cluster,
  pod,
}: {
  cluster: string;
  pod: DiagnosticPod;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ProxyLoggingSnapshot>();
  const [level, setLevel] = useState<ProxyLogLevel>('info');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [proposal, setProposal] = useState<ProxyLoggingProposal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome>();
  const request = useRef<AbortController>();
  const titleId = useId();
  const proxy = pod.containers.find(container => container.name === 'istio-proxy');
  const eligible = !!proxy && proxy.restarts !== null;

  useEffect(() => () => request.current?.abort(), []);

  const readCurrent = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setSnapshot(undefined);
    setError('');
    setOutcome(undefined);
    setDialogOpen(false);
    try {
      const current = await loadProxyLoggingSnapshot(
        clusterScope(cluster),
        pod,
        controller.signal
      );
      if (!controller.signal.aborted) setSnapshot(current);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : t('Proxy logging read failed'));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const review = () => {
    if (!snapshot) return;
    try {
      setProposal(proxyLoggingProposal(snapshot, level));
      setError('');
      setDialogOpen(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Invalid proxy logging proposal'));
    }
  };

  const confirm = async () => {
    if (!proposal) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setDialogOpen(false);
    setError('');
    setOutcome(undefined);
    try {
      const result = await applyProxyLoggingProposal(
        clusterScope(cluster),
        pod,
        proposal,
        controller.signal
      );
      if (!controller.signal.aborted) {
        setSnapshot(result);
        setOutcome({ kind: 'applied', snapshot: result });
        setProposal(undefined);
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setSnapshot(undefined);
        setProposal(undefined);
        setOutcome({
          kind: failure instanceof ProxyLoggingOutcomeError ? 'unknown' : 'not-applied',
          message: failure instanceof Error ? failure.message : t('Proxy logging update failed'),
        });
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const hasChanges = snapshot?.loggers.some(logger => logger.level !== level) ?? false;
  return (
    <Stack spacing={2}>
      <Typography>
        {t(
          'Read and change log levels for the selected istio-proxy through the authenticated Headlamp Pod port-forward. The required Kubernetes permission is create on pods/portforward; no separate SSAR is treated as Envoy authorization.'
        )}
      </Typography>
      <Alert severity="warning">
        {t(
          'The Envoy loopback admin operation has no separate application authorization in this flow. A confirmed level change affects all loggers for this proxy and may increase log volume or expose sensitive details.'
        )}
      </Alert>
      {!eligible && (
        <Alert severity="info">
          {proxy
            ? t('The proxy restart count is unavailable; logging controls are disabled.')
            : t('An observed istio-proxy container is required; logging controls are disabled.')}
        </Alert>
      )}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Button disabled={!eligible || busy} onClick={readCurrent}>
          {t('Read current proxy log levels')}
        </Button>
        <TextField
          select
          label={t('Proposed proxy log level')}
          value={level}
          disabled={!eligible || busy}
          onChange={event => setLevel(event.target.value as ProxyLogLevel)}
        >
          {proxyLogLevels.map(option => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
        <Button disabled={!snapshot || !hasChanges || busy} onClick={review}>
          {t('Review proposed log-level change')}
        </Button>
      </Stack>
      {busy && <Alert severity="info">{t('Proxy logging operation in progress...')}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {outcome?.kind === 'applied' && (
        <Alert severity="success">
          {t('Proxy logging levels updated and verified at {{time}}', {
            time: new Date(outcome.snapshot.capturedAt).toLocaleString(),
          })}
        </Alert>
      )}
      {outcome && outcome.kind !== 'applied' && (
        <Alert severity={outcome.kind === 'unknown' ? 'warning' : 'error'}>
          {outcome.message}
        </Alert>
      )}
      {snapshot && (
        <Stack spacing={2}>
          <Typography>
            {t('Captured target')}: {snapshot.target.namespace}/{snapshot.target.pod} ·{' '}
            {t('Pod UID')} {snapshot.target.uid} · {snapshot.target.container} ·{' '}
            {t('restart count')} {snapshot.target.restarts} ·{' '}
            {new Date(snapshot.capturedAt).toLocaleString()}
          </Typography>
          <Typography>
            {t('Captured current logger levels')} ({snapshot.loggers.length})
          </Typography>
          <LoggerTable loggers={snapshot.loggers} />
        </Stack>
      )}
      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setProposal(undefined);
        }}
        fullWidth
        maxWidth="md"
        aria-labelledby={titleId}
      >
        <DialogTitle id={titleId}>{t('Confirm proxy log-level change')}</DialogTitle>
        <DialogContent dividers>
          {proposal && (
            <Stack spacing={2}>
              <Typography>
                {t('Target')}: {proposal.target.namespace}/{proposal.target.pod} ·{' '}
                {t('Pod UID')} {proposal.target.uid} · {proposal.target.container} ·{' '}
                {t('restart count')} {proposal.target.restarts}
              </Typography>
              <Typography>
                {t('Captured current levels at {{time}}', {
                  time: new Date(proposal.capturedAt).toLocaleString(),
                })}
              </Typography>
              <Typography>
                {t('Proposed level')}: {proposal.level} · {t('Scope')}: {t('All proxy loggers')}
              </Typography>
              <Alert severity="warning">
                {t(
                  'This sends an Envoy admin POST to /logging?level={{level}} after re-reading and matching the captured target and current levels. It is not a Kubernetes dry-run. Confirm only if this runtime-wide proxy change is intended.'
                  ,
                  { level: proposal.level }
                )}
              </Alert>
              <LoggerTable loggers={proposal.currentLoggers} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDialogOpen(false);
              setProposal(undefined);
            }}
          >
            {t('Cancel proxy logging change')}
          </Button>
          <Button
            variant="contained"
            disabled={!proposal || busy}
            onClick={confirm}
          >
            {t('Apply confirmed log-level change')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
