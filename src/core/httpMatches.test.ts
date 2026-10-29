import { buildHttpMatches, HttpMatchCondition } from './httpMatches';

const header: HttpMatchCondition = {
  field: 'headers',
  header: 'x-user',
  operator: 'exact',
  value: 'tester',
};
const uri: HttpMatchCondition = { field: 'uri', header: '', operator: 'prefix', value: '/reviews' };

it('preserves the pinned header-AND and non-header-OR grouping and ordering', () => {
  const conditions: HttpMatchCondition[] = [
    uri,
    header,
    { field: 'method', header: '', operator: 'exact', value: 'GET' },
    { field: 'headers', header: 'x-enabled', operator: 'presence', value: '' },
    { field: 'scheme', header: '', operator: 'regex', value: 'https?' },
    { field: 'authority', header: '', operator: 'exact', value: 'example.com' },
  ];
  const before = JSON.stringify(conditions);
  expect(buildHttpMatches(conditions)).toEqual([
    { headers: { 'x-user': { exact: 'tester' }, 'x-enabled': {} } },
    { uri: { prefix: '/reviews' } },
    { method: { exact: 'GET' } },
    { scheme: { regex: 'https?' } },
    { authority: { exact: 'example.com' } },
  ]);
  expect(JSON.stringify(conditions)).toBe(before);
  expect(buildHttpMatches([])).toEqual([]);
});

it.each([
  'X-User',
  'x_user',
  ':authority',
  'uri',
  'method',
  'scheme',
  'authority',
  '',
  'x-user\n',
  'a'.repeat(257),
])('rejects unsupported, ignored or malformed header name %j', name => {
  expect(() => buildHttpMatches([{ ...header, header: name }])).toThrow('header name');
});
it.each(['', ' trailing ', 'value\nnext', '\u0000', 'a'.repeat(1025)])(
  'rejects invalid match value %j without silently trimming',
  value => {
    expect(() => buildHttpMatches([{ ...uri, value }])).toThrow('Match values');
  }
);
it.each(['(', '(a)\\1', 'a(?=b)', 'x'.repeat(513)])('rejects invalid or overlong RE2 %j', value => {
  expect(() => buildHttpMatches([{ ...uri, operator: 'regex', value }])).toThrow();
});
it('does not silently overwrite duplicate headers or duplicate alternatives', () => {
  expect(() => buildHttpMatches([header, { ...header, value: 'different' }])).toThrow(
    'duplicates would overwrite'
  );
  expect(() => buildHttpMatches([uri, uri])).toThrow('duplicate HTTP match');
  expect(() => buildHttpMatches([{ ...uri, operator: 'presence' }])).toThrow('only for headers');
});
it('enforces exact input bounds and unknown field/operator rejection', () => {
  expect(
    buildHttpMatches(
      Array.from({ length: 20 }, (_, index) => ({ ...uri, value: `/path/${index}` }))
    )
  ).toHaveLength(20);
  expect(() =>
    buildHttpMatches(
      Array.from({ length: 21 }, (_, index) => ({ ...uri, value: `/path/${index}` }))
    )
  ).toThrow('20 conditions');
  expect(buildHttpMatches([{ ...uri, value: 'a'.repeat(1024) }])).toHaveLength(1);
  expect(buildHttpMatches([{ ...uri, operator: 'regex', value: 'a'.repeat(512) }])).toHaveLength(1);
  for (const patch of [{ field: 'queryParams' }, { operator: 'javascript' }]) {
    const invalid = { ...uri };
    Object.assign(invalid, patch);
    expect(() => buildHttpMatches([invalid])).toThrow('Unknown');
  }
});
