import { useCallback, useEffect, useState } from 'react';
import type { ClusterConfig } from '../core/config';

export function useTelemetryQuery<T>(binding: string, settings?: ClusterConfig) {
  const [draft, setDraft] = useState<{ binding: string; identity: string }>();
  const [submitted, setSubmitted] = useState<{
    binding: string;
    query: T;
    settings?: ClusterConfig;
  }>();
  useEffect(() => {
    setDraft(undefined);
    setSubmitted(undefined);
  }, [binding]);
  const setIdentity = useCallback((identity: string) => setDraft({ binding, identity }), [binding]);
  const setQuery = useCallback(
    (query: T | undefined) =>
      setSubmitted(
        query === undefined ? undefined : { binding, query, settings: structuredClone(settings) }
      ),
    [binding, settings]
  );
  return {
    identity: draft?.binding === binding ? draft.identity : settings?.telemetryCluster ?? '',
    setIdentity,
    query: submitted?.binding === binding ? submitted.query : undefined,
    capturedSettings: submitted?.binding === binding ? submitted.settings : undefined,
    setQuery,
  };
}
