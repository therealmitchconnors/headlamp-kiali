import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { gatewayClassChecks } from '../core/gatewayClassRegistry';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'gateway.networking.k8s.io';
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it.each(['ready', 'empty', 'denied', 'invalid'])(
  'loads a cluster-scoped registry from %s evidence without namespace or mesh guesses',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const url = new URL(String(path), 'http://example.test');
      if (url.pathname === `/apis/${group}`)
        return { name: group, versions: [{ groupVersion: `${group}/v1` }] };
      if (url.pathname === `/apis/${group}/v1`)
        return {
          groupVersion: `${group}/v1`,
          resources: [{ name: 'gatewayclasses', kind: 'GatewayClass', namespaced: false }],
        };
      if (url.pathname === `/apis/${group}/v1/gatewayclasses`) {
        if (mode === 'denied') throw { status: 403, message: 'Classes denied' };
        return {
          kind: 'GatewayClassList',
          apiVersion: `${group}/v1`,
          metadata: { resourceVersion: '1' },
          items:
            mode === 'empty'
              ? []
              : [
                  {
                    metadata: { name: 'custom', uid: 'class-uid', labels: { team: 'mesh' } },
                    spec: { controllerName: mode === 'invalid' ? null : 'other.io/controller' },
                  },
                ],
        };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const signal = new AbortController().signal;
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'Gateway',
      group,
      { gatewayClassName: 'custom' },
      null,
      signal,
      'bookinfo',
      { classes: [], selector: { team: 'mesh' } }
    );
    if (mode === 'ready')
      expect(result.context.gatewayClassRegistry?.classes).toEqual([
        { name: 'custom', className: 'custom' },
      ]);
    else if (mode === 'empty') expect(result.context.gatewayClassRegistry?.basis).toBe('fallback');
    else {
      expect(result.context.gatewayClassRegistry).toBeUndefined();
      expect(result.sources[0].complete).toBe(false);
      expect(result.sources[0].error).toBeDefined();
      expect(
        gatewayClassChecks(
          'Gateway',
          group,
          { gatewayClassName: 'custom' },
          result.context.gatewayClassRegistry
        ).findings
      ).toEqual([]);
    }
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(String(path)).not.toContain('/namespaces/');
      expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    }
  }
);
it('captures configured registry overrides and avoids unnecessary API reads', async () => {
  const settings = { classes: [{ name: 'Custom', className: 'custom' }], selector: {} };
  const read = loadValidationSnapshot(
    clusterScope('alpha'),
    'Gateway',
    group,
    { gatewayClassName: 'custom' },
    null,
    new AbortController().signal,
    'bookinfo',
    settings
  );
  settings.classes[0].className = 'changed';
  const result = await read;
  expect(ApiProxy.request).not.toHaveBeenCalled();
  expect(result.context.gatewayClassRegistry?.classes[0].className).toBe('custom');
});
it('does not request registry context for absent or invalid class identities', async () => {
  for (const spec of [{}, { gatewayClassName: 'bad/class' }, { gatewayClassName: null }]) {
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'Gateway',
      group,
      spec,
      null,
      new AbortController().signal,
      'bookinfo'
    );
    expect(result.context.gatewayClassRegistry).toBeUndefined();
    expect(result.sources).toEqual([]);
  }
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
