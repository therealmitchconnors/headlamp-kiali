import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ZtunnelSnapshot, ZtunnelWaypoint } from '../core/ztunnel';
import CodeBlock from './configuration/CodeBlock';

export default function ZtunnelDiagnostics({ data }: { data: ZtunnelSnapshot }) {
  const { t } = useTranslation();
  const [serviceFilter, setServiceFilter] = useState('');
  const [workloadFilter, setWorkloadFilter] = useState('');
  const [selected, setSelected] = useState<{ label: string; raw: Record<string, unknown> }>();
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
          'Reported identities are ztunnel registry IDs, not Kubernetes UIDs or Headlamp cluster names. No resource links are inferred. Status strings and endpoint counts are ztunnel observations, not proof of ambient enrollment, mesh health or authorization.'
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
                    onClick={() =>
                      setSelected({ label: t('Selected ztunnel service'), raw: item.raw })
                    }
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
                    onClick={() =>
                      setSelected({ label: t('Selected ztunnel workload'), raw: item.raw })
                    }
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
          <CodeBlock value={JSON.stringify(selected.raw, null, 2)} label={selected.label} />
        </>
      )}
    </Stack>
  );
}
