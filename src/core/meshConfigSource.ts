import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export interface MeshConfigSource {
  kind: 'standard' | 'mounted';
  name: string;
  key: string;
  path?: string;
}

export interface MeshConfigSourceResolution {
  source?: MeshConfigSource;
  networksSource?: MeshNetworksSource;
  blocked: boolean;
  warnings: string[];
}

export interface MeshNetworksSource {
  name: string;
  key: string;
  path: string;
}

const defaultMeshConfigPath = '/etc/istio/config/mesh';
const defaultMeshNetworksPath = '/etc/istio/config/meshNetworks';
const hasExpansion = (value: string) => /\$\(|\$\{/.test(value);

function list(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error(`Malformed or oversized istiod ${field} list`);
  return value;
}

function safePath(value: unknown, relative: boolean): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f\\]/.test(value) ||
    hasExpansion(value) ||
    value.includes('..') ||
    (relative ? value.startsWith('/') : !value.startsWith('/') && !value.startsWith('./'))
  )
    throw new Error('Mounted mesh configuration uses an invalid or unresolved path');
  const segments = value.split('/').filter(segment => segment !== '' && segment !== '.');
  if (!segments.length) {
    if (!relative && value.startsWith('/')) return '/';
    throw new Error('Mounted mesh configuration uses an empty path');
  }
  return `${relative ? '' : '/'}${segments.join('/')}`;
}

function configKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    !/^[a-zA-Z0-9._-]+$/.test(value) ||
    value === '.' ||
    value === '..'
  )
    throw new Error('Mounted mesh configuration has an invalid ConfigMap key');
  return value;
}

// The pinned caller registers meshConfig, not meshConfigFile. Its pflag parser
// accepts interspersed positionals and skips unknown flag values, including "".
function configurationPaths(rawArgs: unknown): { mesh: string; networks: string } {
  const args = list(rawArgs, 'argument').map(value => {
    if (
      typeof value !== 'string' ||
      value.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(value) ||
      hasExpansion(value)
    )
      throw new Error('Istiod arguments are malformed or contain unresolved expansion');
    return value;
  });
  const selected = { mesh: defaultMeshConfigPath, networks: defaultMeshNetworksPath };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') continue;
    const skipUnknownValue = () => {
      if (index + 1 < args.length && !args[index + 1].startsWith('-')) index++;
    };
    if (!arg.startsWith('--')) {
      // Go test shorthands are a pflag special case, irrelevant to Istiod.
      if (arg.startsWith('-test.')) throw new Error('Istiod test-only arguments are not supported');
      for (let short = 1; short < arg.length; short++) {
        if (arg[short] === 'h')
          throw new Error('Istiod help arguments do not select configuration');
        if (arg.length > short + 2 && arg[short + 1] === '=') break;
        skipUnknownValue();
      }
      continue;
    }
    if (arg[2] === '-' || arg[2] === '=')
      throw new Error('Istiod arguments contain invalid flag syntax');
    const equals = arg.indexOf('=');
    const name = arg.slice(2, equals === -1 ? undefined : equals);
    if (name === 'help') throw new Error('Istiod help arguments do not select configuration');
    if (!['meshConfig', 'monitoringAddr', 'networksConfigFile'].includes(name)) {
      if (equals === -1) skipUnknownValue();
      continue;
    }
    const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
    if (value === undefined) throw new Error('Istiod configuration arguments are missing a value');
    if (name === 'meshConfig') selected.mesh = value;
    if (name === 'networksConfigFile') selected.networks = value;
  }
  return selected;
}

function mountedReference(
  container: Record<string, unknown>,
  rawVolumes: unknown,
  rawPath: string,
  optional: boolean
): MeshNetworksSource | undefined {
  const path = safePath(rawPath, false);
  if (path === '/') throw new Error('The mesh configuration path does not identify a file');
  const volumes = list(rawVolumes, 'volume').map(volume => {
    if (!isRecord(volume) || !isDnsLabel(volume.name))
      throw new Error('Malformed istiod volume identity');
    return volume;
  });
  const covering = list(container.volumeMounts, 'volume mount')
    .map(mount => {
      if (!isRecord(mount) || !isDnsLabel(mount.name))
        throw new Error('Malformed istiod volume mount identity');
      return { mount, path: safePath(mount.mountPath, false) };
    })
    .filter(mount => mount.path === '/' || path === mount.path || path.startsWith(`${mount.path}/`))
    .sort((left, right) => right.path.length - left.path.length);
  if (!covering.length) {
    if (!optional && path !== defaultMeshConfigPath)
      throw new Error('Explicit mesh configuration path has no auditable ConfigMap mount');
    return undefined;
  }
  if (new Set(covering.map(mount => mount.path)).size !== covering.length)
    throw new Error('Mounted mesh configuration has ambiguous overlapping mounts');
  const selected = covering[0];
  const mount = selected.mount;
  if (mount.subPathExpr !== undefined && mount.subPathExpr !== null && mount.subPathExpr !== '')
    throw new Error('Mounted mesh configuration subPathExpr is not resolved');
  let relative =
    selected.path === path
      ? path.slice(path.lastIndexOf('/') + 1)
      : path.slice(selected.path === '/' ? 1 : selected.path.length + 1);
  if (mount.subPath !== undefined && mount.subPath !== null && mount.subPath !== '') {
    const subPath = safePath(mount.subPath, true);
    if (path !== selected.path)
      throw new Error('Mounted mesh configuration directory subPath is not supported');
    relative = subPath;
  }
  const matching = volumes.filter(volume => volume.name === mount.name);
  if (matching.length !== 1)
    throw new Error('Mounted mesh configuration volume is missing or ambiguous');
  const volume = matching[0];
  if (
    !isRecord(volume.configMap) ||
    Object.entries(volume).some(
      ([field, value]) =>
        field !== 'name' && field !== 'configMap' && value !== undefined && value !== null
    )
  )
    throw new Error('Mounted mesh configuration requires an unambiguous direct ConfigMap volume');
  const configMap = volume.configMap;
  if (!isDnsSubdomain(configMap.name))
    throw new Error('Mounted mesh configuration has an invalid ConfigMap name');
  const items = list(configMap.items, 'ConfigMap item').map(item => {
    if (!isRecord(item)) throw new Error('Malformed mounted mesh configuration item');
    return { path: safePath(item.path, true), key: configKey(item.key) };
  });
  const key = items.length ? items.find(item => item.path === relative)?.key : configKey(relative);
  if (key === undefined) {
    // No mapped networks file is optional, but cannot hide another covering source.
    if (optional && covering.length === 1) return undefined;
    throw new Error('Mounted mesh configuration file is not mapped by ConfigMap items');
  }
  return { name: configMap.name, key, path };
}

/**
 * Same-context projection of discovery.go's findMeshConfigFile and
 * shouldLoadMeshConfigFile. A standard-name/mesh-key mount needs no file overlay.
 * Unlike upstream's fallback, malformed or masking mounts fail closed here.
 * Topology/cluster mapping remains the caller's independent responsibility.
 */
export function resolveMeshConfigSource(
  container: Record<string, unknown>,
  rawVolumes: unknown,
  standardName: string
): MeshConfigSourceResolution {
  let source: MeshConfigSource | undefined;
  try {
    if (!isDnsSubdomain(standardName)) throw new Error('Invalid standard mesh ConfigMap name');
    if (list(container.envFrom, 'envFrom').length)
      throw new Error('Istiod envFrom configuration indirection is not resolved');
    const paths = configurationPaths(container.args);
    const reference = mountedReference(container, rawVolumes, paths.mesh, false);
    source = reference
      ? {
          ...reference,
          kind:
            reference.name === standardName && reference.key === 'mesh' ? 'standard' : 'mounted',
        }
      : { kind: 'standard', name: standardName, key: 'mesh' };
    if (source.kind === 'standard') return { source, blocked: false, warnings: [] };
    // setFileConfig only succeeds after setFileMeshNetworks; do not activate the
    // dependency for the standard-config pipeline or interpret its content here.
    let networksSource: MeshNetworksSource | undefined;
    try {
      networksSource = mountedReference(container, rawVolumes, paths.networks, true);
    } catch (error) {
      throw new Error(
        `Mounted mesh networks dependency: ${
          error instanceof Error ? error.message : 'Unable to resolve mounted networks file'
        }`
      );
    }
    return {
      source,
      ...(networksSource ? { networksSource } : {}),
      blocked: false,
      warnings: [],
    };
  } catch (error) {
    return {
      ...(source ? { source } : {}),
      blocked: true,
      warnings: [
        error instanceof Error ? error.message : 'Unable to resolve mounted mesh configuration',
      ],
    };
  }
}
