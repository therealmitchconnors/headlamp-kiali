import rawCatalog from './builtinDashboards.json?raw';
import {
  CustomDashboardSettings,
  CustomDashboardTemplate,
  isDashboardDisabled,
  validateCustomDashboardSettings,
  validateCustomDashboardTemplate,
  validateDashboardCatalog,
} from './customDashboards';
import { isRecord } from './object';

export const BUILTIN_DASHBOARD_SOURCE = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  blob: 'cbbc6cd2ac7834b117fb11e61af613d92016b30f',
} as const;
export type DashboardOrigin = 'builtin' | 'custom';

export function builtinDashboardTemplates(): CustomDashboardTemplate[] {
  const document: unknown = JSON.parse(rawCatalog);
  if (
    !isRecord(document) ||
    document.version !== BUILTIN_DASHBOARD_SOURCE.version ||
    document.commit !== BUILTIN_DASHBOARD_SOURCE.commit ||
    document.sourceBlob !== BUILTIN_DASHBOARD_SOURCE.blob ||
    !Array.isArray(document.dashboards) ||
    document.dashboards.length !== 21
  )
    throw new Error('Bundled dashboard catalog does not match the pinned source');
  const templates = document.dashboards.map(validateCustomDashboardTemplate);
  if (JSON.stringify(templates).length > 65536)
    throw new Error('Bundled dashboard catalog exceeds 64 KiB');
  return validateDashboardCatalog(templates);
}

export function effectiveDashboardCatalog(settings: CustomDashboardSettings): {
  templates: CustomDashboardTemplate[];
  origins: ReadonlyMap<string, DashboardOrigin>;
  disabled: string[];
} {
  const saved = validateCustomDashboardSettings(settings);
  const customNames = new Set(saved.dashboards.map(template => template.name));
  const bundled = saved.includeBuiltins
    ? builtinDashboardTemplates().filter(template => !customNames.has(template.name))
    : [];
  const templates = validateDashboardCatalog([...saved.dashboards, ...bundled]);
  const origins = new Map<string, DashboardOrigin>(
    templates.map(template => [
      template.name,
      customNames.has(template.name) ? 'custom' : 'builtin',
    ])
  );
  const disabled = saved.dashboards.filter(isDashboardDisabled).map(template => template.name);
  return { templates, origins, disabled };
}
