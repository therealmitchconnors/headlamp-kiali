import fixtureText from '../../test-files/parity/import-scope-oracle.json?raw';
import {
  effectiveSidecar,
  importsHost,
  ImportSidecar,
  importSidecar,
  isExportedTo,
  newImportScope,
  validationExportIncluded,
} from './importScope';

type Input =
  | { operation: 'export'; exports: string[]; resourceNamespace: string; viewerNamespace: string }
  | {
      operation: 'import';
      workloadNamespace: string;
      rootNamespace: string;
      sidecars: (ImportSidecar | null)[];
      namespaces: string[];
      identityDomain: string;
      hostname: string;
      configNamespace: string;
    };
const fixtures: { commit: string; cases: { input: Input; expected: unknown }[] } =
  JSON.parse(fixtureText);

it('retains the pinned oracle identity and case count', () => {
  expect(fixtures.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(fixtures.cases).toHaveLength(760);
});
it.each(fixtures.cases)('matches original Go import/export case %#', ({ input, expected }) => {
  if (input.operation === 'export') {
    expect(isExportedTo(input.exports, input.resourceNamespace, input.viewerNamespace)).toEqual(
      expected
    );
  } else {
    const scope = newImportScope(
      input.workloadNamespace,
      input.rootNamespace,
      input.sidecars,
      input.namespaces,
      input.identityDomain
    );
    expect({
      limited: scope.limited,
      imports: importsHost(scope, input.hostname, input.configNamespace),
    }).toEqual(expected);
  }
});
it('rejects malformed/unbounded API input instead of converting it to unrestricted visibility', () => {
  for (const spec of [
    { workloadSelector: { matchLabels: { app: 'reviews' } } },
    { workloadSelector: { labels: { app: 1 } } },
    { egress: {} },
    { egress: [{ hosts: ['invalid'] }] },
    { egress: [{ hosts: ['bookinfo/'] }] },
    { egress: [{ hosts: Array.from({ length: 1001 }, () => '*/*') }] },
    { egress: Array.from({ length: 101 }, () => ({ hosts: ['./*'] })) },
  ])
    expect(() => importSidecar('invalid', 'bookinfo', spec)).toThrow();
  const allowed = importSidecar('valid', 'bookinfo', {
    workloadSelector: { labels: {} },
    egress: [{ hosts: Array.from({ length: 1000 }, () => '*/*') }],
  });
  expect(allowed.spec.egress?.[0]?.hosts).toHaveLength(1000);
});
it('preserves local precedence and the pinned selector-less first-match rule', () => {
  const root = importSidecar('root', 'istio-system', { egress: [{ hosts: ['*/*'] }] });
  const selected = importSidecar('selected', 'bookinfo', {
    workloadSelector: { labels: { app: 'reviews' } },
  });
  const local = importSidecar('local', 'bookinfo', { workloadSelector: { labels: {} } });
  expect(effectiveSidecar('bookinfo', 'istio-system', [root, selected, local])).toBe(local);
  expect(effectiveSidecar('bookinfo', 'istio-system', [root, selected])).toBe(root);
});
it('distinguishes runtime export visibility from validation inclusion of invalid references', () => {
  expect(isExportedTo(['~'], 'bookinfo', 'preview')).toBe(false);
  expect(
    validationExportIncluded(['~'], 'bookinfo', 'preview', ['bookinfo', 'preview'], false)
  ).toBe(true);
  expect(
    validationExportIncluded(['missing'], 'bookinfo', 'preview', ['bookinfo', 'preview'], false)
  ).toBe(true);
  expect(
    validationExportIncluded(['.'], 'bookinfo', 'preview', ['bookinfo', 'preview'], false)
  ).toBe(false);
  expect(
    validationExportIncluded(['*'], 'bookinfo', 'preview', ['bookinfo', 'preview'], true)
  ).toBe(false);
  expect(
    validationExportIncluded(['preview'], 'bookinfo', 'bookinfo', ['bookinfo', 'preview'], true)
  ).toBe(true);
});
