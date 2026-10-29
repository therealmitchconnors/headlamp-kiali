import {
  workloadEntryLabels,
  workloadEntryMatches,
  workloadGroupEntrySelector,
  workloadLabelBudget,
} from './workloadGroupEntries';

it('distinguishes absent labels from an empty map and matches neither as an all-entry selector', () => {
  for (const spec of [{}, { metadata: null }, { metadata: {} }, { metadata: { labels: null } }])
    expect(workloadGroupEntrySelector(spec)).toBeNull();
  expect(workloadGroupEntrySelector({ metadata: { labels: {} } })).toEqual({});
  expect(workloadEntryMatches({}, { app: 'vm' })).toBe(false);
  expect(workloadEntryMatches({}, {})).toBe(false);
});
it('bounds aggregate label text exactly without sharing budgets across snapshots', () => {
  const count = workloadLabelBudget();
  count({ x: 'v'.repeat(999999) });
  expect(() => count({ x: '' })).toThrow('1,000,000');
  expect(() => workloadLabelBudget()({ x: '' })).not.toThrow();
});

it('uses exact spec label equality, retains empty values and does not infer owners or app labels', () => {
  const selector = workloadGroupEntrySelector({
    metadata: { labels: { app: 'vm', version: '' } },
    template: { labels: { app: 'wrong' } },
  });
  expect(selector).toEqual({ app: 'vm', version: '' });
  if (!selector) throw new Error('Expected selector');
  expect(workloadEntryMatches(selector, { app: 'vm', version: '', extra: 'allowed' })).toBe(true);
  for (const labels of [{ app: 'vm' }, { app: 'VM', version: '' }, { app: 'vm', version: 'v1' }])
    expect(workloadEntryMatches(selector, labels)).toBe(false);
  expect(workloadEntryMatches({ constructor: 'value' }, {})).toBe(false);
  const prototypeKey = JSON.parse('{"__proto__":"literal"}');
  expect(workloadEntryMatches(prototypeKey, workloadEntryLabels(prototypeKey))).toBe(true);
  expect(workloadEntryMatches(prototypeKey, {})).toBe(false);
});
it('captures label maps independently and enforces schema/property and string bounds', () => {
  const labels = { app: 'vm' };
  const captured = workloadGroupEntrySelector({ metadata: { labels } });
  labels.app = 'changed';
  expect(captured).toEqual({ app: 'vm' });
  expect(
    Object.keys(
      workloadEntryLabels(
        Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`key-${index}`, 'v']))
      )
    )
  ).toHaveLength(256);
  expect(() =>
    workloadEntryLabels(
      Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key-${index}`, 'v']))
    )
  ).toThrow('256');
  expect(workloadEntryLabels({ ['k'.repeat(1024)]: 'v'.repeat(1024) })).toBeDefined();
  for (const value of [
    [],
    false,
    { app: null },
    { '': 'x' },
    { app: 'x'.repeat(1025) },
    { ['k'.repeat(1025)]: 'x' },
  ])
    expect(() => workloadEntryLabels(value)).toThrow();
  expect(() => workloadGroupEntrySelector(undefined)).toThrow('unavailable');
  expect(() => workloadGroupEntrySelector({ metadata: [] })).toThrow('malformed');
});
