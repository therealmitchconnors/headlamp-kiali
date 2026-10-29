import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CorrelatedWorkload } from '../core/correlation';
import { workloadPodAccounts } from '../core/workloadAccounts';

export default function WorkloadAccounts({ workload }: { workload: CorrelatedWorkload }) {
  const { t } = useTranslation();
  let evidence: ReturnType<typeof workloadPodAccounts>;
  try {
    evidence = workloadPodAccounts(workload);
  } catch (error) {
    return (
      <Alert severity="warning">
        {t('Pod account evidence unavailable: {{message}}', {
          message: error instanceof Error ? error.message : t('Invalid attributed Pod data'),
        })}
      </Alert>
    );
  }
  if (!evidence.observedPods)
    return (
      <>
        {workload.identity.kind === 'WorkloadGroup'
          ? t('VM entry accounts are not Pod account evidence')
          : t('No attributed Pods observed')}
      </>
    );
  return (
    <Box sx={{ overflowWrap: 'anywhere' }}>
      {evidence.accounts.map(account => (
        <Typography key={account.name} variant="body2">
          {t('{{name}} (attributed Pods: {{count}})', account)}
        </Typography>
      ))}
      {!!evidence.unavailable.length && (
        <details>
          <summary>
            {t('{{count}} Pod account observations unavailable', {
              count: evidence.unavailable.length,
            })}
          </summary>
          {evidence.unavailable.map(pod => (
            <Typography key={pod.uid} variant="body2">
              {pod.name}: {pod.message}
            </Typography>
          ))}
        </details>
      )}
    </Box>
  );
}
