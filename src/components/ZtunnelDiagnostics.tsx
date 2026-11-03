import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import {
  ZtunnelEndpoint,
  ZtunnelService,
  ztunnelServiceCandidate,
  ZtunnelSnapshot,
  ZtunnelWaypoint,
  ZtunnelWorkload,
  ztunnelWorkloadCandidate,
} from '../core/ztunnel';
import CodeBlock from './configuration/CodeBlock';
import ZtunnelResourceCandidate from './ZtunnelResourceCandidate';

interface SelectedEntry {
  label: string;
  raw: Record<string, unknown>;
  fields: { field: string; value: string | number }[];
  target: ReturnType<typeof ztunnelServiceCandidate> | ReturnType<typeof ztunnelWorkloadCandidate>;
  registryIdentity: string;
  endpoints?: ZtunnelService['endpoints'];
}

function serviceFields(item: ZtunnelService, t: (key: string) => string) {
  return [
    { field: t('Hostname'), value: item.hostname ?? t('Not reported') },
    { field: t('IP families'), value: item.ipFamilies ?? t('Not reported') },
    {
      field: t('Service ports'),
      value: item.ports === null ? t('Not reported') : JSON.stringify(item.ports),
    },
    {
      field: t('Subject alternative names'),
      value: item.subjectAltNames?.join(', ') ?? t('Not reported'),
    },
  ];
}

function workloadFields(item: ZtunnelWorkload, t: (key: string) => string) {
  return [
    { field: t('Workload name'), value: item.workloadName ?? t('Not reported') },
    { field: t('Workload type'), value: item.workloadType ?? t('Not reported') },
    { field: t('Canonical name'), value: item.canonicalName ?? t('Not reported') },
    { field: t('Canonical revision'), value: item.canonicalRevision ?? t('Not reported') },
    { field: t('Network mode'), value: item.networkMode ?? t('Not reported') },
    { field: t('Service account'), value: item.serviceAccount ?? t('Not reported') },
    { field: t('Services'), value: item.services?.join(', ') ?? t('Not reported') },
    { field: t('Trust domain'), value: item.trustDomain ?? t('Not reported') },
  ];
}

export default function ZtunnelDiagnostics({
  cluster,
  meshClusterName,
  data,
}: {
  cluster: string;
  meshClusterName: string | null;
  data: ZtunnelSnapshot;
}) {
  const { t } = useTranslation();
  const [serviceFilter, setServiceFilter] = useState('');
  const [workloadFilter, setWorkloadFilter] = useState('');
  const [selected, setSelected] = useState<SelectedEntry>();
  const label = (value: string | null | undefined) =>
    value === null || value === undefined ? t('Not reported') : value || t('Empty');
  const addresses = (values: string[] | null) =>
    values === null ? t('Not reported') : values.join(', ') || t('None returned');
  const waypoint = (value: ZtunnelWaypoint | null) => {
    const destination = label(value?.destination);
    return value && value.port !== null
      ? t('{{destination}} (HBONE port {{port}})', { destination, port: value.port })
      : destination;
  };
  const serviceSearch = serviceFilter.toLowerCase();
  const workloadSearch = workloadFilter.toLowerCase();
  const services = data.services.filter(
    item =>
      !serviceSearch ||
      [item.name, item.namespace, item.hostname, ...(item.addresses ?? [])].some(value =>
        value?.toLowerCase().includes(serviceSearch)
      )
  );
  const workloads = data.workloads.filter(
    item =>
      !workloadSearch ||
      [
        item.name,
        item.namespace,
        item.uid,
        item.clusterId,
        item.node,
        item.protocol,
        item.status,
        ...(item.addresses ?? []),
      ].some(value => value?.toLowerCase().includes(workloadSearch))
  );
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {t(
          'Reported identities are ztunnel registry IDs, not Kubernetes UIDs or Headlamp cluster names. Candidate links require an exact configured mesh scope and verified current resource identity; they do not prove historical identity, ambient enrollment, mesh health or authorization.'
        )}
      </Alert>
      <SimpleTable
        data={[
          { field: t('Reported mesh cluster'), value: label(data.runtime.clusterId) },
          { field: t('Reported cluster domain'), value: label(data.runtime.clusterDomain) },
          { field: t('Reported network'), value: label(data.runtime.network) },
          { field: t('Reported local node'), value: label(data.runtime.node) },
          { field: t('Certificate records'), value: data.certificateCount ?? t('Not reported') },
          { field: t('Policy records'), value: data.policyCount ?? t('Not reported') },
        ]}
        columns={[
          { label: t('Field'), getter: item => item.field },
          { label: t('Value'), getter: item => item.value },
        ]}
      />
      <SectionBox title={t('Observed ztunnel services')}>
        <Stack spacing={2}>
          <TextField
            label={t('Filter observed ztunnel services')}
            value={serviceFilter}
            inputProps={{ maxLength: 512 }}
            onChange={event => {
              setServiceFilter(event.target.value);
              setSelected(undefined);
            }}
          />
          <Typography>
            {t('{{visible}} of {{total}} reported services', {
              visible: services.length,
              total: data.services.length,
            })}
          </Typography>
          <SimpleTable
            data={services}
            columns={[
              { label: t('Namespace'), getter: item => label(item.namespace) },
              { label: t('Reported name'), getter: item => label(item.name) },
              { label: t('Service VIPs'), getter: item => addresses(item.addresses) },
              {
                label: t('Waypoint'),
                getter: item => waypoint(item.waypoint),
              },
              {
                label: t('Endpoints reported'),
                getter: item => item.endpoints?.length ?? t('Not reported'),
              },
              {
                label: t('Reported healthy endpoints'),
                getter: item =>
                  item.endpoints?.filter(endpoint => endpoint.status === 'Healthy').length ??
                  t('Not reported'),
              },
              {
                label: t('Details'),
                getter: item => (
                  <Button
                    aria-label={t('Inspect ztunnel service {{index}}', { index: item.index })}
                    onClick={() => {
                      setSelected({
                        label: t('Selected ztunnel service'),
                        raw: item.raw,
                        fields: serviceFields(item, t),
                        target: ztunnelServiceCandidate(
                          item,
                          meshClusterName,
                          data.runtime.clusterId
                        ),
                        registryIdentity: `${item.namespace ?? ''}/${item.name ?? ''}`,
                        endpoints: item.endpoints,
                      });
                    }}
                  >
                    {t('Inspect')}
                  </Button>
                ),
              },
            ]}
          />
        </Stack>
      </SectionBox>
      <SectionBox title={t('Observed ztunnel workloads')}>
        <Stack spacing={2}>
          <TextField
            label={t('Filter observed ztunnel workloads')}
            value={workloadFilter}
            inputProps={{ maxLength: 512 }}
            onChange={event => {
              setWorkloadFilter(event.target.value);
              setSelected(undefined);
            }}
          />
          <Typography>
            {t('{{visible}} of {{total}} reported workloads', {
              visible: workloads.length,
              total: data.workloads.length,
            })}
          </Typography>
          <SimpleTable
            data={workloads}
            columns={[
              { label: t('Namespace'), getter: item => label(item.namespace) },
              { label: t('Reported name'), getter: item => label(item.name) },
              { label: t('Addresses'), getter: item => addresses(item.addresses) },
              { label: t('Node'), getter: item => label(item.node) },
              { label: t('Reported mesh cluster'), getter: item => label(item.clusterId) },
              {
                label: t('Waypoint'),
                getter: item => waypoint(item.waypoint),
              },
              { label: t('Protocol'), getter: item => label(item.protocol) },
              { label: t('Reported status'), getter: item => label(item.status) },
              {
                label: t('Details'),
                getter: item => (
                  <Button
                    aria-label={t('Inspect ztunnel workload {{index}}', { index: item.index })}
                    onClick={() => {
                      setSelected({
                        label: t('Selected ztunnel workload'),
                        raw: item.raw,
                        fields: workloadFields(item, t),
                        target: ztunnelWorkloadCandidate(
                          item,
                          meshClusterName,
                          data.runtime.clusterId
                        ),
                        registryIdentity: item.uid ?? '',
                      });
                    }}
                  >
                    {t('Inspect')}
                  </Button>
                ),
              },
            ]}
          />
        </Stack>
      </SectionBox>
      {selected && (
        <>
          <Button onClick={() => setSelected(undefined)}>{t('Hide ztunnel entry')}</Button>
          <SimpleTable
            data={selected.fields}
            columns={[
              { label: t('Field'), getter: item => item.field },
              { label: t('Value'), getter: item => item.value },
            ]}
          />
          {selected.endpoints !== undefined && selected.endpoints !== null && (
            <>
              <Typography variant="h6" component="h3">
                {t('Observed service endpoints')}
              </Typography>
              <SimpleTable
                data={selected.endpoints}
                emptyMessage={t('No service endpoints were returned.')}
                columns={[
                  { label: t('Registry key'), getter: (item: ZtunnelEndpoint) => item.key },
                  {
                    label: t('Reported workload identity'),
                    getter: (item: ZtunnelEndpoint) => item.workloadUid ?? t('Not reported'),
                  },
                  {
                    label: t('Reported status'),
                    getter: (item: ZtunnelEndpoint) => item.status ?? t('Not reported'),
                  },
                  {
                    label: t('Reported ports'),
                    getter: (item: ZtunnelEndpoint) =>
                      item.ports === null ? t('Not reported') : JSON.stringify(item.ports),
                  },
                ]}
              />
            </>
          )}
          <ZtunnelResourceCandidate
            cluster={cluster}
            target={selected.target}
            registryIdentity={selected.registryIdentity}
          />
          <CodeBlock value={JSON.stringify(selected.raw, null, 2)} label={selected.label} />
        </>
      )}
    </Stack>
  );
}
