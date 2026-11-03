import { isRecord } from './object';

export const proxyLogLevels = [
  'off',
  'trace',
  'debug',
  'info',
  'warning',
  'error',
  'critical',
] as const;

export type ProxyLogLevel = (typeof proxyLogLevels)[number];

export interface ProxyLoggerLevel {
  logger: string;
  level: ProxyLogLevel;
}

export interface ProxyLoggingSnapshot {
  cluster: string;
  target: {
    namespace: string;
    pod: string;
    uid: string;
    container: 'istio-proxy';
    restarts: number;
  };
  capturedAt: string;
  loggers: readonly ProxyLoggerLevel[];
}

export interface ProxyLoggingProposal {
  cluster: string;
  target: ProxyLoggingSnapshot['target'];
  capturedAt: string;
  currentLoggers: readonly ProxyLoggerLevel[];
  level: ProxyLogLevel;
}

function isProxyLogLevel(value: unknown): value is ProxyLogLevel {
  return typeof value === 'string' && proxyLogLevels.includes(value as ProxyLogLevel);
}

export function parseProxyLoggerLevels(value: unknown): ProxyLoggerLevel[] {
  if (typeof value !== 'string' || value.length > 262144)
    throw new Error('Proxy logging response is malformed or exceeds 256 KiB');
  const lines = value.split(/\r?\n/);
  if (lines.length > 4097 || lines[0] !== 'active loggers:')
    throw new Error('Proxy logging response has an unsupported format');
  const loggers: ProxyLoggerLevel[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const separator = line.lastIndexOf(': ');
    const logger = line.slice(0, separator);
    const level = line.slice(separator + 2);
    if (
      separator < 1 ||
      logger.length > 256 ||
      logger.trim() !== logger ||
      /[\u0000-\u001f\u007f]/.test(logger) ||
      !isProxyLogLevel(level) ||
      seen.has(logger)
    )
      throw new Error('Proxy logging response contains an invalid or duplicate logger');
    seen.add(logger);
    loggers.push({ logger, level });
  }
  if (!loggers.length) throw new Error('Proxy logging response did not report any loggers');
  return loggers.sort((left, right) => left.logger.localeCompare(right.logger));
}

export function proxyLoggingProposal(
  snapshot: ProxyLoggingSnapshot,
  level: unknown
): ProxyLoggingProposal {
  if (
    !isRecord(snapshot) ||
    typeof snapshot.cluster !== 'string' ||
    !snapshot.cluster.trim() ||
    !isRecord(snapshot.target) ||
    !snapshot.target.namespace ||
    !snapshot.target.pod ||
    !snapshot.target.uid ||
    snapshot.target.container !== 'istio-proxy' ||
    !Number.isSafeInteger(snapshot.target.restarts) ||
    snapshot.target.restarts < 0 ||
    !Array.isArray(snapshot.loggers) ||
    !snapshot.loggers.length ||
    snapshot.loggers.length > 4096 ||
    !isProxyLogLevel(level)
  )
    throw new Error('A captured proxy target and valid current/proposed log levels are required');
  const currentLoggers = parseProxyLoggerLevels(
    `active loggers:\n${snapshot.loggers.map(item => `${item.logger}: ${item.level}`).join('\n')}`
  );
  if (currentLoggers.every(item => item.level === level))
    throw new Error('The selected log level is already active for all proxy loggers');
  return Object.freeze({
    cluster: snapshot.cluster,
    target: Object.freeze({ ...snapshot.target }),
    capturedAt: snapshot.capturedAt,
    currentLoggers: Object.freeze(currentLoggers.map(item => Object.freeze({ ...item }))),
    level,
  });
}

export function proxyLoggingStateMatches(
  first: readonly ProxyLoggerLevel[],
  second: readonly ProxyLoggerLevel[]
): boolean {
  return (
    first.length === second.length &&
    first.every(
      (item, index) =>
        item.logger === second[index]?.logger && item.level === second[index]?.level
    )
  );
}
