import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { ProxyConfigEntry } from '../core/proxyConfig';
import { proxyListenerDetails, ProxyRouteDetail, proxyRouteDetails } from '../core/proxyDetails';
import { readProxyClusterSummary, readProxyMetadataPath } from '../core/proxySummary';
import CodeBlock from './configuration/CodeBlock';
import ProxyConfigurationCandidate from './ProxyConfigurationCandidate';
import ProxyServiceCandidate from './ProxyServiceCandidate';

export default function ProxyEntryDetails({
  entry,
  domain,
  cluster,
}: {
  entry: ProxyConfigEntry;
  domain: string | null;
  cluster: string;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<{ label: string; value: unknown; referencePath?: string }>();
  const result = useMemo(() => {
    try {
      return {
        cluster:
          entry.kind === 'cluster'
            ? readProxyClusterSummary(entry.resource, domain ?? '')
            : undefined,
        clusterReference:
          entry.kind === 'cluster' ? readProxyMetadataPath(entry.resource.metadata) : '',
        routes: entry.kind === 'route' ? proxyRouteDetails(entry.resource) : undefined,
        listener: entry.kind === 'listener' ? proxyListenerDetails(entry.resource) : undefined,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid proxy entry summary' };
    }
  }, [entry, domain]);
  const actions: Record<ProxyRouteDetail['action'], string> = {
    forward: t('Forward'),
    redirect: t('Redirect'),
    'direct-response': t('Direct response'),
    none: t('No action reported'),
    unsupported: t('Extension or non-forwarding action'),
  };
  const protocols: Record<string, string> = {
    'App: HTTP TLS': t('HTTP TLS'),
    'App: Istio HTTP Plain': t('Istio HTTP plaintext'),
    'App: TCP TLS': t('TCP TLS'),
    'App: HTTP': t('HTTP plaintext'),
  };
  return (
    <Stack spacing={2}>
      {result.error && <Alert severity="warning">{result.error}</Alert>}
      {result.cluster && (
        <>
          {!domain && (
            <Alert severity="info">
              {t(
                'Service DNS identity is not configured; no Kubernetes Service identity is inferred.'
              )}
            </Alert>
          )}
          <SimpleTable
            data={[
              { label: t('Service or cluster name'), value: result.cluster.host.service },
              { label: t('Namespace'), value: domain ? result.cluster.host.namespace : null },
              {
                label: t('Parsed port'),
                value: result.cluster.port === '0' ? null : result.cluster.port,
              },
              { label: t('Subset'), value: result.cluster.subset },
              { label: t('Direction'), value: result.cluster.direction },
              { label: t('Cluster discovery type'), value: result.cluster.type },
              {
                label: t('Configuration metadata reference'),
                value: result.cluster.destinationRule,
              },
            ]}
            columns={[
              { label: t('Field'), getter: item => item.label },
              { label: t('Value'), getter: item => item.value || t('Not reported') },
            ]}
          />
          {domain && <ProxyServiceCandidate cluster={cluster} name={entry.name} domain={domain} />}
          {!!result.clusterReference && (
            <ProxyConfigurationCandidate
              cluster={cluster}
              kind="DestinationRule"
              path={result.clusterReference}
            />
          )}
        </>
      )}
      {result.routes && (
        <>
          <Typography>
            {t(
              'Every route action is retained, including redirects, direct responses and passthrough. Inspect a route to see its complete match constraints and action; domains are not resolved to Kubernetes resources.'
            )}
          </Typography>
          <SimpleTable
            data={result.routes}
            columns={[
              { label: t('Entry'), getter: item => item.index },
              { label: t('Virtual host'), getter: item => item.virtualHost || t('Not reported') },
              {
                label: t('Domains'),
                getter: item => item.domains.join(', ') || t('None returned'),
              },
              { label: t('Route'), getter: item => item.name || t('Not reported') },
              { label: t('Action'), getter: item => actions[item.action] },
              {
                label: t('Configuration metadata reference'),
                getter: item => item.reference || t('Not reported'),
              },
              {
                label: t('Details'),
                getter: item => (
                  <Button
                    aria-label={t('Inspect route match and action {{index}}', {
                      index: item.index,
                    })}
                    onClick={() =>
                      setDetail({
                        label: t('Route match and action'),
                        referencePath: item.referencePath,
                        value: {
                          match: item.match,
                          action: item.action,
                          configuration: item.actionData,
                        },
                      })
                    }
                  >
                    {t('Inspect route')}
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      {result.listener && (
        <>
          <Typography>
            {t('Listener address')}: {JSON.stringify(result.listener.address)}
          </Typography>
          <Alert severity="info">
            {t(
              'Protocol labels describe configured filter-chain matches, not observed encryption. Inspect each chain for complete match constraints and destinations; unknown filters remain visible in the full entry.'
            )}
          </Alert>
          <SimpleTable
            data={result.listener.entries}
            columns={[
              { label: t('Entry'), getter: item => item.index },
              { label: t('Filter chain'), getter: item => item.name || t('Not reported') },
              {
                label: t('Default chain'),
                getter: item => (item.defaultChain ? t('True') : t('False')),
              },
              {
                label: t('Application protocol match'),
                getter: item => protocols[item.applicationProtocol] ?? t('Not classified'),
              },
              {
                label: t('Network filters'),
                getter: item => item.filterNames.join(', ') || t('None returned'),
              },
              {
                label: t('Details'),
                getter: item => (
                  <Button
                    aria-label={t('Inspect listener filter chain {{index}}', { index: item.index })}
                    onClick={() =>
                      setDetail({
                        label: t('Listener filter-chain match and destinations'),
                        value: { match: item.match, destinations: item.destinations },
                      })
                    }
                  >
                    {t('Inspect filter chain')}
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      <Typography variant="body2">
        {t(
          'Metadata references are observations, not proof that the referenced resource exists or is visible.'
        )}
      </Typography>
      {detail && (
        <>
          {!!detail.referencePath && (
            <ProxyConfigurationCandidate
              cluster={cluster}
              kind="VirtualService"
              path={detail.referencePath}
            />
          )}
          <CodeBlock value={JSON.stringify(detail.value, null, 2)} label={detail.label} />
        </>
      )}
    </Stack>
  );
}
