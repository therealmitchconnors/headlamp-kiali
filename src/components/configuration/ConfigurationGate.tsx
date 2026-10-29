import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { ReactNode, useCallback, useMemo, useState } from 'react';
import { clusterScope } from '../../core/scope';
import { discoverConfiguration } from '../../data/configuration';
import { useRequest } from '../../hooks/useRequest';
import type { ConfigurationResourceClass } from '../../resources/common';
import { ConfigurationDefinition } from '../../resources/registry';
import RequestStatus from '../RequestStatus';

function ServedResource({
  definition,
  apiVersion,
  children,
}: {
  definition: ConfigurationDefinition;
  apiVersion: string;
  children: (resourceClass: ConfigurationResourceClass) => ReactNode;
}) {
  const resourceClass = useMemo(() => {
    class SelectedResource extends definition.resourceClass {
      static apiVersion = apiVersion;
      static _internalApiEndpoint = undefined;
    }
    // Each scoped class owns its endpoint cache; never mutate the shared model or its version.
    return SelectedResource;
  }, [definition, apiVersion]);
  return <>{children(resourceClass)}</>;
}

export default function ConfigurationGate({
  cluster,
  definition,
  children,
}: {
  cluster: string;
  definition: ConfigurationDefinition;
  children: (resourceClass: ConfigurationResourceClass) => ReactNode;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(
    (signal: AbortSignal) => discoverConfiguration(clusterScope(cluster), definition, signal),
    [cluster, definition]
  );
  const result = useRequest(JSON.stringify([cluster, definition.id, attempt]), load);
  return (
    <Stack spacing={2}>
      <RequestStatus state={result} loadingLabel={t('Discovering configuration APIs...')}>
        {availability =>
          availability.available === true ? (
            <ServedResource definition={definition} apiVersion={availability.apiVersion}>
              {children}
            </ServedResource>
          ) : (
            <Alert severity="info">
              {availability.reason === 'absent'
                ? t('{{kind}} is not served by this cluster. No installation was attempted.', {
                    kind: definition.kind,
                  })
                : t('This cluster does not serve a supported {{kind}} API version.', {
                    kind: definition.kind,
                  })}
            </Alert>
          )
        }
      </RequestStatus>
      {(result.status === 'error' || (result.status === 'ready' && !result.data.available)) && (
        <Button onClick={() => setAttempt(value => value + 1)} sx={{ alignSelf: 'flex-start' }}>
          {t('Retry discovery')}
        </Button>
      )}
    </Stack>
  );
}
