import oracleText from '../../test-files/parity/gateway-class-oracle.json?raw';
import { getClusterConfig, readConfig, updateClusterConfig } from './config';
import {
  gatewayClassChecks,
  resolveGatewayClassRegistry,
  validateGatewayClassSettings,
} from './gatewayClassRegistry';
import { Finding, initialValidation } from './validation';

const oracle: {
  cases: {
    input: { gatewayClassName: string; classes: { name: string; className: string }[] };
    expected: Finding[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)('matches original Go GatewayClass membership %#', ({ input, expected }) => {
  expect(
    gatewayClassChecks('Gateway', 'gateway.networking.k8s.io', input, {
      basis: 'configured',
      classes: input.classes,
      uncertain: [],
    }).findings
  ).toEqual(expected);
});

const settings = { classes: [], selector: {} };
const item = (name: string, controllerName: string, labels = {}) => ({
  name,
  namespace: '',
  uid: name,
  labels,
  spec: { controllerName },
});
const check = (name: string, registry?: ReturnType<typeof resolveGatewayClassRegistry>) =>
  gatewayClassChecks('Gateway', 'gateway.networking.k8s.io', { gatewayClassName: name }, registry);

it('uses configured names without requiring discovered objects', () => {
  const registry = resolveGatewayClassRegistry({
    classes: [{ name: 'External gateway', className: 'external' }],
    selector: {},
  });
  expect(registry.basis).toBe('configured');
  expect(check('external', registry).findings).toEqual([]);
  expect(check('istio', registry).findings).toEqual([
    {
      code: 'KIA1504',
      severity: 'error',
      path: 'spec/gatewayClassName',
      message: 'Gateway API Class not found in Kiali configuration',
    },
  ]);
});
it('preserves the pinned literal controller prefix, unless a nonempty label selector selects other controllers', () => {
  const source = {
    complete: true,
    items: [
      item('istio', 'istio.io/gateway-controller'),
      item('prefix', 'istio.io-other/controller'),
      item('external', 'example.com/controller', { team: 'mesh' }),
    ],
  };
  expect(
    resolveGatewayClassRegistry(settings, source).classes.map(value => value.className)
  ).toEqual(['istio', 'prefix']);
  const selected = resolveGatewayClassRegistry({ classes: [], selector: { team: 'mesh' } }, source);
  expect(selected.classes).toEqual([{ name: 'external', className: 'external' }]);
  expect(check('istio', selected).findings[0].code).toBe('KIA1504');
});
it('resolves guaranteed fallback entries without inventing mesh-wide facts', () => {
  const fallback = resolveGatewayClassRegistry(settings, { complete: true, items: [] });
  expect(fallback.classes.map(value => value.className)).toEqual(['istio', 'istio-remote']);
  expect(fallback.uncertain).toEqual(['istio-east-west', 'istio-waypoint']);
  expect(check('istio-waypoint', fallback).findings).toEqual([]);
  expect(check('istio-waypoint', fallback).skipped[0]).toContain('mesh');
  expect(check('unknown', fallback).findings[0].code).toBe('KIA1504');
  expect(
    resolveGatewayClassRegistry(
      settings,
      { complete: true, items: [] },
      { clusterCount: 2, ambientInAnyCluster: true }
    ).classes.map(value => value.className)
  ).toEqual(['istio', 'istio-remote', 'istio-east-west', 'istio-waypoint']);
  const single = resolveGatewayClassRegistry(
    settings,
    { complete: true, items: [] },
    { clusterCount: 1, ambientInAnyCluster: false }
  );
  expect(single.uncertain).toEqual([]);
  expect(check('istio-waypoint', single).findings).toHaveLength(1);
});
it('does not fallback on incomplete discovery, invalid records, selectors or configuration', () => {
  expect(() => resolveGatewayClassRegistry(settings, { complete: false, items: [] })).toThrow(
    'incomplete'
  );
  expect(() =>
    resolveGatewayClassRegistry(settings, {
      complete: true,
      items: [{ ...item('bad', ''), namespace: 'wrong' }],
    })
  ).toThrow('Malformed');
  for (const value of [
    { classes: [{ name: '', className: 'istio' }], selector: {} },
    { classes: [], selector: { 'bad key': 'x' } },
    { classes: [], selector: { valid: '\n' } },
    { classes: [], selector: {}, unknown: true },
    { classes: Array.from({ length: 101 }, () => ({ name: 'A', className: 'a' })), selector: {} },
  ])
    expect(() => validateGatewayClassSettings(value)).toThrow();
  expect(check('istio').skipped[0]).toContain('unavailable');
});
it('persists and validates per-cluster settings without changing unrelated scopes', () => {
  const original = {
    schemaVersion: 1 as const,
    clusters: { alpha: { prometheus: null }, beta: { prometheus: null } },
  };
  const configured = {
    classes: [{ name: 'Custom', className: 'custom' }],
    selector: { team: 'mesh' },
  };
  const updated = updateClusterConfig(original, 'alpha', {
    prometheus: null,
    gatewayClasses: configured,
  });

  expect(getClusterConfig(updated, 'alpha').gatewayClasses).toEqual(configured);
  expect(updated.clusters.beta).toEqual(original.clusters.beta);
  expect(readConfig(updated)).toEqual({ valid: true, config: updated });
  expect(
    readConfig({
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, gatewayClasses: { bad: true } } },
    }).valid
  ).toBe(false);
});
it('enforces exact registry configuration and discovery bounds', () => {
  const classes = Array.from({ length: 100 }, (_, index) => ({
    name: `Class ${index}`,
    className: `class-${index}`,
  }));
  const selector = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`key-${index}`, 'value'])
  );
  expect(validateGatewayClassSettings({ classes, selector }).classes).toHaveLength(100);
  expect(() =>
    validateGatewayClassSettings({ classes, selector: { ...selector, extra: 'value' } })
  ).toThrow('100 entries');
  const records = Array.from({ length: 1000 }, (_, index) =>
    item(`class-${index}`, 'istio.io/controller')
  );
  expect(
    resolveGatewayClassRegistry(settings, { complete: true, items: records }).classes
  ).toHaveLength(1000);
  expect(() =>
    resolveGatewayClassRegistry(settings, {
      complete: true,
      items: [...records, item('extra', 'istio.io/controller')],
    })
  ).toThrow('1000 records');
});
it('integrates KIA1504 with the existing validation exclusion behavior', () => {
  const registry = resolveGatewayClassRegistry(settings, {
    complete: true,
    items: [item('known', 'istio.io/controller')],
  });
  const context = {
    cluster: 'alpha',
    identityDomain: null,
    gatewayClassRegistry: registry,
    namespaces: { complete: false, items: [] },
    destinationRules: { complete: false, items: [] },
    sidecars: { complete: false, items: [] },
  };
  const input = {
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'Gateway',
    group: 'gateway.networking.k8s.io',
    spec: { gatewayClassName: 'missing', listeners: [] },
    workloads: [],
    complete: false,
    context,
  };
  expect(
    initialValidation({ ...input, annotations: {} }).findings.some(
      value => value.code === 'KIA1504'
    )
  ).toBe(true);
  expect(
    initialValidation({
      ...input,
      annotations: { 'kiali.io/ignore-validations': 'KIA1504' },
    }).findings.some(value => value.code === 'KIA1504')
  ).toBe(false);
});
