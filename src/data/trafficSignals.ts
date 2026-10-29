import { ServiceEndpoint } from '../core/config';
import { ClusterScope } from '../core/scope';
import { decodeTrafficSignal, SignalQuery, trafficSignalQueries } from '../core/trafficSignals';
import { loadMetricRanges } from './metricRanges';

export async function loadTrafficSignals(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: SignalQuery,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const captured = structuredClone(query);
  return loadMetricRanges(
    scope,
    endpoint,
    captured,
    trafficSignalQueries(captured),
    signal,
    decodeTrafficSignal,
    'Traffic signal reads exceeded 15 seconds'
  );
}
