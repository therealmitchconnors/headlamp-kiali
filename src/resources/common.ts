import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { isRecord } from '../core/object';

const { KubeObject } = K8s.cluster;

export interface ConfigurationObject<
  Spec extends object = Record<string, unknown>,
  Status extends Record<string, unknown> = Record<string, unknown>
> extends KubeObjectInterface {
  spec?: Spec;
  status?: Status;
}

export class ConfigurationResource<
  Spec extends object = object,
  Status extends Record<string, unknown> = Record<string, unknown>
> extends KubeObject<ConfigurationObject<Spec, Status>> {
  static isNamespaced = true;

  get spec(): Spec | undefined {
    return this.jsonData.spec;
  }
  get status(): Status | undefined {
    return this.jsonData.status;
  }

  get specFields(): [string, unknown][] {
    return isRecord(this.spec) ? Object.entries(this.spec) : [];
  }

  get statusFields(): [string, unknown][] {
    return isRecord(this.status)
      ? Object.entries(this.status)
          .filter(([key]) => key !== 'conditions')
          .map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.map(item =>
                  isRecord(item) && 'conditions' in item
                    ? Object.fromEntries(
                        Object.entries(item).filter(([name]) => name !== 'conditions')
                      )
                    : item
                )
              : value,
          ])
      : [];
  }

  get conditions(): unknown {
    if (!this.status) return undefined;
    const groups = Object.entries(this.status).flatMap(([key, value]) => {
      if (!Array.isArray(value)) return [];
      const entries = value.flatMap((item: unknown, index) =>
        isRecord(item) && 'conditions' in item
          ? [
              {
                path: `status.${key}[${index}]`,
                ...Object.fromEntries(
                  Object.entries(item).filter(([name]) =>
                    ['name', 'parentRef', 'controllerName', 'ancestorRef', 'conditions'].includes(
                      name
                    )
                  )
                ),
              },
            ]
          : []
      );
      return entries.length ? [[key, entries]] : [];
    });
    return groups.length
      ? {
          ...(this.status.conditions === undefined ? {} : { conditions: this.status.conditions }),
          ...Object.fromEntries(groups),
        }
      : this.status.conditions;
  }

  get reportedGeneration(): unknown {
    return this.status?.observedGeneration;
  }

  /** Printer paths are structural reads only; never evaluate schema-provided code. */
  printerValue(path: string): string {
    if (!/^\.(spec|status)\./.test(path) || path.length > 512) return '-';
    let remaining = path;
    let values: unknown[] = [this.jsonData];
    while (remaining) {
      const field = remaining.match(/^\.([A-Za-z0-9_]+)/);
      const wildcard = remaining.startsWith('[*]');
      const filter = remaining.match(/^\[\?\(@\.([A-Za-z0-9_]+)==["']([^"']*)["']\)\]/);
      if (field) {
        values = values.map(value =>
          Array.isArray(value) && field[1] === 'length'
            ? value.length
            : isRecord(value) && Object.prototype.hasOwnProperty.call(value, field[1])
            ? value[field[1]]
            : undefined
        );
        remaining = remaining.slice(field[0].length);
      } else if (wildcard || filter) {
        values = values
          .flatMap(value => (Array.isArray(value) ? value : []))
          .filter(
            value =>
              !filter ||
              (isRecord(value) &&
                Object.prototype.hasOwnProperty.call(value, filter[1]) &&
                value[filter[1]] === filter[2])
          );
        remaining = remaining.slice(filter ? filter[0].length : 3);
      } else return '-';
    }
    const value = values.length === 1 ? values[0] : values;
    if (Array.isArray(value)) {
      return (
        value
          .map(value =>
            typeof value === 'string' || typeof value === 'number' ? String(value) : ''
          )
          .filter(Boolean)
          .join(', ') || '-'
      );
    }
    if (isRecord(value) && Object.values(value).every(item => typeof item === 'string')) {
      return (
        Object.entries(value)
          .map(([key, item]) => `${key}=${item}`)
          .join(', ') || '-'
      );
    }
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '-';
  }
}

export type ConfigurationResourceClass = typeof ConfigurationResource<object>;
