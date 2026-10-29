import { cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import fixturesText from '../../../test-files/configuration/fixtures.json?raw';
import StructuredValue from './StructuredValue';
vi.mock('./CodeBlock', () => ({
  default: ({ value, label }: { value: string; label: string }) => (
    <div role="group" aria-label={label}>
      {value}
    </div>
  ),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  NameValueTable: ({ rows }: { rows: { name: string; value: ReactNode }[] }) => (
    <dl>
      {rows.map(row => (
        <div key={row.name}>
          <dt>{row.name}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  ),
  SimpleTable: ({
    data,
    columns,
    showPagination,
    rowsPerPage,
  }: {
    data: unknown[];
    columns: { label: string; getter: (row: unknown) => ReactNode }[];
    showPagination: boolean;
    rowsPerPage: number[];
  }) => {
    expect(showPagination).toBe(true);
    expect(rowsPerPage).toEqual([10, 20, 50]);
    return (
      <table>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map(column => (
                <td key={column.label}>{column.getter(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
}));
afterEach(cleanup);

it('uses a named read-only code surface for multiline embedded configuration', () => {
  render(<StructuredValue field="inlineCode" value={'first line\nsecond line'} />);
  expect(screen.getByRole('group', { name: 'inlineCode' })).toBeDefined();
});

it('keeps false, zero, null, empty strings, objects and lists distinguishable', () => {
  render(
    <StructuredValue
      value={{
        enabled: false,
        weight: 0,
        missing: undefined,
        empty: '',
        object: {},
        list: [],
        nothing: null,
      }}
    />
  );
  for (const text of [
    'False',
    '0',
    'Not specified',
    'Empty string',
    'Empty object',
    'Empty list',
    'Null',
  ]) {
    expect(screen.getByText(text)).toBeDefined();
  }
});

it('renders every populated key and scalar in the full nested routing fixture without a JSON dump', () => {
  const fixture = JSON.parse(fixturesText).virtualService.spec;
  render(<StructuredValue value={fixture} />);
  function check(value: unknown) {
    if (Array.isArray(value)) value.forEach(check);
    else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        expect(screen.getAllByText(key).length).toBeGreaterThan(0);
        check(nested);
      }
    } else {
      const text = value === false ? 'False' : value === '' ? 'Empty string' : String(value);
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  }
  check(fixture);
});
