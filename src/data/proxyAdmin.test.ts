import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { DiagnosticPod } from '../core/diagnostics';
import { clusterScope } from '../core/scope';
import { loadDiagnosticPod } from './diagnostics';
import { loadProxySnapshot } from './proxyAdmin';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { stream: vi.fn() } }));
vi.mock('./diagnostics', () => ({ loadDiagnosticPod: vi.fn() }));
const pod: DiagnosticPod = {
  name: 'reviews',
  namespace: 'bookinfo',
  uid: 'uid',
  containers: [
    { name: 'istio-proxy', type: 'init', nativeSidecar: true, ready: true, restarts: 0 },
  ],
};
let message: (value: unknown) => void;
let fail: () => void;
const send = vi.fn();
const cancel = vi.fn();
const socket: WebSocket = {
  protocol: 'v4.channel.k8s.io',
  send,
  binaryType: 'arraybuffer',
  bufferedAmount: 0,
  extensions: '',
  onclose: null,
  onerror: null,
  onmessage: null,
  onopen: null,
  readyState: 1,
  url: 'ws://synthetic.invalid',
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
};
const getSocket = vi.fn((): WebSocket | null => socket);
const encode = (value: string) => new TextEncoder().encode(value);
function frame(channel: number, data: Uint8Array) {
  const result = new Uint8Array(data.length + 1);
  result[0] = channel;
  result.set(data, 1);
  message(result.buffer);
}
function greet(channel = 0) {
  frame(channel, new Uint8Array([152, 58]));
}
function reply(body = '{"version":"test","state":"LIVE"}') {
  frame(
    0,
    encode(
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${
        encode(body).length
      }\r\n\r\n${body}`
    )
  );
}
async function start(
  read: 'configuration' | 'server-info' = 'server-info',
  controller = new AbortController()
) {
  const pending = loadProxySnapshot(clusterScope('alpha'), pod, read, controller.signal);
  await vi.waitFor(() => expect(ApiProxy.stream).toHaveBeenCalled());
  return { pending, controller };
}
beforeEach(() => {
  vi.useRealTimers();
  send.mockReset();
  cancel.mockReset();
  getSocket.mockReset().mockReturnValue(socket);
  vi.mocked(loadDiagnosticPod).mockReset().mockResolvedValue(pod);
  vi.mocked(ApiProxy.stream)
    .mockReset()
    .mockImplementation((_path, callback, options) => {
      message = callback;
      fail = options.failCb!;
      return { cancel, getSocket };
    });
});
afterEach(() => {
  vi.useRealTimers();
});
it.each(['server-info', 'configuration'] as const)(
  'uses only the fixed %s GET, explicit cluster and no reconnect',
  async read => {
    const { pending } = await start(read);
    greet(1);
    greet();
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0];
    expect(request[0]).toBe(0);
    expect(new TextDecoder().decode(request.subarray(1))).toBe(
      `GET /${
        read === 'server-info' ? 'server_info' : 'config_dump'
      } HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept: application/json\r\nAccept-Encoding: identity\r\n\r\n`
    );
    reply();
    const result = await pending;
    expect(result.data).toEqual({ version: 'test', state: 'LIVE' });
    expect(result.restartVerified).toBe(true);
    expect(ApiProxy.stream).toHaveBeenCalledWith(
      '/api/v1/namespaces/bookinfo/pods/reviews/portforward?ports=15000',
      expect.any(Function),
      expect.objectContaining({
        cluster: 'alpha',
        isJson: false,
        additionalProtocols: ['v4.channel.k8s.io'],
        reconnectOnFailure: false,
      })
    );
    expect(loadDiagnosticPod).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalled();
    reply();
    expect(send).toHaveBeenCalledTimes(1);
  }
);
it.each(['channel', 'port', 'frame', 'error', 'close', 'protocol', 'http'] as const)(
  'rejects %s failures and closes',
  async kind => {
    const { pending } = await start();
    const assertion = expect(pending).rejects.toThrow();
    if (kind === 'channel') frame(2, new Uint8Array());
    if (kind === 'port') frame(0, new Uint8Array([80, 0]));
    if (kind === 'frame') message('text');
    if (kind === 'error') {
      greet(1);
      frame(1, encode('synthetic denial'));
    }
    if (kind === 'close') fail();
    if (kind === 'protocol') {
      getSocket.mockReturnValue({ ...socket, protocol: 'base64.binary.k8s.io' });
      greet();
    }
    if (kind === 'http') {
      greet();
      frame(0, encode('HTTP/1.1 503 Unavailable\r\n\r\n'));
    }
    await assertion;
    expect(cancel).toHaveBeenCalled();
    expect(loadDiagnosticPod).toHaveBeenCalledTimes(1);
  }
);
it('suppresses cancelled reads, closes a late socket even without messages and never sends', async () => {
  vi.useFakeTimers();
  getSocket.mockReturnValue(null);
  const { pending, controller } = await start();
  const assertion = expect(pending).rejects.toThrow();
  controller.abort();
  await assertion;
  const cancelledBeforeSocket = cancel.mock.calls.length;
  getSocket.mockReturnValue(socket);
  await vi.advanceTimersByTimeAsync(50);
  expect(cancel.mock.calls.length).toBeGreaterThan(cancelledBeforeSocket);
  greet();
  expect(send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds delayed reads including identity checks to 15 seconds', async () => {
  vi.useFakeTimers();
  const { pending } = await start();
  const assertion = expect(pending).rejects.toThrow('exceeded 15 seconds');
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(cancel).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['uid', 'restart', 'container'])('rejects a changed %s after the response', async kind => {
  const changed: DiagnosticPod = {
    ...pod,
    uid: kind === 'uid' ? 'replacement' : pod.uid,
    containers:
      kind === 'container' ? [] : [{ ...pod.containers[0], restarts: kind === 'restart' ? 1 : 0 }],
  };
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce(pod).mockResolvedValueOnce(changed);
  const { pending } = await start();
  greet();
  reply();
  await expect(pending).rejects.toThrow('changed');
});
it('blocks replacements, absent proxies and pre-cancelled work before any stream', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadProxySnapshot(clusterScope('alpha'), pod, 'server-info', controller.signal)
  ).rejects.toThrow();
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce({ ...pod, uid: 'replacement' });
  await expect(
    loadProxySnapshot(clusterScope('alpha'), pod, 'configuration', new AbortController().signal)
  ).rejects.toThrow('replaced');
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce({ ...pod, containers: [] });
  await expect(
    loadProxySnapshot(clusterScope('alpha'), pod, 'configuration', new AbortController().signal)
  ).rejects.toThrow('required');
  expect(ApiProxy.stream).not.toHaveBeenCalled();
});
it('closes a synchronously failed connection after its handle is returned without recursion', async () => {
  vi.mocked(ApiProxy.stream).mockImplementation((_path, _callback, options) => {
    cancel.mockImplementation(() => options.failCb?.());
    options.failCb?.();
    return { cancel, getSocket };
  });
  await expect(
    loadProxySnapshot(clusterScope('alpha'), pod, 'server-info', new AbortController().signal)
  ).rejects.toThrow('refused');
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('also applies the deadline to a blocked initial pod read', async () => {
  vi.useFakeTimers();
  vi.mocked(loadDiagnosticPod).mockImplementation(
    (_scope, _namespace, _name, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      })
  );
  const pending = loadProxySnapshot(
    clusterScope('alpha'),
    pod,
    'configuration',
    new AbortController().signal
  );
  const assertion = expect(pending).rejects.toThrow('exceeded 15 seconds');
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(ApiProxy.stream).not.toHaveBeenCalled();
});
it.each([
  ['server-info', 262145],
  ['configuration', 4194305],
] as const)('enforces the actual %s byte bound', async (read, length) => {
  const { pending } = await start(read);
  greet();
  frame(
    0,
    encode(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`)
  );
  await expect(pending).rejects.toThrow('byte limit');
  expect(cancel).toHaveBeenCalled();
});
it('cleans up synchronous SDK failures without leaving timers', async () => {
  vi.useFakeTimers();
  vi.mocked(ApiProxy.stream).mockImplementation(() => {
    throw new Error('synthetic SDK failure');
  });
  await expect(
    loadProxySnapshot(clusterScope('alpha'), pod, 'configuration', new AbortController().signal)
  ).rejects.toThrow('synthetic SDK failure');
  expect(vi.getTimerCount()).toBe(0);
});
it('reports a host setup timeout, then closes on a very late frame without sending', async () => {
  vi.useFakeTimers();
  getSocket.mockReturnValue(null);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { pending } = await start();
    const assertion = expect(pending).rejects.toThrow('exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('did not expose a proxy socket'));
    getSocket.mockReturnValue(socket);
    greet();
    expect(cancel.mock.calls.length).toBeGreaterThan(1);
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    warning.mockRestore();
  }
});
it('reads a named ztunnel container through the same fixed GET and rechecks that exact container', async () => {
  const ztunnel: DiagnosticPod = {
    ...pod,
    containers: [{ ...pod.containers[0], name: 'ztunnel', type: 'regular', nativeSidecar: false }],
  };
  vi.mocked(loadDiagnosticPod).mockResolvedValue(ztunnel);
  const pending = loadProxySnapshot(
    clusterScope('alpha'),
    ztunnel,
    'ztunnel-configuration',
    new AbortController().signal
  );
  await vi.waitFor(() => expect(ApiProxy.stream).toHaveBeenCalled());
  greet();
  reply('{"services":[],"workloads":[]}');
  expect((await pending).data).toEqual({ services: [], workloads: [] });
  expect(new TextDecoder().decode(send.mock.calls[0][0].subarray(1))).toMatch(
    /^GET \/config_dump HTTP\/1\.1\r\n/
  );
  expect(loadDiagnosticPod).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalled();
});
it('rejects ztunnel replacement or format misuse without attributing another container', async () => {
  const ztunnel: DiagnosticPod = {
    ...pod,
    containers: [{ ...pod.containers[0], name: 'ztunnel' }],
  };
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce(ztunnel).mockResolvedValueOnce(pod);
  const pending = loadProxySnapshot(
    clusterScope('alpha'),
    ztunnel,
    'ztunnel-configuration',
    new AbortController().signal
  );
  await vi.waitFor(() => expect(ApiProxy.stream).toHaveBeenCalled());
  greet();
  reply('{"services":[],"workloads":[]}');
  await expect(pending).rejects.toThrow('changed');
  vi.mocked(ApiProxy.stream).mockClear();
  vi.mocked(loadDiagnosticPod).mockResolvedValue(ztunnel);
  await expect(
    loadProxySnapshot(clusterScope('alpha'), ztunnel, 'server-info', new AbortController().signal)
  ).rejects.toThrow('istio-proxy container is required');
  expect(ApiProxy.stream).not.toHaveBeenCalled();
});
