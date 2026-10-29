import { decodeAggregatedRange, validateMetricRange } from './metricRanges';
import { metricSelector, trafficMetricLabels, TrafficQuery } from './telemetry';

export const TRAFFIC_SIGNALS = {
  request_throughput: { metric: 'istio_request_bytes_sum', unit: 'bytes/s' },
  response_throughput: { metric: 'istio_response_bytes_sum', unit: 'bytes/s' },
  grpc_sent: { metric: 'istio_request_messages_total', unit: 'messages/s' },
  grpc_received: { metric: 'istio_response_messages_total', unit: 'messages/s' },
  // Pinned Kiali compensates for Istio's reversed L4 counter-direction names.
  tcp_sent: { metric: 'istio_tcp_received_bytes_total', unit: 'bytes/s' },
  tcp_received: { metric: 'istio_tcp_sent_bytes_total', unit: 'bytes/s' },
  tcp_opened: { metric: 'istio_tcp_connections_opened_total', unit: 'connections/s' },
  tcp_closed: { metric: 'istio_tcp_connections_closed_total', unit: 'connections/s' },
} as const;
export type TrafficSignal = keyof typeof TRAFFIC_SIGNALS;
export const TRAFFIC_SIGNAL_KEYS = Object.keys(TRAFFIC_SIGNALS) as TrafficSignal[];
export interface SignalQuery extends TrafficQuery {
  signals: TrafficSignal[];
}
export function trafficSignalQueries(query: SignalQuery) {
  validateMetricRange(query);
  if (
    !Array.isArray(query.signals) ||
    !query.signals.length ||
    query.signals.length > 8 ||
    new Set(query.signals).size !== query.signals.length ||
    query.signals.some(signal => !TRAFFIC_SIGNAL_KEYS.some(key => key === signal))
  )
    throw new Error('Choose 1 to 8 distinct available traffic signals');
  const labels = metricSelector(trafficMetricLabels(query));
  return query.signals.map(signal => ({
    key: signal,
    expression: `sum(rate(${TRAFFIC_SIGNALS[signal].metric}{${labels}}[5m]))`,
  }));
}
export function decodeTrafficSignal(response: unknown, query: SignalQuery) {
  return decodeAggregatedRange(response, query, 'Traffic signal');
}
