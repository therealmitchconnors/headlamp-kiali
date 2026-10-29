import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  DetailsGrid,
  Link,
  ResourceListView,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { ConfigurationReference, configurationReferences } from '../../core/configuration';
import { ConfigurationResource } from '../../resources/common';
import { ConfigurationDefinition, configurationDefinitions } from '../../resources/registry';
import ClusterScope from '../ClusterScope';
import ConfigurationActions from './ConfigurationActions';
import ConfigurationGate from './ConfigurationGate';
import StructuredValue from './StructuredValue';
import Validation from './Validation';
import WorkloadGroupEntries from './WorkloadGroupEntries';

const REFERENCE_ROUTES: Partial<Record<ConfigurationReference['kind'], string>> = {
  Service: 'service',
  Secret: 'secret',
  ConfigMap: 'configmap',
  Namespace: 'namespace',
};

function References({ resource }: { resource: ConfigurationResource }) {
  const { t } = useTranslation();
  const references = configurationReferences(
    resource.kind,
    resource.spec,
    resource.metadata.namespace ?? '',
    resource.jsonData.apiVersion?.split('/')[0]
  );
  if (!references.length) return null;
  return (
    <SectionBox title={t('Configuration references')}>
      <Typography variant="body2">
        {t(
          'These are explicit configuration references, not verified endpoints or measured traffic. Wildcard and external hosts are not mapped to Kubernetes Services.'
        )}
      </Typography>
      <SimpleTable
        data={references}
        columns={[
          { label: t('Kind'), getter: (ref: ConfigurationReference) => ref.kind },
          {
            label: t('Reference'),
            getter: (ref: ConfigurationReference) => (
              <Link
                routeName={
                  REFERENCE_ROUTES[ref.kind] ??
                  configurationDefinitions.find(
                    definition =>
                      definition.kind === ref.kind &&
                      definition.group === (ref.group ?? 'networking.istio.io')
                  )?.resourceClass.detailsRoute
                }
                activeCluster={resource.cluster}
                params={{ name: ref.name, ...(ref.namespace ? { namespace: ref.namespace } : {}) }}
              >
                {ref.namespace ? `${ref.namespace}/${ref.name}` : ref.name}
              </Link>
            ),
          },
          { label: t('Field'), getter: (ref: ConfigurationReference) => ref.path },
          { label: t('Subset'), getter: (ref: ConfigurationReference) => ref.subset ?? '-' },
          { label: t('Section'), getter: (ref: ConfigurationReference) => ref.sectionName ?? '-' },
        ]}
      />
    </SectionBox>
  );
}

export function configurationDetailSections(resource: ConfigurationResource) {
  return [
    { id: 'kiali-config-references', section: <References resource={resource} /> },
    ...(resource.kind === 'WorkloadGroup' &&
    resource.jsonData.apiVersion?.split('/')[0] === 'networking.istio.io'
      ? [
          {
            id: 'kiali-config-workload-entries',
            section: (
              <WorkloadGroupEntries
                key={JSON.stringify([
                  resource.cluster,
                  resource.metadata.namespace,
                  resource.metadata.name,
                  resource.metadata.uid,
                  resource.metadata.resourceVersion,
                  resource.specFields.find(([name]) => name === 'metadata')?.[1],
                ])}
                resource={resource}
              />
            ),
          },
        ]
      : []),
    { id: 'kiali-config-validation', section: <Validation resource={resource} /> },
    ...resource.specFields.map(([name, value]) => ({
      id: `kiali-config-spec-${name}`,
      section: (
        <SectionBox title={name}>
          <StructuredValue value={value} />
        </SectionBox>
      ),
    })),
    ...resource.statusFields.map(([name, value]) => ({
      id: `kiali-config-status-${name}`,
      section: (
        <SectionBox title={`status.${name}`}>
          <StructuredValue value={value} />
        </SectionBox>
      ),
    })),
    {
      id: 'kiali-config-conditions',
      section: <ConditionSection value={resource.conditions} />,
    },
  ];
}

function ConditionSection({ value }: { value: unknown }) {
  const { t } = useTranslation();
  return value === undefined ? null : (
    <SectionBox title={t('Conditions')}>
      <StructuredValue value={value} />
    </SectionBox>
  );
}

function KindPicker({
  definition,
  cluster,
}: {
  definition: ConfigurationDefinition;
  cluster: string;
}) {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  return (
    <SectionBox title={t('Mesh configuration')} headerProps={{ headerStyle: 'main' }}>
      <TextField
        select
        label={t('Configuration kind')}
        value={definition.id}
        sx={{ minWidth: 260 }}
        onChange={event => {
          const selected = configurationDefinitions.find(entry => entry.id === event.target.value);
          if (selected)
            history.push({
              pathname: `/c/${encodeURIComponent(cluster)}/kiali/configuration/${selected.id}`,
              search: location.search,
            });
        }}
      >
        {configurationDefinitions.map(entry => (
          <MenuItem key={entry.id} value={entry.id}>
            {entry.label}
          </MenuItem>
        ))}
      </TextField>
      <Alert severity="info" sx={{ mt: 2 }}>
        {t(
          'Configuration changes require permission checks, server dry-run and explicit confirmation. Reported status is not a mesh-health or semantic-validation guarantee.'
        )}
      </Alert>
    </SectionBox>
  );
}

export function ConfigurationList({ definition }: { definition: ConfigurationDefinition }) {
  const { t } = useTranslation();
  const [refresh, setRefresh] = useState(0);
  return (
    <ClusterScope>
      {scope => (
        <div key={scope.cluster}>
          <KindPicker definition={definition} cluster={scope.cluster} />
          <ConfigurationGate cluster={scope.cluster} definition={definition}>
            {resourceClass => (
              <>
                <ConfigurationActions
                  definition={definition}
                  apiVersion={String(resourceClass.apiVersion)}
                  cluster={scope.cluster}
                  onChanged={() => setRefresh(value => value + 1)}
                />
                <ResourceListView
                  key={refresh}
                  id={`kiali-config-${definition.id}`}
                  title={definition.label}
                  resourceClass={resourceClass}
                  enableRowActions={false}
                  enableRowSelection={false}
                  headerProps={{ titleSideActions: [], headerStyle: 'subsection' }}
                  columns={[
                    {
                      id: 'name',
                      label: t('Name'),
                      getValue: item => item.metadata.name,
                      render: item => (
                        <Link
                          routeName={definition.resourceClass.detailsRoute}
                          activeCluster={item.cluster}
                          params={{
                            name: item.metadata.name,
                            ...(resourceClass.isNamespaced
                              ? { namespace: item.metadata.namespace }
                              : {}),
                          }}
                        >
                          {item.metadata.name}
                        </Link>
                      ),
                    },
                    ...(resourceClass.isNamespaced ? ['namespace' as const] : []),
                    ...definition.columns.map(column => ({
                      id: column.path,
                      label: column.name,
                      show: column.show,
                      getValue: (item: ConfigurationResource) => item.printerValue(column.path),
                    })),
                    'age',
                  ]}
                />
              </>
            )}
          </ConfigurationGate>
        </div>
      )}
    </ClusterScope>
  );
}

export function ConfigurationDetail({
  definition,
  name: nameProp,
  namespace: namespaceProp,
}: {
  definition: ConfigurationDefinition;
  name?: string;
  namespace?: string;
}) {
  const { t } = useTranslation();
  const params = useParams<{ name: string; namespace: string }>();
  const [refresh, setRefresh] = useState(0);
  const name = nameProp ?? params.name;
  const namespace = definition.resourceClass.isNamespaced
    ? namespaceProp ?? params.namespace
    : undefined;
  return (
    <ClusterScope>
      {scope => (
        <ConfigurationGate key={scope.cluster} cluster={scope.cluster} definition={definition}>
          {resourceType =>
            name && (!resourceType.isNamespaced || namespace) ? (
              <DetailsGrid
                key={refresh}
                resourceType={resourceType}
                name={name}
                namespace={namespace}
                cluster={scope.cluster}
                noDefaultActions
                withEvents
                actions={item =>
                  item
                    ? [
                        <ConfigurationActions
                          key={`${scope.cluster}/${namespace}/${name}`}
                          definition={definition}
                          apiVersion={item.jsonData.apiVersion ?? String(resourceType.apiVersion)}
                          cluster={scope.cluster}
                          resource={item}
                          onChanged={() => setRefresh(value => value + 1)}
                        />,
                      ]
                    : []
                }
                extraInfo={item =>
                  item
                    ? [
                        { name: t('API version'), value: item.jsonData.apiVersion },
                        {
                          name: t('Reported generation'),
                          value: <StructuredValue value={item.reportedGeneration} />,
                        },
                      ]
                    : []
                }
                extraSections={item => (item ? configurationDetailSections(item) : [])}
              />
            ) : (
              <Alert severity="error">{t('A resource name and namespace are required.')}</Alert>
            )
          }
        </ConfigurationGate>
      )}
    </ClusterScope>
  );
}

export default function Configuration() {
  return <ConfigurationList definition={configurationDefinitions[0]} />;
}
