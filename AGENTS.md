# AGENTS.md

This file provides guidance for AI coding agents working on this Headlamp plugin.

## Implementation Handoff

Read [PLAN.md](PLAN.md) before continuing the native Kiali port. It records the
current checkpoints, handoff work, completed milestones, remaining
dependencies, next task, test environment and compatibility constraints.
Keep it current alongside [docs/parity.md](docs/parity.md); do not assume access
to the original agent's conversation, session files or task database.

## Kiali Project Skills

The repository root is the Kiali plugin directory. Skills are in
`.github/skills/<name>/SKILL.md`; read the relevant workflow when a task matches.
Use `create-crd-plugin` only for an explicitly requested full CRD-plugin buildout,
not for routine scaffold setup or small changes. For maintenance, use the focused
skills: `define-resource`, `add-list-view`, `add-detail-view`, `add-settings`,
`run-and-verify`, and `document-plugin`. The README lists all 11 extracted skills
and their pinned upstream source.

The skill files are preserved verbatim from a Claude Code harness. For Copilot:

- References to `CLAUDE.md` mean this `AGENTS.md`; references to `.claude/skills/`
  mean `.github/skills/`.
- `/skill-name` references mean to read and follow the corresponding local
  `SKILL.md`, not to execute a shell command.
- Claude `allowed-tools` metadata is not a permission grant. Use only tools
  actually available in this session, respecting the user's approval boundaries.
- Kubernetes, Helm, and Chrome DevTools MCP tools are not configured by this
  repository. Use available equivalent tools or CLIs, or report a blocked step.
  Never claim live verification without inspecting a running Headlamp instance.
- Confirm the cluster and namespace before mutations, and obtain explicit
  approval for installs, fixture application, or cleanup. Prefer
  `kubectl --context <context> ...` to changing the user's active context.
- Shell working directories do not persist between tool calls. Run commands
  from the plugin root explicitly when needed.
- The pinned 0.14.0 toolchain's `npm start` copies to Headlamp's normal
  `plugins/<name>` directory, not `dev-plugins`. Follow the installed tool's
  actual output; do not assume the upstream skill's installation path or
  hand-create symlinks. Preserve an installed production package when stopping
  a temporary verification watcher.
- SDK declarations can be newer than the running host's resource helpers:
  Headlamp 0.35.0's Service instances lack `getFormattedPorts`. Prefer stable
  resource JSON fields where necessary, and verify new helper calls live.
- Headlamp 0.35.0 also expects CommonComponents `Link.search` to be a string.
  Serialize query parameters with URLSearchParams rather than passing the
  object form accepted by newer SDK declarations.
- The stock host's Select role can differ from the SDK test renderer. Inspect
  the rendered labelled control and form value rather than assuming `combobox`.
- `Link.activeCluster` preserves the currently selected cluster group. For
  navigation from a multi-context comparison to a single-cluster Kiali page,
  pass `params={{ cluster: target }}` instead; otherwise the link can retain
  extra contexts and land on the single-cluster guard.
- ConfigStore persistence is debounced (500 ms in the pinned toolchain).
  A "Settings saved" message is not a storage-flush signal. In browser tests,
  wait until the stored `pluginConfigs.kiali` matches the public
  `new pluginLib.ConfigStore('kiali').get()` value before a hard reload,
  including after restoring test settings. Inspect only Kiali's slice; do not
  modify private Redux state or leave an intercepted fixture endpoint enabled.
- MUI dialogs can be visible while their fade transition is still running.
  Wait for dialog/ancestor opacity to reach 1, or disable screenshot animations,
  before diagnosing a transparent dialog from an image.
- Headlamp 0.35's native Map source picker populates asynchronously. Wait for
  Custom Resources before selecting the Kiali group; otherwise source indexes
  can shift. Click a leaf checkbox and wait for its checked state rather than
  assuming an immediate update; close both nested popovers before graph actions.
  Its edge renderer does not display captions despite newer SDK `label` types.
  Horizontal SVG paths can have zero-height boxes: verify connected path geometry
  and computed stroke/opacity after layout, plus the screenshot. The host's
  unnamed source-picker checkboxes remain an accessibility limitation.
- Monaco reviews load asynchronously. Before capturing them, wait for the
  expected editor text and `document.fonts.ready`, not just the dialog title
  or dry-run success message. Check the review's read-only state as well.
- For raw Pod logs, use public `ApiProxy.request` with `isJSON: false` and
  `Accept: */*`, then bound the returned Response stream. An exclusive
  `Accept: text/plain` produced HTTP 406 on the verification cluster even though
  the successful response is plaintext.
- Do not include an unstable translation function in an async loader's
  dependency list merely to format result text. Translate stored failure data
  during rendering; otherwise rerenders can continuously restart requests.
- `src/resources/schema-types.ts`, the per-kind resource classes and registry
  are generated from `test-files/configuration/schemas.json` and
  `gateway-schemas.json`. Gateway schemas are pinned upstream sources matching
  Kiali's dependencies, not captured from an installed Gateway API. Use
  `npm run resources:generate` / `resources:check`; do not hand-edit them.
- Configuration identities include API group and scope. Istio Gateway and Gateway
  API Gateway have distinct classes/routes. GatewayClass is cluster-scoped:
  no namespace in its route, object metadata, API path or authorization review.
- Kubernetes typed-list items can omit `kind` and `apiVersion`. Infer them only
  from a validated list envelope; reject conflicting values when present.
  The reference-validation live check caught this on NamespaceList responses.
- Remounting DetailsGrid does not necessarily invalidate Headlamp's object cache.
  Intercepted writes have no real watch events; use the explicit Reload page
  action when checking their changed data. Do not reach into private query
  caches or bundle a second React Query instance to force updates.
- Mutation dialogs capture a structured clone of the original API object on
  opening. Keep this snapshot immutable; never read a newer resourceVersion
  from a live resource after the user has edited an older specification.
- Create SelfSubjectAccessReviews intentionally omit `resourceAttributes.name`.
  Browser mutation fixtures should recognize the captured group/resource/
  namespace/create scope while separately restricting every intercepted write
  to owned fixture names. Do not send live writes to work around a fixture guard.
- `pr-triage` contains Headlamp-specific commit conventions. Consult this
  repository's actual history and contribution rules instead of assuming those
  conventions apply here.

## Plugin Implementation Rules

- Keep `src/index.tsx` focused on registration using function-style `register*`
  APIs. Put UI in `src/components/`, resource models in `src/resources/`, and
  topology in `src/mapView.tsx`.
- Use Headlamp's `K8s` and `ApiProxy` helpers for cluster access, never direct
  kube-apiserver calls. Reuse Headlamp common components and MUI components.
- Namespace route paths, registration names, and table IDs with `kiali`.
- Import runtime values only from documented externalized library entry points.
  A deep import can type-check but resolve to an undefined Headlamp global at
  runtime. Verify new runtime imports by loading the plugin in Headlamp.
- Translate user-facing prose and give interactive controls accessible names.
- Verify the pinned caller pipeline before enabling a checker, not only its
  helper tests. ServiceEntry and Istio Gateway port-name helpers exist upstream
  but are not enabled by their checkers; do not turn dormant helpers into findings.
- PeerAuthentication checkers exclude every non-null selector, including an
  empty selector. The separate namespace mTLS indicator normalizes empty
  selectors differently. Preserve each caller's semantics.
- The preceding exclusion applies to PeerAuthentication mTLS-pattern checkers,
  not generic KIA0002 selectorless grouping: absent/null/empty selectors all
  participate in the latter. It compares same-namespace policies, regardless of
  mode, and is distinct from workload-overlap KIA0003. RequestAuthentication
  disables both generic multi-match checks in the pinned caller.
- VirtualService KIA1106 imports whole objects when any host matches the
  namespace-wide Sidecar scope, then counts all hosts. Gateway strings remain
  literal: omitted gateways use `no-gateway`, not `mesh`. Duplicate hosts or
  gateways can flag a single object with no peer references. Do not normalize
  these away or generalize its namespace wildcard buckets into DNS glob matching.
- WorkloadGroup entry relationships compare `spec.metadata.labels` to
  WorkloadEntry `spec.labels`, not object metadata or template labels.
  Pinned `FilterWorkloadEntriesBySelector` excludes empty selectors. Do not
  generalize the usual Kubernetes empty-selector-matches-all rule here, treat
  WorkloadEntries as Pods, or use these links as complete workload/account
  validation context or evidence of VM health.
- VM application correlation follows the first matching WorkloadEntry's
  `spec.labels` in captured list order, otherwise group selector labels only
  after a complete entry read. Preserve group UID/resourceVersion separately
  from entry label provenance. Entries are not Pods or ready replicas; VM
  application health and Service routing remain unsupported until their
  respective evidence pipelines are implemented.
- Pinned `buildHTTPMatchRequest` groups headers into one AND alternative, but
  emits URI/scheme/method/authority conditions as separate OR alternatives.
  Do not silently reinterpret the wizard's flat condition list as all-AND.
  An HTTP delegate with no parent match list is not necessarily a catch-all;
  its target may add conditions.
- HTTP match `name`, `ignoreUriCase` and `statPrefix` are not predicates.
  Zero ports, empty scopes/maps/lists and ignored `headers` keys can also leave
  an alternative unconditional. Preserve other fields when editing a condition;
  never turn removal of its final predicate into an implicit catch-all.
- Gateway API collision checks compare exact host/port/protocol and explicit
  address-type/value pairs. The pinned checker excludes equal Gateway names
  even across namespaces; do not silently replace that with UID-based exclusion
  or add wildcard/default-type matching.
- A resolved configuration with no root namespace uses the observed controller
  namespace, following pinned Kiali discovery. Keep that provenance separate
  from raw configuration; never apply this fallback to denied, missing,
  ambiguous or unsupported configuration sources.
- Keep toolchain-owned build configuration intact. Use existing npm scripts.
- Type-check, lint, and build changes. Before claiming runtime behavior works,
  check the actual contribution and browser console in Headlamp; a successful
  build alone is not a live-load check.

## Available Scripts

The following npm scripts are available for development and testing:

- **`npm run format`** - Format code with prettier
- **`npm run lint`** - Lint code with eslint for coding issues
- **`npm run lint-fix`** - Automatically fix linting issues
- **`npm run build`** - Build the plugin for production
- **`npm run tsc`** - Type check code with TypeScript compiler
- **`npm run test`** - Run tests with vitest
- **`npm start`** - Start development server watching for changes
- **`npm run storybook`** - Start Storybook for component development
- **`npm run storybook-build`** - Build static Storybook
- **`npm run i18n`** - Extract translatable strings for internationalization
- **`npm run package`** - Create a tarball of the plugin package

## Plugin Development Resources

### Example Plugins

Explore these example plugins in `node_modules/@kinvolk/headlamp-plugin/examples/` to learn common patterns:

- **activity** - Shows how to add activity tracking and monitoring
- **app-menus** - Demonstrates adding custom menus to the app bar
- **change-logo** - Shows how to customize the Headlamp logo
- **cluster-chooser** - Demonstrates cluster selection UI
- **custom-theme** - Shows how to create custom themes
- **customizing-map** - Demonstrates customizing resource visualization maps
- **details-view** - Shows how to customize resource detail views
- **dynamic-clusters** - Demonstrates dynamic cluster configuration
- **headlamp-events** - Shows how to work with Kubernetes events
- **pod-counter** - Simple example counting pods and displaying in app bar
- **projects** - Demonstrates project/namespace organization
- **resource-charts** - Shows how to add custom charts for resources
- **sidebar** - Demonstrates customizing the sidebar navigation
- **tables** - Shows how to create custom resource tables
- **ui-panels** - Demonstrates adding custom UI panels

### Official Plugins

Check out production-ready plugins in `node_modules/@kinvolk/headlamp-plugin/official-plugins/` for advanced patterns:

#### Using Custom Resource Definitions (CRDs)

- **cert-manager** - Complete CRD integration for cert-manager resources
  - Files: `official-plugins/cert-manager/src/resources/` (certificate.ts, issuer.ts, clusterIssuer.ts, etc.)
  - Shows how to register and display custom resources for certificates, issuers, challenges, and orders
- **flux** - GitOps CRDs for Flux resources
  - Files: `official-plugins/flux/src/` (kustomization, helmrelease, gitrepository resources)
  - Demonstrates working with Flux CRDs for GitOps workflows
- **keda** - Kubernetes Event Driven Autoscaling CRDs
  - Files: `official-plugins/keda/src/resources/` (scaledobject.ts, scaledjob.ts, triggerauthentication.ts)
  - Shows CRD integration for event-driven autoscaling
- **karpenter** - Node provisioning CRDs
  - Files: `official-plugins/karpenter/src/` (NodeClass, EC2NodeClass resources)
  - Demonstrates multiple CRD deployment types (EKS Auto Mode, self-installed)

#### Visualizing Relationships with Maps

- **keda** - Map view showing KEDA resource relationships
  - File: `official-plugins/keda/src/mapView.tsx`
  - Uses edge creation (`makeKubeToKubeEdge`) to visualize connections between ScaledObjects, ScaledJobs, and TriggerAuthentications
  - Shows how to build graph visualizations of resource dependencies

#### Adding Metrics and Charts

- **prometheus** - Advanced charts for workload resources
  - Files: `official-plugins/prometheus/src/components/Chart/`
  - Provides CPU, memory, network, and disk charts using Prometheus metrics
  - Includes specialized charts for Karpenter (KarpenterChart, KarpenterNodeClaimCreationChart)
  - Shows KEDA metrics (KedaActiveJobsChart, KedaScalerMetricsChart, KedaHPAReplicasChart)
  - File: `official-plugins/prometheus/src/request.tsx` for fetching Prometheus data
- **opencost** - Cost metrics and visualization
  - File: `official-plugins/opencost/src/detail.tsx`
  - Uses `recharts` library (AreaChart, CartesianGrid, Tooltip) to display cost data
  - Shows how to fetch and display custom metrics from external services
  - Demonstrates time-series data visualization with stacked area charts

#### Other Advanced Patterns

- **ai-assistant** - AI integration for cluster management
- **app-catalog** - Helm chart catalog powered by ArtifactHub
- **backstage** - Integration with Backstage developer portal

### Key Topics and Examples

#### Adding Items to the App Bar

- **Example:** `pod-counter` - Shows `registerAppBarAction` to add items to top bar
- **File:** `examples/pod-counter/src/index.tsx`

#### Customizing the Sidebar

- **Example:** `sidebar` - Demonstrates `registerSidebarEntry` and `registerSidebarEntryFilter`
- **File:** `examples/sidebar/src/index.tsx`

#### Working with Resource Details

- **Example:** `details-view` - Shows how to customize resource detail pages
- **File:** `examples/details-view/src/index.tsx`

#### Creating Custom Tables

- **Example:** `tables` - Demonstrates custom table implementations
- **File:** `examples/tables/src/index.tsx`

#### Adding Charts and Visualizations

- **Example:** `resource-charts` - Shows how to add custom charts
- **File:** `examples/resource-charts/src/index.tsx`

#### Theme Customization

- **Example:** `custom-theme` - Demonstrates theme customization
- **File:** `examples/custom-theme/src/index.tsx`

#### Internationalization (i18n)

- Use `npm run i18n <locale>` to add new locales (e.g., `npm run i18n es` for Spanish)
- Translation files are in `locales/<locale>/translation.json`
- Use `useTranslation()` hook from `@kinvolk/headlamp-plugin/i18n`

## Development Workflow

1. **Start Development:** Run `npm start` to watch for changes
2. **Make Changes:** Edit files in `src/`
3. **Type Check:** Run `npm run tsc` to check for TypeScript errors
4. **Lint:** Run `npm run lint` to check for code quality issues
5. **Format:** Run `npm run format` to format code
6. **Test:** Run `npm run test` to run tests
7. **Build:** Run `npm run build` to create production build

## Best Practices

- Follow the patterns shown in the example plugins
- Use TypeScript for type safety
- Keep plugins focused on a single feature or enhancement
- Document your plugin's functionality in the README.md

## API Documentation

For detailed API documentation, visit:

- [Headlamp Plugin API Reference](https://headlamp.dev/docs/latest/development/api/)
- [Plugin Development Guide](https://headlamp.dev/docs/latest/development/plugins/)
- [UI Component Storybook](https://headlamp.dev/docs/latest/development/frontend/#storybook)
