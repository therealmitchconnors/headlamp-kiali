import { EditableHttpRoute, editableHttpRoutes, RouteEditMode } from './httpRouteBehavior';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export interface MirrorTargetDraft {
  host: string;
  subset: string;
  port: string;
  percentage: string;
}
export interface HttpMirroringDraft extends MirrorTargetDraft {
  routeIndex: number;
  mode: RouteEditMode;
}

export function initialHttpMirroring(route?: EditableHttpRoute): HttpMirroringDraft {
  const value = route?.value ?? {};
  const first = Array.isArray(value.mirrors) && isRecord(value.mirrors[0]) ? value.mirrors[0] : {};
  const legacy = isRecord(value.mirror);
  const destination = isRecord(value.mirror)
    ? value.mirror
    : isRecord(first.destination)
    ? first.destination
    : {};
  const percentage = legacy
    ? isRecord(value.mirrorPercentage)
      ? value.mirrorPercentage.value
      : value.mirrorPercent ?? value.mirror_percent
    : isRecord(first.percentage)
    ? first.percentage.value
    : undefined;
  const text = (value: unknown, fallback = '') =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
  return {
    routeIndex: route?.index ?? -1,
    mode: 'keep',
    host: text(destination.host),
    subset: text(destination.subset),
    port: text(isRecord(destination.port) ? destination.port.number : undefined),
    percentage: text(percentage, '100'),
  };
}

export function mirrorTarget(draft: MirrorTargetDraft): {
  mirror: { host: string; subset?: string; port?: { number: number } };
  mirrorPercentage: { value: number };
} {
  if (!isDnsSubdomain(draft.host))
    throw new Error('Mirror host must be a DNS name without a wildcard, scheme or path');
  if (draft.subset && !isDnsLabel(draft.subset))
    throw new Error('Mirror subset must be a DNS label, or blank for no subset');
  const port = draft.port === '' ? undefined : Number(draft.port);
  if (
    port !== undefined &&
    (!/^[0-9]+$/.test(draft.port) ||
      draft.port.trim() !== draft.port ||
      draft.port.length > 5 ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535)
  )
    throw new Error('Mirror port must be an integer from 1 to 65535, or blank');
  const percentage = Number(draft.percentage);
  if (
    draft.percentage.length > 32 ||
    !/^[0-9]+(?:\.[0-9]+)?$/.test(draft.percentage) ||
    draft.percentage.trim() !== draft.percentage ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  )
    throw new Error('Mirror percentage must be a decimal number from 0 to 100');
  return {
    mirror: {
      host: draft.host,
      ...(draft.subset ? { subset: draft.subset } : {}),
      ...(port === undefined ? {} : { port: { number: port } }),
    },
    mirrorPercentage: { value: percentage },
  };
}

export function planHttpMirroring(
  spec: unknown,
  draft: HttpMirroringDraft
): { spec: Record<string, unknown>; index: number } {
  if (draft.mode !== 'set' && draft.mode !== 'remove')
    throw new Error('Choose to replace or remove HTTP mirroring');
  const selected = editableHttpRoutes(spec).find(route => route.index === draft.routeIndex);
  if (!isRecord(spec) || !Array.isArray(spec.http) || !selected)
    throw new Error('Select an existing HTTP forwarding route');
  const route = { ...selected.value };
  delete route.mirrors;
  delete route.mirrorPercent;
  delete route.mirror_percent;
  if (draft.mode === 'set') {
    const target = mirrorTarget(draft);
    // Keep existing key order so equivalent destinations are not counted as edits.
    const previous = isRecord(route.mirror) ? route.mirror : {};
    const mirror = { ...previous, ...target.mirror };
    if (!target.mirror.subset) delete mirror.subset;
    if (!target.mirror.port) delete mirror.port;
    else
      mirror.port = {
        ...(isRecord(previous.port) ? previous.port : {}),
        ...target.mirror.port,
      };
    route.mirror = mirror;
    route.mirrorPercentage = {
      ...(isRecord(route.mirrorPercentage) ? route.mirrorPercentage : {}),
      ...target.mirrorPercentage,
    };
  } else {
    delete route.mirror;
    delete route.mirrorPercentage;
  }
  if (JSON.stringify(route) === JSON.stringify(selected.value))
    throw new Error('The selected HTTP route would not change');
  return {
    index: selected.index,
    spec: {
      ...spec,
      http: spec.http.map((value, index) => (index === selected.index ? route : value)),
    },
  };
}
