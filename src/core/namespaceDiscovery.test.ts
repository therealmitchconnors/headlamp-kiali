import { MeshConfigFields, namespaceDiscovery } from './mesh';

const namespace = { name: 'bookinfo', labels: { team: 'mesh', empty: '' } };
const configuration = (discoverySelectors: Record<string, unknown>[]): MeshConfigFields => ({
  rootNamespace: 'root-system',
  hasDiscoverySelectors: discoverySelectors.length > 0,
  discoverySelectors,
});
it('distinguishes unrestricted, OR-matched, excluded and implicit namespace scopes', () => {
  expect(namespaceDiscovery(namespace, 'istio-system', configuration([]))).toEqual({
    status: 'included',
    basis: 'unrestricted',
  });
  const selectors = configuration([
    { matchLabels: { team: 'other' } },
    { matchLabels: { team: 'mesh', empty: '' } },
  ]);
  expect(namespaceDiscovery(namespace, 'istio-system', selectors)).toEqual({
    status: 'included',
    basis: 'selector',
  });
  expect(namespaceDiscovery({ name: 'other', labels: {} }, 'istio-system', selectors).status).toBe(
    'excluded'
  );
  for (const name of ['istio-system', 'root-system'])
    expect(namespaceDiscovery({ name, labels: {} }, 'istio-system', selectors)).toEqual({
      status: 'included',
      basis: 'implicit',
    });
  expect(namespaceDiscovery(namespace, 'istio-system', configuration([{}]))).toEqual({
    status: 'included',
    basis: 'selector',
  });
});
it('ANDs expressions within a selector and handles absent keys without inventing label values', () => {
  const select = (expressions: unknown[]) =>
    namespaceDiscovery(
      namespace,
      'istio-system',
      configuration([{ matchExpressions: expressions }])
    );
  expect(
    select([
      { key: 'team', operator: 'In', values: ['mesh', 'other'] },
      { key: 'missing', operator: 'NotIn', values: ['yes'] },
    ]).status
  ).toBe('included');
  expect(
    select([
      { key: 'team', operator: 'Exists' },
      { key: 'missing', operator: 'DoesNotExist' },
    ]).status
  ).toBe('included');
  expect(
    select([
      { key: 'team', operator: 'In', values: ['other'] },
      { key: 'team', operator: 'Exists' },
    ]).status
  ).toBe('excluded');
  expect(
    namespaceDiscovery(
      { name: 'bookinfo', labels: Object.create({ team: 'mesh' }) },
      'istio-system',
      configuration([{ matchLabels: { team: 'mesh' } }])
    ).status
  ).toBe('excluded');
});
it.each([
  { matchLabels: { 'team\n': 'mesh' } },
  { matchLabels: { team: 'bad value' } },
  { unknownField: true },
  { matchExpressions: [{ key: 'team', operator: 'Unknown', values: [] }] },
  { matchExpressions: [{ key: 'team', operator: 'In', values: [] }] },
  { matchExpressions: [{ key: 'team', operator: 'Exists', values: ['mesh'] }] },
])('does not silently ignore malformed selectors even beside a matching selector: %j', invalid => {
  expect(namespaceDiscovery(namespace, 'istio-system', configuration([{}, invalid])).status).toBe(
    'unavailable'
  );
});
it('requires consistent metadata and evaluates exact selector/term limits', () => {
  expect(
    namespaceDiscovery(namespace, 'istio-system', { hasDiscoverySelectors: true }).status
  ).toBe('unavailable');
  expect(
    namespaceDiscovery(namespace, 'istio-system', {
      hasDiscoverySelectors: false,
      discoverySelectors: [{}],
    }).status
  ).toBe('unavailable');
  expect(
    namespaceDiscovery({ ...namespace, name: 'bookinfo\n' }, 'istio-system', configuration([]))
      .status
  ).toBe('unavailable');
  expect(
    namespaceDiscovery(
      namespace,
      'istio-system',
      configuration(Array.from({ length: 100 }, () => ({})))
    ).status
  ).toBe('included');
  expect(
    namespaceDiscovery(
      namespace,
      'istio-system',
      configuration(Array.from({ length: 101 }, () => ({})))
    ).status
  ).toBe('unavailable');
  const selectors = Array.from({ length: 10 }, () => ({
    matchLabels: Object.fromEntries(
      Array.from({ length: 99 }, (_, index) => [`key${index}`, 'value'])
    ),
  }));
  expect(namespaceDiscovery(namespace, 'istio-system', configuration(selectors)).status).toBe(
    'excluded'
  );
  expect(
    namespaceDiscovery(namespace, 'istio-system', configuration([...selectors, {}]))
  ).toMatchObject({ status: 'unavailable', message: expect.stringContaining('1000') });
});
