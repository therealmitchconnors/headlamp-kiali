import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useCallback, useEffect, useState } from 'react';
import { useKialiConfig } from '../../config';
import { getClusterConfig } from '../../core/config';
import { clusterScope } from '../../core/scope';
import type { Finding } from '../../core/validation';
import {
  captureGateway,
  GatewayValidationSettings,
  loadScopedGatewayValidation,
} from '../../data/gatewayValidation';
import { useRequest } from '../../hooks/useRequest';
import type { ConfigurationResource } from '../../resources/common';
import { Gateway } from '../../resources/gateway';
import { K8sGateway } from '../../resources/k8s-gateway';
import RequestStatus from '../RequestStatus';
import StructuredValue from './StructuredValue';

function Results({
  cluster,
  target,
  settings,
}: {
  cluster: string;
  target: unknown;
  settings: GatewayValidationSettings;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadScopedGatewayValidation(clusterScope(cluster), target, settings, signal),
    [cluster, target, settings]
  );
  const state = useRequest(cluster, load);
  return (
    <RequestStatus state={state} loadingLabel={t('Running declared-scope Gateway checks...')}>
      {data => (
        <>
          {data.scope?.configurationSources && (
            <details>
              <summary>{t('Captured mesh configuration sources')}</summary>
              <StructuredValue value={data.scope.configurationSources} />
            </details>
          )}
          {data.excluded ? (
            <Alert severity="info">
              {t('All Gateway checks are excluded by annotation; no evidence was read.')}
            </Alert>
          ) : (
            <Alert severity="info">
              {t(
                'Captured {{count}} declared local managed namespaces. These checks are not proof of listener attachment, controller readiness, injection or reachability.',
                {
                  count: data.scope?.membership.length ?? 0,
                }
              )}
            </Alert>
          )}
          {data.controller && (
            <Alert severity="info">
              {t('Captured controller: {{controller}}. Gateway selector scope: {{scope}}.', {
                controller: data.controller.name,
                scope: data.controller.scopeToNamespace
                  ? t('Gateway namespace only')
                  : t('All declared local managed namespaces'),
              })}{' '}
              {t('Observed controller UID: {{uid}}; resource version: {{version}}.', {
                uid: data.controller.uid,
                version: data.controller.resourceVersion,
              })}{' '}
              {t(
                'Captured {{count}} default-inclusion workloads; owned Pods and child ReplicaSets are not independent targets.',
                {
                  count: data.workloads.length,
                }
              )}
            </Alert>
          )}
          {data.registry && (
            <Alert severity="info">
              {t(
                'Gateway class registry membership is separate from controller acceptance. Conditional mesh-wide defaults remain unresolved.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding => finding.references?.length) && (
            <Alert severity="info">
              {t(
                'These identities and UIDs were observed in the validation snapshot. Navigation uses namespace and name; it is not permanently bound to that UID.'
              )}
            </Alert>
          )}
          {!data.excluded && (
            <SimpleTable
              data={data.result.findings}
              emptyMessage={t(
                'No findings from these scoped checks. Coverage remains partial; this is not a validity verdict.'
              )}
              columns={[
                { label: t('Code'), getter: finding => finding.code },
                {
                  label: t('Severity'),
                  getter: finding =>
                    finding.severity === 'error'
                      ? t('Error')
                      : finding.severity === 'warning'
                      ? t('Warning')
                      : t('Unknown'),
                },
                { label: t('Path'), getter: finding => finding.path },
                {
                  label: t('Message'),
                  getter: finding =>
                    finding.code === 'KIA0302'
                      ? t('No matching workload found for gateway selector in this namespace')
                      : finding.code === 'KIA0301'
                      ? t('More than one Gateway for the same host port combination')
                      : finding.code === 'KIA1501'
                      ? t('More than one K8s Gateway for the same host port combination')
                      : finding.code === 'KIA1502'
                      ? t('More than one K8s Gateway for the same address and type combination')
                      : finding.code === 'KIA1503'
                      ? t(
                          'Each listener must have a unique combination of Hostname, Port, and Protocol'
                        )
                      : finding.code === 'KIA1504'
                      ? t('Gateway API Class not found in Kiali configuration')
                      : finding.message,
                },
                {
                  label: t('Related configurations'),
                  getter: (finding: Finding) =>
                    finding.references?.length
                      ? finding.references.map(reference => (
                          <div key={reference.uid}>
                            <Link
                              routeName={
                                reference.group === 'networking.istio.io'
                                  ? Gateway.detailsRoute
                                  : K8sGateway.detailsRoute
                              }
                              params={{
                                cluster,
                                namespace: reference.namespace,
                                name: reference.name,
                              }}
                            >
                              {reference.namespace}/{reference.name}
                            </Link>{' '}
                            {t('Observed UID: {{uid}}', { uid: reference.uid })}
                          </div>
                        ))
                      : t('None'),
                },
              ]}
            />
          )}
          {!data.excluded &&
            data.result.skipped.map(message => (
              <Alert key={message} severity="info">
                {message}
              </Alert>
            ))}
          {data.result.suppressed > 0 && (
            <Alert severity="info">
              {t('{{count}} findings were suppressed by the ignore-validations annotation.', {
                count: data.result.suppressed,
              })}
            </Alert>
          )}
        </>
      )}
    </RequestStatus>
  );
}

export default function ScopedGatewayValidation({ resource }: { resource: ConfigurationResource }) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, resource.cluster) : undefined;
  const [request, setRequest] = useState<{
    binding: string;
    attempt: number;
    target: unknown;
    settings: GatewayValidationSettings;
  }>();
  const [error, setError] = useState('');
  const binding = JSON.stringify([
    resource.cluster,
    resource.jsonData,
    config.valid,
    settings?.meshClusterName,
    settings?.gatewayClasses,
    settings?.skipWildcardGatewayHosts,
  ]);
  useEffect(() => {
    setRequest(undefined);
    setError('');
  }, [binding]);
  return (
    <SectionBox title={t('Declared-scope Gateway checks')}>
      <Alert severity="info">
        {t(
          'Explicit read-only checks require an unambiguous declared local namespace scope and complete versioned sources. Istio Gateway port-name helpers are disabled in the pinned caller; no dormant port rules or route attachment checks are enabled. Reads stop after 15 seconds.'
        )}
      </Alert>
      {!settings?.meshClusterName && (
        <Alert severity="warning">
          {t(
            'Configure an explicit logical mesh cluster name before running scoped Gateway checks.'
          )}
        </Alert>
      )}
      <Link routeName="kiali-settings" params={{ cluster: resource.cluster }}>
        {t('Configure logical mesh cluster name')}
      </Link>
      <Button
        disabled={!config.valid || !settings?.meshClusterName}
        onClick={() => {
          try {
            captureGateway(resource.jsonData);
            if (!settings?.meshClusterName)
              throw new Error('Logical mesh cluster name is unavailable');
            setError('');
            setRequest(current => ({
              binding,
              attempt: (current?.attempt ?? 0) + 1,
              target: structuredClone(resource.jsonData),
              settings: {
                logicalName: settings.meshClusterName,
                gatewayClasses: structuredClone(settings.gatewayClasses),
                skipWildcardGatewayHosts: settings.skipWildcardGatewayHosts,
              },
            }));
          } catch (error) {
            setRequest(undefined);
            setError(error instanceof Error ? error.message : t('Gateway capture is unavailable'));
          }
        }}
      >
        {t('Run scoped Gateway checks')}
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {request?.binding === binding && (
        <Results
          key={`${binding}/${request.attempt}`}
          cluster={resource.cluster}
          target={request.target}
          settings={request.settings}
        />
      )}
    </SectionBox>
  );
}
