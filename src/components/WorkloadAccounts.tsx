import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CorrelatedWorkload } from '../core/correlation';
import { resourceKey } from '../core/scope';
import { WorkloadAccountProjection } from '../core/workloadInclusion';

export default function WorkloadAccounts({
  workload,
  projection,
}: {
  workload: CorrelatedWorkload;
  projection: WorkloadAccountProjection;
}) {
  const { t } = useTranslation();
  const evidence = projection.workloads.find(
    item => resourceKey(item.identity) === resourceKey(workload.identity)
  );
  const vm = projection.vmWorkloads.find(
    item => resourceKey(item.identity) === resourceKey(workload.identity)
  );
  if (!evidence && !vm)
    return (
      <>
        {workload.identity.kind === 'WorkloadGroup'
          ? t('VM entry accounts are not Pod account evidence')
          : t('This workload is not included in the pinned default account workload set')}
      </>
    );
  return (
    <Box sx={{ overflowWrap: 'anywhere' }}>
      {evidence &&
        (evidence.pods.length ? (
          <>
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
          </>
        ) : (
          t('No attributed Pods observed')
        ))}
      {vm && (
        <>
          <Typography variant="body2">
            {t('VM entry accounts are not Pod account evidence')}
          </Typography>
          {vm.entries.length
            ? vm.entries.map(entry => {
                const text =
                  entry.serviceAccount.ok === true
                    ? t('{{account}} (WorkloadEntry {{entry}})', {
                        account: entry.serviceAccount.name,
                        entry: entry.name,
                      })
                    : t('{{entry}}: {{message}}', {
                        entry: entry.name,
                        message: entry.serviceAccount.message,
                      });
                return (
                  <Typography key={entry.uid} variant="body2">
                    {text} ({t('UID: {{uid}}; resource version: {{resourceVersion}}', entry)})
                  </Typography>
                );
              })
            : t('No selector-matched WorkloadEntries were observed')}
        </>
      )}
    </Box>
  );
}
