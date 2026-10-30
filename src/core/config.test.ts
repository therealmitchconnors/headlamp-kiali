import {
  ConfigurationError,
  getClusterConfig,
  KialiConfig,
  readConfig,
  updateClusterConfig,
  validateIdentityDomain,
  validateMeshClusterName,
  validateServiceEndpoint,
  validateTracingConfig,
} from './config';

const endpoint = {
  namespace: 'istio-system',
  service: 'prometheus',
  port: '9090',
  basePath: '',
};

describe('versioned, cluster-scoped configuration', () => {
  it('keeps logical mesh names explicit and separate from context and telemetry identities', () => {
    const source: KialiConfig = {
      schemaVersion: 1,
      clusters: {
        alpha: { prometheus: null, telemetryCluster: 'metric-alpha' },
        beta: { prometheus: null, meshClusterName: 'logical-beta' },
      },
    };
    expect(getClusterConfig(source, 'alpha').meshClusterName).toBeUndefined();
    const saved = updateClusterConfig(source, 'alpha', {
      prometheus: null,
      meshClusterName: 'logical-alpha',
    });
    expect(readConfig(saved)).toEqual({ valid: true, config: saved });
    expect(saved.clusters.alpha.telemetryCluster).toBe('metric-alpha');
    expect(saved.clusters.beta).toEqual(source.clusters.beta);
    expect(
      updateClusterConfig(saved, 'alpha', { prometheus: null }).clusters.alpha.meshClusterName
    ).toBe('logical-alpha');
    expect(
      updateClusterConfig(saved, 'alpha', { prometheus: null, meshClusterName: null }).clusters
        .alpha.meshClusterName
    ).toBeNull();
    expect(source.clusters.alpha.meshClusterName).toBeUndefined();
    expect(validateMeshClusterName('x'.repeat(256))).toHaveLength(256);
    expect(validateMeshClusterName('mesh-\u{1f680}')).toBe('mesh-\u{1f680}');
  });
  it.each(['', ' alpha', 'alpha ', 'alpha\n', 'a'.repeat(257), '\ud800', 1, {}])(
    'rejects malformed logical mesh names %# without applying a fallback',
    meshClusterName => {
      expect(() => validateMeshClusterName(meshClusterName)).toThrow(ConfigurationError);
      expect(
        readConfig({ schemaVersion: 1, clusters: { alpha: { prometheus: null, meshClusterName } } })
          .valid
      ).toBe(false);
    }
  );
  it('validates, clones and preserves per-cluster custom dashboard definitions', () => {
    const definitions = {
      namespaceLabel: 'namespace',
      clusterLabel: 'cluster',
      dashboards: [
        {
          name: 'test',
          title: 'Test',
          items: [
            {
              chart: {
                name: 'Memory',
                metricName: 'memory_bytes',
                unit: 'bytes',
                dataType: 'raw' as const,
              },
            },
          ],
        },
      ],
    };
    const source: KialiConfig = { schemaVersion: 1, clusters: { beta: { prometheus: null } } };
    const updated = updateClusterConfig(source, 'alpha', {
      prometheus: null,
      customDashboards: definitions,
    });
    definitions.dashboards[0].title = 'mutated';
    expect(updated.clusters.alpha.customDashboards?.dashboards[0].title).toBe('Test');
    expect(readConfig(updated).valid).toBe(true);
    expect(
      updateClusterConfig(updated, 'alpha', { prometheus: endpoint }).clusters.alpha
        .customDashboards
    ).toEqual(updated.clusters.alpha.customDashboards);
    expect(updated.clusters.beta).toEqual({ prometheus: null });
    expect(
      readConfig({
        schemaVersion: 1,
        clusters: {
          alpha: {
            prometheus: null,
            customDashboards: { ...definitions, credentials: 'not-allowed' },
          },
        },
      }).valid
    ).toBe(false);
  });
  it('round-trips saved dashboard includes without flattening or sharing source objects', () => {
    const definitions = {
      namespaceLabel: 'namespace',
      clusterLabel: 'cluster',
      dashboards: [{ name: 'root', title: 'Root', items: [{ include: 'shared$Memory' }] }],
    };
    const source: KialiConfig = { schemaVersion: 1, clusters: { beta: { prometheus: null } } };
    const updated = updateClusterConfig(source, 'alpha', {
      prometheus: null,
      customDashboards: definitions,
    });
    expect(readConfig(updated)).toEqual({ valid: true, config: updated });
    expect(updated.clusters.alpha.customDashboards?.dashboards).toEqual(definitions.dashboards);
    definitions.dashboards[0].items[0].include = 'changed';
    expect(updated.clusters.alpha.customDashboards?.dashboards[0].items[0].include).toBe(
      'shared$Memory'
    );
    expect(updated.clusters.beta).toEqual(source.clusters.beta);
  });
  it('round-trips an optional boolean wildcard Gateway setting without changing another cluster', () => {
    const config: KialiConfig = { schemaVersion: 1, clusters: { beta: { prometheus: null } } };
    const next = updateClusterConfig(config, 'alpha', {
      prometheus: null,
      skipWildcardGatewayHosts: true,
    });
    expect(readConfig(next)).toEqual({ valid: true, config: next });
    expect(next.clusters.beta).toEqual(config.clusters.beta);
    expect(
      updateClusterConfig(next, 'alpha', { prometheus: null }).clusters.alpha
        .skipWildcardGatewayHosts
    ).toBe(true);
    expect(
      updateClusterConfig(next, 'alpha', { prometheus: null, skipWildcardGatewayHosts: false })
        .clusters.alpha.skipWildcardGatewayHosts
    ).toBe(false);
    for (const value of [null, 1, 'true', [], {}])
      expect(
        readConfig({
          schemaVersion: 1,
          clusters: { alpha: { prometheus: null, skipWildcardGatewayHosts: value } },
        }).valid
      ).toBe(false);
  });
  it('defaults only an absent configuration', () => {
    expect(readConfig(undefined)).toEqual({
      valid: true,
      config: { schemaVersion: 1, clusters: {} },
    });
    for (const input of [null, {}, [], 'invalid', { schemaVersion: 2, clusters: {} }]) {
      expect(readConfig(input).valid).toBe(false);
    }
  });

  it('round-trips valid independent cluster settings', () => {
    const config: KialiConfig = {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: endpoint }, beta: { prometheus: null } },
    };
    expect(readConfig(config)).toEqual({ valid: true, config });
    expect(getClusterConfig(config, 'missing')).toEqual({ prometheus: null });
    expect(getClusterConfig(config, 'alpha').prometheus).toEqual(endpoint);
  });

  it('merges only the chosen cluster and does not mutate the current configuration', () => {
    const original: KialiConfig = {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: endpoint } },
    };
    const updated = updateClusterConfig(original, 'beta', { prometheus: null });
    expect(updated.clusters.alpha).toEqual(original.clusters.alpha);
    expect(updated.clusters.beta).toEqual({ prometheus: null });
    expect(Object.keys(original.clusters)).toEqual(['alpha']);
  });

  it('handles cluster names that coincide with object prototype properties', () => {
    const config: KialiConfig = { schemaVersion: 1, clusters: {} };
    expect(getClusterConfig(config, 'toString')).toEqual({ prometheus: null });
    const updated = updateClusterConfig(config, '__proto__', { prometheus: endpoint });
    expect(getClusterConfig(updated, '__proto__').prometheus).toEqual(endpoint);
    expect(Object.getPrototypeOf(updated.clusters)).toBe(Object.prototype);
    expect(readConfig(JSON.parse(JSON.stringify(updated)))).toEqual({
      valid: true,
      config: updated,
    });
  });

  it('rejects unknown fields, credentials and malformed cluster settings explicitly', () => {
    for (const settings of [
      null,
      {},
      { prometheus: { ...endpoint, token: 'do-not-store' } },
      { prometheus: null, token: 'do-not-store' },
    ]) {
      expect(readConfig({ schemaVersion: 1, clusters: { alpha: settings } }).valid).toBe(false);
    }
    expect(() =>
      updateClusterConfig({ schemaVersion: 1, clusters: {} }, '', { prometheus: null })
    ).toThrow(ConfigurationError);
  });

  it('accepts existing profiles and preserves label overrides when only metrics settings change', () => {
    const old = { schemaVersion: 1, clusters: { alpha: { prometheus: endpoint } } };
    expect(readConfig(old)).toEqual({ valid: true, config: old });
    const config: KialiConfig = {
      schemaVersion: 1,
      clusters: {
        alpha: { prometheus: endpoint, appLabels: { app: 'team/app', version: 'team/version' } },
      },
    };
    expect(
      updateClusterConfig(config, 'alpha', { prometheus: null }).clusters.alpha.appLabels
    ).toEqual({ app: 'team/app', version: 'team/version' });
    expect(
      updateClusterConfig(config, 'alpha', { prometheus: endpoint, appLabels: null }).clusters.alpha
        .appLabels
    ).toBeNull();
  });

  it('requires a complete, valid custom label pair without discarding other cluster data', () => {
    for (const appLabels of [
      { app: 'team/app' },
      { app: '', version: 'version' },
      { app: 'bad key', version: 'version' },
    ]) {
      expect(
        readConfig({ schemaVersion: 1, clusters: { alpha: { prometheus: endpoint, appLabels } } })
          .valid
      ).toBe(false);
    }
    expect(
      readConfig({
        schemaVersion: 1,
        clusters: {
          alpha: { prometheus: endpoint, appLabels: { app: 'team/app', version: 'team/version' } },
        },
      }).valid
    ).toBe(true);
  });

  it('preserves independent health rules and rejects invalid stored patterns', () => {
    const config: KialiConfig = {
      schemaVersion: 1,
      clusters: {
        alpha: {
          prometheus: endpoint,
          healthRates: [{ name: 'reviews.*', tolerance: [] }],
        },
      },
    };
    expect(
      updateClusterConfig(config, 'alpha', { prometheus: null }).clusters.alpha.healthRates
    ).toEqual(config.clusters.alpha.healthRates);
    expect(
      readConfig({
        schemaVersion: 1,
        clusters: {
          alpha: {
            prometheus: endpoint,
            healthRates: [{ name: '[', tolerance: [] }],
          },
        },
      }).valid
    ).toBe(false);
  });
});

describe('internal Service endpoint validation', () => {
  it('rejects trailing newlines in registry domains and Service identities', () => {
    expect(() => validateIdentityDomain('svc.cluster.local\n')).toThrow();
    expect(() => validateServiceEndpoint({ ...endpoint, namespace: 'istio-system\n' })).toThrow();
    expect(() => validateServiceEndpoint({ ...endpoint, service: 'prometheus\n' })).toThrow();
  });

  it('normalizes port numbers and an optional base path', () => {
    expect(
      validateServiceEndpoint({ ...endpoint, port: '09090', basePath: '/prometheus/' })
    ).toEqual({
      ...endpoint,
      port: '9090',
      basePath: '/prometheus',
    });

    expect(validateServiceEndpoint({ ...endpoint, port: 'http', basePath: '/' }).basePath).toBe('');
  });

  it.each([
    { namespace: '../default' },
    { service: 'service:9090/proxy' },
    { service: 'https://example.com' },
    { namespace: 'UPPERCASE' },
    { port: '0' },
    { port: '65536' },
    { port: '-1' },
    { port: '1.5' },
    { port: 9090 },
    { basePath: '/../../api' },
    { basePath: '/%2e%2e' },
    { basePath: '/prometheus?token=secret' },
    { basePath: 'https://example.com' },
    { basePath: '//example.com' },
    { basePath: '/a\\b' },
  ])('rejects unsafe or invalid endpoint fields %j', changes => {
    expect(() => validateServiceEndpoint({ ...endpoint, ...changes })).toThrow(ConfigurationError);
  });
});

describe('explicit service DNS identity domain', () => {
  it('keeps an unknown domain unknown and preserves a configured value across other updates', () => {
    const config: KialiConfig = {
      schemaVersion: 1,
      clusters: { alpha: { prometheus: endpoint, identityDomain: 'svc.mesh.example' } },
    };
    expect(readConfig(config)).toEqual({ valid: true, config });
    expect(
      updateClusterConfig(config, 'alpha', { prometheus: null }).clusters.alpha.identityDomain
    ).toBe('svc.mesh.example');
    expect(
      getClusterConfig({ schemaVersion: 1, clusters: {} }, 'alpha').identityDomain
    ).toBeUndefined();
  });

  describe('optional tracing settings', () => {
    it('round-trips an independent provider while keeping older profiles and other settings', () => {
      const config: KialiConfig = {
        schemaVersion: 1,
        clusters: { alpha: { prometheus: endpoint, tracing: { provider: 'tempo', endpoint } } },
      };
      expect(readConfig(config)).toEqual({ valid: true, config });
      expect(
        updateClusterConfig(config, 'alpha', { prometheus: null }).clusters.alpha.tracing
      ).toEqual(config.clusters.alpha.tracing);
      expect(
        updateClusterConfig(config, 'alpha', { prometheus: endpoint, tracing: null }).clusters.alpha
          .tracing
      ).toBeNull();
    });
    it.each([
      { provider: 'unknown', endpoint },
      { provider: 'tempo', endpoint, headers: { 'X-Scope-OrgID': 'tenant' } },
      { provider: 'jaeger', endpoint: { ...endpoint, token: 'not-stored' } },
      { provider: 'jaeger', endpoint: { ...endpoint, basePath: 'https://external.test' } },
    ])('rejects unsupported providers, credentials and external endpoints %#', value => {
      expect(() => validateTracingConfig(value)).toThrow(ConfigurationError);
      expect(
        readConfig({
          schemaVersion: 1,
          clusters: { alpha: { prometheus: null, tracing: value } },
        }).valid
      ).toBe(false);
    });
  });
  it.each([
    '',
    '../default',
    'https://cluster.local',
    'svc.cluster.local.',
    'UPPER',
    'bad name',
    123,
  ])('rejects invalid domain %j', value => {
    expect(() => validateIdentityDomain(value)).toThrow(ConfigurationError);
  });
});
