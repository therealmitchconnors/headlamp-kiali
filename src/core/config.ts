import { CustomDashboardSettings, validateCustomDashboardSettings } from './customDashboards';
import { GatewayClassSettings, validateGatewayClassSettings } from './gatewayClassRegistry';
import { HealthRateRule, validateHealthRules } from './healthCalculator';
import { AppLabels, isLabelKey } from './labels';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export interface ServiceEndpoint {
  namespace: string;
  service: string;
  port: string;
  basePath: string;
}
export interface TracingConfig {
  provider: 'jaeger' | 'tempo';
  endpoint: ServiceEndpoint;
}

export interface ClusterConfig {
  prometheus: ServiceEndpoint | null;
  appLabels?: AppLabels | null;
  healthRates?: HealthRateRule[];
  identityDomain?: string | null;
  tracing?: TracingConfig | null;
  gatewayClasses?: GatewayClassSettings;
  telemetryCluster?: string | null;
  skipWildcardGatewayHosts?: boolean;
  customDashboards?: CustomDashboardSettings;
}

export interface KialiConfig {
  schemaVersion: 1;
  clusters: Record<string, ClusterConfig>;
}

export type ConfigResult = { valid: true; config: KialiConfig } | { valid: false; message: string };

export class ConfigurationError extends Error {}

function wildcardGatewaySetting(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new ConfigurationError('Skip wildcard Gateway hosts must be a boolean');
  return value;
}
function customDashboardsSetting(value: unknown): CustomDashboardSettings {
  try {
    return validateCustomDashboardSettings(value);
  } catch (error) {
    throw new ConfigurationError(
      error instanceof Error ? error.message : 'Invalid custom dashboard settings'
    );
  }
}

export function validateTelemetryCluster(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new ConfigurationError(
      'Metric cluster label must contain 1 to 256 characters without surrounding whitespace or control characters'
    );
  return value;
}

export function validateIdentityDomain(value: unknown): string {
  if (!isDnsSubdomain(value))
    throw new ConfigurationError('Service DNS identity domain must be a DNS subdomain');
  return value;
}

export function validateTracingConfig(value: unknown): TracingConfig {
  if (!isRecord(value) || (value.provider !== 'jaeger' && value.provider !== 'tempo'))
    throw new ConfigurationError('Select a supported tracing provider');
  rejectUnknownFields(value, ['provider', 'endpoint']);
  return { provider: value.provider, endpoint: validateServiceEndpoint(value.endpoint) };
}

function rejectUnknownFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some(field => !fields.includes(field))) {
    throw new ConfigurationError('Configuration contains unsupported fields');
  }
}

function name(value: unknown, field: string): string {
  if (!isDnsLabel(value)) {
    throw new ConfigurationError(`${field} must be a Kubernetes DNS label`);
  }
  return value;
}

export function validateAppLabels(value: unknown): AppLabels {
  if (!isRecord(value) || !isLabelKey(value.app) || !isLabelKey(value.version)) {
    throw new ConfigurationError(
      'Application and version label keys must both be valid Kubernetes label keys'
    );
  }
  rejectUnknownFields(value, ['app', 'version']);
  return { app: value.app, version: value.version };
}

export function validateServiceEndpoint(value: unknown): ServiceEndpoint {
  if (!isRecord(value)) {
    throw new ConfigurationError('Endpoint must be a Service reference');
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
      rejectUnknownFields(settings, [
        'prometheus',
        'appLabels',
        'healthRates',
        'identityDomain',
        'tracing',
        'gatewayClasses',
        'telemetryCluster',
        'skipWildcardGatewayHosts',
        'customDashboards',
      ]);
      const prometheus =
        settings.prometheus === null ? null : validateServiceEndpoint(settings.prometheus);
      return [
        cluster,
        {
          prometheus,
          ...(settings.customDashboards === undefined
            ? {}
            : { customDashboards: customDashboardsSetting(settings.customDashboards) }),
          ...(settings.skipWildcardGatewayHosts === undefined
            ? {}
            : {
                skipWildcardGatewayHosts: wildcardGatewaySetting(settings.skipWildcardGatewayHosts),
              }),
          ...(settings.telemetryCluster === undefined
            ? {}
            : {
                telemetryCluster:
                  settings.telemetryCluster === null
                    ? null
                    : validateTelemetryCluster(settings.telemetryCluster),
              }),
          ...(settings.gatewayClasses === undefined
            ? {}
            : { gatewayClasses: configuredGatewayClasses(settings.gatewayClasses) }),
          ...(settings.tracing === undefined
            ? {}
            : {
                tracing: settings.tracing === null ? null : validateTracingConfig(settings.tracing),
              }),
          ...(settings.identityDomain === undefined
            ? {}
            : {
                identityDomain:
                  settings.identityDomain === null
                    ? null
                    : validateIdentityDomain(settings.identityDomain),
              }),
          ...(settings.healthRates === undefined
            ? {}
            : { healthRates: configuredHealthRules(settings.healthRates) }),
          ...(settings.appLabels === undefined
            ? {}
            : {
                appLabels:
                  settings.appLabels === null ? null : validateAppLabels(settings.appLabels),
              }),
        },
      ] as const;
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
        ...getClusterConfig(config, cluster),
        ...(settings.customDashboards === undefined
          ? {}
          : { customDashboards: customDashboardsSetting(settings.customDashboards) }),
        ...(settings.skipWildcardGatewayHosts === undefined
          ? {}
          : {
              skipWildcardGatewayHosts: wildcardGatewaySetting(settings.skipWildcardGatewayHosts),
            }),
        ...(settings.telemetryCluster === undefined
          ? {}
          : {
              telemetryCluster:
                settings.telemetryCluster === null
                  ? null
                  : validateTelemetryCluster(settings.telemetryCluster),
            }),
        ...(settings.gatewayClasses === undefined
          ? {}
          : { gatewayClasses: configuredGatewayClasses(settings.gatewayClasses) }),
        prometheus:
          settings.prometheus === null ? null : validateServiceEndpoint(settings.prometheus),
        ...(settings.tracing === undefined
          ? {}
          : {
              tracing: settings.tracing === null ? null : validateTracingConfig(settings.tracing),
            }),
        ...(settings.identityDomain === undefined
          ? {}
          : {
              identityDomain:
                settings.identityDomain === null
                  ? null
                  : validateIdentityDomain(settings.identityDomain),
            }),
        ...(settings.healthRates === undefined
          ? {}
          : { healthRates: configuredHealthRules(settings.healthRates) }),
        ...(settings.appLabels === undefined
          ? {}
          : {
              appLabels: settings.appLabels === null ? null : validateAppLabels(settings.appLabels),
            }),
      },
    },
  };
}

function configuredHealthRules(value: unknown): HealthRateRule[] {
  try {
    return validateHealthRules(value);
  } catch (error) {
    throw new ConfigurationError(error instanceof Error ? error.message : 'Invalid health rules');
  }
}

function configuredGatewayClasses(value: unknown): GatewayClassSettings {
  try {
    return validateGatewayClassSettings(value);
  } catch (error) {
    throw new ConfigurationError(
      error instanceof Error ? error.message : 'Invalid Gateway class settings'
    );
  }
}
