import fixtureText from '../../test-files/parity/revision-tag-oracle.json?raw';
import { revisionTag, selectedRevisionTags } from './mesh';
const fixture = JSON.parse(fixtureText) as {
  cases: {
    input: { revision: string; webhooks: { name: string; labels: Record<string, string> }[] };
    expected: { cluster: string; name: string; revision: string } | null;
  }[];
};
it.each(fixture.cases)(
  'matches original Go same-context tag selection %#',
  ({ input, expected }) => {
    const tags = input.webhooks.map(webhook => revisionTag({ metadata: webhook }));
    const selected = selectedRevisionTags(tags).selected.get(input.revision);
    expect(
      selected ? { cluster: 'fixture', name: selected.tag, revision: selected.revision } : null
    ).toEqual(expected);
  }
);
