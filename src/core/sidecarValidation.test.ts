import oracleText from '../../test-files/parity/sidecar-root-oracle.json?raw';
import { NamespaceMeshConfiguration } from './mesh';
import { ReferenceValidationContext } from './referenceValidation';
import { sidecarNeedsMeshConfiguration, sidecarRootSelectorChecks } from './sidecarValidation';
import { Finding, initialValidation } from './validation';

const group = 'networking.istio.io';
const selected = { workloadSelector: { labels: { app: 'reviews' } } };
function context(
  rootNamespace: string | undefined = 'mesh-root',
  namespace = 'mesh-root'
): ReferenceValidationContext {
  return {
    cluster: 'alpha',
    identityDomain: null,
    namespaces: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
    destinationRules: { complete: false, items: [] },
    namespaceMesh: new Map([
      [
        namespace,
        {
          status: 'ready',
          controller: 'control-plane/istiod',
          fields: { rootNamespace, hasDiscoverySelectors: false },
        },
      ],
    ]),
  };
}
const oracle: {
  cases: {
    input: { rootNamespace: string; namespace: string; spec: Record<string, unknown> };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);

it.each(oracle.cases)('matches original-Go root-selector behavior %#', ({ input, expected }) => {
  expect(
    sidecarRootSelectorChecks(
      'Sidecar',
      group,
      input.namespace,
      input.spec,
      context(input.rootNamespace, input.namespace)
    )
  ).toEqual({ findings: expected, skipped: [] });
});

it.each([
  ['Sidecar', 'example.test'],
  ['PeerAuthentication', 'security.istio.io'],
])('does not activate for %s in %s', (kind, group) => {
  expect(sidecarRootSelectorChecks(kind, group, 'mesh-root', selected, context())).toEqual({
    findings: [],
    skipped: [],
  });
  expect(sidecarNeedsMeshConfiguration(kind, group, selected)).toBe(false);
});

it.each([
  {},
  { workloadSelector: null },
  { workloadSelector: {} },
  { workloadSelector: { labels: null } },
  { workloadSelector: { labels: {} } },
])('needs no mesh reads or defaults for empty selectors %#', spec => {
  expect(sidecarNeedsMeshConfiguration('Sidecar', group, spec)).toBe(false);
  expect(sidecarRootSelectorChecks('Sidecar', group, '', spec)).toEqual({
    findings: [],
    skipped: [],
  });
});

it.each([
  false,
  [],
  { matchLabels: { app: 'reviews' } },
  { labels: { app: 1 } },
  { labels: { 'app\n': 'reviews' } },
  { labels: { app: 'bad value' } },
  { labels: { app: 'reviews' }, extension: true },
])('defers malformed or unsupported selectors %#', workloadSelector => {
  const result = sidecarRootSelectorChecks(
    'Sidecar',
    group,
    'mesh-root',
    { workloadSelector },
    context()
  );
  expect(result.findings).toEqual([]);
  expect(result.skipped).toHaveLength(1);
});

it('accepts 100 equality labels but defers 101 instead of truncating them', () => {
  for (const count of [100, 101]) {
    const spec = {
      workloadSelector: {
        labels: Object.fromEntries(Array.from({ length: count }, (_, i) => [`label${i}`, 'value'])),
      },
    };
    const result = sidecarRootSelectorChecks('Sidecar', group, 'mesh-root', spec, context());
    expect(sidecarNeedsMeshConfiguration('Sidecar', group, spec)).toBe(count === 100);
    expect(result.findings).toHaveLength(count === 100 ? 1 : 0);
    expect(result.skipped).toHaveLength(count === 100 ? 0 : 1);
  }
});

it.each([
  undefined,
  { status: 'unavailable', message: 'Mesh configuration was denied' },
  { status: 'ready', controller: 'cp/istiod', fields: { hasDiscoverySelectors: false } },
  {
    status: 'ready',
    controller: 'cp/istiod',
    fields: { rootNamespace: '', hasDiscoverySelectors: false },
  },
  {
    status: 'ready',
    controller: 'cp/istiod',
    fields: { rootNamespace: 'istio-system\n', hasDiscoverySelectors: false },
  },
] satisfies (NamespaceMeshConfiguration | undefined)[])(
  'does not infer a root from the conventional namespace name %#',
  mesh => {
    const current = context('istio-system', 'istio-system');
    current.namespaceMesh = mesh ? new Map([['istio-system', mesh]]) : undefined;
    const result = sidecarRootSelectorChecks('Sidecar', group, 'istio-system', selected, current);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  }
);

it('does not borrow another namespace context or accept an absent namespace', () => {
  for (const namespace of ['other', '', 'mesh-root\n']) {
    const result = sidecarRootSelectorChecks('Sidecar', group, namespace, selected, context());
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  }
});

it('integrates suppression without upgrading limited coverage into a verdict', () => {
  const input = {
    cluster: 'alpha',
    namespace: 'mesh-root',
    kind: 'Sidecar',
    group,
    spec: selected,
    annotations: {},
    workloads: [],
    complete: false,
    context: context(),
  };
  const result = initialValidation(input);
  expect(result.findings.map(finding => finding.code)).toEqual(['KIA1006']);
  expect(result.coverage).toBe('partial');
  expect(result.skipped).toContain(
    'Workload-selector check requires a complete namespace snapshot'
  );
  const suppressed = initialValidation({
    ...input,
    annotations: { 'kiali.io/ignore-validations': 'KIA1006' },
  });
  expect(suppressed.findings).toEqual([]);
  expect(suppressed.suppressed).toBe(1);
  expect(() => initialValidation({ ...input, cluster: 'beta' })).toThrow(/different cluster/);
});
