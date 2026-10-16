import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import {
  ClusterConfig,
  ConfigurationError,
  KialiConfig,
  readConfig,
  updateClusterConfig,
} from './core/config';

export const configStore = new ConfigStore<KialiConfig>('kiali');
const useStoredConfig = configStore.useConfig();

export function useKialiConfig() {
  const stored = useStoredConfig();
  return useMemo(() => readConfig(stored), [stored]);
}

export function saveClusterConfig(cluster: string, settings: ClusterConfig) {
  const current = readConfig(configStore.get());
  if (current.valid === false) {
    throw new ConfigurationError(current.message);
  }
  configStore.set(updateClusterConfig(current.config, cluster, settings));
}
