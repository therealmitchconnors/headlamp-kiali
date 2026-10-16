import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import { ReactNode } from 'react';
import { ClusterScope as Scope, clusterScope } from '../core/scope';

export default function ClusterScope({ children }: { children: (scope: Scope) => ReactNode }) {
  const clusters = K8s.useSelectedClusters();
  const { t } = useTranslation();
  if (clusters.length !== 1) {
    return (
      <SectionBox title="Kiali" headerProps={{ headerStyle: 'main' }}>
        <Alert severity="info">
          {clusters.length === 0
            ? t('Select a cluster to use Kiali.')
            : t('This initial Kiali view supports one cluster at a time. Select a single cluster.')}
        </Alert>
      </SectionBox>
    );
  }
  return <>{children(clusterScope(clusters[0]))}</>;
}
