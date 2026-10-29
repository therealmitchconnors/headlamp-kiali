import fixturesText from '../../test-files/configuration/fixtures.json?raw';
import gatewayFixtureText from '../../test-files/configuration/gateway-fixtures.json?raw';
import gatewaySchemaText from '../../test-files/configuration/gateway-schemas.json?raw';
import schemaText from '../../test-files/configuration/schemas.json?raw';
import { DestinationRule } from './destination-rule';
import { HTTPRoute } from './http-route';
import { K8sGateway } from './k8s-gateway';
import { configurationDefinitions } from './registry';
import { VirtualService } from './virtual-service';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    cluster: {
      KubeObject: class {
        constructor(public jsonData: { spec?: object; status?: object }, public cluster: string) {}
      },
    },
  },
}));

const fixtures = JSON.parse(fixturesText);
const schemas = {
  resources: [...JSON.parse(schemaText).resources, ...JSON.parse(gatewaySchemaText).resources],
};

it('registers every schema-derived model with collision-safe routes and the captured served versions', () => {
  expect(configurationDefinitions).toHaveLength(23);
  expect(
    new Set(configurationDefinitions.map(entry => entry.resourceClass.detailsRoute)).size
  ).toBe(23);
  for (const definition of configurationDefinitions) {
    const source = schemas.resources.find(
      (source: { kind: string; group: string }) =>
        source.kind === definition.kind && source.group === definition.group
    );
    expect(source).toBeDefined();
    expect(definition.resourceClass.isNamespaced).toBe(source.scope !== 'Cluster');
    expect(definition.resourceClass.apiName).toBe(source.plural);
    expect(definition.resourceClass.detailsRoute).toMatch(/^kiali-config-/);
    expect([...definition.resourceClass.apiVersion].sort()).toEqual(
      source.versions.map((version: { name: string }) => `${source.group}/${version.name}`).sort()
    );
  }
});

it('keeps Gateway groups distinct and renders real condition/array printer columns without evaluation', () => {
  const definitions = configurationDefinitions.filter(entry => entry.kind === 'Gateway');
  expect(definitions.map(entry => entry.id)).toEqual(['gateway', 'k8s-gateway']);
  const gateway = new K8sGateway(JSON.parse(gatewayFixtureText).gateway, 'alpha');
  expect(gateway.printerValue('.status.addresses[*].value')).toBe('192.0.2.1');
  expect(gateway.printerValue('.status.conditions[?(@.type=="Programmed")].status')).toBe('True');
  expect(gateway.printerValue('.status.conditions[?(@.type=="Missing")].status')).toBe('-');
  expect(gateway.printerValue('.status.conditions[?(@.type=alert(1))].status')).toBe('-');
  expect(gateway.printerValue('.spec.constructor')).toBe('-');
});

it('moves nested parent/listener conditions to the final condition group without dropping identity or other status', () => {
  const fixtures = JSON.parse(gatewayFixtureText);
  const route = new HTTPRoute(fixtures.httpRoute, 'alpha');
  expect(route.statusFields).toEqual([
    [
      'parents',
      [
        {
          parentRef: fixtures.httpRoute.status.parents[0].parentRef,
          controllerName: fixtures.httpRoute.status.parents[0].controllerName,
        },
      ],
    ],
  ]);
  expect(route.conditions).toEqual({
    parents: [{ path: 'status.parents[0]', ...fixtures.httpRoute.status.parents[0] }],
  });
  const gateway = new K8sGateway(fixtures.gateway, 'alpha');
  expect(gateway.statusFields.find(([name]) => name === 'listeners')?.[1]).toEqual([
    {
      name: 'https',
      attachedRoutes: 1,
      supportedKinds: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute' }],
    },
  ]);
  expect(fixtures.gateway.status.listeners[0].conditions).toHaveLength(1);
});

it('exposes all supplied spec and extension status fields without losing zero or false values', () => {
  const service = new VirtualService(fixtures.virtualService, 'alpha');
  const rule = new DestinationRule(fixtures.destinationRule, 'alpha');
  expect(service.specFields.map(([key]) => key)).toEqual(Object.keys(fixtures.virtualService.spec));
  expect(rule.specFields.map(([key]) => key)).toEqual(Object.keys(fixtures.destinationRule.spec));
  expect(service.statusFields.map(([key]) => key)).toContain('extensionStatus');
  expect(service.statusFields.map(([key]) => key)).not.toContain('conditions');
  expect(service.conditions).toEqual(fixtures.virtualService.status.conditions);
  expect(service.reportedGeneration).toBe(1);
  expect(service.spec?.http?.[0].route?.[0].weight).toBe(0);
});

it('reads structural printer paths but never evaluates schema-provided code', () => {
  const service = new VirtualService(fixtures.virtualService, 'alpha');
  expect(service.printerValue('.spec.hosts')).toBe('reviews');
  expect(service.printerValue('.spec.gateways')).toBe('mesh, edge/public');
  expect(service.printerValue('.status.observedGeneration')).toBe('1');
  expect(service.printerValue('.spec.http.length')).toBe('3');
  expect(service.printerValue('.spec.noSuchField')).toBe('-');
  expect(service.printerValue('.spec.hosts[0]')).toBe('-');
  expect(service.printerValue('constructor.constructor("alert(1)")')).toBe('-');
  const data = { ...fixtures.virtualService, spec: undefined, status: undefined };
  expect(new VirtualService(data, 'alpha').specFields).toEqual([]);
});
