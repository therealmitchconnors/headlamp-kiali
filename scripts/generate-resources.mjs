import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import prettier from 'prettier';

const { values } = parseArgs({
  options: {
    capture: { type: 'string' },
    'capture-gateway': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
});
const sourcePath = 'test-files/configuration/schemas.json';
const gatewayPath = 'test-files/configuration/gateway-schemas.json';
const gatewaySources = [
  ['GatewayClass', 'gatewayclasses', '7a6acae831d5f8d0eef0ce5be1ba66d64a506cfd'],
  ['Gateway', 'gateways', '4bd6e7c136e6033ff6db336f80df4bb44f7d01d9'],
  ['HTTPRoute', 'httproutes', '49ea6aec585b0541b124bd87e28b358aa7bbd908'],
  ['GRPCRoute', 'grpcroutes', '854c49b7d86fa1d8f5281c75e69d9d9fd6b9a6dc'],
  ['TCPRoute', 'tcproutes', 'fa1574935460d5f0ed51e8acdb5a177d3ef15836'],
  ['TLSRoute', 'tlsroutes', '9e9161cd7b5049b0a15b93cf484f92c140a1075f'],
  ['UDPRoute', 'udproutes', 'c6a59cd0514a7f7e23258dfa1da930ca273cfdb2'],
  ['ReferenceGrant', 'referencegrants', '29f9a5b98fbb2cf46b25705f6d3777050e42829e'],
]
  .map(([kind, plural, blob]) => ({
    kind,
    repo: 'kubernetes-sigs/gateway-api',
    version: 'v1.6.0',
    commit: '89b3b0c3fa63f9342f43ba0fb2cf93d6aab53af7',
    blob,
    path: `config/crd/experimental/gateway.networking.k8s.io_${plural}.yaml`,
  }))
  .concat([
    {
      kind: 'InferencePool',
      repo: 'kubernetes-sigs/gateway-api-inference-extension',
      version: 'v1.5.0',
      commit: 'df9f8909fe06fe2dfd4a6fc0bd0c01a0acabf849',
      blob: '363f7dfad904874cdb4140ff0fb470ad9d248793',
      path: 'config/crd/bases/inference.networking.k8s.io_inferencepools.yaml',
    },
  ]);
const allowed = [
  'VirtualService',
  'DestinationRule',
  'Gateway',
  'ServiceEntry',
  'Sidecar',
  'WorkloadEntry',
  'WorkloadGroup',
  'EnvoyFilter',
  'AuthorizationPolicy',
  'PeerAuthentication',
  'RequestAuthentication',
  'WasmPlugin',
  'TrafficExtension',
  'Telemetry',
];
const schemaKeys = new Set([
  'type',
  'properties',
  'items',
  'additionalProperties',
  'required',
  'enum',
  'nullable',
  'anyOf',
  'oneOf',
  'allOf',
  'x-kubernetes-int-or-string',
  'x-kubernetes-preserve-unknown-fields',
]);
function schema(node) {
  if (typeof node !== 'object' || node === null) return node;
  if (Array.isArray(node)) return node.map(schema);
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => schemaKeys.has(key))
      .map(([key, value]) => [
        key,
        key === 'properties'
          ? Object.fromEntries(
              Object.entries(value).map(([field, value]) => [field, schema(value)])
            )
          : schema(value),
      ])
  );
}
if (values.capture) {
  assert.ok(!values.check, 'Capture and check are separate operations');
  const crds = JSON.parse(await readFile(values.capture, 'utf8'));
  const resources = allowed.map(kind => {
    const crd = crds.items.find(
      crd => crd.spec.names.kind === kind && crd.spec.group.endsWith('.istio.io')
    );
    assert.ok(crd, `Missing live CRD: ${kind}`);
    assert.equal(crd.spec.scope, 'Namespaced');
    const versions = crd.spec.versions
      .filter(version => version.served)
      .map(version => ({
        name: version.name,
        storage: version.storage,
        columns: version.additionalPrinterColumns ?? [],
        spec: schema(version.schema.openAPIV3Schema.properties.spec),
        status: schema(version.schema.openAPIV3Schema.properties.status),
      }));
    return { kind, group: crd.spec.group, plural: crd.spec.names.plural, versions };
  });
  await mkdir('test-files/configuration', { recursive: true });
  await writeFile(
    sourcePath,
    JSON.stringify(
      {
        source:
          'Live managed Istio asm-1-30 CRD schema; metadata, defaults and descriptions omitted',
        resources,
      },
      null,
      2
    ) + '\n'
  );
}
if (values['capture-gateway']) {
  assert.ok(!values.check && !values.capture, 'Capture and check are separate operations');
  const { load } = await import('js-yaml');
  const resources = [];
  for (const source of gatewaySources) {
    const response = await fetch(
      `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.path}`
    );
    assert.ok(response.ok, `Unable to retrieve ${source.path}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      source.blob
    );
    const crd = load(bytes.toString('utf8'));
    assert.equal(crd.spec.names.kind, source.kind);
    assert.ok(['Cluster', 'Namespaced'].includes(crd.spec.scope));
    resources.push({
      kind: source.kind,
      group: crd.spec.group,
      plural: crd.spec.names.plural,
      scope: crd.spec.scope,
      versions: crd.spec.versions
        .filter(version => version.served)
        .map(version => ({
          name: version.name,
          storage: version.storage,
          columns: version.additionalPrinterColumns ?? [],
          spec: schema(version.schema.openAPIV3Schema.properties.spec),
          status: schema(version.schema.openAPIV3Schema.properties.status),
        })),
    });
  }
  await writeFile(
    gatewayPath,
    JSON.stringify(
      {
        source:
          'Pinned upstream schemas matching Kiali v2.33.0 dependencies; experimental fields included; not installed in the verification cluster',
        sources: gatewaySources,
        resources,
      },
      null,
      2
    ) + '\n'
  );
}
const source = await readFile(sourcePath, 'utf8');
const istioResources = JSON.parse(source).resources;
assert.deepEqual(
  istioResources.map(resource => resource.kind),
  allowed
);
const gatewaySource = await readFile(gatewayPath, 'utf8');
const gateway = JSON.parse(gatewaySource);
assert.deepEqual(gateway.sources, gatewaySources);
assert.deepEqual(
  gateway.resources.map(resource => resource.kind),
  gatewaySources.map(source => source.kind)
);
const resources = [...istioResources, ...gateway.resources];
const digest = createHash('sha256').update(source).update(gatewaySource).digest('hex');
function type(node) {
  if (node === true || !node) return 'unknown';
  if (node['x-kubernetes-int-or-string']) return 'number | string';
  if (node.enum) return node.enum.map(value => JSON.stringify(value)).join(' | ');
  let result;
  if (node.type === 'object' || node.properties) {
    const fields = Object.entries(node.properties ?? {}).map(
      ([key, value]) =>
        `${JSON.stringify(key)}${node.required?.includes(key) ? '' : '?'}: ${type(value)};`
    );
    if (node.additionalProperties || node['x-kubernetes-preserve-unknown-fields']) {
      fields.push(`[key: string]: ${fields.length ? 'unknown' : type(node.additionalProperties)};`);
    }
    result = fields.length ? `{ ${fields.join('\n')} }` : 'Record<string, unknown>';
  } else if (node.type === 'array') result = `Array<${type(node.items)}>`;
  else if (node.type === 'integer' || node.type === 'number') result = 'number';
  else if (node.type === 'string') result = 'string';
  else if (node.type === 'boolean') result = 'boolean';
  else if (node.anyOf || node.oneOf) result = (node.anyOf ?? node.oneOf).map(type).join(' | ');
  else if (node.allOf) result = node.allOf.map(type).join(' & ');
  else if (node['x-kubernetes-preserve-unknown-fields']) result = 'unknown';
  else throw new Error(`Unsupported schema node ${JSON.stringify(node)}`);
  return node.nullable ? `(${result}) | null` : result;
}
const banner = `// Generated by scripts/generate-resources.mjs; do not edit by hand.\n// Schema SHA-256: ${digest}\n`;
const declarations = [];
const imports = ["import { ConfigurationResourceClass } from './common';"];
for (const resource of resources) {
  const versions = [...resource.versions].sort((a, b) => Number(b.storage) - Number(a.storage));
  const storage = versions[0];
  const className =
    resource.kind === 'Gateway' && resource.group === 'gateway.networking.k8s.io'
      ? 'K8sGateway'
      : resource.kind;
  const slug = className
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  const specs = [...new Set(versions.map(version => type(version.spec)))];
  const statuses = [...new Set(versions.map(version => type(version.status)))];
  declarations.push(`export type ${className}Spec = ${specs.join(' | ')};`);
  declarations.push(
    `export type ${className}Status = (${statuses.join(' | ')}) & Record<string, unknown>;`
  );
  imports.push(`import { ${className} } from './${slug}';`);
  await emit(
    `src/resources/${slug}.ts`,
    `${banner}
import { ConfigurationResource } from './common';
import type { ${className}Spec, ${className}Status } from './schema-types';
export class ${className} extends ConfigurationResource<${className}Spec, ${className}Status> {
  static kind = ${JSON.stringify(resource.kind)};
  static isNamespaced = ${resource.scope !== 'Cluster'};
  static apiName = ${JSON.stringify(resource.plural)};
  static apiVersion = ${JSON.stringify(
    versions.map(version => `${resource.group}/${version.name}`)
  )};
  static get listRoute() { return 'kiali-config-${slug}'; }
  static get detailsRoute() { return 'kiali-config-${slug}-detail'; }
}
`
  );
  resource.slug = slug;
  resource.className = className;
  resource.label =
    resource.kind === 'Gateway'
      ? resource.group === 'gateway.networking.k8s.io'
        ? 'Gateway (Gateway API)'
        : 'Gateway (Istio)'
      : resource.kind;
  resource.columns = storage.columns
    .filter(column => column.type !== 'date')
    .map(column => ({ name: column.name, path: column.jsonPath, show: !column.priority }));
  const summaries = {
    VirtualService: [
      ['HTTP routes', '.spec.http.length'],
      ['TCP routes', '.spec.tcp.length'],
      ['TLS routes', '.spec.tls.length'],
    ],
    DestinationRule: [['Subsets', '.spec.subsets.length']],
    Gateway: [
      ['Servers', '.spec.servers.length'],
      ['Selector', '.spec.selector'],
    ],
    Sidecar: [
      ['Egress rules', '.spec.egress.length'],
      ['Ingress rules', '.spec.ingress.length'],
    ],
    WorkloadGroup: [['Template address', '.spec.template.address']],
    EnvoyFilter: [
      ['Priority', '.spec.priority'],
      ['Patches', '.spec.configPatches.length'],
    ],
    AuthorizationPolicy: [['Rules', '.spec.rules.length']],
    RequestAuthentication: [['JWT rules', '.spec.jwtRules.length']],
    WasmPlugin: [
      ['URL', '.spec.url'],
      ['Phase', '.spec.phase'],
    ],
    TrafficExtension: [['Phase', '.spec.phase']],
    Telemetry: [
      ['Metric rules', '.spec.metrics.length'],
      ['Tracing rules', '.spec.tracing.length'],
    ],
    K8sGateway: [['Listeners', '.spec.listeners.length']],
    HTTPRoute: [
      ['Rules', '.spec.rules.length'],
      ['Parents', '.spec.parentRefs.length'],
    ],
    GRPCRoute: [
      ['Rules', '.spec.rules.length'],
      ['Parents', '.spec.parentRefs.length'],
    ],
    TCPRoute: [
      ['Rules', '.spec.rules.length'],
      ['Parents', '.spec.parentRefs.length'],
    ],
    TLSRoute: [
      ['Rules', '.spec.rules.length'],
      ['Parents', '.spec.parentRefs.length'],
    ],
    UDPRoute: [
      ['Rules', '.spec.rules.length'],
      ['Parents', '.spec.parentRefs.length'],
    ],
    ReferenceGrant: [
      ['From', '.spec.from.length'],
      ['To', '.spec.to.length'],
    ],
  };
  resource.columns.push(
    ...(summaries[className] ?? []).map(([name, path]) => ({ name, path, show: true }))
  );
}
await emit('src/resources/schema-types.ts', banner + declarations.join('\n\n'));
await emit(
  'src/resources/registry.ts',
  `${banner}
${imports.sort((a, b) => a.split("'")[1].localeCompare(b.split("'")[1])).join('\n')}
export interface ConfigurationDefinition {
  id: string;
  kind: string;
  label: string;
  group: string;
  plural: string;
  resourceClass: ConfigurationResourceClass;
  columns: { name: string; path: string; show: boolean }[];
}
export const configurationDefinitions: readonly ConfigurationDefinition[] = [
${resources
  .map(
    resource => `{
  id: '${resource.slug}', kind: '${resource.kind}', label: '${resource.label}', group: '${
      resource.group
    }',
  plural: '${resource.plural}', resourceClass: ${resource.className},
  columns: ${JSON.stringify(resource.columns)}
}`
  )
  .join(',\n')}
];
`
);
async function emit(path, content) {
  const options = await prettier.resolveConfig('package.json');
  const formatted = prettier.format(content, { ...options, parser: 'typescript' });
  if (values.check)
    assert.equal(await readFile(path, 'utf8'), formatted, `Generated resource drift: ${path}`);
  else {
    await mkdir('src/resources', { recursive: true });
    await writeFile(path, formatted);
  }
}
console.log(`Verified ${resources.length} schema-derived resource models (${digest})`);
