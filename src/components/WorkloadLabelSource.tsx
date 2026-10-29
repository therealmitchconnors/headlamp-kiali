import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CorrelationResource } from '../core/correlation';

export default function WorkloadLabelSource({
  identity,
  virtualMachine,
}: Pick<CorrelationResource, 'identity' | 'virtualMachine'>) {
  const { t } = useTranslation();
  if (!virtualMachine) return <>{t('Observed Kubernetes labels')}</>;
  const entry = virtualMachine.entry;
  return (
    <Box sx={{ overflowWrap: 'anywhere' }}>
      <Typography variant="body2">
        {entry
          ? t('First matching WorkloadEntry specification')
          : t('WorkloadGroup selector labels; no matched entries')}
      </Typography>
      {entry && (
        <>
          <Link
            routeName="kiali-config-workload-entry-detail"
            params={{ cluster: identity.cluster, namespace: identity.namespace, name: entry.name }}
          >
            {entry.name}
          </Link>
          <Typography variant="body2">
            {t('Observed UID: {{uid}}; resource version: {{version}}', {
              uid: entry.uid,
              version: entry.resourceVersion,
            })}
          </Typography>
        </>
      )}
      <Typography variant="body2">
        {t('{{count}} selector-matched entries; not a VM readiness count', {
          count: virtualMachine.matchingEntries,
        })}
      </Typography>
    </Box>
  );
}
