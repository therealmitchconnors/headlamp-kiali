import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { GatewayRouteDraft, GatewayRouteKind } from '../../core/gatewayRouteProposals';

export type GatewayRouteFormDraft = GatewayRouteDraft;

export const initialGatewayRouteDraft: GatewayRouteFormDraft = {
  name: '',
  namespace: '',
  hostnames: '',
  parentName: '',
  parentNamespace: '',
  sectionName: '',
  parentPort: '',
  serviceName: '',
  serviceNamespace: '',
  servicePort: '',
};

export default function GatewayRouteEditor({
  kind,
  creating,
  draft,
  onChange,
  disabled,
  error,
}: {
  kind: GatewayRouteKind;
  creating: boolean;
  draft: GatewayRouteFormDraft;
  onChange: (draft: GatewayRouteFormDraft) => void;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const field = (
    key: keyof GatewayRouteFormDraft,
    label: string,
    helperText: string | undefined,
    type: string = 'text'
  ) => (
    <TextField
      key={key}
      label={label}
      type={type}
      value={draft[key]}
      disabled={disabled}
      helperText={helperText}
      onChange={event => onChange({ ...draft, [key]: event.target.value })}
    />
  );
  return (
    <Stack spacing={2}>
      {creating && (
        <>
          {field(
            'name',
            t('Route name'),
            t('Blank defaults to the backend Service name, matching the pinned Kiali wizard.')
          )}
          {field('namespace', t('Route namespace'), undefined)}
          {field(
            'hostnames',
            t('Route hostnames'),
            t(
              'Comma-separated DNS names or wildcard DNS names. Blank uses the backend Service name, matching the pinned Kiali wizard default.'
            )
          )}
        </>
      )}
      <Alert severity="info">
        {t(
          'Use the exact Gateway API Gateway name and namespace. A blank parent namespace means the route namespace. Blank section and port do not select a listener; listener acceptance is not verified.'
        )}
      </Alert>
      {field('parentName', t('Gateway name'), undefined)}
      {field('parentNamespace', t('Gateway namespace'), t('Blank uses the route namespace.'))}
      {field(
        'sectionName',
        t('Gateway section name'),
        t('Blank leaves the Gateway section unspecified.')
      )}
      {field(
        'parentPort',
        t('Gateway listener port'),
        t('Blank leaves the Gateway port unspecified.'),
        'number'
      )}
      {creating && (
        <>
          <Alert severity="info">
            {t(
              'The backend is a core Kubernetes Service. A blank backend namespace means the route namespace; choose an explicit Service port.'
            )}
          </Alert>
          {field('serviceName', t('Backend Service name'), undefined)}
          {field(
            'serviceNamespace',
            t('Backend Service namespace'),
            t('Blank uses the route namespace.')
          )}
          {field('servicePort', t('Backend Service port'), undefined, 'number')}
        </>
      )}
      <Alert severity="warning">
        {t(
          '{{kind}} proposals include only a Gateway parent and a Service backend. HTTP path/method rules, GRPC service/method matches, filters, cross-kind backends and controller-specific behavior are not edited by this form.',
          { kind }
        )}
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
