import { isRecord } from './object';

export interface ServiceEndpoint {
  namespace: string;
  service: string;
  port: string;
  basePath: string;
}

export interface ClusterConfig {
  prometheus: ServiceEndpoint | null;
}

export interface KialiConfig {
  schemaVersion: 1;
  clusters: Record<string, ClusterConfig>;
}

export type ConfigResult = { valid: true; config: KialiConfig } | { valid: false; message: string };

export class ConfigurationError extends Error {}

function rejectUnknownFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some(field => !fields.includes(field))) {
    throw new ConfigurationError('Configuration contains unsupported fields');
  }
}

function name(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  ) {
    throw new ConfigurationError(`${field} must be a Kubernetes DNS label`);
  }
  return value;
}

export function validateServiceEndpoint(value: unknown): ServiceEndpoint {
  if (!isRecord(value)) {
    throw new ConfigurationError('Metrics endpoint must be a Service reference');
  }
  rejectUnknownFields(value, ['namespace', 'service', 'port', 'basePath']);
  const namespace = name(value.namespace, 'Namespace');
  const service = name(value.service, 'Service');
  if (typeof value.port !== 'string') {
    throw new ConfigurationError('Port must be a number or a named Service port');
  }
  let port = value.port;
  if (/^\d+$/.test(port)) {
    const numeric = Number(port);
    if (numeric < 1 || numeric > 65535) {
      throw new ConfigurationError('Port must be between 1 and 65535');
    }
    port = String(numeric);
  } else if (
    port.length > 15 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(port) ||
    !/[a-z]/.test(port)
  ) {
    throw new ConfigurationError('Port must be a number or a named Service port');
  }
  if (typeof value.basePath !== 'string') {
    throw new ConfigurationError('Base path must be a string');
  }
  const basePath = value.basePath.replace(/\/+$/, '');
  if (
    basePath !== '' &&
    (!basePath.startsWith('/') ||
      !basePath
        .slice(1)
        .split('/')
        .every(part => /^[a-zA-Z0-9._~-]+$/.test(part) && part !== '.' && part !== '..'))
  ) {
    throw new ConfigurationError(
      'Base path must be a plain absolute path without query parameters'
    );
  }
  return { namespace, service, port, basePath };
}

export function readConfig(value: unknown): ConfigResult {
  if (value === undefined) {
    return { valid: true, config: { schemaVersion: 1, clusters: {} } };
  }
  try {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.clusters)) {
      throw new ConfigurationError('Expected configuration schema version 1');
    }
    rejectUnknownFields(value, ['schemaVersion', 'clusters']);
    const entries = Object.entries(value.clusters).map(([cluster, settings]) => {
      if (!cluster.trim() || !isRecord(settings)) {
        throw new ConfigurationError('Each cluster must have a configuration object');
      }
      rejectUnknownFields(settings, ['prometheus']);
      const prometheus =
        settings.prometheus === null ? null : validateServiceEndpoint(settings.prometheus);
      return [cluster, { prometheus }] as const;
    });
    return {
      valid: true,
      config: { schemaVersion: 1, clusters: Object.fromEntries(entries) },
    };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { valid: false, message: error.message };
    }
    throw error;
  }
}

export function getClusterConfig(config: KialiConfig, cluster: string): ClusterConfig {
  return Object.prototype.hasOwnProperty.call(config.clusters, cluster)
    ? config.clusters[cluster]
    : { prometheus: null };
}

export function updateClusterConfig(
  config: KialiConfig,
  cluster: string,
  settings: ClusterConfig
): KialiConfig {
  if (!cluster.trim()) {
    throw new ConfigurationError('A cluster must be selected');
  }
  return {
    ...config,
    clusters: {
      ...config.clusters,
      [cluster]: {
        prometheus:
          settings.prometheus === null ? null : validateServiceEndpoint(settings.prometheus),
      },
    },
  };
}
