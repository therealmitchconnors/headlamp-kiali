import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { VALIDATION_IGNORE_ANNOTATION } from '../core/validationAnnotations';
import { ConfigurationObject } from '../resources/common';
import { configurationDefinitions } from '../resources/registry';
import { executeMutation, MutationConflict, prepareValidationExclusions } from './mutations';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const original: ConfigurationObject<object> = {
  apiVersion: 'networking.istio.io/v1',
  kind: 'VirtualService',
  metadata: {
    name: 'selected',
    namespace: 'bookinfo',
    uid: 'uid-1',
    resourceVersion: '1',
    creationTimestamp: '2026-01-01T00:00:00Z',
    labels: { preserve: 'yes' },
    annotations: { unrelated: 'preserve', [VALIDATION_IGNORE_ANNOTATION]: 'KIA0004' },
  },
  spec: { hosts: ['reviews'] },
  status: { observedGeneration: 1 },
};
const target = {
  cluster: 'alpha',
  namespace: 'bookinfo',
  name: 'selected',
  apiVersion: 'networking.istio.io/v1',
  definition: configurationDefinitions.find(item => item.kind === 'VirtualService')!,
};
beforeEach(() => {
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') return { status: { allowed: true } };
      if (!options?.method) return structuredClone(original);
      return JSON.parse(String(options.body));
    });
});
it.each(['KIA1107,GWAPI', '', null])(
  'changes only the intended annotation to %j through repeated permission/version checks',
  async value => {
    const prepared = prepareValidationExclusions(target, value, original);
    expect(Object.isFrozen(prepared.validationExclusions)).toBe(true);
    expect(prepared.spec).toBeUndefined();
    const signal = new AbortController().signal;
    await executeMutation(prepared, true, signal);
    await executeMutation(prepared, false, signal);
    const calls = vi.mocked(ApiProxy.request).mock.calls;
    expect(calls).toHaveLength(6);
    expect(JSON.parse(String(calls[0][1]?.body)).spec.resourceAttributes).toMatchObject({
      verb: 'update',
      namespace: 'bookinfo',
      name: 'selected',
    });
    const expectedAnnotations: Record<string, string> = { unrelated: 'preserve' };
    if (value !== null) expectedAnnotations[VALIDATION_IGNORE_ANNOTATION] = value;
    for (const index of [2, 5]) {
      expect(calls[index][1]?.method).toBe('PUT');
      expect(JSON.parse(String(calls[index][1]?.body))).toEqual({
        ...original,
        metadata: { ...original.metadata, annotations: expectedAnnotations },
      });
    }
    expect(String(calls[2][0])).toMatch(/\?dryRun=All$/);
    expect(String(calls[5][0])).not.toContain('dryRun');
    expect(
      calls.every(
        call => call[1]?.cluster === 'alpha' && call[1]?.signal === signal && call[2] === false
      )
    ).toBe(true);
  }
);
it.each(['uid', 'resourceVersion'])('does not write after %s changes', async field => {
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce({ status: { allowed: true } })
    .mockResolvedValueOnce({ ...original, metadata: { ...original.metadata, [field]: 'changed' } });
  await expect(
    executeMutation(
      prepareValidationExclusions(target, '', original),
      false,
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(MutationConflict);
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});
it('blocks denied, malformed and mixed proposals without a write', async () => {
  const prepared = prepareValidationExclusions(target, '', original);
  await expect(
    executeMutation({ ...prepared, spec: {} }, false, new AbortController().signal)
  ).rejects.toThrow('cannot be combined');
  expect(ApiProxy.request).not.toHaveBeenCalled();
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({
    status: { allowed: false, reason: 'Denied update' },
  });
  await expect(executeMutation(prepared, false, new AbortController().signal)).rejects.toThrow(
    'Denied update'
  );
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('rejects malformed current annotations and cancellation before the write', async () => {
  const prepared = prepareValidationExclusions(target, '', original);
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce({ status: { allowed: true } })
    .mockResolvedValueOnce({
      ...original,
      metadata: { ...original.metadata, annotations: { invalid: 4 } },
    });
  await expect(executeMutation(prepared, false, new AbortController().signal)).rejects.toThrow(
    'annotations are malformed'
  );
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
  const signal = new AbortController();
  signal.abort();
  await expect(executeMutation(prepared, false, signal.signal)).rejects.toThrow();
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});
it('rejects no-op and malformed targets/values before permission probes', () => {
  expect(() => prepareValidationExclusions(target, 'KIA0004', original)).toThrow('not changed');
  expect(() =>
    prepareValidationExclusions({ ...target, namespace: 'different' }, '', original)
  ).toThrow('identity');
  expect(() => prepareValidationExclusions(target, 'x'.repeat(4097), original)).toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('cannot fall through an unsupported action into a destructive request', async () => {
  const prepared = prepareValidationExclusions(target, '', original);
  await expect(
    executeMutation(
      { ...prepared, action: JSON.parse('"unsupported"') },
      false,
      new AbortController().signal
    )
  ).rejects.toThrow('Unsupported configuration mutation action');
  await expect(
    executeMutation(prepared, JSON.parse('"false"'), new AbortController().signal)
  ).rejects.toThrow('boolean dry-run');
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('preserves cluster-wide scope for GatewayClass annotation changes', async () => {
  const definition = configurationDefinitions.find(item => item.kind === 'GatewayClass')!;
  const global = {
    ...original,
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'GatewayClass',
    metadata: { ...original.metadata },
    spec: { controllerName: 'example.test/gateway' },
  };
  delete global.metadata.namespace;
  const selected = { ...target, namespace: '', apiVersion: global.apiVersion, definition };
  vi.mocked(ApiProxy.request).mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') return { status: { allowed: true } };
    if (!options?.method) return global;
    return JSON.parse(String(options.body));
  });
  await executeMutation(
    prepareValidationExclusions(selected, '', global),
    true,
    new AbortController().signal
  );
  const calls = vi.mocked(ApiProxy.request).mock.calls;
  expect(calls[2][0]).toBe('/apis/gateway.networking.k8s.io/v1/gatewayclasses/selected?dryRun=All');
  expect(JSON.parse(String(calls[0][1]?.body)).spec.resourceAttributes.namespace).toBeUndefined();
  expect(JSON.parse(String(calls[2][1]?.body)).metadata.namespace).toBeUndefined();
});
it.each([{}, original])(
  'does not report an unexpected acknowledgement as a successful annotation update',
  async response => {
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce({ status: { allowed: true } })
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(response);
    await expect(
      executeMutation(
        prepareValidationExclusions(target, '', original),
        false,
        new AbortController().signal
      )
    ).rejects.toThrow(/reload before any further operation/);
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
  }
);
