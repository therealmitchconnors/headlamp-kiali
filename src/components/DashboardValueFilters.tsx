import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ReactNode, useMemo, useState } from 'react';
import {
  AggregationChoices,
  aggregationValueOptions,
  AggregationValues,
  filterAggregationValues,
  initialAggregationChoices,
  selectAggregationValue,
} from '../core/dashboardAggregations';
import type { loadCustomDashboard } from '../data/customDashboards';

type DashboardData = Awaited<ReturnType<typeof loadCustomDashboard>>;
export type DisplayDashboardRead = DashboardData['charts'][number] & { hiddenSeries: number };

export default function DashboardValueFilters({
  data,
  children,
}: {
  data: DashboardData;
  children: (charts: DisplayDashboardRead[], controls: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const prepared = useMemo(() => {
    try {
      const options = aggregationValueOptions(
        data.query.dashboard,
        data.charts.flatMap(chart => (chart.read.ok ? [chart.read.result] : []))
      );
      return { ok: true as const, options, choices: initialAggregationChoices(options) };
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : 'Aggregation display filters are unavailable',
      };
    }
  }, [data]);
  const [draft, setDraft] = useState<{
    data: DashboardData;
    choices: AggregationChoices;
    error?: string;
  }>();
  if (prepared.ok === false) return <Alert severity="error">{prepared.message}</Alert>;
  const choices = draft?.data === data ? draft.choices : prepared.choices;
  const change = (option: AggregationValues, value: string, checked: boolean) => {
    setDraft(current => {
      const previous = current?.data === data ? current.choices : prepared.choices;
      try {
        return { data, choices: selectAggregationValue(previous, option, value, checked) };
      } catch (error) {
        return {
          data,
          choices: previous,
          error: error instanceof Error ? error.message : t('Could not update display filters'),
        };
      }
    });
  };
  const charts = data.charts.map((entry): DisplayDashboardRead => {
    if (entry.read.ok === false) return { ...entry, hiddenSeries: 0 };
    const result = filterAggregationValues(entry.read.result, choices);
    return {
      ...entry,
      hiddenSeries: entry.read.result.series.length - result.series.length,
      read: { ok: true, result },
    };
  });
  const hidden = charts.reduce((sum, chart) => sum + chart.hiddenSeries, 0);
  const observed = prepared.options.filter(option => option.values.length);
  const controls = observed.length ? (
    <Stack spacing={1}>
      {draft?.data === data && draft.error && <Alert severity="error">{draft.error}</Alert>}
      {hidden > 0 && (
        <Alert severity="info">
          {t(
            'Returned series hidden by display filters: {{count}}. Queries and captured responses are unchanged.',
            { count: hidden }
          )}
        </Alert>
      )}
      <details>
        <summary>{t('Filter captured aggregation values (display only)')}</summary>
        <Typography variant="body2">
          {t(
            'These values come only from the captured successful responses. Selecting values changes charts and tables locally, not server filters or authorization. Series missing a label are retained. Single-selection controls initially show the first observed value; display selections reset on a new result.'
          )}
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {observed.map(option => (
            <Stack key={option.label} spacing={0.5}>
              <Typography>
                {t('{{name}} ({{label}})', { name: option.displayName, label: option.label })}
              </Typography>
              {option.singleSelection ? (
                <RadioGroup aria-label={t('Visible {{name}} values', { name: option.displayName })}>
                  {option.values.map((value, index) => (
                    <FormControlLabel
                      key={value}
                      label={t('Show {{name}} = {{value}}', {
                        name: option.displayName,
                        value: JSON.stringify(value),
                      })}
                      control={
                        <Radio
                          name={`kiali-dashboard-values-${option.label}`}
                          value={String(index)}
                          checked={choices.get(option.label)?.get(value) === true}
                          onChange={() => change(option, value, true)}
                        />
                      }
                    />
                  ))}
                </RadioGroup>
              ) : (
                option.values.map(value => (
                  <FormControlLabel
                    key={value}
                    label={t('Show {{name}} = {{value}}', {
                      name: option.displayName,
                      value: JSON.stringify(value),
                    })}
                    control={
                      <Checkbox
                        checked={choices.get(option.label)?.get(value) === true}
                        onChange={event => change(option, value, event.target.checked)}
                      />
                    }
                  />
                ))
              )}
            </Stack>
          ))}
        </Stack>
      </details>
    </Stack>
  ) : null;
  return <>{children(charts, controls)}</>;
}
