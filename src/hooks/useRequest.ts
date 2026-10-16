import { useEffect, useState } from 'react';
import { ReadFailure, readFailure } from '../data/requests';

export type RequestState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ReadFailure };

export function useRequest<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>
): RequestState<T> {
  const [result, setResult] = useState<{ key: string; state: RequestState<T> }>();
  useEffect(() => {
    const controller = new AbortController();
    setResult({ key, state: { status: 'loading' } });
    async function run() {
      try {
        const data = await load(controller.signal);
        if (!controller.signal.aborted) {
          setResult({ key, state: { status: 'ready', data } });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ key, state: { status: 'error', error: readFailure(error) } });
        }
      }
    }
    run();
    return () => controller.abort();
  }, [key, load]);
  return result?.key === key ? result.state : { status: 'loading' };
}
