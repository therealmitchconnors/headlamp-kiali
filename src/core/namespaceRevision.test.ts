import fixtureText from '../../test-files/parity/namespace-revision-oracle.json?raw';
import { namespaceRevisionSelection } from './namespaceRevision';

const fixture = JSON.parse(fixtureText) as {
  cases: { input: { labels: Record<string, string> | null }; expected: string }[];
};
it.each(fixture.cases)('matches original Go namespace revision case %#', ({ input, expected }) => {
  const result = namespaceRevisionSelection(input.labels);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.revision).toBe(expected);
});
it.each([
  { labels: {}, basis: 'unselected', revision: '', labelled: false },
  { labels: { 'istio.io/rev': '' }, basis: 'revision-label', revision: '', labelled: true },
  {
    labels: { 'istio-injection': 'enabled', 'istio.io/rev': 'blue' },
    basis: 'injection-enabled',
    revision: 'default',
    labelled: true,
  },
  {
    labels: { 'istio.io/dataplane-mode': 'ambient' },
    basis: 'ambient-default',
    revision: 'default',
    labelled: true,
  },
  {
    labels: { 'istio.io/dataplane-mode': 'ambient', 'istio.io/rev': '' },
    basis: 'revision-label',
    revision: '',
    labelled: true,
  },
  {
    labels: { 'maistra.io/member-of': '', 'istio-injection': 'enabled' },
    basis: 'maistra-member',
    revision: '',
    labelled: true,
  },
  {
    labels: {
      'maistra.io/member-of': 'mesh',
      'maistra.io/ignore-namespace': 'false',
      'istio.io/rev': 'blue',
    },
    basis: 'revision-label',
    revision: 'blue',
    labelled: true,
  },
])(
  'retains the selection provenance without resolving controllers: $basis/$revision',
  ({ labels, ...expected }) => {
    expect(namespaceRevisionSelection(labels)).toMatchObject({ ok: true, ...expected });
  }
);
it('treats the Maistra ignore label as presence, not a parsed boolean', () => {
  expect(
    namespaceRevisionSelection({
      'maistra.io/member-of': 'mesh',
      'maistra.io/ignore-namespace': '',
    })
  ).toMatchObject({
    ok: true,
    revision: '',
    basis: 'unselected',
    labelled: true,
    maistraIgnored: true,
  });
});
it.each(
  [
    [],
    true,
    { 'istio.io/rev': 3 },
    { 'istio.io/rev': 'bad value' },
    { 'maistra.io/member-of': 'x'.repeat(64) },
  ].map(labels => ({ labels }))
)('reports malformed or excessive relevant label values: $labels', ({ labels }) => {
  expect(namespaceRevisionSelection(labels).ok).toBe(false);
});
it('does not borrow inherited label values or reinterpret unrelated labels', () => {
  expect(namespaceRevisionSelection(Object.create({ 'istio-injection': 'enabled' }))).toMatchObject(
    {
      ok: true,
      revision: '',
      basis: 'unselected',
      labelled: false,
    }
  );
  expect(namespaceRevisionSelection({ unrelated: 42 })).toMatchObject({
    ok: true,
    labelled: false,
  });
});
