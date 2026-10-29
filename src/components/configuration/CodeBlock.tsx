import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Editor } from '@monaco-editor/react';
import { useTheme } from '@mui/material/styles';

export default function CodeBlock({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Editor
      value={value}
      language="plaintext"
      height={Math.min(450, Math.max(100, value.split('\n').length * 20))}
      theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
      wrapperProps={{ role: 'group', 'aria-label': t('Read-only {{field}}', { field: label }) }}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
      }}
    />
  );
}
