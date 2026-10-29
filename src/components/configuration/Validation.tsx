import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useCallback, useId, useState } from 'react';
import { useKialiConfig } from '../../config';
import { getClusterConfig } from '../../core/config';
import { GatewayClassSettings } from '../../core/gatewayClassRegistry';
import { clusterScope } from '../../core/scope';
import { Finding, initialValidation } from '../../core/validation';
import { loadValidationSnapshot } from '../../data/validation';
import { useRequest } from '../../hooks/useRequest';
import { ConfigurationResource } from '../../resources/common';
import { DestinationRule } from '../../resources/destination-rule';
import { Gateway as IstioGateway } from '../../resources/gateway';
import { K8sGateway } from '../../resources/k8s-gateway';
import { PeerAuthentication } from '../../resources/peer-authentication';
import { ServiceEntry } from '../../resources/service-entry';
import { VirtualService } from '../../resources/virtual-service';
import RequestStatus from '../RequestStatus';

function FindingReferences({
  cluster,
  references,
}: {
  cluster: string;
  references: NonNullable<Finding['references']>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = `kiali-finding-references-${useId()}`;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        {t('{{count}} related configurations', { count: references.length })}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        aria-labelledby={titleId}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle id={titleId}>{t('Related configurations')}</DialogTitle>
        <DialogContent>
          <Alert severity="info">
            {t(
              'These identities and UIDs were observed in the validation snapshot. Navigation uses namespace and name; it is not permanently bound to that UID.'
            )}
          </Alert>
          <SimpleTable
            data={references}
            columns={[
              { label: t('Kind'), getter: reference => reference.kind },
              { label: t('Namespace'), getter: reference => reference.namespace },
              {
                label: t('Name'),
                getter: reference => (
                  <Box sx={{ overflowWrap: 'anywhere' }}>
                    <Link
                      routeName={
                        reference.group === 'networking.istio.io' && reference.kind === 'Gateway'
                          ? IstioGateway.detailsRoute
                          : reference.kind === 'Gateway'
                          ? K8sGateway.detailsRoute
                          : reference.kind === 'PeerAuthentication'
                          ? PeerAuthentication.detailsRoute
                          : reference.kind === 'DestinationRule'
                          ? DestinationRule.detailsRoute
                          : reference.kind === 'VirtualService'
                          ? VirtualService.detailsRoute
                          : ServiceEntry.detailsRoute
                      }
                      params={{ cluster, namespace: reference.namespace, name: reference.name }}
                    >
                      {reference.name}
                    </Link>
                  </Box>
                ),
              },
              {
                label: t('Observed UID'),
                getter: reference => <Box sx={{ overflowWrap: 'anywhere' }}>{reference.uid}</Box>,
              },
            ]}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('Close related configurations')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Checks({
  resource,
  attempt,
  identityDomain,
  gatewayClasses,
  skipWildcardGatewayHosts,
}: {
  resource: ConfigurationResource;
  attempt: number;
  identityDomain: string | null;
  gatewayClasses?: GatewayClassSettings;
  skipWildcardGatewayHosts: boolean;
}) {
  const { t } = useTranslation();
  const cluster = resource.cluster;
  const namespace = resource.metadata.namespace ?? '';
  const group = resource.jsonData.apiVersion?.split('/')[0] ?? '';
  const load = useCallback(
    async (signal: AbortSignal) => {
      const kind = resource.kind;
      const spec = structuredClone(resource.spec);
      const metadata = structuredClone(resource.metadata);
      const status = structuredClone(resource.jsonData.status);
      const snapshot = await loadValidationSnapshot(
        clusterScope(cluster),
        kind,
        group,
        spec,
        identityDomain,
        signal,
        namespace,
        gatewayClasses
      );
      return {
        skipWildcardGatewayHosts,
        gatewayRegistry: snapshot.context.gatewayClassRegistry,
        result: initialValidation({
          cluster,
          namespace,
          kind,
          group,
          spec,
          status,
          generation: metadata.generation,
          owner: metadata.uid ? { name: metadata.name, uid: metadata.uid } : undefined,
          annotations: metadata.annotations ?? {},
          workloads: [],
          // This reader does not include WorkloadGroups or custom controllers.
          // A complete Kubernetes snapshot cannot prove a selector misses all mesh workloads.
          complete: false,
          context: { ...snapshot.context, skipWildcardGatewayHosts },
        }),
        errors: snapshot.sources
          .filter(source => !source.complete)
          .map(source => ({ kind: source.key, message: source.error?.message })),
      };
    },
    [cluster, namespace, group, resource, identityDomain, gatewayClasses, skipWildcardGatewayHosts]
  );
  const state = useRequest(
    JSON.stringify([
      cluster,
      namespace,
      resource.metadata.uid,
      resource.metadata.resourceVersion,
      identityDomain,
      gatewayClasses,
      skipWildcardGatewayHosts,
      attempt,
    ]),
    load
  );
  return (
    <RequestStatus state={state} loadingLabel={t('Running initial configuration checks...')}>
      {data => (
        <>
          {resource.kind === 'Gateway' && group === 'networking.istio.io' && (
            <Alert severity="info">
              {t(
                'Istio Gateway conflicts use exact selector/port groups and pinned target-namespace/hostname matching. Protocol and TLS are not compared. Related gateways apply to the object, not only the indicated host. This is not a listener acceptance or reachability verdict.'
              )}{' '}
              {data.skipWildcardGatewayHosts
                ? t('Bare * host comparisons are skipped in this captured check.')
                : t('Bare * host comparisons are included in this captured check.')}
            </Alert>
          )}
          {resource.kind === 'Gateway' && group === 'gateway.networking.k8s.io' && (
            <>
              <Alert severity="info">
                {t(
                  'Gateway class checks use the configured/discovered registry, not object existence. Empty successful discovery uses pinned defaults; conditional east-west/waypoint defaults remain unknown without mesh-wide evidence. Denied or incomplete discovery does not become an empty successful list.'
                )}
              </Alert>
              {data.gatewayRegistry && (
                <details>
                  <summary>{t('Resolved Gateway API class registry')}</summary>
                  <Alert severity="info">
                    {t('Registry source: {{basis}}', {
                      basis: {
                        configured: t('Configured classes'),
                        discovered: t('Discovered classes'),
                        fallback: t('Pinned defaults'),
                      }[data.gatewayRegistry.basis],
                    })}
                  </Alert>
                  <SimpleTable
                    data={data.gatewayRegistry.classes}
                    columns={[
                      { label: t('Display name'), getter: item => item.name },
                      { label: t('Class name'), getter: item => item.className },
                    ]}
                  />
                  {!!data.gatewayRegistry.uncertain.length && (
                    <Alert severity="warning">
                      {t('Conditional defaults not resolved: {{classes}}', {
                        classes: data.gatewayRegistry.uncertain.join(', '),
                      })}
                    </Alert>
                  )}
                </details>
              )}
            </>
          )}
          {data.errors.map(error => (
            <Alert severity="warning" key={error.kind}>
              {error.kind}: {error.message ?? t('Incomplete resource list')}
            </Alert>
          ))}
          {data.result.findings.some(finding => finding.code === 'KIA0204') && (
            <Alert severity="info">
              {t(
                'TLS override findings describe configuration patterns, not observed encryption. Automatic mTLS and actual proxy behavior require separate assessment.'
              )}
            </Alert>
          )}
          {data.result.findings.some(
            finding => finding.code === 'KIA1501' || finding.code === 'KIA1502'
          ) && (
            <Alert severity="info">
              {t(
                'Gateway collision findings use exact hostname/port/protocol or explicit address-type/value comparisons from the pinned checker. Wildcard overlaps and omitted address defaults are not inferred. Same-named Gateways are excluded even across namespaces; this is not a controller acceptance or reachability verdict.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding => finding.code === 'KIA1101') && (
            <Alert severity="info">
              {t(
                'Destination severity follows the pinned Kiali classifier: only ALLOW_ANY produces warnings; other supported modes produce errors. An omitted policy uses the pinned Kiali ALLOW_ANY default. This is not evidence of traffic reachability or proxy enforcement.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding => finding.code === 'KIA1106') && (
            <Alert severity="info">
              {t(
                'Host conflicts follow pinned Kiali grouping, not a routing or reachability verdict. Gateway strings are compared literally; omitted gateways differ from mesh. Duplicate hosts or gateways can flag a single object. Export and namespace-wide Sidecar imports select whole VirtualServices, then all their hosts contribute.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding => finding.code === 'KIA0002') && (
            <Alert severity="info">
              {t(
                'Selectorless PeerAuthentication conflicts count absent, null and empty matchLabels selectors alike, regardless of mTLS mode. They compare policies in the same namespace, not namespace policies against mesh-root policies. This is separate from workload-selector overlap and does not determine effective encryption.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding =>
            ['KIA0401', 'KIA0501', 'KIA0505', 'KIA0506'].includes(finding.code)
          ) && (
            <Alert severity="info">
              {t(
                'PeerAuthentication findings compare namespace/mesh configuration patterns. Automatic mTLS defaults, selector presence and top-level DestinationRule modes follow pinned Kiali behavior; these checks do not prove encryption or enforcement.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding =>
            ['KIA0205', 'KIA0206', 'KIA0207', 'KIA0208'].includes(finding.code)
          ) && (
            <Alert severity="info">
              {t(
                'DestinationRule mTLS findings compare namespace/root PeerAuthentication patterns, not observed encryption or enforcement. Selector presence, automatic mTLS and policy ordering follow the pinned checker.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding => finding.code === 'KIA1004') && (
            <Alert severity="info">
              {t(
                'Registry findings describe configuration lookup patterns, not traffic reachability or effective Sidecar enforcement.'
              )}
            </Alert>
          )}
          {data.result.findings.some(finding => finding.code === 'KIA0104') && (
            <Alert severity="info">
              {t(
                'Authorization host findings are scoped service-registry hints for internal names, not HTTP Host-header validation or an authorization decision. Wildcard and external Host-header matchers are excluded. Severity follows configured outbound policy, not observed traffic.'
              )}
            </Alert>
          )}
          <SimpleTable
            data={data.result.findings}
            emptyMessage={t(
              'No findings from these limited checks. This is not a validity or health verdict.'
            )}
            columns={[
              { label: t('Code'), getter: (finding: Finding) => finding.code },
              {
                label: t('Severity'),
                getter: (finding: Finding) =>
                  finding.severity === 'error'
                    ? t('Error')
                    : finding.severity === 'warning'
                    ? t('Warning')
                    : t('Unknown'),
              },
              { label: t('Field'), getter: (finding: Finding) => finding.path },
              {
                label: t('Message'),
                getter: (finding: Finding) =>
                  finding.code === 'KIA0204'
                    ? t('mTLS settings of a non-local Destination Rule are overridden')
                    : finding.code === 'KIA1006'
                    ? t('Global default sidecar should not have workloadSelector')
                    : finding.code === 'KIA1004' || finding.code === 'KIA0104'
                    ? t('This host has no matching entry in the service registry')
                    : finding.code === 'KIA1101'
                    ? t("DestinationWeight on route doesn't have a valid service (host not found)")
                    : finding.code === 'KIA0401'
                    ? t('Mesh-wide Destination Rule enabling mTLS is missing')
                    : finding.code === 'KIA0501'
                    ? t('Destination Rule enabling namespace-wide mTLS is missing')
                    : finding.code === 'KIA0505'
                    ? t('Destination Rule disabling namespace-wide mTLS is missing')
                    : finding.code === 'KIA0506'
                    ? t('Destination Rule disabling mesh-wide mTLS is missing')
                    : finding.code === 'KIA0205'
                    ? t('PeerAuthentication enabling mTLS at mesh level is missing')
                    : finding.code === 'KIA0206'
                    ? t('PeerAuthentication enabling namespace-wide mTLS is missing')
                    : finding.code === 'KIA0207'
                    ? t('PeerAuthentication with TLS strict mode found, it should be permissive')
                    : finding.code === 'KIA0208'
                    ? t('PeerAuthentication enabling mTLS found, permissive mode needed')
                    : finding.code === 'KIA0002'
                    ? t('More than one selector-less object in the same namespace')
                    : finding.code === 'KIA0301'
                    ? t('More than one Gateway for the same host port combination')
                    : finding.code === 'KIA1106'
                    ? t('More than one Virtual Service for same host')
                    : finding.code === 'KIA0201'
                    ? t('More than one DestinationRules for the same host subset combination')
                    : finding.code === 'KIA1211'
                    ? t('More than one ServiceEntry for the same host and port')
                    : finding.code === 'KIA1212'
                    ? t('ServiceEntries have conflicting protocols for the same host and port')
                    : finding.message,
              },
              ...(data.result.findings.some(finding => finding.references?.length)
                ? [
                    {
                      label: t('Related configurations'),
                      getter: (finding: Finding) =>
                        finding.references?.length ? (
                          <FindingReferences
                            key={JSON.stringify([
                              cluster,
                              namespace,
                              resource.metadata.name,
                              resource.metadata.uid,
                              resource.metadata.resourceVersion,
                              attempt,
                              finding.code,
                              finding.path,
                            ])}
                            cluster={cluster}
                            references={finding.references}
                          />
                        ) : (
                          t('None')
                        ),
                    },
                  ]
                : []),
            ]}
          />
          {data.result.skipped.map(message => (
            <Alert severity="info" key={message}>
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

export default function Validation({ resource }: { resource: ConfigurationResource }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const config = useKialiConfig();
  const identityDomain = config.valid
    ? getClusterConfig(config.config, resource.cluster).identityDomain ?? null
    : null;
  return (
    <SectionBox title={t('Initial configuration checks')}>
      <Alert severity="info">
        {t(
          'Coverage is partial: routing, selectors, exports, VirtualService destination registry and host conflicts, Sidecar imports/mode/root selectors/egress registry, ServiceEntry host/port conflicts, DestinationRule host/subset/TLS/peer-policy patterns, PeerAuthentication namespace/mesh patterns and selectorless conflicts, Istio Gateway targets/host conflicts, Gateway class registry/listeners/status, HTTP/gRPC references, ReferenceGrants, AuthorizationPolicy namespace/method/host-registry patterns and WorkloadGroup label conflicts. Namespace-wide imports exclude workload-selected overrides. References do not prove listener attachment; policy checks do not evaluate access decisions. Missing or stale context is reported, not treated as valid configuration.'
        )}
      </Alert>
      {config.valid === false && <Alert severity="error">{config.message}</Alert>}
      {resource.kind === 'PeerAuthentication' && (
        <Alert severity="info">
          {t(
            'The pinned PeerAuthentication mTLS-pattern checks exclude every present selector, including an empty one. Selectorless conflict checks and the separate namespace mTLS indicator instead count empty selectors as namespace-wide.'
          )}
        </Alert>
      )}
      <Button disabled={!config.valid} onClick={() => setAttempt(value => value + 1)}>
        {t('Run initial checks')}
      </Button>
      <Alert severity="info">
        {t(
          'Context reads stop after 15 seconds. A timeout does not establish validity or absence; retry after correcting connectivity or reducing the relevant source data.'
        )}
      </Alert>
      {attempt > 0 && config.valid && (
        <Checks
          resource={resource}
          attempt={attempt}
          identityDomain={identityDomain}
          skipWildcardGatewayHosts={
            getClusterConfig(config.config, resource.cluster).skipWildcardGatewayHosts ?? false
          }
          gatewayClasses={getClusterConfig(config.config, resource.cluster).gatewayClasses}
        />
      )}
    </SectionBox>
  );
}
