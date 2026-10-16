import {
  ConfigurationError,
  getClusterConfig,
  KialiConfig,
  readConfig,
  updateClusterConfig,
  validateServiceEndpoint,
} from './config';

const endpoint = {
  namespace: 'istio-system',
  service: 'prometheus',
  port: '9090',
  basePath: '',
};

describe('versioned, cluster-scoped configuration', () => {
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
});

describe('internal Service endpoint validation', () => {
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
