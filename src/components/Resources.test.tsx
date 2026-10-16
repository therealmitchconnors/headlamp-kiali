import { cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { Namespaces, Services } from './Resources';

const selection = vi.hoisted(() => ({ clusters: ['alpha'] }));

class Service {
  metadata = { name: 'productpage', namespace: 'bookinfo' };
  spec = {
    type: 'ClusterIP',
    clusterIP: '10.0.0.1',
    ports: [{ port: 9080, protocol: 'TCP' }],
    selector: { app: 'productpage' },
  };
}

class Namespace {
  metadata = { name: 'bookinfo', labels: { 'istio.io/rev': 'asm-1-30' } };
  jsonData = { status: { phase: 'Active' } };
}

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useSelectedClusters: () => selection.clusters,
    ResourceClasses: {
      get Service() {
        return Service;
      },
      get Namespace() {
        return Namespace;
      },
    },
  },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ replace: vi.fn() }),
  useLocation: () => ({ search: '' }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  StatusLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ResourceListView: <T,>({
    resourceClass,
    columns,
    enableRowActions,
    enableRowSelection,
    headerProps,
  }: {
    resourceClass: new () => T;
    columns: (string | { id: string; getValue: (item: T) => ReactNode })[];
    enableRowActions: boolean;
    enableRowSelection: boolean;
    headerProps: { titleSideActions: ReactNode[] };
  }) => {
    expect(enableRowActions).toBe(false);
    expect(enableRowSelection).toBe(false);
    expect(headerProps.titleSideActions).toEqual([]);
    const item = new resourceClass();
    return (
      <div>
        {columns.map((column, index) => (
          <span key={index}>{typeof column === 'string' ? column : column.getValue(item)}</span>
        ))}
      </div>
    );
  },
}));

beforeEach(() => {
  selection.clusters = ['alpha'];
});
afterEach(cleanup);

it('renders Service data without requiring newer Headlamp class helper methods', () => {
  render(<Services />);
  expect(screen.getByText('9080/TCP')).toBeDefined();
  expect(screen.getByText('app=productpage')).toBeDefined();
  expect(screen.getByText('10.0.0.1')).toBeDefined();
});

it('renders namespace revision and phase from the public resource model', () => {
  render(<Namespaces />);
  expect(screen.getByText('asm-1-30')).toBeDefined();
  expect(screen.getByText('Active')).toBeDefined();
});

it('does not silently pick one member of a selected cluster group', () => {
  selection.clusters = ['alpha', 'beta'];
  render(<Services />);
  expect(screen.getByText(/supports one cluster at a time/)).toBeDefined();
  expect(screen.queryByText('9080/TCP')).toBeNull();
});
