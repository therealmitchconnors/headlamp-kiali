import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { CustomDashboardSettings } from '../core/customDashboards';
import {
  DASHBOARD_WORKLOAD_KINDS,
  DashboardAnnotationTarget,
  DashboardWorkloadKind,
  validateDashboardAnnotationTarget,
} from '../core/dashboardAnnotations';
import { clusterScope } from '../core/scope';
import { loadDashboardAnnotations } from '../data/dashboardAnnotations';
import { RequestState, useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

type Capture = Awaited<ReturnType<typeof loadDashboardAnnotations>>;
export type DashboardAnnotationState = ({ status: 'stale' } | RequestState<Capture>) & {
  binding: string;
  attempt: number;
};
interface ReadRequest {
  attempt: number;
  target: DashboardAnnotationTarget;
  settings: CustomDashboardSettings;
}

function AnnotationCapture({
  cluster,
  binding,
  request,
  onState,
}: {
  cluster: string;
  binding: string;
  request: ReadRequest;
  onState: (state: DashboardAnnotationState) => void;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadDashboardAnnotations(clusterScope(cluster), request.settings, request.target, signal),
    [cluster, request]
  );
  const state = useRequest(JSON.stringify([binding, request]), load);
  useEffect(
    () => onState({ ...state, binding, attempt: request.attempt }),
    [state, binding, request.attempt, onState]
  );
  return (
    <RequestStatus state={state} loadingLabel={t('Reading dashboard annotation sources...')}>
      {data => (
        <Stack spacing={1}>
          <Typography>
            {t('Captured annotation namespace: {{namespace}}; Headlamp cluster: {{cluster}}', {
              namespace: data.target.namespace,
              cluster: data.cluster,
            })}
          </Typography>
          <SimpleTable
            data={data.sources}
            columns={[
              { label: t('Resource'), getter: source => `${source.kind}/${source.name}` },
              { label: t('UID'), getter: source => source.uid },
              { label: t('Resource version'), getter: source => source.resourceVersion },
              {
                label: t('Annotation source'),
                getter: source =>
                  source.location === 'pod-template'
                    ? t('Pod template metadata')
                    : t('Resource metadata'),
              },
              {
                label: t('Dashboard annotation'),
                getter: source =>
                  source.annotationPresent
                    ? t('Declared templates: {{count}}', { count: source.definitions.length })
                    : t('Not present'),
              },
            ]}
          />
          <Typography variant="body2">
            {t(
              'Namespace definitions override saved/bundled names; workload definitions apply last. These snapshots are not live watches and do not establish which cluster or workload produced the selected metrics.'
            )}
          </Typography>
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function DashboardAnnotations({
  cluster,
  namespace,
  binding,
  settings,
  enabled,
  onEnabled,
  onState,
}: {
  cluster: string;
  namespace: string;
  binding: string;
  settings: CustomDashboardSettings;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  onState: (state: DashboardAnnotationState) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DashboardWorkloadKind>('Deployment');
  const [name, setName] = useState('');
  const [request, setRequest] = useState<ReadRequest>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const invalidate = () => {
    setRequest(undefined);
    setError('');
    onState({ binding, attempt, status: 'stale' });
  };
  useEffect(() => {
    if (!enabled) setRequest(undefined);
  }, [enabled]);
  return (
    <Stack spacing={1}>
      <FormControlLabel
        label={t('Use namespace/workload dashboard annotations for this view')}
        control={
          <Checkbox
            checked={enabled}
            onChange={event => {
              setRequest(undefined);
              setError('');
              onEnabled(event.target.checked);
            }}
          />
        }
      />
      {enabled && (
        <>
          <Alert severity="info">
            {t(
              'Read dashboards.kiali.io/templates from the Kubernetes Namespace named by Dashboard namespace, with an optional workload in that same namespace. Reads are explicit, use your Headlamp identity, and do not write resources. Denied, malformed or stale sources block chart loading and discovery until reloaded or disabled.'
            )}
          </Alert>
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              select
              label={t('Annotation workload kind')}
              sx={{ minWidth: 240 }}
              value={kind}
              onChange={event => {
                const value = event.target.value;
                if (Object.prototype.hasOwnProperty.call(DASHBOARD_WORKLOAD_KINDS, value)) {
                  setKind(value as DashboardWorkloadKind);
                  invalidate();
                }
              }}
            >
              {Object.keys(DASHBOARD_WORKLOAD_KINDS).map(kind => (
                <MenuItem key={kind} value={kind}>
                  {kind}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('Annotation workload name (optional)')}
              sx={{ minWidth: 320, flexGrow: 1 }}
              value={name}
              onChange={event => {
                setName(event.target.value);
                invalidate();
              }}
            />
          </Stack>
          <Typography variant="body2">
            {t(
              'Supported controllers use pod-template annotations when the map is present, even if empty; otherwise resource annotations apply. Pod, Job and CronJob use their own metadata, matching the pinned caller. Custom controllers and WorkloadGroups are not selected here.'
            )}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => {
              try {
                const target = validateDashboardAnnotationTarget({
                  namespace,
                  ...(name ? { workload: { kind, name } } : {}),
                });
                const next = attempt + 1;
                setAttempt(next);
                setError('');
                onState({ binding, attempt: next, status: 'loading' });
                setRequest({ attempt: next, target, settings: structuredClone(settings) });
              } catch (error) {
                setRequest(undefined);
                setError(
                  error instanceof Error ? error.message : t('Invalid annotation source selection')
                );
                onState({ binding, attempt, status: 'stale' });
              }
            }}
          >
            {t('Read dashboard annotation overrides')}
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          {request && (
            <AnnotationCapture
              cluster={cluster}
              binding={binding}
              request={request}
              onState={onState}
            />
          )}
        </>
      )}
    </Stack>
  );
}
