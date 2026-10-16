import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ReactNode } from 'react';
import { RequestState } from '../hooks/useRequest';

export default function RequestStatus<T>({
  state,
  children,
}: {
  state: RequestState<T>;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (state.status === 'loading') {
    return (
      <Stack direction="row" spacing={1} alignItems="center" role="status">
        <CircularProgress size={20} aria-label={t('Checking connection')} />
        <Typography>{t('Checking connection...')}</Typography>
      </Stack>
    );
  }
  if (state.status === 'error') {
    const labels = {
      'not-found': t('Not found'),
      forbidden: t('Access denied'),
      unauthenticated: t('Authentication required'),
      unavailable: t('Unavailable'),
      'invalid-response': t('Unexpected response'),
    };
    return (
      <Alert severity="error">
        {t('{{reason}}: {{message}}', {
          reason: labels[state.error.kind],
          message: state.error.message,
        })}
      </Alert>
    );
  }
  return <>{children(state.data)}</>;
}
