import oracleText from '../../test-files/correlation/label-oracle.json?raw';
import {
  AppLabels,
  applicationLabels,
  decodeLabelSelector,
  isLabelKey,
  isLabelValue,
  labelIndex,
  Labels,
  matchesSelector,
} from './labels';

const oracle: {
  commit: string;
  cases: {
    input: { labels: Labels; override: AppLabels };
    expected: ReturnType<typeof applicationLabels>;
  }[];
} = JSON.parse(oracleText);

describe('Kiali label resolution', () => {
  it('uses the independently executed pinned Go implementation', () => {
    expect(oracle.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
    expect(oracle.cases).toHaveLength(75);
  });
  it.each(oracle.cases)('matches the Go label oracle %#', ({ input, expected }) => {
    expect(applicationLabels(input.labels, input.override)).toEqual(expected);
  });
  it('does not mistake inherited properties for labels', () => {
    const labels: Record<string, string> = Object.create({ app: 'inherited' });
    expect(applicationLabels(labels).app).toBeNull();
  });
});

describe('Kubernetes label selectors and scoped postings', () => {
  it('handles equality, missing keys, empty values and all expression operators', () => {
    const labels = { app: 'reviews', version: 'v2', empty: '' };
    expect(matchesSelector(labels, { matchLabels: { app: 'reviews', empty: '' } })).toBe(true);
    expect(matchesSelector(labels, { matchLabels: { missing: '' } })).toBe(false);
    expect(
      matchesSelector(labels, {
        matchExpressions: [{ key: 'version', operator: 'In', values: ['v1', 'v2'] }],
      })
    ).toBe(true);
    expect(
      matchesSelector(labels, {
        matchExpressions: [{ key: 'missing', operator: 'NotIn', values: ['v1'] }],
      })
    ).toBe(true);
    expect(
      matchesSelector(labels, { matchExpressions: [{ key: 'empty', operator: 'Exists' }] })
    ).toBe(true);
    expect(
      matchesSelector(labels, { matchExpressions: [{ key: 'empty', operator: 'DoesNotExist' }] })
    ).toBe(false);
  });
  it('validates selectors even when no candidate would match', () => {
    expect(() =>
      matchesSelector(
        {},
        {
          matchLabels: { app: 'missing' },
          matchExpressions: [{ key: 'version', operator: 'In', values: [] }],
        }
      )
    ).toThrow('require values');
    const index = labelIndex([], () => ({}));
    expect(() =>
      index.select('a', 'b', {
        matchExpressions: [{ key: 'app', operator: 'Exists', values: ['bad'] }],
      })
    ).toThrow('cannot contain values');
  });
  it('does not cross cluster or namespace boundaries when matching a selector', () => {
    const items = [
      { identity: { cluster: 'a', namespace: 'one' }, labels: { app: 'reviews', version: 'v1' } },
      { identity: { cluster: 'a', namespace: 'one' }, labels: { app: 'reviews', version: 'v2' } },
      { identity: { cluster: 'b', namespace: 'one' }, labels: { app: 'reviews', version: 'v2' } },
      { identity: { cluster: 'a', namespace: 'two' }, labels: { app: 'reviews', version: 'v2' } },
    ];
    const index = labelIndex(items, item => item.labels);
    expect(index.select('a', 'one', { matchLabels: { app: 'reviews', version: 'v2' } })).toEqual([
      items[1],
    ]);
    expect(
      index.select('a', 'one', {
        matchExpressions: [{ key: 'version', operator: 'NotIn', values: ['v1'] }],
      })
    ).toEqual([items[1]]);
    expect(index.select('missing', 'one', {})).toEqual([]);
  });
  it.each(['app', 'app.kubernetes.io/name', 'example.com/App_Name', 'constructor'])(
    'accepts label key %s',
    key => {
      expect(isLabelKey(key)).toBe(true);
    }
  );
  it.each(['', '/app', 'a//b', 'Upper.example/app', 'bad key', 'a/' + 'x'.repeat(64)])(
    'rejects invalid label key %s',
    key => {
      expect(isLabelKey(key)).toBe(false);
    }
  );
  it.each(['app\n', 'example.com\n/app', 'example.com/app\r\n', 'a'.repeat(318)])(
    'rejects non-whole or oversized keys %j',
    key => {
      expect(isLabelKey(key)).toBe(false);
    }
  );
  it.each(['bad value', '*', 'trailing\n', 'x'.repeat(64), '\u4e00'])(
    'rejects invalid label selector values %j',
    value => {
      expect(isLabelValue(value)).toBe(false);
      expect(() => decodeLabelSelector({ matchLabels: { team: value } })).toThrow();
      expect(() =>
        decodeLabelSelector({
          matchExpressions: [{ key: 'team', operator: 'In', values: [value] }],
        })
      ).toThrow();
    }
  );
  it('retains valid empty values and nil existence-value lists', () => {
    expect(isLabelValue('')).toBe(true);
    expect(isLabelValue('a'.repeat(63))).toBe(true);
    expect(matchesSelector({ team: '' }, decodeLabelSelector({ matchLabels: { team: '' } }))).toBe(
      true
    );
    expect(
      matchesSelector(
        { team: '' },
        decodeLabelSelector({
          matchExpressions: [{ key: 'team', operator: 'Exists', values: null }],
        })
      )
    ).toBe(true);
  });
});
