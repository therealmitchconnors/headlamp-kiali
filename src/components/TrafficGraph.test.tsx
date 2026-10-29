import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrafficGraph, { TrafficDiagram } from './TrafficGraph';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (match, key) => String(values?.[key] ?? match)),
  }),
}));
afterEach(cleanup);
const traffic = [
  {
    source: { cluster: 'east', namespace: 'bookinfo', workload: 'productpage' },
    destination: { cluster: 'east', namespace: 'bookinfo', workload: 'reviews' },
    protocol: 'http',
    rate: 3,
  },
];

it('provides named keyboard-operable graph nodes and a selection summary', async () => {
  render(<TrafficGraph traffic={traffic} />);
  const node = screen.getByRole('button', { name: 'Inspect east / bookinfo / reviews' });
  node.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(screen.getByText('1 observed connections')).toBeDefined();
  expect(node.getAttribute('aria-pressed')).toBe('true');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Clear graph selection' }));
  expect(screen.queryByText('1 observed connections')).toBeNull();
});

it('describes optional captions accessibly without changing the existing node names', async () => {
  render(
    <TrafficDiagram
      graph={{
        nodes: [
          {
            id: 'outside',
            cluster: 'east',
            namespace: 'edge',
            label: 'ingress',
            caption: 'Outside selected namespace',
          },
        ],
        edges: [],
      }}
    />
  );
  const node = screen.getByRole('button', {
    name: 'Inspect east / edge / ingress',
    description: 'Outside selected namespace',
  });
  const id = node.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)?.textContent).toBe('Outside selected namespace');
  node.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(screen.getByRole('status').textContent).toContain('Outside selected namespace');
});

it('states empty data and rendering limits explicitly', () => {
  const { rerender } = render(<TrafficGraph traffic={[]} />);
  expect(screen.getByText(/no traffic edges were invented/)).toBeDefined();
  rerender(
    <TrafficGraph
      traffic={Array.from({ length: 60 }, (_, i) => ({
        ...traffic[0],
        source: { ...traffic[0].source, workload: `client-${i}` },
      }))}
    />
  );
  expect(screen.getByText(/exceeds the display limit/)).toBeDefined();
  expect(screen.queryByRole('group', { name: 'Observed request graph' })).toBeNull();
});

it('uses selected-measure prose while retaining the display-limit warning for generic diagrams', () => {
  const graph = {
    nodes: [{ id: 'a', cluster: 'east', namespace: 'bookinfo', label: 'a' }],
    edges: [{ id: 'loop', source: 'a', target: 'a', protocol: 'tcp', rate: 0 }],
  };
  const { rerender } = render(<TrafficDiagram graph={graph} unit="Bytes / second" />);
  expect(screen.getByText(/Line width represents the selected rate/)).toBeDefined();
  expect(screen.queryByText(/Line width represents request rate/)).toBeNull();
  expect(document.querySelector('path[stroke-dasharray="4 3"]')).not.toBeNull();
  rerender(
    <TrafficDiagram
      graph={{
        ...graph,
        nodes: Array.from({ length: 51 }, (_, index) => ({ ...graph.nodes[0], id: String(index) })),
      }}
      unit="Bytes / second"
    />
  );
  expect(screen.getByText(/exceeds the display limit/)).toBeDefined();
  expect(screen.queryByRole('group', { name: 'Observed traffic graph' })).toBeNull();
});
