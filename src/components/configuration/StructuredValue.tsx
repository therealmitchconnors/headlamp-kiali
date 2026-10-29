import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { isRecord } from '../../core/object';
import CodeBlock from './CodeBlock';

/** Preserve every supplied field, including false, zero, empty collections and unknown extensions. */
export default function StructuredValue({ value, field }: { value: unknown; field?: string }) {
  const { t } = useTranslation();
  if (value === undefined) return <span>{t('Not specified')}</span>;
  if (value === null) return <span>{t('Null')}</span>;
  if (typeof value === 'boolean') return <span>{value ? t('True') : t('False')}</span>;
  if (typeof value === 'number') return <span>{String(value)}</span>;
  if (typeof value === 'string' && value.includes('\n'))
    return <CodeBlock value={value} label={field ?? t('Configuration text')} />;
  if (typeof value === 'string')
    return (
      <Typography component="span" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {value === '' ? t('Empty string') : value}
      </Typography>
    );
  if (Array.isArray(value)) {
    if (!value.length) return <span>{t('Empty list')}</span>;
    if (value.every(item => typeof item === 'string' || typeof item === 'number')) {
      return (
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {value.map((item, index) => (
            <li key={index}>
              <StructuredValue value={item} />
            </li>
          ))}
        </Box>
      );
    }
    return (
      <SimpleTable
        data={value.map((item, index) => ({ index, value: item }))}
        columns={[
          {
            label: t('Item'),
            getter: (row: { index: number }) => row.index + 1,
            gridTemplate: 'min-content',
          },
          {
            label: t('Fields'),
            getter: (row: { value: unknown }) => <StructuredValue value={row.value} />,
          },
        ]}
        showPagination
        rowsPerPage={[10, 20, 50]}
      />
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return <span>{t('Empty object')}</span>;
    return (
      <NameValueTable
        rows={entries.map(([key, item]) => ({
          name: key,
          value: <StructuredValue value={item} field={key} />,
        }))}
      />
    );
  }
  return <span>{t('Unsupported field value')}</span>;
}
