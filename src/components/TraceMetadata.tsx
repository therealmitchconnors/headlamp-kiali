import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { TraceFlags, TraceReference, TraceSpan } from '../core/tracing';
import TraceAttributes from './TraceAttributes';

function MetadataTable({ rows }: { rows: { label: string; value?: string | number | boolean }[] }) {
  const { t } = useTranslation();
  return (
    <SimpleTable
      data={rows}
      columns={[
        { label: t('Field'), getter: item => item.label },
        {
          label: t('Value'),
          getter: item => (
            <Typography component="span" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
              {item.value === undefined
                ? t('Not reported')
                : typeof item.value === 'boolean'
                ? item.value
                  ? t('True')
                  : t('False')
                : item.value === ''
                ? t('Empty')
                : String(item.value)}
            </Typography>
          ),
        },
      ]}
    />
  );
}
function Flags({ flags, remoteLabel }: { flags?: TraceFlags; remoteLabel: string }) {
  const { t } = useTranslation();
  const rows: { label: string; value?: string | number | boolean }[] = [
    {
      label: t('Raw trace flags'),
      value:
        flags === undefined
          ? undefined
          : `0x${flags.raw.toString(16).padStart(8, '0')} (${flags.raw})`,
    },
    { label: t('Sampling flag'), value: flags?.sampled },
    { label: remoteLabel, value: flags?.remote },
  ];
  if (flags?.debug !== undefined) rows.push({ label: t('Jaeger debug flag'), value: flags.debug });
  if (flags?.firehose !== undefined)
    rows.push({ label: t('Jaeger firehose flag'), value: flags.firehose });
  return <MetadataTable rows={rows} />;
}

export function SpanMetadata({ span }: { span: TraceSpan }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Span metadata')}
      </Typography>
      <Typography variant="body2">
        {t(
          'Sampling and remote-context flags are provider metadata, not request-health verdicts. Unrecognized flag bits are retained in the raw value.'
        )}
      </Typography>
      <Flags flags={span.flags} remoteLabel={t('Remote parent context')} />
      <MetadataTable
        rows={[
          { label: t('Trace state'), value: span.traceState },
          { label: t('Status code'), value: span.status?.code },
          { label: t('Status message'), value: span.status?.message },
          { label: t('Resource schema URL'), value: span.resourceSchemaUrl },
          { label: t('Dropped resource attributes'), value: span.resourceDroppedAttributesCount },
          { label: t('Dropped span attributes'), value: span.droppedAttributesCount },
          { label: t('Dropped span events'), value: span.droppedEventsCount },
          { label: t('Dropped span links'), value: span.droppedLinksCount },
        ]}
      />
      <Typography variant="h6" component="h3">
        {t('Instrumentation scope')}
      </Typography>
      {span.scope ? (
        <>
          <MetadataTable
            rows={[
              { label: t('Scope name'), value: span.scope.name },
              { label: t('Scope version'), value: span.scope.version },
              { label: t('Scope schema URL'), value: span.scope.schemaUrl },
              { label: t('Dropped scope attributes'), value: span.scope.droppedAttributesCount },
            ]}
          />
          <Typography variant="subtitle1" component="h4">
            {t('Scope attributes')}
          </Typography>
          <TraceAttributes entries={span.scope.attributes} />
        </>
      ) : (
        <Typography>{t('Instrumentation scope was not reported.')}</Typography>
      )}
    </Stack>
  );
}

export function TraceReferenceMetadata({
  reference,
  index,
}: {
  reference: TraceReference;
  index: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <>
      <Button
        aria-label={t('Inspect link metadata {{index}}', { index })}
        onClick={() => setOpen(true)}
      >
        {t('Metadata')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="md"
        aria-labelledby={titleId}
      >
        <DialogTitle id={titleId}>{t('Span link metadata')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <MetadataTable
              rows={[
                { label: t('Trace ID'), value: reference.traceId },
                { label: t('Span ID'), value: reference.spanId },
                { label: t('Reference type'), value: reference.type },
                { label: t('Trace state'), value: reference.traceState },
                { label: t('Dropped link attributes'), value: reference.droppedAttributesCount },
              ]}
            />
            <Flags flags={reference.flags} remoteLabel={t('Remote linked context')} />
            <Typography variant="h6" component="h3">
              {t('Link attributes')}
            </Typography>
            <TraceAttributes entries={reference.attributes ?? []} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('Close link metadata')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
