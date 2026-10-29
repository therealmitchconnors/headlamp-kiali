import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useId, useMemo, useState } from 'react';
import { TrafficEdge } from '../core/telemetry';
import { buildTrafficGraph, TrafficDiagramData } from '../core/trafficGraph';

export default function TrafficGraph({ traffic }: { traffic: TrafficEdge[] }) {
  const graph = useMemo(() => {
    const graph = buildTrafficGraph(traffic);
    return { ...graph, nodes: graph.nodes.map(node => ({ ...node, label: node.workload })) };
  }, [traffic]);
  return <TrafficDiagram graph={graph} />;
}

export function TrafficDiagram({
  graph,
  unit,
  selection,
}: {
  graph: TrafficDiagramData;
  unit?: string;
  selection?: { id?: string; onChange: (id?: string) => void };
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const marker = `kiali-arrow-${useId().replace(/:/g, '')}`;
  const [internalSelected, setInternalSelected] = useState<string>();
  const selected = selection ? selection.id : internalSelected;
  const setSelected = selection ? selection.onChange : setInternalSelected;
  const node = graph.nodes.find(node => node.id === selected);
  if (!graph.nodes.length)
    return (
      <Alert severity="info">
        {unit
          ? t('No graph observations match this selection. No edges have been invented.')
          : t('No positive request rates were observed; no traffic edges were invented.')}
      </Alert>
    );
  if (graph.nodes.length > 50 || graph.edges.length > 200)
    return (
      <Alert severity="info">
        {t(
          'This graph exceeds the display limit of 50 nodes or 200 edges. Use the complete connection table below or narrow the query.'
        )}
      </Alert>
    );
  const positions = new Map(
    graph.nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / graph.nodes.length - Math.PI / 2;
      return [node.id, { x: 400 + 265 * Math.cos(angle), y: 280 + 195 * Math.sin(angle) }];
    })
  );
  const connected = node
    ? graph.edges.filter(edge => edge.source === node.id || edge.target === node.id)
    : [];
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        {unit
          ? t(
              'Arrows show observed direction. Line width represents the selected rate, not health or policy. Select a node to inspect its connections.'
            )
          : t(
              'Arrows show observed request direction. Line width represents request rate, not health or policy. Select a workload to inspect its connections.'
            )}
      </Typography>
      <Box
        component="svg"
        viewBox="0 0 800 560"
        sx={{ width: '100%', maxHeight: 560 }}
        role="group"
        aria-label={unit ? t('Observed traffic graph') : t('Observed request graph')}
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.palette.primary.main} />
          </marker>
        </defs>
        {graph.edges.map(edge => {
          const from = positions.get(edge.source)!;
          const to = positions.get(edge.target)!;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const parallel = graph.edges
            .filter(item => item.source === edge.source && item.target === edge.target)
            .findIndex(item => item.id === edge.id);
          const curve = 0.1 + parallel * 0.09;
          const start = { x: from.x + (dx / distance) * 27, y: from.y + (dy / distance) * 27 };
          const end = { x: to.x - (dx / distance) * 27, y: to.y - (dy / distance) * 27 };
          const path =
            edge.source === edge.target
              ? `M ${from.x - 15} ${from.y - 20} C ${from.x - 80} ${from.y - 100 - parallel * 25},${
                  from.x + 80
                } ${from.y - 100 - parallel * 25},${from.x + 15} ${from.y - 20}`
              : `M ${start.x} ${start.y} Q ${(from.x + to.x) / 2 - dy * curve} ${
                  (from.y + to.y) / 2 + dx * curve
                },${end.x} ${end.y}`;
          return (
            <path
              key={edge.id}
              d={path}
              fill="none"
              stroke={theme.palette.primary.main}
              strokeWidth={Math.min(7, 1 + Math.log1p(edge.rate))}
              strokeDasharray={edge.rate === 0 ? '4 3' : undefined}
              markerEnd={`url(#${marker})`}
              opacity={!node || edge.source === node.id || edge.target === node.id ? 0.9 : 0.15}
            >
              <title>
                {edge.protocol}: {edge.rate.toPrecision(4)} {unit ?? t('requests / second')}
              </title>
            </path>
          );
        })}
        {graph.nodes.map((item, index) => {
          const position = positions.get(item.id)!;
          const captionId = item.caption ? `${marker}-caption-${index}` : undefined;
          return (
            <g
              key={item.id}
              transform={`translate(${position.x},${position.y})`}
              role="button"
              tabIndex={0}
              aria-pressed={selected === item.id}
              aria-describedby={captionId}
              aria-label={t('Inspect {{cluster}} / {{namespace}} / {{workload}}', {
                cluster: item.cluster,
                namespace: item.namespace,
                workload: item.label,
              })}
              onClick={() => setSelected(item.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelected(item.id);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <circle
                r={26}
                fill={
                  selected === item.id
                    ? theme.palette.primary.light
                    : theme.palette.background.paper
                }
                stroke={theme.palette.primary.main}
                strokeWidth={2}
              />
              <text y={4} textAnchor="middle" fill={theme.palette.text.primary} fontSize={12}>
                {item.label.slice(0, 7)}
              </text>
              <text y={44} textAnchor="middle" fill={theme.palette.text.primary} fontSize={12}>
                {item.label.length > 25 ? `${item.label.slice(0, 22)}...` : item.label}
              </text>
              {item.caption && (
                <text
                  id={captionId}
                  y={61}
                  textAnchor="middle"
                  fill={theme.palette.text.secondary}
                  fontSize={11}
                >
                  {item.caption}
                </text>
              )}
              <title>
                {item.cluster} / {item.namespace} / {item.label}
                {item.caption ? ` - ${item.caption}` : ''}
              </title>
            </g>
          );
        })}
      </Box>
      {node && (
        <Box role="status">
          <Typography>
            {node.cluster} / {node.namespace} / {node.label}
          </Typography>
          {node.caption && <Typography>{node.caption}</Typography>}
          <Typography>
            {t('{{count}} observed connections', { count: connected.length })}
          </Typography>
          <Button onClick={() => setSelected(undefined)}>{t('Clear graph selection')}</Button>
        </Box>
      )}
      <Typography variant="body2">
        {unit
          ? t(
              'The connection table below contains the same filtered identities and rates; table pagination remains available beyond the diagram limit.'
            )
          : t('The connection table below contains the same graph identities and request rates.')}
      </Typography>
    </Stack>
  );
}
