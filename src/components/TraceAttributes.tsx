import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { TraceAttribute } from '../core/tracing';
import StructuredValue from './configuration/StructuredValue';

export default function TraceAttributes({ entries }: { entries: TraceAttribute[] }) {
  const { t } = useTranslation();
  return (
    <SimpleTable
      data={entries}
      columns={[
        { label: t('Attribute'), getter: item => item.key },
        {
          label: t('Value'),
          getter: item => <StructuredValue field={item.key} value={item.value} />,
        },
        { label: t('Type'), getter: item => item.type ?? t('Provider value') },
      ]}
    />
  );
}
