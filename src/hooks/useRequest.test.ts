import { act, renderHook, waitFor } from '@testing-library/react';
import { useRequest } from './useRequest';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

describe('scope-bound request lifecycle', () => {
  it('never displays a previous cluster result while the new one loads', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loadFirst = vi.fn(() => first.promise);
    const loadSecond = vi.fn(() => second.promise);
    const { result, rerender } = renderHook(({ key, load }) => useRequest(key, load), {
      initialProps: { key: 'alpha', load: loadFirst },
    });
    await act(async () => first.resolve('alpha data'));
    expect(result.current).toEqual({ status: 'ready', data: 'alpha data' });
    rerender({ key: 'beta', load: loadSecond });
    expect(result.current).toEqual({ status: 'loading' });
    await act(async () => second.resolve('beta data'));
    expect(result.current).toEqual({ status: 'ready', data: 'beta data' });
  });

  it('ignores a late resolution even when the transport does not honour abort', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loadFirst = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return first.promise;
    });
    const loadSecond = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return second.promise;
    });
    const { result, rerender, unmount } = renderHook(({ key, load }) => useRequest(key, load), {
      initialProps: { key: 'alpha', load: loadFirst },
    });
    rerender({ key: 'beta', load: loadSecond });
    expect(loadFirst.mock.calls[0][0].aborted).toBe(true);
    await act(async () => second.resolve('beta data'));
    await act(async () => first.resolve('late alpha data'));
    expect(result.current).toEqual({ status: 'ready', data: 'beta data' });
    unmount();
    expect(loadSecond.mock.calls[0][0].aborted).toBe(true);
  });

  it('surfaces failures and clears them for a new request', async () => {
    const denied = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const success = vi.fn().mockResolvedValue('ok');
    const { result, rerender } = renderHook(({ key, load }) => useRequest<string>(key, load), {
      initialProps: { key: 'one', load: denied },
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({
      status: 'error',
      error: { kind: 'forbidden', status: 403, message: 'Forbidden' },
    });
    rerender({ key: 'two', load: success });
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', data: 'ok' }));
  });
});
