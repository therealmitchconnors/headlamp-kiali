# Kiali native Headlamp port: implementation plan and agent handoff

This is the current, repository-local plan. It supersedes the earlier
session-local planning notes and does not require access to a Copilot session
database, conversation, or private artifact directory.

**The port is partial.** Native browsing, scoped settings and application
correlation work. An additional increment implements 14 Istio configuration
models/views, confirmed configuration CRUD, limited checks, traffic charts
and a basic observed-request graph. Configuration now also includes nine
Gateway API/inference kinds from pinned upstream schemas. The health increment
adds a Go-oracle-backed calculator, per-cluster tolerances and health for
supported workloads, Applications and inbound-only Services. The 2026-11-03
increment closes the supported HTTP/gRPC reporter and entity-aggregation
boundary; TCP health, capability inference, and proxy/ambient/security evidence
remain explicitly unavailable.
Hosted live Bookinfo request/latency charts, traffic graph and workload health
are verified. Native Jaeger/Tempo HTTP trace browsing is implemented with
hosted fixture-backed checks; live tracing and new Desktop evidence remain open.
Read-only pod logs and bounded native Envoy server/configuration snapshots are
also implemented and verified against live Bookinfo in hosted Headlamp.

### Current integration — 2026-11-05

The implementation branch now integrates validated PRs #4, #6, #11, #13,
#37, #38 and #39 through `c8128c5be38bf1fd42cdbe41bd70a083a5da2232`.
Mounted sources, workload/account projection, HTTP/gRPC health guards,
graph focus/state, observed security telemetry and analysis/rendering budgets
are present alongside the repeatable hosted smoke. Integration conflicts
preserved both source-provenance guards and the newer Service checks;
the combined implementation passed 23,105 tests in 193 files, type-check,
lint, build and generated/catalog checks.

Read-only hosted validation used `mitch-auto`. The remaining PRs #12, #14,
#19, #20, #21, #22, #27, #28 and #29 are only partially validated; #31 and
#36 have reproducible live failures. See the current integration notes in
`docs/parity.md`. The planning snapshot below is historical and does not
describe these newer merge states.

### Historical baseline reconciliation — 2026-11-03

The implementation base and PR target are
[`therealmitchconnors-kiali-plugin`](https://github.com/therealmitchconnors/headlamp-kiali/tree/therealmitchconnors-kiali-plugin)
at `655e75109cf27f964f55045bdadfe39c72d22022` (merged #2). This task branch
contained the same tracked implementation baseline; its planning commit was not
evidence of feature integration. The verified GitHub PR base for this task is
the port branch, not `main`.

The GitHub issue/PR states below are a point-in-time planning snapshot. #1 and
#2 are merged into the baseline. Every other implementation PR listed is open
and unmerged; its branch, tests, or issue assignment do not change this
baseline's implementation or evidence state. Use [the issue-linked execution
map](#issue-linked-execution-and-catalog-map) and
[partial-release readiness](docs/parity.md#partial-release-readiness) as the
portable current handoff. The dated checkpoints and test counts below remain
historical evidence for their named revisions, not current test results.

### Mounted-source continuation — 2026-11-01

Issue #3 continues from the declared-scope Gateway prerequisite (#2), integrated
into this implementation branch; the validated branches are now integrated.
The selected source batch is same-context, direct ConfigMap-backed mounted mesh
files, audited against the existing pinned Kiali discovery caller. Indirect
environment resolution and cross-context configuration remain unsupported.
See the source audit in `docs/parity.md` before extending this batch.
The issue #3 continuation now accepts the audited protobuf field-name aliases
without silently defaulting configured root/discovery/automatic-mTLS values,
and closes the argument-parser oracle gap using pinned `parseArgsInto`/pflag.
The batch remains a selected-field projection, not full effective configuration.

### Resume status — 2026-11-03

The reboot handoff has been resumed. Istio Gateway KIA0301 and selectorless
PeerAuthentication KIA0002 checks, trace-wide intrinsic filters, and
event/link/instrumentation attribute filters, and graph namespace annotations
are now packaged after hosted verification. No cluster policies or tracing providers were installed.
This checkpoint consolidates the native port work after `6753f8e`. The user has
requested commits and pushes at verified checkpoints; use the branch history
to identify the current checkpoint rather than assuming `6753f8e` contains it.
The VM workload-correlation increment is packaged after local and hosted
verification. Matching-entry probe evidence has also passed local/hosted checks,
with disabled-check assumptions explicitly distinguished from reported status.
No VM was deployed.
Positive Pod-account provenance now appears in Applications through captured
UID owner chains. Missing account fields remain unavailable and no
account-absence checker or authorization principal is inferred.
The supported health boundary now requires observed data for every queried
direction, rejects unsupported request protocols rather than treating them as
healthy, and distinguishes explicit zero-rate observations from absent vectors.
A pinned query/aggregation fixture complements the existing Go reporter and
calculator oracles. No new hosted/real telemetry or Desktop evidence was
collected for this increment.

**Captured workload/account projection (2026-11-03):** Applications retain their
existing label grouping and Gateway retains its separate default-workload
projection. The account path now has a separate bounded projection over complete
namespace captures, including OpenShift DeploymentConfig discovery, versioned
source lists and UID/API-version-checked owner chains. It uses only the pinned
v2.33 default account workload kinds; runtime Kiali `ExcludeWorkloads`, managed
namespace/cross-context membership and custom controllers are not captured and
must remain explicit downstream gates. Pod accounts come only from attributed
Pod specs. Matched WorkloadEntry `spec.serviceAccount` values and UIDs/versions
are exposed as separate VM provenance, never as Pods or ServiceAccount-object
existence. No KIA1701/principal/absence checker is enabled. Type-check, lint,
build and focused tests pass (180 tests in 7 files). The full suite passed
22,615 of 22,616 tests; one unrelated Traces component test hit its existing
5-second timeout under full-suite load and passed when run with its neighboring
component tests. Hosted, Desktop and live checks remain open.

**Prometheus recurrence, 2026-10-29:** the existing Pod again reached its 1 GiB
cap during TSDB compaction (156 OOM restarts before mitigation). Under the
user's earlier conditional authorization, a UID-guarded `pods/resize` patch
raised only its server memory limit to **2 GiB** and request to **1 GiB** after
server dry-run. CPU/reloader resources stayed unchanged. The same Pod UID
`7c99cc2a-6da4-4815-8141-e3f73e083926` became ready, completed backlog compaction
and WAL checkpointing, and remained at 157 restarts during observation.
Memory samples ranged from 849 to 1,142 MiB; historical TSDB data from
2026-10-27T16:20:46Z remained queryable. Actual stock hosted Headlamp also
confirmed Prometheus 3.10.0 reachability after recovery, without intercepted
responses. No Pod deletion or second TSDB reset occurred.

**Deployment template remains 256 MiB/1 GiB.** Updating its `Recreate` template
would replace the Pod and discard `emptyDir` history, so it was deliberately
not rolled out or paused. The in-place allocation persists for the current Pod,
but a future replacement needs the higher budget reapplied. A lasting workload
template update requires an approved storage/rollout decision; do not silently
discard data to make the template match.

The current full-parity estimate is **approximately 55%, with roughly +/-10
percentage points of uncertainty**. This is an engineering estimate across the
remaining feature families, not a measured catalog coverage score or a claim
that test counts imply parity. Advanced graphs, configured and cross-context
workload/capability provenance, effective security/ambient semantics, mesh-wide multi-cluster behavior,
dashboards and integration/live/Desktop closure remain substantial work.

### Cloud continuation handoff — paused at the user's request

The user requested stopping at the next published checkpoint, then continuing
with cloud agents rather than keeping the laptop running. The working branch is
`therealmitchconnors-kiali-plugin`; GitHub's default branch is `main`. A cloud
task must explicitly use the working branch as its base or it will miss this
port. Read this plan, `AGENTS.md` and `docs/parity.md` before implementation.

The configuration-source continuation selects supported mounted mesh files from
the first container's `--meshConfig` arguments and direct ConfigMap volume
mapping. It preserves shared/local precedence and reports selected map/key/path
and captured identity through Mesh, namespace validation, scoped Gateway checks
and the configured mTLS indicator. Selected-file failures do not fall back to the
standard ConfigMap. New mounted captures verify controller and source versions;
existing unsupported topology and completeness guards remain in force.

The next bounded prerequisite is nonempty networks acceptance and complete
protobuf parse/fusion/default evidence, followed by separately audited
cross-context configuration-cluster association, not arbitrary environment
expansion. Full ProxyConfig/extensions and runtime configuration remain separate
work. Do not enable workload/port/subset mTLS or principal-absence checks from
this selected-field projection.

The **Gateway listener/port/controller and Service port-validation milestones
are implemented** as active-caller-only, declared-scope increments. Gateway
details offer explicit scoped checks: Istio KIA0302 uses complete default
workload inclusion and captured controller namespace-scope flags; existing
Istio/Gateway API conflicts, listener/status and class checks reuse the same
complete local scope. Dormant Gateway port-name helpers and attachment/port
validation checkers remain disabled. A separate guarded route-form increment
now creates or attaches existing-host-supported HTTPRoute/GRPCRoute resources;
listener/controller acceptance and advanced route matching remain open. Service
details link to an explicit, read-only inspector requiring declared local
namespace scope, a complete pooled
managed-namespace Pod snapshot and complete cluster-wide Deployments. It ports
the active KIA0601/KIA0602/KIA0701 checks and keeps denied, stale, malformed,
truncated or unresolved evidence unavailable, using status annotations rather
than correlation `proxyMode`. The synthetic hosted browser and fixture checks
are now exercised by the repeatable smoke described below; Desktop and
live-cluster verification remain open, and full Gateway/controller parity is
not claimed. See `docs/parity.md`.

Independent cloud work can address advanced graph appenders or external
dashboard integration, but keep assignments bounded and file ownership distinct.
Open PRs against the working branch and integrate prerequisite PRs before
starting dependent tasks. Do not treat a single open-ended prompt as a reliable
weekend-long completion queue.

The repository is public and now has a normal CI workflow for plugin checks and
the hosted smoke, but no Copilot setup workflow. Cloud agents can install
dependencies with `npm ci` and use the documented npm gates and committed
oracle fixtures. For Actions-based agents, an optional
`.github/workflows/copilot-setup-steps.yml` must be present on the default
branch; it does not configure cloud-sandbox sessions. See
[GitHub's environment guidance](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment).

The local pinned-source checkout, browser runners/screenshots and real kubeconfig
are not in the repository. Cloud agents must not assume `/Users/...` paths exist
or copy personal kube credentials. Fetch pinned public references when
regenerating source evidence. The repeatable synthetic hosted Headlamp smoke is
`npm run smoke:hosted`; it launches the pinned stock 0.35.0 host and the actual
built plugin without a real cluster. Unit/build success alone is not runtime
proof. Actual AKS/provider/Desktop gates still require an authorized
verification environment and approved fixtures. They must remain explicitly
open otherwise.

GitHub cloud tasks run without this laptop. Current built-in cloud automations
are limited to private/internal repositories, so this public repository cannot
use that scheduler directly. Queue normal cloud tasks or deliberately configure
an approved Actions/API orchestrator, with spending limits and review boundaries.
See [cloud sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions)
and [automation prerequisites](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations).

### Latest verified checkpoint

- **Mixed-reporter security-label reconciliation (2026-11-05):** compatible
  source/destination series pair when all requested traffic labels except
  `reporter` and `connection_security_policy` match, preserving missing versus
  explicit policy values and each exact reporter identity. Equal-rate pairs count
  once using the source series as deterministic representative; one-sided rows
  remain, while mismatched rates, non-policy identities, and ambiguous
  same-reporter policy partitions fail closed. Focused topology core/adapter/UI
  tests passed (**1,815 tests in three files**), as did formatting, type-check,
  lint and production build. No live Headlamp/Bookinfo access is available here,
  so the reproduced hosted Combined failure remains to be rechecked.
- **Mixed-reporter topology (2026-11-03):** the advanced traffic graph now
  defaults to source-aligned combined mode while retaining explicit source and
  destination modes. Combined selectors cover selected-namespace source egress,
  destination workload ingress and source-reported unserviced ingress. Exact
  paired identities count once only when rates/labels agree; single-reporter
  buckets remain, and partial/conflicting overlapping buckets fail closed.
  Kiali's reversed TCP sent/received counter mapping is applied. Focused graph
  core/adapter/UI gates passed
  **1,802 tests in three files**; TypeScript, lint and production build passed.
  Mixed-mode hosted/console/i18n/a11y, Desktop and live-cluster evidence remain
  open; no real traffic or cluster fixtures were changed. See `docs/parity.md`.
- **Issue #3 completion audit (2026-11-01):** the existing mounted-source batch
  retains its no-fallback, bounded-read and source-revalidation guards. Fixed
  silent omission of protobuf snake_case names for the nine projected mesh
  fields, including disabled automatic mTLS and namespace discovery. Pinned
  legacy jsonpb gives present camelCase names precedence even when null; nested
  selectors and label-map keys are not recursively renamed. Unit/adapter/mTLS
  regressions cover aliases, conflicting spellings, malformed values and
  downstream scope/default behavior. Added 122 original-Go argument cases
  (106 comparisons and 16 explicitly stricter guards) to the existing 141-case
  path/reference artifact. The generator pins pflag through Kiali's go.mod/go.sum;
  no plugin runtime dependency changed. Transport, networks parsing and full
  protobuf fusion/default evidence remain gaps, not completed parity.
  Focused verification passed **521 tests in five files**, type-check, lint,
  production build, formatting, parity/resource/dashboard checks and oracle
  regeneration (both fetched and local pinned sources).
  The full suite passed **22,939 tests in 188 files** with the existing Vitest
  runner and `--maxWorkers=2`. A default-worker run had two unrelated five-second
  UI timeouts (ServiceTrafficWizard and Traces); both files passed a **32-test**
  focused rerun before the complete two-worker run. No tests or timeouts changed.
  Read-only code review found no significant issues. Secret scans passed.
  CodeQL reported only a pre-existing mocked-request assertion in
  `gatewayScopedValidation.test.ts:224`; its substring filter checks that a
  request did not occur, not URL trust or transport, so it is a false positive.
  No Headlamp endpoint or configured Kubernetes context is available; contribution,
  console, i18n/a11y, hosted fixture, Desktop and live-cluster gates remain open.
- **Mounted mesh configuration sources (2026-11-01, issue #3):** integrated
  prerequisite #2 and added first-container `--meshConfig`/direct-volume
  resolution, selected map/key/path provenance and bounded shared/local merging.
  The new file-source branch checks mapped networks dependencies, accepting only
  absent keys/empty configuration. Unsupported, missing, denied, malformed or
  changed sources remain unavailable; no fallback or new validator is enabled.
  All relevant consumers retain captured provenance. The original-Go helper
  artifact has 116 source comparisons and 25 explicit native guard cases;
  argument parsing was still an oracle gap at this earlier checkpoint; it is
  covered by the continuation above. Transport and full protobuf fusion/defaults remain gaps.
  Final local verification passed **22,785 tests in 188 files**, including
  **106 targeted consumer tests**. Type-check, lint, production build, changed-code
  formatting, parity/resource/dashboard checks and oracle regeneration passed.
  An unrelated wizard test timed out once during concurrent gates; a targeted
  retry and subsequent full suites passed without changing that test.
  No Headlamp endpoint or configured Kubernetes context was available.
  Browser contribution/console/i18n/a11y, hosted fixture, Desktop and live-cluster
  gates remain open, including all earlier Gateway runtime gates.
- **Hosted Headlamp smoke foundation (2026-11-03):** added a reproducible
  Docker/Chromium run against the pinned stock Headlamp 0.35.0 image and built
  plugin, a loopback-only read-only synthetic Kubernetes/Prometheus API, and a
  GitHub Actions workflow. The smoke exercises real host authentication,
  contribution/navigation, English labels and named controls, debounced public
  ConfigStore persistence across reload, Prometheus build-info, and positive,
  denied, incomplete and stale outcomes for both scoped Gateway and Service
  port inspectors. The successful run observed 181 authenticated reads and no
  Kubernetes writes. Exact commands, fixture scope and classified stock-host
  diagnostics are in `docs/hosted-smoke-tests.md` and `docs/parity.md`. This
  closes only the synthetic hosted-web smoke gate; Desktop, live-cluster,
  live-provider and OIDC/authentication evidence remain open. The CI-equivalent
  local checks passed type-check, lint, build and parity inventory; the full
  suite passed **22,594 tests in 189 files**.
- **Scoped Gateway validation (2026-10-31):** added the explicit detail-page
  inspector, active Istio Gateway KIA0302 and captured exact-true controller
  scope semantics. Complete versioned Gateway/default-workload/VM sources are
  projected onto the declared local namespace scope. UID/version/field freshness,
  ownership, pagination, malformed-source, denial and timeout guards fail closed.
  Default workload inclusion is a separate source-informed projection, not
  application correlation or full configurable workload coverage.
  No new original-Go oracle or positive live Gateway fixture was added.
  At that pre-integration checkpoint, the focused set passed **103 tests in
  three files** and the full run passed **22,480 tests in 186 files**, including
  the owner-version guard and related-link provenance regression.
  Browser contribution/i18n/a11y/console, hosted fixture, Desktop and live-cluster
  gates remain open; local tests do not close them. See `docs/parity.md`.
- **Service port validation (2026-10-31):** added the explicit Service inspector
  and complete typed Pod/Deployment collection over the declared local scope.
  Active caller semantics retain pooled selector matching without an extra
  namespace filter, vacuous all-sidecar behavior, the independent any-ambient
  test, appProtocol precedence, first cluster-wide Deployment metadata-label
  match, exact mapping exclusions and the no-missing-Deployment behavior.
  The selected Service is re-read and compared after the evidence capture;
  source failures, truncation and timeouts cannot produce partial findings.
  At that pre-integration checkpoint, the focused set passed **118 tests in
  four files** and the full suite passed **22,491 tests in 186 files**. There is
  no new original-Go oracle. Headlamp browser load/a11y, hosted fixture
  verification, Desktop and live-cluster gates remain explicitly open.
  The combined branch covers 23 schema-derived configuration kinds and
  **41 bounded finding codes**.
  After integration, the full suite passed **22,594 tests in 189 files**;
  type-checking, lint and production build also passed. Browser contribution,
  hosted fixture, Desktop and live-cluster verification remain open.
  An activation audit removed unintended ServiceEntry KIA0601 enforcement:
  the pinned ServiceEntry/Istio Gateway pipelines leave port-name helpers disabled.
  A subsequent KIA0004 audit restricts generic workload-selector activation to
  AuthorizationPolicy/PeerAuthentication/RequestAuthentication and Sidecar in
  their exact groups/fields. Inactive kinds no longer get spurious deferrals;
  malformed active selectors defer explicitly. Runtime absence checking remains
  gated on a complete mesh-workload model, not bounded correlation.
  The Gateway API route audit confirmed Kiali v2.33.0 activates only HTTPRoute
  and GRPCRoute v1 parent/Service-reference checkers (Gateway v1 and
  ReferenceGrant v1beta1); TCPRoute/TLSRoute/UDPRoute have no active route
  checker and remain disabled. HTTPRoute v1beta1 is a native model extension,
  not pinned caller coverage. The existing active-route capture now re-reads
  the selected object after source collection and rejects changed identity,
  resourceVersion, API version or spec under the shared deadline. The focused
  set passed 45 tests in two files; the full suite passed 22,605 tests in 189
  files with one worker. Type-check, lint and build passed. No Headlamp CDP
  target was available on :9222, so fresh browser contribution/console/i18n/
  a11y verification remains open.
  The separate namespace account projection now requires complete versioned
  source lists and supported UID owner chains for the pinned default account
  workload set. It exposes observed Pod accounts and source-aligned VM entry
  accounts without constructing principals. Custom Kiali exclusions, custom
  controllers and managed/cross-context membership remain unavailable; KIA1701,
  KIA0106 and authorization verdicts stay disabled.
  Declared namespace revision selection now has a 1,538-case original-Go oracle
  and visible provenance separate from controller/injection hints. Maistra
  membership cannot be resolved through coincident Istiod labels; assessment
  links require ready contexts. Mesh reads capture cluster scope and share a
  fifteen-second deadline. Four hosted groups/eighteen GETs measured 15,544 ms;
  actual Bookinfo labels rendered `asm-1-30` without interception.
  Same-context revision tags now select the first captured webhook per raw
  revision, replacing rather than unioning lookup aliases. A new 364-case Go
  oracle preserves missing/empty revisions and explicit empty tags. The mesh
  table exposes ignored aliases; ready own/root contexts retain scoped links.
  This does not resolve full cross-cluster tag assignment or managed membership.
  Controller observation now follows the pinned first-container choice and
  exposes its provenance, rather than preferring a discovery-named sibling.
  First-only shared reads, ordering, malformed/missing inputs and actual managed
  Istiod were verified. Ordered literal environment semantics now have a
  211-case original-Go oracle: final ID/shared assignments, exact-true accumulation,
  explicit clears and conservative indirection/noncanonical guards. Four hosted
  groups made forty GETs; complete managed scope remains open.
  An optional explicit `meshClusterName` now supplies captured per-context
  controller-ID comparison, distinct from telemetry/context names and independent
  of external-management flags. Settings persistence, no fallback, no replay/
  resurrection, pending cancellation and unchanged guards passed four hosted
  groups/33 GETs. This does not certify managed namespaces or activate Service checks.
  A typed declared local/default-visibility namespace scope is now exposed,
  requiring complete versioned sources, mapped non-external controllers,
  observed Maistra classification and resolved configuration. Four hosted
  groups/25 GETs covered membership, selectors, visibility and unavailable
  sources. At that checkpoint, the pooled Service validation pipeline was next;
  it is implemented in the Service port-validation checkpoint above.
  Active ServiceEntry host/port conflict checks now add KIA1211/KIA1212 with
  export/import scope, UID/spec freshness and related-configuration inspection.
  DestinationRule KIA0201 now adds source-backed host/subset overlap with exact
  non-local mTLS default exceptions and scoped related-rule links.
  KIA0204 adds source-bound TLS override patterns with top-level/port-level
  presence semantics and an explicit distinction from observed encryption.
  Sidecar KIA1006 now uses explicitly resolved per-namespace root configuration,
  independent of import-source reads; absent/empty selectors need no discovery.
  KIA1004 adds an export-aware Service registry and scoped egress lookup with
  unknown-visibility deferral, source-compatible host rules and precise paths.
  VirtualService KIA1101 now reuses the registry for HTTP/TCP/TLS destinations,
  with source-backed outbound-policy defaults/classification and immutable
  resource/source capture. Mesh inventory exposes declared outbound modes.
  PeerAuthentication KIA0401/KIA0501/KIA0505/KIA0506 now preserve selector
  presence, top-level TLS and input-order semantics with scoped rule evidence.
  Resolved missing roots use the observed controller namespace, with explicit
  provenance across Sidecar, mesh and configured-mTLS consumers.
  DestinationRule KIA0205–KIA0208 add the counterpart peer-policy checks, with
  selected-rule freshness and security-group links to observed peer policies.
- Native Envoy/pod diagnostics, fixture-backed ztunnel inspection, expanded
  trace metadata and explicit UID-verified trace-to-Pod links.
- Separate traffic topology page with workload/application/versioned-application/
  Service projections, captured historical windows, request/byte/message units,
  local filtering and edge metadata. Explicit single-reporter modes remain
  available; combined mode source-aligns egress, destination ingress and
  source-reported unserviced ingress, deduplicating only exact equal-rate reporter
  pairs and retaining their identities/provenance. Conflicting pairs fail closed.
  TCP sent/received measures follow Kiali's reversed Istio L4 counter mapping.
  Service adjacency is marked as derived.
- Exact trace string-tag filters, historical search end time, a 24-hour range
  option and a captured 15-second search deadline are also implemented.
  Six hosted intercepted scenarios passed and tracing fixture settings were
  restored durably; actual providers remain unavailable.
- On-demand Jaeger/Tempo service and operation pickers now retain manual input,
  captured scope/time, local filtering and pagination. Six hosted scenarios
  intercepted eight name GETs; picking names submitted no trace search or write.
- Native circuit-breaker editing and optional Service-create settings now share
  pure proposals and the guarded mutation path. Unrelated policy/override fields
  are preserved; setting the threshold explicitly migrates the deprecated alias.
- Native load-balancing/affinity editing and optional Service-create settings
  now preserve unrelated policy metadata and explicitly replace incompatible
  strategy fields through the same guarded mutation path.
- Native HTTP mirroring now supports guarded existing-route edits and observed
  shadow-only Service versions, with independent percentages and explicit
  duplication warnings. Forwarding weights are never silently redistributed.
- Explicit outbound TLS controls now support top-level DestinationRule modes
  and proxy-container file references, plus optional Service creation. They
  never infer changes from mesh status; incompatible credentials are explicitly
  replaced, and subset/port overrides are preserved.
- Service routing creation now supports explicit TCP rules with selected-port
  scope, shared policy composition and rejection of incompatible HTTP drafts.
- Service creation also composes optional HTTP timeout/retry/fault settings with
  weighted/mirrored routes. Groups are excluded by default, incompatible TCP
  drafts are rejected and impact warnings persist through confirmation.
- Guarded HTTP route reordering now preserves complete forwarding/redirect/
  delegate objects and rejects definitely unconditional rules before later
  rules, without claiming complete reachability analysis.
- Service creation now supports bounded HTTP request conditions with the pinned
  header-AND/non-header-OR grouping, RE2 validation and port constraints on every
  alternative. Review clarifies that these are not access controls and that
  unmatched/default traffic can still reach a mirrored version normally.
- Existing HTTP alternatives now support granular condition edits without
  flattening compound scope restrictions. Shared empty-alternative guards
  recognize metadata and protobuf-default fields instead of treating them as
  real predicates.
- Tempo searches now support bounded typed/scoped attribute comparisons and
  regexes, exact integer literals and captured filter displays. Connection
  changes invalidate submitted searches rather than replaying them elsewhere.
- Missing/null and present/non-null Tempo predicates now have explicit controls,
  canonical empty input state and distinct captured displays.
- Gateway API class registry settings and KIA1504 now preserve configured/
  discovered/default provenance and defer unresolved mesh-wide conditional
  defaults. Denied or incomplete discovery is never converted to absence.
- Explicit saved Istio telemetry identities now feed metrics, topology and
  workload/Application/Service health forms. Submitted settings are captured
  to prevent reference-driven refetches and cross-endpoint query replay.
- Native cluster comparison now captures 1..8 explicit contexts, preserves
  per-source errors and uses a three-worker queue with per-target deadlines.
  Metrics retain provider/identity provenance without sums or membership guesses.
- Graph inspection now offers explicit current-resource candidates through
  unique captured/saved telemetry mappings, with no historical UID or traffic
  origin claim. Ambiguous names, ownership and incomplete reads remain errors.
- Guarded inbound mTLS editing now preserves PeerAuthentication selectors and
  workload-port overrides, with explicit modes/inheritance and broad-scope
  impact warnings retained during confirmation.
- HTTPRoute/GRPCRoute backend weight editing now uses relative Gateway API
  ratios/defaults, preserving parent/backend references, filters and matches.
- Gateway collision checks now include KIA1501/KIA1502 with source-exact
  literal/nil/name-exclusion semantics, selected-object freshness and group-safe
  related-reference links.
- Configuration context reads now capture scope/spec/settings and stop after
  15 seconds, with linked cancellation and no late/retained findings after
  timeout. Hosted delay testing measured 15,051 ms and verified retry/denial.
- Exported metric/workload/entity-health readers now capture all inputs and
  share a 15-second whole-read deadline. Four hosted paths measured
  15,054..15,092 ms and verified explicit retry without healthy fallbacks.
- Native traffic histograms now expose duration/request/response-size averages
  and P50/P90/P95/P99 with captured historical scope, explicit units, bounded
  matrices, three workers and a 15-second deadline. Hosted real duration reads
  returned no finite samples; successful byte charts, gaps, isolated points,
  zero and independent failures were verified through interception, not live data.
- Tempo now has separate bounded span name/status-message/duration/status/kind
  predicates. Exact nanosecond serialization, enum/operator guards, immutable
  capture and provider-change behavior passed five hosted fixture scenario
  groups with three intercepted GETs. No live tracing provider was installed.
- Literal Tempo attribute/tag keys now support bounded punctuation, embedded
  spaces and Unicode with complete-name quoting and explicit scope. Five hosted
  fixture groups verified escaping, captured identities, control/duplicate
  rejection and unchanged Jaeger JSON tags using two intercepted search GETs.
- Trace detail and connection probes now capture provider/endpoint/cluster and
  share the linked 15-second deadline. Hosted timeout/retry/denial checks
  intercepted six reads; observed UI times were 15,119/15,440 ms, including
  action/navigation overhead. No timeout becomes an empty trace or valid probe.
- AuthorizationPolicy KIA0104 now preserves Host-header exemptions, internal
  name lookup and per-kind registry export filtering, including autogenerated
  VirtualService exclusion. Twelve hosted cases used synthetic selected policies
  with real Bookinfo evidence or intercepted registries; no policy was written.
  Namespace-first pruning avoids irrelevant registry reads and method checks
  remain independent. Gateway collision explanations were also corrected and
  checked in eleven hosted scenarios without unrelated TLS findings.
- WorkloadGroup details now offer bounded, captured WorkloadEntry spec-label
  matching and UID-bearing links, with empty-selector exclusion. The structural
  Map uses the same scoped matcher and includes target nodes. Eleven hosted
  scenarios covered actual empty inventory, synthetic matches, failures/budgets,
  15,111..15,121 ms timeout/retry checks, Conditions-last layout and a drawn Map connection.
  No VM resources were installed. Stock 0.35 omits edge captions and has unnamed
  source-picker checkboxes; those host limitations remain documented.
- Canonical outbound Envoy names now offer explicit current-Service candidate
  lookups with validated UID/port evidence, captured bindings and a deadline.
  Eight hosted scenario groups used one real proxy stream and ten Service GETs,
  including live Bookinfo details and intercepted failures. The 15,535 ms
  timeout/retry and native Service drawer were verified without proxy refetch.
  These links do not establish historical identity, routing or traffic origin.
- Canonical DestinationRule/VirtualService metadata references now support
  explicit current-object lookup and group-safe detail navigation, with separate
  observed/current API versions, strict UID/version guards and a deadline.
  Twelve hosted fixture cases covered eleven object GETs, four authorized
  forwarding negotiations and a 15,052 ms timeout/retry. All configuration
  payloads were intercepted; no objects or SDK globals were changed.
- Additional traffic signals now cover throughput, gRPC messages and four TCP
  rates, with explicit raw names and pinned direction compensation. Shared
  scalar reads preserve histogram behavior. Hosted checks observed actual
  zero throughput, bounded synthetic rates/errors, concurrency three and a
  15,056..15,070 ms timeouts and the unchanged legacy panel disclosure;
  no traffic generator or cluster write was used.
- VirtualService KIA1106 now preserves literal gateway grouping, normalized
  host buckets, namespace wildcards and duplicate self-contributions. Export
  defaults and namespace-wide Sidecar imports select whole objects; UID/spec
  changes and incomplete context defer checks. Sixteen hosted fixture scenarios
  covered scoped related links, real mesh defaults, denial, exclusions and a
  15,132 ms deadline/retry. All VirtualServices/Sidecars were intercepted; the
  live VirtualService list was empty. Eleven Gateway regression scenarios passed.
- Istio Gateway KIA0301 now preserves selector/port grouping, target-namespace
  prefixes, pinned hostname matching and ordered path/object-reference behavior.
  The per-cluster bare-wildcard toggle defaults off and is captured with checks.
  Twenty-two hosted scenarios passed with 23 intercepted Gateway-list GETs,
  a 15,391 ms deadline, retry, saved-setting hard reload and stale-result rejection.
  Eleven Gateway API and sixteen VirtualService scenarios passed again.
- PeerAuthentication KIA0002 now checks same-namespace selectorless policy
  conflicts, distinct from mTLS-pattern empty-selector exclusions and KIA0003.
  Complete policy identity and resolved namespace evidence are required.
  Eighteen hosted cases observed 17 intercepted policy lists and a 15,401 ms
  timeout/retry; nineteen prior mTLS/root-fallback cases passed again.
- Trace search now includes whole-trace duration and reported root span/service
  intrinsic filters alongside the existing five span fields. Scope remains
  explicit in queries and captured rows; exact duration/quoting/limit behavior
  is shared. Five hosted scenario groups exercised all eight fields with three
  intercepted searches, historical capture, provider invalidation and denial/retry.
  No live provider matching is claimed.
- Event-name and instrumentation scope name/version intrinsics now share the
  bounded literal/range/RE2 path. Canonical colon names remain distinct from
  dot attributes; versions are not semver and event conditions do not claim
  same-event joins. Four hosted groups issued three intercepted GETs and
  preserved capture/provider isolation, denial/retry and the ten-predicate cap.
  The increment passed **382 focused tests in five files** and normal gates;
  no live provider was queried.
- Trace/span/parent/link ID predicates and signed event offsets are now exposed.
  Pinned storage narrows IDs to equality/inequality; malformed hex is rejected
  locally. Event offsets preserve exact whole nanoseconds within a directly
  parseable symmetric magnitude bound, without float-arithmetic workarounds.
  Four hosted groups issued three GETs for all six fields; metadata regressions
  passed. **461 focused tests in six files** and normal gates passed.
  Seventeen field options retain the shared ten-predicate limit; link traversal,
  structural/count intrinsics and unrestricted cross-span pipelines remain open.
- One bounded related-span group now supports same-trace AND plus directional
  child/parent/descendant/ancestor/sibling relationships. Primary and related
  criteria stay separate; AND need not match distinct spans and structural
  operators return right-group matches. Three hosted groups made nine searches,
  checking all operators, quoting, capture/provider isolation and denial/retry.
  **484 focused tests in seven files** and normal gates passed. No provider
  matching is claimed; unions, negated relations, additional groups and raw
  pipelines remain unsupported.
- Event/link/instrumentation attribute scopes now share typed filtering,
  exact literals, nil predicates and bounded captured reads. Five hosted
  groups covered the three scopes/five scalar types, mixed trace intrinsics,
  stale draft/provider isolation and denial/retry, with no writes.
- Traffic graph nodes now show consistent selected/outside/unknown namespace
  annotations in diagrams, tables and keyboard inspection. Name-only comparison
  remains distinct from cluster membership, RBAC and current object existence.
  Four hosted groups/three intercepted metric GETs covered all projections,
  local filtering, scope invalidation/resubmission and denial.
- WorkloadGroup-backed VM workloads now join application and current-resource
  correlation through complete, discovered same-namespace entry evidence.
  First-matching-entry label precedence retains separate group/entry UIDs;
  no Pods, replica health or safe per-entry traffic versions are inferred.
  Shared correlation captures scope and has a 15-second deadline. Sixteen
  hosted groups observed real Bookinfo plus 34 intercepted VM-list GETs, one
  synthetic graph query and a 15,658 ms timeout/retry. No VM was deployed.
- Matching WorkloadEntries now expose source-backed probe evidence, separating
  reported conditions from disabled/unrecognized-annotation assumptions. Three
  hosted groups/five intercepted lists covered all branches, first-condition
  order, stale timestamps, malformed fields, partial/denied reads and retry.
  VM replica health remains unassessed; no live VM probe was performed.
- Captured Pod service-account observations now appear per workload and per Pod,
  bound to existing scoped UID ownership. Six hosted cases covered real Bookinfo
  accounts and missing/malformed/denied/owner-mismatch behavior with no
  ServiceAccount-object reads or writes. Complete account-principal validation
  remains open.
- Native custom aggregate dashboards now support bounded saved raw/rate/histogram chart
  definitions, explicit namespace/metric-cluster scoping, captured history,
  signed gauges, unit scaling, independent chart errors and shared read limits.
  Five hosted groups observed 27 intercepted reads, concurrency three and a
  15,549 ms timeout; actual Bookinfo memory-metric aggregation returned 61
  finite nonzero samples. Full custom dashboard/discovery/annotation/Grafana/
  Perses parity remains open.
- Classic custom histograms now expand selected Average/P50/P90/P95/P99 summaries
  through the shared query builder, preserving signed custom samples while
  keeping built-in Istio histogram domains unchanged. Three hosted groups/
  13 intercepted reads verified all summaries, per-summary failure, captured
  drafts and exact eight-request expansion bounds. Prior raw/rate and Istio
  histogram runtime regressions passed.
- Custom dashboards now capture up to ten exact additional metric-label filters
  without allowing namespace/cluster scope replacement or persisting drafts.
  Three hosted groups/eight intercepted GETs covered literal/empty values,
  rejected scope overrides and invalid/oversized inputs, and corrected retry.
  Shared range reads now enforce a 16 KiB encoded query-parameter budget.
- Named custom chart metrics now use pinned list-over-legacy precedence and
  render as separate lines with aligned timestamps, explicit gaps and a
  matching numeric comparison table. Five hosted groups/nine intercepted
  reads verified persistence, labels, per-metric errors/stable colors,
  histogram grouping, expansion bounds and legacy fallback.
- Saved dashboard templates now compose whole-template and exact chart includes,
  preserving pinned shared-visited-set behavior and ordered resolution.
  Missing references and unsupported syntax fail before metrics requests.
  Six hosted groups/12 intercepted GETs verified Settings persistence, actual
  included chart rendering, captured references, invalidation, rejection paths,
  query expansion bounds and corrected retry. Named-metric/legacy regressions
  also passed. All new positive chart data was synthetic; no writes occurred.
- Custom dashboard `groupLabels` now retain independent raw/rate/histogram
  series with strict declared-label, duplicate, scope and cardinality guards.
  Seven hosted groups/32 intercepted GETs verified real chart lines, wrapping
  captions, gaps/zero, unchanged ordering on reordered responses, independent
  failures, exact eight-line and 1,024-character boundaries and corrected retry.
  Named-metric and template regressions also passed. All new positive samples
  were synthetic; no writes occurred.
- Explicit saved-template discovery now captures `discoverOn`/runtime metadata,
  scope and instant, preserves literal include suppression separately from
  trimmed composition, and never fetches charts merely by selecting a match.
  Five hosted groups observed ten intercepted discovery GETs, three explicitly
  loaded charts and a 15,101 ms timeout/retry. A separate real Bookinfo query
  returned ten metric names and matched `istio_requests_total` under explicit
  destination namespace/cluster/reporter selectors. This is metric presence,
  not application-language evidence. Grouped-chart runtime regressions passed.
- Charts now preserve unspecified units rather than inventing physical dimensions.
  Scalar tables use a neutral Value heading; grouped/named comparisons disclose
  the missing unit and dimensional uncertainty. Three hosted groups/five GETs
  verified persistence, scaled signed/zero values, real grouped lines and a
  subsequent declared-unit change. Samples were synthetic and no writes occurred.
- Captured safe-integer `min`/`max` display bounds and 1..12-column `spans`
  now work across scalar, named and grouped charts. Four hosted groups/eight
  GETs verified exact axes, post-scale numeric preservation, responsive stacking
  without refetch, one-sided all-outside domains, invalid-input rejection and
  an unsafe-geometry error that retains the numeric table. Unit regressions
  passed again. New samples were synthetic; no writes occurred.
- Optional aggregation grouping and captured-value checkbox/radio controls now
  preserve the source converter's declaration ordering and literal visibility
  rules. Five hosted groups/six GETs verified explicit grouping loads, local-only
  value filtering, missing-label retention, first-observed single selection,
  reset on new results, rejection paths and corrected retry. Display/axis
  regressions passed. New samples were synthetic; no writes occurred.
- Larger compositions now retain up to 160 charts of bounded metadata and offer
  explicit chart batches, without raising the eight-expanded-request limit.
  Four hosted groups/16 GETs verified nine-chart composition, rejected empty/
  over-limit selections, full-definition grouping options, original panel order,
  exact eight-query batches, capture/reset semantics and raw-only selection
  independent of unselected histogram settings. Aggregation regressions passed.
- The checksum-pinned built-in catalog now ships all 21 templates and 91 inline
  charts behind a per-cluster opt-in. Saved definitions override names without
  copying bundled data into ConfigStore. Five hosted groups/eight metric GETs/
  two discovery GETs verified opt-in persistence, Go charts, source provenance,
  bounded Thorntail composition, overrides/discovery and opt-out. Saved-only
  selection regressions passed; no Kubernetes writes occurred.
- Per-template disable declarations now preserve name-only/empty definitions
  while excluding their names from effective loading and discovery. Four hosted
  groups/six metric GETs/one discovery GET verified persistence, broken-include
  errors without fallback, discovery-only entries, restored bundled dependencies
  and disabled-only catalogs. No Kubernetes writes occurred.
- Explicit Namespace/workload annotation overlays now capture validated resource
  identity, UID/version and source location, apply namespace then workload
  precedence, and block metric/discovery reads on stale or failed evidence.
  Five hosted groups/15 resource GETs/six metric GETs verified template-map
  masking, Job metadata, sanitized errors, no fallback/resurrection and a
  15,103 ms deadline/retry. Real Bookinfo Namespace and reviews-v1 Deployment
  reads also passed without interception. No cluster writes occurred.
- Application dashboard recommendations now use captured Pod references before
  namespace-overlaid metric discovery, preserve auto/enabled/disabled policy
  and ordered whole-runtime replacement, and embed scoped chart loading.
  Six hosted groups verified 78 intercepted resource GETs, 12 metric GETs and
  a 15,081 ms shared deadline. An actual Bookinfo read captured three owned
  reviews Pods plus Namespace evidence in eleven unintercepted GETs. Browser
  settings-only policy survived hard reload. No Kubernetes writes occurred.
- Chart sorting now supports captured lexical/exact signed-int64 ordering,
  source-compatible sort-only query grouping and hidden-label conversion.
  Ambiguous converted groups and invalid integer values fail explicitly.
  Five hosted groups/nine metric GETs verified legend/table order, precision,
  local filters, label retention, errors and histogram summaries. Application
  dashboard regressions passed (15,052 ms shared deadline). No writes occurred.
- Workload dashboard recommendations now support eight Kubernetes kinds through
  explicit ownership then annotation/discovery phases. Selected child controllers
  retain only their UID-owned Pods; namespace/workload overlays require freshness.
  Paired app/version selectors and captured charts passed five hosted groups
  (78 resource/twelve metric GETs, 15,251 ms deadline). Actual Bookinfo linking,
  Deployment/one-Pod evidence and source identity passed in 22 read-only GETs.
  Native resource-name/spec/status/conditions/events views remain unchanged.
- Captured chart expansion now reuses scalar/grouped panel rendering in a
  labelled dialog, including query scope, current sorting/value filters and
  independent errors. Five hosted groups measured 220→520 px scalar expansion,
  keyboard focus trap/restore, source invalidation and narrow-screen scrolling.
  Opening/closing sent no requests (four metric GETs for explicit loads only).
  Workload app/version expansion also passed without additional metric GETs.
- Time-axis dashboard styles now support captured line/area/bar/scatter choices
  without altering queries or values. Isolated finite line/area samples remain
  visible; independent areas/bars are never stacked. Three hosted groups rendered
  eight scalar/grouped charts with eight metric GETs, checking real primitives,
  numeric rows, sort order and expanded styles. Expansion regressions passed.
- Series-category axes now select each visible series' latest finite sample
  within the existing range, retaining actual sample times and unavailable
  categories. Default/explicit-empty type semantics, sorting and independent
  category geometry passed three hosted groups/six metric GETs. Expansion and
  local filtering added no requests; eight-chart time-axis regressions passed.
- Captured chart visibility now honors boolean startCollapsed and provides
  local Show/Hide controls. Errors, warnings and no-data notices stay visible;
  histogram summaries toggle independently and expansion preserves prior
  visibility. Four hosted groups proved eight requests per explicit capture
  (sixteen across reload), no requests for visibility/filter actions and
  definition-default reset. Category-axis regressions passed.
- Captured template rows now support native viewport plot sizing with a local
  no-fetch control. Explicit rows enable it; omitted/null preserves natural
  heights. Selected templates retain their own preference across includes and
  overlays. The source gap/floor/150 px minimum and default two are preserved,
  but captions/errors/tables remain in normal flow rather than reproducing
  upstream parent-container sizing. Four hosted groups measured exact plot
  heights, narrow stacking, keyboard expansion and Settings hard-reload
  persistence; three captures made five metric GETs each. Visibility and
  workload/application dashboard regressions passed.
- Latest dashboard-row increment: **433 focused tests in ten files**, plus
  type/lint/i18n/build and generation checks. Original-Go evidence is unchanged.
- Latest namespace-selection prerequisite: **1,713 focused tests in eight files**
  plus the full **21,564-test suite in 177 files**, type/lint/i18n/build/package and
  source/resource/catalog/parity/hosted checks. No Service port checker was
  activated: complete managed-namespace and pooled-Pod evidence remain prerequisites.
- Previous selector-caller correction: **334 focused tests in five files**, with
  type/lint/build/package, source/resource/catalog/parity checks and four hosted cases
  (eight resource GETs). All audited source blobs matched the pinned inventory;
  no finding codes or Go oracle cases were added.
- Previous visibility increment: **421 focused tests in thirteen files**, plus
  type/lint/i18n/build/package and catalog/resource/parity/hosted checks.
- Previous series-axis increment: **408 focused tests in twelve files**, plus
  type/lint/i18n/build/package and source/catalog/resource/parity/hosted checks.
- Previous style increment: **385 focused tests in ten files**, plus
  type/lint/i18n/build/package and resource/catalog/parity/hosted checks.
- Previous expansion increment: **51 focused tests in five files**, plus
  type/lint/i18n/build/package and catalog/resource/parity/hosted checks.
- Previous workload increment: **175 focused tests in twelve files**, plus
  type/lint/i18n/build/package, resource/catalog/parity and hosted checks.
- Previous sorting increment: **380 focused tests in eight files**, plus
  type/lint/i18n/build/package and catalog/resource/parity/hosted checks.
- Previous application increment: **429 focused tests in ten files**, plus
  type/lint/i18n/build/package, catalog/resource/parity and hosted checks.
  Previous annotation increment: **366 focused tests in eight files**, plus a
  final 27-test UI rerun, type/lint/i18n/build/package/catalog and hosted checks.
  Previous disabling increment: **409 focused tests in eight files**, plus
  type/lint/i18n/build/package, catalog-check and hosted gates passed.
  Previous catalog increment: **442 focused tests in 11 files**, plus
  type/lint/i18n/build/package, offline catalog checksum and hosted checks passed.
  Previous chart-selection increment: **412 focused tests in nine files**, plus
  type/lint/i18n/build/package and hosted checks passed.
  Previous aggregation increment: **456 focused tests in 14 files**, plus
  type/lint/i18n/build/package and hosted checks passed.
  Previous display increment: **399 focused tests in ten files**, plus
  type/lint/i18n/build/package and hosted checks passed.
  Previous unitless increment: **390 focused tests in nine files**, plus
  type/lint/i18n/build/package and hosted checks passed.
  Previous discovery increment: **398 focused tests in nine files**, plus
  type/lint/i18n/build/package and hosted checks passed.
  Previous grouping increment: **695 focused tests in 13 files**, plus
  a final three-test chart-layout rerun and type/lint/i18n/build/package checks.
  Its expanded 216-case original-Go query oracle and parity catalog check passed.
  Previous template increment: **171 focused tests in six files**, plus
  type/lint/i18n/build/package and hosted checks passed.
  Latest full-suite checkpoint: **22,377 tests in 183 files** after declared
  local namespace scope; its focused suite passed **2,229 tests in eight files**.
  The preceding **22,359-test/182-file** suite covered explicit
  logical mesh identity; its focused suite passed **354 tests in six files**.
  The preceding **22,340-test/182-file** suite covered ordered
  controller environment handling; its focused suite passed **277 tests in
  four files**. The previous **22,108-test/181-file** suite covered first-container
  provenance and the accumulated dashboard/tracing increments. Its focused
  mesh suite passed **1,961 tests in five files**; three hosted groups made
  twenty GETs and actual managed Istiod first-container provenance matched.
  The earlier **21,932-test/178-file** checkpoint covered local tag
  precedence; its focused suite passed **1,958 tests in five files**.
  Five hosted tag groups made 37 intercepted GETs without writes; namespace
  regressions made 18 GETs and measured a 15,049 ms deadline. Unintercepted
  Bookinfo revision evidence remains `asm-1-30`.
  The preceding namespace-revision checkpoint passed 21,564 tests in 177 files.
  Earlier checkpoints at `08b4021` (19,978/176) and before it (19,415/155)
  remain historical evidence.
  Comparison metrics reject unexpected aggregation labels and mixed times.
  Independent original-Go evidence totals 19,733 cases, including 211 controller-environment,
  364 revision-tag,
  1,538 namespace-revision
  and 216 custom-dashboard
  queries, 228 WorkloadEntry
  health and 96 VM-label selection,
  176 selectorless
  PeerAuthentication, 328 Istio Gateway,
  400 VirtualService
  host-conflict, 108 traffic-signal and 960 authorization
  host/visibility cases, 180 histogram-query and 508 Gateway
  collision and 64 class membership cases, 1,728 graph
  identities, 398 ServiceEntry groups, 1,087 DestinationRule pairs, 1,800 TLS
  patterns, 72 root-selector, 288 egress/registry, 576 VirtualService registry and
  348 PeerAuthentication, 984 counterpart-policy and 72 exclusion cases. The related-reference
  dialog also passed focused scope/keyboard/live-load checks.
- Configured namespace discovery now evaluates bounded selectors, retains
  own/root namespace exceptions and gates configuration defaults/mTLS without
  claiming actual injection or health. Shared label-selector validation now
  rejects partial keys and invalid values. Five hosted selector cases, real
  unrestricted/root contexts and matching-scope policy reads passed.
- Validation exclusions now have a guarded annotation-only editor with
  restore/selective/all modes, immutable review, explicit confirmation,
  UID/version/acknowledgement checks and scope-change cancellation. Seven
  hosted interception cases passed; all permission reviews and PUTs were
  intercepted. No exclusion was written to the live cluster.
- Current `kiali-0.1.0.tar.gz` SHA-256:
  `85671f0ce0407d3549120839ec5e9f1212edc5193ac651a1afdaabcf972a0c63`.
- This checkpoint includes the implemented work after `6753f8e`. No new cluster component,
  live routing/policy fixture or logging mutation was applied in these increments.
  Prometheus's latest state and the in-place memory/template distinction are
  recorded in the resume section above; earlier zero-restart checks are historical.
- Full parity is still open. Desktop debugging is unavailable; control-plane
  sync returned 401; representative live routing needs approval; tracing and
  ztunnel success evidence remains synthetic.
- Nine hosted Sidecar scenarios passed, using real managed root configuration
  for root/non-root cases and intercepted Sidecar objects. No objects were
  applied. All interceptors were removed and settings stayed durably unchanged.
  The isolated hosted helper is stopped at each published checkpoint and port
  4487 checked closed. Generated translation backups were removed from source,
  dist and staging, and the packaged member list was verified exactly.
  Each direct fixture run closed its owned isolated browser.
  Owned scratch through HTTP creation was archived outside the worktree;
  subsequent routing/tracing, presence-filter and Gateway/multi-context scratch
  and validation/telemetry deadline, histogram, tracing-search, authorization-host
  WorkloadGroup relationship, proxy Service/configuration candidate, traffic-signal
  VirtualService/Istio Gateway conflict, selectorless policy, trace-wide intrinsic
  metadata-scope, graph namespace-annotation, VM correlation, probe/account evidence
  and custom dashboard scratch is also
  archived outside the worktree. Session-local Playwright tooling was
  used for fixture execution without changing production dependencies.
  Tracing remains durably disabled and no fixture endpoint is retained.
  The normal Desktop plugin installation was not overwritten; recheck targets
  before use.
- Fourteen egress-registry scenarios also passed, including real Bookinfo
  registry reads, export overrides/defaults, ServiceEntry scope, denial and null
  listener indexes. No fixtures were applied; DNS settings were restored.
- Fourteen VirtualService scenarios and the configured-mode inventory passed.
  Only `ALLOW_ANY` lowers missing-destination severity in the pinned Kiali
  classifier; the supported dynamic-DNS mode remains an error, not a claim that
  actual traffic is blocked. No cluster object was changed.
- Nineteen PeerAuthentication/root-fallback scenarios passed, with intercepted
  policies and no writes. Missing raw roots are no longer deferred when a
  resolved configuration and observed controller namespace supply the pinned
  fallback; denied or ambiguous sources remain unavailable.
- Twenty-two counterpart policy scenarios passed, including scope/order,
  captured UID/spec freshness, denied reads and security-group related links.
  No policies were applied; DNS settings were restored.
- Eight circuit-breaker scenarios passed, including Service-driven creation.
  Ten specification requests and thirteen permission reviews were intercepted.
  No live configuration changed; the actual read-only proposal and preserved
  overrides were inspected, and DNS settings were restored.
- Eight load-balancing scenarios passed, including strategy replacement and
  combined Service creation. Sixteen specification requests and sixteen
  permission reviews were intercepted; no live configuration changed.
- Ten mirroring scenarios passed, including failure guards and real read-only
  Service evidence. Thirteen specification requests and fifteen permission
  reviews were intercepted; no mirrored traffic was generated. Settings were
  restored durably and all handlers removed. Desktop remains unavailable.
- Twelve outbound TLS scenarios passed with nineteen specification requests and
  twenty-one permission reviews intercepted. No TLS policy or credential was
  installed; settings were restored and handlers removed.
- Four TCP creation scenarios passed with eight specification requests and nine
  permission reviews intercepted. No resources, settings or traffic changed.
- Four HTTP policy creation scenarios passed with eight specification requests
  and nine permission reviews intercepted. Rendered read-only proposals and
  conflict/denial paths were checked; no settings or live traffic changed.
- Six route-order scenarios passed with four specification requests and six
  permission reviews intercepted. No real routes were changed.
- Four request-matching scenarios passed with twelve specification requests and
  thirteen permission reviews intercepted. No resources or settings changed.
- Nine existing-condition scenarios passed with eight specification requests
  and ten permission reviews intercepted. No live configuration changed.
- Six typed Tempo checks intercepted four GETs. Invalid types/regex/keys,
  integer limits, connection changes, Jaeger incompatibility and denial were
  exercised. Tracing was restored durably; no provider was installed.
- A presence-filter check intercepted one GET and verified missing/null versus
  present/non-null behavior in the native query UI. Tracing was restored durably.
- The user was unavailable when asked to authorize isolated live tests in
  `mitch-auto/kiali-verification`; this is not approval. That namespace was
  not created. Continue source-backed implementation and intercepted checks.
- KIA1504 now uses the configured/discovered registry, not GatewayClass object existence.
  Pinned `cache/cache.go` resolves configured classes first, then discovered
  classes with an equality-label selector or the exact `istio.io` controller
  prefix rule. Fallback adds `istio`/`istio-remote`, conditionally
  `istio-east-west` for multiple configured mesh clients and `istio-waypoint`
  for ambient in any configured cluster. Headlamp context count or only the
  selected cluster's ambient flag cannot substitute for that mesh-wide context.
- Sixteen registry scenarios verified settings save/reload and source/failure
  handling with twenty-two intercepted class lists and zero live writes.
  Settings were restored. The isolated hosted helper was subsequently stopped
  and port 4487 checked closed after the dependent increments.
- Seven identity scenarios covered all query consumers, save/reload and missing
  mappings. Twenty-three provider reads were intercepted, including the
  overview connection probe; no live writes occurred and settings were restored.
- Three comparison scenario groups covered eight synthetic contexts, with
  thirty-five intercepted GETs and measured concurrency of three. Host config
  was only intercepted, not edited. All temporary settings/handlers were removed.
- Seven graph-resource scenarios exercised real Bookinfo current candidates
  and negative fixtures, issuing fifty-four namespace reads without writes.
  Settings were restored and current UID disclosures inspected.
- Eleven inbound mTLS cases intercepted thirteen specification requests and
  fifteen permission reviews, including failure guards. No live policy changed.
- Seven Gateway-weight cases intercepted five specification requests and seven
  permission reviews. No Gateway API or resources were installed or modified.
- Eleven Gateway-collision cases intercepted eleven lists, including failure
  and suppression guards. Related references were inspected; no live writes.
- A context-deadline scenario intercepted three Namespace reads, measured the
  timeout and verified explicit retry plus clearing of old findings on denial.
- Four telemetry/health deadline cases intercepted eighteen metric reads.
  Bookinfo evidence stayed read-only and temporary settings were restored.

## Start here

1. Read [AGENTS.md](AGENTS.md), this plan, [docs/parity.md](docs/parity.md), and
   [test-files/README.md](test-files/README.md).
2. Inspect `git status`, the current branch and the recent commits before editing.
   Ensure the checkout includes the correlation and handoff checkpoint below.
3. Preserve the existing correlation implementation. Review it before extending
   it; do not regenerate the plugin scaffold.
4. Read the current increment and verification boundaries below. Continue the
   remaining cross-resource validation, effective mesh configuration and
   health/query semantics; do not rebuild the now-present models or trace
   browser, or mistake fixture verification for full live parity.
5. Update this plan and the parity ledger as work lands. A completed foundation
   milestone is not a claim of full parity for its broader feature family.

### Git handoff boundary

| Checkpoint | Contents |
| --- | --- |
| `06162d2` | Initial Kiali scaffold and extracted agent skills; scaffolding only |
| `739260f` | Native resource browsing, scoped settings, parity infrastructure and reproducible development fixtures |
| Correlation and handoff checkpoint after `739260f` | Application correlation, Applications list/detail UI, label settings, tests, oracle, related documentation and this plan |
| Native port checkpoint after `6753f8e` | 23 configuration models, guarded CRUD, thirty-eight bounded finding codes, host/health/mTLS/import/local-check/proxy/policy/graph/grouping/registry oracles, mesh inventory, entity health, charts/histograms/graph/custom aggregate dashboards, native tracing, guided routing, VM/Pod account evidence and read-only diagnostics/current-resource candidates |

At handoff the branch is `therealmitchconnors-kiali-plugin`.
The original correlation/handoff checkpoint is `6753f8e`; the subsequent native
port checkpoint includes the configuration/telemetry/diagnostic/VM/dashboard
increments described here. Simply checking out `6753f8e` elsewhere does not
include them; fetch the latest `therealmitchconnors-kiali-plugin` branch.

## Current increment and evidence boundary

- `src/resources/` contains 14 typed models generated from sanitized live Istio
  CRD schemas. Discovery uses public API discovery rather than requiring CRD-read
  permissions, distinguishes forbidden/absent/unsupported, and selects versions
  without mutating shared model metadata.
- Nine Gateway/inference models complete the pinned configuration-kind inventory:
  GatewayClass, Gateway, HTTPRoute, GRPCRoute, TCPRoute, TLSRoute, UDPRoute,
  ReferenceGrant and InferencePool. Their schemas match Kiali's actual dependency
  versions (Gateway API 1.6.0, inference-extension 1.5.0), not the earlier 1.4
  exploratory reference. These APIs are absent in the live test cluster.
  Generation covers spec/status and all served pinned versions, group-safe
  routes and cluster-scoped GatewayClass operations.
- Root, parent and listener conditions are grouped last without dropping other
  status fields. GatewayClass and Gateway printer columns support safe
  condition filters and wildcard paths. Named parent/backend/mirror/certificate/
  grant/picker references preserve API groups; links do not prove permission.
  All 23 kinds have opt-in Map sources. Service-reference edges and the later
  WorkloadGroup entry associations are wired; other edge families remain open.
  The expanded hosted Map filter shows all kinds, distinct Gateway labels and
  real icons for the nine new leaves.
- Configuration lists preserve printer columns and add useful summaries.
  Detail sections render every supplied spec/status field with nested native
  tables, preserve zero/false/unknown extension fields, show explicit references,
  and place Conditions last before Events. Multiline text uses read-only Monaco.
- Create, edit-specification and delete controls use SelfSubjectAccessReview,
  server dry-run, explicit confirmation, current UID/resourceVersion checks and
  delete preconditions. Edits preserve other object fields. No blind write retry
  or automatic rollback exists. Browser mutation checks intercepted all writes;
  no operation was applied to the live mesh.
- An initial guided traffic-weight workflow edits one existing VirtualService
  HTTP/TCP/TLS route, requiring integer percentages totaling 100 and preserving
  every other field. It reuses the guarded review path and captures the original
  API object when opening, not after editing. Limits are 100 routes/20
  destinations. The Service workflow creates namespace-local
  DestinationRule/VirtualService proposals from observed versions and now also
  edits one uniquely captured, same-namespace existing pair. The edit path
  updates only changed objects, retains selected originals/UID/resourceVersion,
  reuses existing route and policy planners, and uses guarded two-step execution
  with per-object partial outcomes. Mixed create/update, ambiguous targets,
  Gateway-attached/multi-host resources and unsupported routes remain excluded.
- Existing HTTP forwarding routes now have keep/set/remove timeout, retry,
  fixed-delay and HTTP-abort controls. They preserve unrelated fields and
  use immutable current/proposed JSON review through the existing guarded
  update path. Bounds and fault/timing incompatibilities are explicit.
- Mesh inventory discovers local `app=istiod` controllers, namespace labels,
  revision tags and standard/shared configuration fields. It preserves unknown
  values and uses label hints rather than claiming actual injection or security.
  Selected shared/local fields merge without runtime defaults. Direct ConfigMap
  mounted mesh files now have guarded source selection and empty-networks
  acceptance; unsupported mounts, nonempty networks, external configuration
  clusters and full ProxyConfig/extension merging remain open.
- Configured mTLS has a reusable pinned composition engine with 2,600 independent
  Go cases and a namespace-wide consumer using an explicit controller. It
  suppresses output on partial policy reads, conflicts and unsupported contexts.
  Configured status is kept separate from observed encryption/security.
- Observed connection security now uses a captured 5/15/60-minute range for
  destination-reported `istio_requests_total` HTTP/gRPC labels, with a five-minute
  rate window and 15-second samples. It exposes mTLS-labeled, `none`-labeled,
  mixed, unknown, unsupported and unavailable categories plus query/range/reporter
  provenance. The projection bounds results to eight groups, retains unknown
  labels, summarizes positive categories across that range, and displays rates
  from the latest aligned sample. Sparse, missing, stale or non-finite samples
  and warnings withhold shares and mark the evidence partial or unavailable.
  It does not claim complete traffic coverage, configured policy, proxy sync,
  certificate validity or authorization. The active Kiali graph appender also
  consumes message/TCP metrics and has graph-dependent waypoint/ambient paths;
  those dimensions remain unsupported here pending their required inputs.
- Tracing adds optional per-cluster Jaeger/Tempo HTTP query endpoints, connection
  probes, service/operation/duration/error searches, trace deep links and native
  span timing/attributes/events/reference inspection. Nanoseconds and OTLP int64
  values remain exact; decoders enforce bounded inputs and identity consistency.
  Settings/check cancellation, same-ID retry, navigation and stale-response
  isolation have regression tests. Hosted success paths used synthetic browser
  interception; the real absent-Service failure was also checked. No tracing
  provider was installed. Auxiliary metadata is now projected as described
  below; graph/workload correlation, broader filters, authenticated/tenant
  transports and new Desktop checks remain.
- Bounded checks now cover KIA1104, KIA1105, KIA0004, KIA0005, KIA1107,
  KIA1102, KIA1108, KIA0101, KIA0102, KIA1702, KIA1401, KIA1402, KIA1503 and
  KIA1601, with ignore-annotation handling and incomplete-context reporting.
  Host normalization has 627 independent pinned-Go cases. Host-alias/subset
  checks require an explicit per-cluster DNS identity suffix. Namespace-wide
  Sidecar imports now have 760 independent Go import/export cases, with root
  fallback, local precedence, exclusions and conservative conflict handling.
  DestinationRule exports use resolved per-source-namespace mesh defaults;
  incomplete sources or ambiguous control planes defer affected checks.
  These do not provide a validity verdict or the full Kiali validation suite.
- HTTPRoute/GRPCRoute Gateway parents and Service parents/backends/mirrors now
  have bounded checks. Gateway sharing uses namespace label selectors.
  ReferenceGrant matching deliberately enforces groups and optional target
  names that the pinned helper omits. Missing grants differ from unreadable
  grants; unsupported kinds and attachment/port/controller status remain open.
- Local checks add KIA1007 omitted outbound mode and GWAPI
  condition findings. Port/condition helpers have 564 independent Go cases.
  The consumer requires current observed generations and fixes nested listener
  field paths; explicit native JSON modes are not made ambiguous by Go defaults.
- Traffic metrics use an explicitly entered telemetry cluster label, one
  reporter, five-minute rates and fixed query end time. The initial charts show
  HTTP/gRPC request rate/basic error percentage, p95 duration and TCP throughput.
  A keyboard-operable workload graph and equivalent table show positive observed
  request edges. This is not the full Kiali graph/health/query implementation.
- The full health matcher/calculator has 271 independent pinned-Go oracle cases.
  Custom cluster rules and resource annotations use bounded RE2 matching.
  The workload adapter supports five replica-controller kinds, refuses
  combined health on missing/stale/partial inputs, and explicitly excludes proxy
  synchronization, ambient and security assessment. Application and Service
  consumers now reuse the calculator: Applications combine correlated top-level
  controller snapshots and explicit canonical-service metrics; Services use
  inbound requests and Service annotations. Inbound reporter combination now
  has 372 independent Go cases and an explicit UI mode; no-response/gRPC
  normalization is shared. Unknown-cluster/external/query defaults and
  proxy/ambient behavior remain open.
- The grouped structural Map source has 23 opt-in leaf sources with icons.
  Service-reference targets are included even when only Kiali sources are
  enabled; WorkloadGroup spec-label matches also include WorkloadEntry targets.
  These edges are configuration associations, not ownership or measured traffic.
- Pod diagnostics includes regular/init/ephemeral container inventory, native
  sidecars and explicit current/previous log snapshots (1,000 lines, 24-hour
  lookback, 256 KiB and 15 seconds). Pod UID/restarts are checked before/after.
  Raw Headlamp requests need `Accept: */*` on the test cluster; exclusive
  `text/plain` caused HTTP 406. Logs are not stored in plugin settings.
- Native Envoy diagnostics uses public `ApiProxy.stream`, Kubernetes v4
  WebSocket forwarding to port 15000, and only fixed GETs for `/server_info`
  and `/config_dump`. No local listener, exec, token creation, bridge or
  cluster installation is needed. It has bounded HTTP framing/JSON decoding,
  before/after UID/restart checks and a 15-second overall deadline. Server
  information is capped at 256 KiB and configuration at 4 MiB.
  Cluster/route/listener entries retain static/active/warming/draining states,
  unknown fields and distinct indexed entries for repeated/unnamed resources.
  Selected entries open read-only JSON; bootstrap/secrets/endpoints are not
  displayed. These are observations, not validity, synchronization or health.
- Actual live schemas/discovery and empty configuration lists were verified in
  stock hosted Headlamp. Populated detail, code-block, confirmation, validation,
  chart and graph success paths were verified with explicitly intercepted browser
  fixtures. Graph node selection works by keyboard. Unit tests cover failures,
  conflicts, bounds, partial visibility and source reproducibility.
- No new config resources were seeded: VirtualService/DestinationRule lists
  remain empty. Desktop CDP is currently unavailable. The earlier Prometheus demo
  was OOMKilled/crash-looping, and its real failure was shown correctly by the UI.
  Subsequently, the user explicitly authorized discarding its historical TSDB
  data. Only the exact Prometheus pod was replaced with a UID-preconditioned
  delete, clearing its emptyDir; the replacement is ready and all six Bookinfo
  scrape targets report up. Limits, configuration and cluster policies were not
  changed. The 1 GiB limit remains a recurrence risk. The latest user instruction
  permits a memory-limit increase if Prometheus becomes problematic again.
- Bounded fresh Bookinfo traffic subsequently proved real hosted request/latency
  charts, six request edges and healthy reviews-v1 replica/request health.
  The exact telemetry cluster label is `Kubernetes`. Custom thresholds persisted
  after reload and changed the result; defaults were restored. Prometheus still
  had zero restarts, so its resources were not changed. No mesh configuration
  writes or new CRD installs were performed.
- These are not grounds for claiming full parity. Obtain approval before
  seeding representative CRs or unrelated installs, and have the user relaunch
  Desktop debugging for the remaining Desktop checks.

The production plugin was installed in the local Headlamp Desktop profile.
That installation is outside Git; source changes still need a build/deployment.
Temporary development watchers and hosted-web verification servers were stopped.
Do not assume a live debug target or test service is still available: recheck it.

Tracing regression checkpoint: 4,308 tests in 44 files passed, alongside
type-check, lint, resource generation, parity consistency, i18n, build and
packaging. Final trace identity/semantic-heading adjustments also passed the
focused suites, type-check and lint. The final production bundle loaded in
hosted Headlamp; its console had only the known host CRD-v1beta1 discovery 404.
The generated `kiali-0.1.0.tar.gz` includes LICENSE, NOTICE and English locale
assets (SHA-256 `fbeef3159e1890f9c3a8b52c75a02d22a9578cd70c705de8d1b9537404c041e4`).
This generated package is not committed; rebuild it from source when moving
environments. Desktop CDP remained unavailable on port 9222.

The subsequent Sidecar/export increment passed 5,082 tests in 45 files,
type-check/lint, oracle regeneration and parity checks. Its production bundle
was loaded in hosted Headlamp. Eight intercepted scenarios verified private/
public exports, root exclusion/local override, conflicts, mesh export defaults,
configuration denial and KIA0005; real namespace/controller/config reads supplied
the remaining context. No cluster writes occurred, and temporary DNS settings
were restored. The previous tracing tarball predates this increment; refresh
the package at the next checkpoint. The isolated hosted server may be running
while later validation work continues; recheck it rather than assuming it stopped.

The Gateway-reference follow-up passed 5,104 tests in 47 files and the normal
type/lint/schema/parity/build gates. Nine hosted scenarios verified HTTP/gRPC
parents, namespace sharing, strict ReferenceGrant identity, denials and malformed
selectors with intercepted Gateway resources plus real Service/Namespace reads.
The actual absent-HTTPRoute state returned after interception was removed.
No Gateway API or resources were installed. Source-informed tests are not a
full independent Gateway checker oracle.

The Application/Service health follow-up passed the 5,124-test, 50-file full
suite and normal gates; a final additional zero-rate UI regression also passed
with type/lint/build checks. Hosted real data proved positive request health,
missing-telemetry suppression and zero-rate replica-only labeling.
The refreshed `kiali-0.1.0.tar.gz` includes these increments and licenses,
SHA-256 `ce292034220e549fff753d84ee1af1c302793509a179c68ee268717a86588d6c`.
The isolated hosted server remains available for continuing work; the normal
Desktop plugin installation was not overwritten.

The reporter-combination checkpoint passed 5,505 tests in 51 files,
type/lint/schema/parity checks and oracle regeneration. Combined-mode health
loaded against real Bookinfo for Service, Application and workload subjects.
Intercepted error-only cases separately verified source-only errors, gRPC
no-response precedence and missing-reporter suppression. The current package
SHA-256 is `5f9e2700b2be1736251a0f25e1fe5bd55e03b465a854ac164b70e6558e2d128b`;
it supersedes the earlier package hashes above. Full port work remains open.

The Service traffic creation checkpoint passed 5,520 tests in 55 files and
type/lint/schema/parity/build/package gates. Real source discovery and fully
intercepted success/partial/stale write paths loaded in hosted Headlamp; actual
bookinfo VirtualService/DestinationRule lists remained empty. Readable immutable
JSON review replaced the initial nested-table preview. The latest package hash
is `f6f21edeb8901c5b909e35500692be319665633656e3ac578a6b36e1dff544c0`.

The HTTP behavior checkpoint passed 5,543 tests in 56 files plus the normal
type/lint/schema/parity/build/package gates. Intercepted hosted updates proved
timeout/retry edits, explicit timing removal before delay/abort faults, unrelated
field preservation and stale-version rejection. No live fault was applied.
The latest package SHA-256 is
`0823bed4b84bd33bc08bf62f4eae42b046af8954663ec1b1712a5e75f8088683`.

The local-check checkpoint passed 6,114 tests in 57 files, including 564 new
original-Go port/condition cases. Hosted fixtures verified KIA0601, KIA1007,
current Gateway/listener warnings and stale-condition deferral without writes.
The later activation audit removed ServiceEntry KIA0601 enforcement because
the pinned caller does not run that helper. Current behavior and coverage are
recorded at the top of this plan. This historical package SHA-256 was
`67598d383459fbecb94e46feffa4612ed60d4715ab6b64c4f7ab315e5f215bd7`.
Real routing/controller enforcement still requires separately approved fixture
application; no approval for new live routing or fault changes is assumed.
The user was unavailable when asked to authorize temporary bookinfo routing
fixtures. That was not approval: continue read-only development and intercepted
write checks. Live fixture application/cleanup remains blocked pending permission.

The read-only diagnostics checkpoint passed **6,191 tests in 64 files** plus
type/lint/schema/parity/i18n/build/package gates. Real hosted Bookinfo checks
loaded native-sidecar logs, Envoy LIVE server state and 88 configuration entries.
One GET was sent per forwarding stream, and observed streams closed after reads.
Synthetic browser checks covered repeated/unnamed entries, selected JSON,
HTTP 403, oversize responses and replacement reads; real data was restored.
The current package SHA-256 is
`874b1aa4375fd4ff03dec9b103c55cbb8ac2fcd1d5a9b7e807b3478174773910`.
Prometheus still had zero restarts; its memory limit was not changed.
Desktop verification, upstream proxy summaries, synchronization, ztunnel and
confirmed logging controls remain open. Older hosts can assign a socket after
`stream().cancel()`; the adapter observes the public handle for 15 seconds and
closes late frames without sending. Setup that hangs beyond that window without
any subsequent frame cannot be fully reclaimed through the stock public API;
this is an explicit host-lifecycle limitation, not a proven cancellation guarantee.

The proxy-detail expansion passed **7,279 tests in 66 files**. It adds
1,063 independent original-Go cases for cluster names/ports/metadata, protocol
classification, preferred-domain selection and xDS nonce comparison. Cluster
inspection now uses the configured service DNS suffix without guessing one;
changes update the selected summary without another network read. Ports retain
exact decimal text. Route inspection retains all match fields/actions (including
redirect/direct-response/passthrough), and listener inspection preserves default
chains, complete constraints and recognized destinations. Full entry JSON remains
available when a summary is unsupported or malformed.

Real hosted checks exercised cluster summaries both with and without explicit
DNS identity, and route/filter-chain inspection with read-only Monaco details.
Temporary browser DNS settings were restored. The latest package SHA-256 is
`b0c91ce20a7629ef9f8dfa2946ff1becf2025f5ae9cbdc40742eb814f8c78d96`.
No new cluster resource was created or changed.

The managed control plane advertises `http-debug=8080`. A read-only
`/debug/syncz` request through Headlamp's public Pod proxy returned HTTP 401,
while an ordinary read of that same control-plane Pod succeeded. No token,
service account, exec or alternative authorization path was attempted.
The pure xDS comparator is **not wired into health or presented as live sync
evidence**. Live control-plane sync remains blocked on a supported authorized
endpoint; anonymous Envoy admin access does not solve this boundary.

The Istio Gateway reference follow-up passed **7,300 tests in 68 files** and
normal type/lint/schema/parity/i18n/build/package gates. KIA1102/KIA1108 now
cover top-level and HTTP/TCP/TLS match references. Current namespace and explicit
namespace/name references need no DNS assumption; legacy dotted names do.
The reader keeps Istio Gateways separate from Gateway API Gateways and requires
complete evidence before asserting absence. Native behavior fixes nested field
paths, evaluates all matches after an earlier failure and accepts dotted names
in explicit namespace/name references without a legacy-style warning.
Five hosted fixture scenarios covered missing/found/denied/legacy/dotted-name
cases; all interceptions were removed and no resource was written.
The latest package SHA-256 is
`69e3c6bdb2753211717fd58aaa7153579bf5baf036d2f165afdd336541716787`.

The AuthorizationPolicy pattern follow-up passed **7,614 tests in 70 files**
plus normal type/lint/schema/parity/i18n/build/package gates. KIA0101 checks
positive namespace patterns against complete namespace evidence; KIA0102 checks
HTTP methods locally even if namespace reads fail. The two primitive matchers
have 296 independent original-Go cases, including wildcard ordering, Unicode
whitespace and simple-case behavior. Five hosted read-only fixture scenarios
covered findings, valid patterns, denied namespace evidence, method-only reads
and suppression. No policy was installed or changed.
The latest package SHA-256 is
`1f69232276bd1b4fcc554265e6fd528f094e50c3b4e9a31c99e5e4e659afe63d`.
Prometheus remained ready with zero restarts; resources were left unchanged.
These checks do not evaluate principals, negative patterns, trust domains,
traffic authorization or effective allow/deny decisions.

The ztunnel configuration increment passed **7,637 tests in 71 files** and
normal type/lint/schema/parity/i18n/build/package gates. Proxy diagnostics now
has an explicit Envoy/ztunnel format choice. The ztunnel path reuses the fixed
read-only `/config_dump` request on port 15000, the 4 MiB/15-second bounds and
the exact selected container's before/after restart checks. Native service and
workload tables retain reported identities, waypoints, missing-versus-empty
endpoint evidence, local filtering and selected raw fields without inferring
Kubernetes links or mesh health. Top-level certificate/policy bodies are omitted
from the rendered projection.

Hosted checks used the committed synthetic fixture and verified actual table/
Monaco rendering, false/zero fields, endpoint counters and no filter refetch.
A real Envoy response was also rejected under ztunnel format rather than
displaying a fabricated empty ztunnel result. No ztunnel deployment was detected
by the `app=ztunnel` DaemonSet query, and none was installed. Live ztunnel,
Desktop, ambient metrics/enrollment and identity mapping remain open.
The latest package SHA-256 is
`c743acbcd5ddf3e88943309768fbbf22ed55d0e89f30d904d083e79ae369fcd1`.

The trace-metadata increment passed **7,673 tests in 72 files** and normal
type/lint/schema/parity/i18n/build/package gates. It preserves Jaeger sampling/
debug/firehose flags, OTLP sampling and known/unknown remote-context flags,
trace state, status messages/codes, resource/scope schema URLs, instrumentation
attributes and dropped counts, event drops and link attributes. Exact int64
values and explicit empty/zero/false metadata remain distinct from absence.
Unknown status codes stay unassessed. Strict integer/ID matching rejects trailing
newlines, ambiguous OTLP aliases fail explicitly, and a 10,000-record per-trace
budget bounds aggregate batch/scope/span/event/link decoding.

Hosted Tempo/Jaeger fixtures verified selected-span metadata, accessible link
dialogs and exact scope/link attributes. A screenshot caught a transition in
progress; settled opacity/background checks confirmed the actual dialog is
opaque and readable. Settings/interceptions were restored and no tracing backend
was installed. Desktop debugging was rechecked and remained unavailable on 9222.
The latest package SHA-256 is
`2cd3db98d130a9c917534e82c5491ffff0f703de787fc20c1b6335d26d6cf826`.

The reported-Pod correlation increment passed **7,700 tests in 75 files** and
normal type/lint/schema/parity/i18n/build/package gates. Complete, unambiguous
namespace/name/UID attributes enable an explicit current-cluster verification;
only exact UID equality produces native Pod/diagnostic links. Service names
and reported cluster labels are not selectors. Missing/conflicting evidence,
UID mismatch and denied/deleted Pods never become name-only links. The shared
15-second diagnostic deadline now rejects even when an SDK request ignores
abort, while preventing subsequent requests and stale UI results.

Hosted checks used synthetic trace attributes plus a real Bookinfo Pod GET for
success/mismatch cases, and an intercepted 403 for denial. Missing/conflicting
references made no Pod request. The normal live Envoy read still worked after
the shared-deadline refactor. A host ConfigStore persistence race was found in
the test harness: reload before the 500 ms debounce could retain an earlier
fixture endpoint. Owned fixture settings were cleared, and subsequent setup/
cleanup explicitly waited for Kiali's persisted settings to match its public
ConfigStore value. Tracing is disabled in both memory and persisted test-profile
settings; no test provider or cluster resource was installed.
The latest package SHA-256 is
`a77fd1febf985a1cda15a61a45e45e75cff80ef3bba772fc12d8c043aa62ccf6`.
Prometheus remained ready with zero restarts. Broader workload/service/graph
correlation and historical identity resolution remain open.

The WorkloadGroup label-conflict increment passed **7,716 tests in 77 files**
plus normal gates. KIA1702 reads only the selected namespace's WorkloadGroups,
requires complete bounded evidence, and rechecks the selected name/UID and
labels against that snapshot. It compares exact key/value sets independent of
ordering, distinguishes absent metadata from present empty labels, and defers
on replacement, changed labels, malformed peers or scope mismatch.
Eight hosted intercepted scenarios verified conflicts, distinct labels, denial,
stale UID/labels, cross-namespace responses, suppression and absent metadata.
No WorkloadGroup was created. The latest package hash is shown at the top.

Two related dependencies were inspected but deliberately not replaced with
weaker checks: upstream KIA1701 uses service-account identities derived from
observed workloads, not a Kubernetes ServiceAccount existence list; KIA1504 uses
Kiali's configured/discovered/fallback GatewayClass registry, not merely API
object existence. Registry membership is now implemented above, while its
conditional mesh-wide defaults and full workload provenance remain open.

## Confirmed product decisions

- Port Kiali's mesh, observability and configuration behavior into native
  Headlamp React/MUI views, backed by reusable TypeScript domain logic.
- Support stock Headlamp Desktop and hosted Headlamp in a browser.
- No Headlamp modifications, local Kiali companion, runtime Go, kubectl, Docker,
  or custom backend requirement.
- Do not require installing Kiali or any other new component in an end user's
  target cluster. Reuse existing Istio resources and telemetry services.
- Missing dependencies must be visible; the plugin must not install them.
- Include tracing, traffic-management wizards, proxy diagnostics, multi-cluster
  behavior and the rest of the scoped parity target.
- **Exclude AI/chat and offline/gather/import workflows.** Live historical
  telemetry queries remain in scope.
- Reuse Headlamp login, cluster connections, hosting, themes and appropriate
  built-in resource interactions.
- Future plugin mutations follow Headlamp RBAC and require explicit
  confirmation. There is no separate per-cluster write-mode opt-in.
- Track stock-host/browser limitations explicitly. Do not introduce a bridge,
  credential escalation or policy bypass to hide a parity gap.
- Target functional/semantic parity, not a copy of PatternFly styling or a
  server implementing Kiali's REST API.
- Implementation is approved. That is not blanket authorization for new cluster
  installs, fixture application, cleanup or changes to security policies.

## Pinned references

- Kiali: **v2.33.0**, commit
  [`0e8be887b8217bbcac5e3ae0bfcd258073949cca`](https://github.com/kiali/kiali/tree/0e8be887b8217bbcac5e3ae0bfcd258073949cca).
  Do not silently change the parity baseline to upstream master.
- Plugin toolchain: `@kinvolk/headlamp-plugin` **0.14.0**.
- Host exercised so far: stock Headlamp **0.35.0**, Desktop and hosted-web mode.
- The upstream source inventories cover 508 source blobs, 616 inventory records,
  21 frontend routes and 216 distinct contract fields.
- Independent Go oracles cover 375 health-model, 271 health-calculator, 627 host,
  2,600 configured-mTLS, 760 import/export, 372 reporter, 564 local-check,
  1,063 proxy-summary, 296 authorization-pattern and 75 label-resolution
  cases. These are developer-only tools, not a runtime dependency.
- Source and tests are authoritative. Upstream architecture documents are useful
  navigation aids, not substitutes for reading behavior.

## What exists now

| Surface | Current implementation | Important limit |
| --- | --- | --- |
| Kiali navigation | Overview, Applications, Mesh inventory, mTLS configuration, Traces, Mesh configuration, Traffic metrics/signals/histograms/graph, Custom aggregate dashboards, Cluster comparison, Health, Pod diagnostics, Namespaces, Services, Workloads, Connection settings | No links to unimplemented features; custom dashboards are a bounded raw/rate/classic-histogram subset |
| Overview | Istio API discovery and existing Prometheus Service connectivity | API presence is not mesh/control-plane health |
| Native resource browsing | Namespace/Service tables; Deployment, StatefulSet, DaemonSet, Job and CronJob tabs | No plugin list mutations; details delegate to Headlamp |
| Settings | Version-1 cluster ConfigStore: Prometheus/tracing Service endpoints, app/version labels, health rules and explicit service DNS suffix | Browser-profile-local; unknown DNS suffix remains unset; no credentials |
| Scoped reads | Explicit cluster, namespace validation, abort propagation, structured failures, stale-response suppression | No persistent derived-data cache |
| Applications | List/detail grouping, versions, related Services, owned pods and native-sidecar detection | One cluster and one explicitly selected namespace |
| Correlation core | Scoped label postings, selectors, UID owner chains, de-duplication, Service-host resolution | Configuration relationships, not measured traffic |
| Health | Pinned calculator/reporter combination, cluster rules, five replica-workload kinds, correlated Applications and inbound-only Services; exact telemetry-cluster selectors and complete HTTP/gRPC direction observations | TCP error health, capability inference, unknown-cluster fallback, external Service discovery, proxy/ambient/security assessment and VM health remain unavailable |
| Mesh inventory and configured mTLS | Local discovery, selected config merge and namespace-wide policy indicator | Label hints/configuration only; not full effective/observed mesh security |
| Mesh configuration | 23 schema-derived Istio/Gateway/inference models, list/detail views and references | Gateway success paths fixture-verified only; representative live CR and Desktop checks remain |
| WorkloadGroup entry inspection and VM correlation | Explicit same-scope spec-label lookup/Map links; complete-evidence first-entry labels feed application and graph candidates | Live inventory empty; positive associations fixture-backed; no VM health or complete workload/account provenance; VM routing guarded unsupported |
| Configuration actions | Confirmed CRUD, existing-route weights and Service-driven two-object creation | Fixture-backed writes; existing-resource multi-object editing and broader workflows remain |
| Initial checks | Forty-one bounded codes, including declared-scope Istio Gateway selector/controller checks, Gateway API listeners/status/classes, selectorless PeerAuthentication, host conflicts, AuthorizationPolicy registry, ServiceEntry/DestinationRule/TLS patterns, Service port checks, WorkloadGroup labels, Gateway API collisions/targets, exports and conditions | No full semantic validity verdict; dormant Gateway port-name checks excluded; attachment/per-workload/principal context and remaining checkers are incomplete; Gateway scoped and Service port browser/live verification remain open |
| Telemetry and graph | Bounded Prometheus reads, basic charts, positive-rate workload graph and table; observed connection-security range projection for destination-reported HTTP/gRPC request labels | Full graph security enrichment, gRPC-message/TCP security semantics, waypoint/ambient evidence and new Desktop/live telemetry checks remain |
| Traffic histograms | Native duration/size average and percentile explorer with historical scope, captured settings and bounded partial results | Real reads had no finite samples; finite charts fixture-backed; custom dashboards remain open |
| Traffic signals | Eight throughput/message/TCP rate families with explicit raw names, Kiali direction mapping and shared bounded scalar reads | Real throughput was zero; positive/error charts fixture-backed; not active connection counts or full query/default parity |
| Trace browsing | Jaeger/Tempo HTTP browsing, exact span/scope/link metadata, URL navigation and explicit UID-verified Pod links | Synthetic traces with real Pod verification; live provider, broader correlations/filters/transports and lossless raw viewing remain |
| Pod/proxy diagnostics | Container inventory, bounded logs, Envoy inspection, current-Service/configuration candidates and explicitly selected ztunnel registry tables | Envoy/Service hosted-live; configuration/ztunnel positives fixture-backed; broader metadata formats, authorized sync, ambient metrics, logging controls and Desktop remain |
| Parity evidence | Source inventories, reproducible generators, synthetic fixtures and live Bookinfo checks | Inventoried does not mean implemented |

### Application semantics to preserve

- Default label priority is canonical Istio labels, then `app.kubernetes.io`
  labels, then `app`/`version`. A configured pair replaces that fallback order.
- Presence matters: an empty preferred label value is distinct from a missing
  label. Empty application labels remain addressable through query parameters.
- Replica-controller application labels come from pod templates; Job/CronJob
  application labels come from controller metadata, matching the pinned source.
- Controller owner references require matching scoped UID, group, kind and
  name. Do not replace this with name-only matching.
- Owned ReplicaSets/Jobs collapse into observed parents. Missing or inconsistent
  parents are explicit uncertainty; known children may remain visible.
- Selectorless Services do not automatically select every pod or workload.
- Native sidecars are recognized in restartable init containers with
  `restartPolicy: Always`. Container presence does not prove proxy health.
- Snapshot reads cover nine namespaced kinds: Deployments, StatefulSets,
  DaemonSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs, Pods and Services.
  A discovered WorkloadGroup/WorkloadEntry source now supplies VM label provenance.
- Reads use three workers, a shared 15-second deadline and at most four 250-item pages per kind. Limits,
  permission failures, malformed responses and inconsistent pagination are
  reported as incomplete; incomplete zero counts are shown as unavailable.
- Derived application refresh is manual. Arbitrary custom/external/registry
  workloads, OpenShift-specific controllers and multi-namespace UI remain incomplete.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/index.tsx` | Registration only, with `kiali-` names and `/kiali/...` paths |
| `src/config.ts`, `src/core/config.ts` | ConfigStore integration, schema validation and cluster-specific merging |
| `src/core/tracing.ts`, `src/data/tracing.ts`, `src/components/Traces.tsx` | Bounded HTTP tracing normalization, scoped reads and native search/detail |
| `src/core/scope.ts`, `object.ts` | Explicit scope, identity and shared guards |
| `src/core/labels.ts`, `correlation.ts` | Pure selector, label, owner and application relationship logic |
| `src/core/health.ts`, `readiness.ts` | Separate Kiali health primitives and Kubernetes readiness |
| `src/data/requests.ts`, `correlation.ts` | Headlamp transport adapters, response validation and bounded snapshots |
| `src/{core,data}/diagnostics.ts`, `core/proxyHttp.ts`, `core/proxyConfig.ts`, `data/proxyAdmin.ts` | Bounded pod logs and native WebSocket Envoy observations |
| `src/hooks/useRequest.ts` | Scope/key-bound asynchronous state and cancellation |
| `src/components/` | Current native views and settings |
| `locales/en/translation.json` | Extracted nonempty English strings |
| `scripts/parity/` | Inventory/oracle generation and consistency checks |
| `test-files/parity/`, `test-files/correlation/` | Committed synthetic evidence; no production credentials |
| `test-files/deploy/` | Pinned Bookinfo/Prometheus examples and local Kustomize overlays |
| `docs/parity.md` | Feature evidence, partial coverage, limitations and provenance |
| `src/resources/`, `src/mapView.tsx` | Generated Istio models and structural configuration topology |
| `scripts/generate-resources.mjs`, `test-files/configuration/` | Sanitized live schemas, deterministic model generation and synthetic configuration fixtures |
| `src/core/telemetry.ts`, `trafficGraph.ts`, `validation.ts` | Initial query/response/graph/checker core |
| `src/data/mutations.ts`, `telemetry.ts`, `configuration.ts` | Guarded configuration changes, metric reads and API discovery |
| `docs/OVERVIEW.md` | Planned permanent coverage/screenshot document; not implemented yet |

Keep pure core logic independent of React and transport. Keep adapters explicit,
typed and testable. Stay within this package; do not create a monorepo, generic
plugin framework, second React/Redux instance or bundled Kiali SPA.

## Milestone status and dependencies

This table is the portable execution record. Update it directly; access to the
original agent's SQL task store is not required.

**Done** means the initial bounded milestone described above was delivered.
It does not mean every upstream subfeature in that family has reached parity.
**Partial / open** still has implementation work. The full-parity ledger remains
the authority for individual behavior and platform claims.

| ID | Status | Deliverable / remaining work | Prerequisites |
| --- | --- | --- | --- |
| `parity-catalog` | Done | Initial pinned source and behavior inventory | None |
| `stock-host-spikes` | Done, bounded | Public APIs needed by native browsing/settings proved; advanced transport/renderer questions remain with their feature tasks | `parity-catalog` |
| `parity-harness` | Done, foundation | Reproducible inventories/oracles; add fixtures for each new port | `parity-catalog` |
| `shared-context` | Done | Scope, identity, settings, failure states and cancellation | `stock-host-spikes`, `parity-harness` |
| `resource-access` | Done, initial | Typed built-in SDK models and explicit ApiProxy adapters; new CRD models belong to `config-views` | `shared-context` |
| `resource-views` | Done, initial | Native read-only lists, readiness and native detail links | `resource-access` |
| `correlation` | Done, initial | Supported Kubernetes correlation core and first Applications consumer; complete workload/account inclusion remains open ([#7](https://github.com/therealmitchconnors/headlamp-kiali/issues/7), PR [#11](https://github.com/therealmitchconnors/headlamp-kiali/pull/11)) | `resource-access` |
| `config-views` | **Partial / open** | Applications and all 23 baseline configuration kinds implemented; more relationship edges and real-CR/Desktop evidence remain | `resource-views`, `correlation` |
| `safe-mutations` | Partial / open | Guarded spec CRUD and validation-exclusion annotation editing implemented; real-write verification and broader resource actions remain | `config-views` |
| `basic-validation` | Partial / open | Forty-one bounded codes, including integrated Service port checks (#1) and declared-scope Gateway checks (#2); Gateway route attachment, effective workload/principal context and broader checks remain ([#8](https://github.com/therealmitchconnors/headlamp-kiali/issues/8), PR [#12](https://github.com/therealmitchconnors/headlamp-kiali/pull/12)) | `config-views`, `mesh-security` |
| `telemetry` | Partial / open | Initial charts, eight rate families, histograms and bounded native dashboards implemented; VM/custom-workload annotation sources and complete upstream query/default coverage remain ([#24](https://github.com/therealmitchconnors/headlamp-kiali/issues/24), PR [#27](https://github.com/therealmitchconnors/headlamp-kiali/pull/27)) | `resource-views`, `correlation` |
| `health` | Partial / open | Calculator/reporter core and all three entity consumers implemented; protocol/reporter coverage and unknown-cluster/external/capability/query and proxy/ambient semantics remain ([#9](https://github.com/therealmitchconnors/headlamp-kiali/issues/9), PR [#13](https://github.com/therealmitchconnors/headlamp-kiali/pull/13)) | `telemetry` |
| `basic-graph` | Done, bounded | Initial graph plus workload/app/versioned-app/Service projections, history and rate metadata verified hosted; broader pipeline tracked below | `telemetry`, `correlation`, `stock-host-spikes` |
| `mesh-security` | Partial / open | Local inventory, mounted-source provenance, selected config merge, namespace-selector assessment and observed HTTP/gRPC security labels implemented; full effective configuration and observed-security parity remain ([#3](https://github.com/therealmitchconnors/headlamp-kiali/issues/3), merged PR [#4](https://github.com/therealmitchconnors/headlamp-kiali/pull/4); [#33](https://github.com/therealmitchconnors/headlamp-kiali/issues/33), merged PR [#38](https://github.com/therealmitchconnors/headlamp-kiali/pull/38)) | `correlation`, `config-views`, `telemetry` |
| `full-validation` | Partial / open | Incremental checker batches are implemented; effective policy context, Gateway API route attachment and broader checkers remain ([#8](https://github.com/therealmitchconnors/headlamp-kiali/issues/8), PR [#12](https://github.com/therealmitchconnors/headlamp-kiali/pull/12)) | `basic-validation`, `mesh-security` |
| `basic-wizards` | Partial / open | Existing-route weight editing, Service-driven DR/VS creation and bounded existing-pair updates with guarded partial outcomes implemented; broader routing and advanced controls remain ([#10](https://github.com/therealmitchconnors/headlamp-kiali/issues/10), PR [#14](https://github.com/therealmitchconnors/headlamp-kiali/pull/14)) | `safe-mutations`, `basic-validation` |
| `full-wizards` | Partial / open | HTTP/TCP Service creation and bounded existing-pair updates reuse guarded HTTP/matching/mirroring/DR policy editors; inbound-mTLS/Gateway-weight/exclusion editors exist; broader multi-object and Gateway API forms remain ([#10](https://github.com/therealmitchconnors/headlamp-kiali/issues/10), PR [#14](https://github.com/therealmitchconnors/headlamp-kiali/pull/14); [#15](https://github.com/therealmitchconnors/headlamp-kiali/issues/15), PR [#19](https://github.com/therealmitchconnors/headlamp-kiali/pull/19)) | `basic-wizards`, `full-validation` |
| `diagnostics` | Partial / open | Bounded logs, Envoy inspection/current-resource candidates and ztunnel configuration tables implemented; metadata projections, authorized synchronization, confirmed logging controls and Desktop checks remain ([#18](https://github.com/therealmitchconnors/headlamp-kiali/issues/18), PR [#22](https://github.com/therealmitchconnors/headlamp-kiali/pull/22); [#30](https://github.com/therealmitchconnors/headlamp-kiali/issues/30), PR [#36](https://github.com/therealmitchconnors/headlamp-kiali/pull/36)) | `resource-views`, `mesh-security`, `safe-mutations`, `stock-host-spikes` |
| `integrations` | Partial / open | Native Jaeger/Tempo HTTP browsing implemented; Tempo count predicates, trace/workload correlation, external dashboard discovery, live providers and authenticated transports remain ([#16](https://github.com/therealmitchconnors/headlamp-kiali/issues/16), PR [#20](https://github.com/therealmitchconnors/headlamp-kiali/pull/20); [#17](https://github.com/therealmitchconnors/headlamp-kiali/issues/17), PR [#21](https://github.com/therealmitchconnors/headlamp-kiali/pull/21); [#23](https://github.com/therealmitchconnors/headlamp-kiali/issues/23), PR [#29](https://github.com/therealmitchconnors/headlamp-kiali/pull/29)) | `telemetry`, `correlation`, `basic-graph`, `stock-host-spikes` |
| `multi-cluster` | Partial / open | Explicit saved identities and bounded context comparison implemented; shared-store normalization, full graph fan-out and configurable mesh membership remain ([#25](https://github.com/therealmitchconnors/headlamp-kiali/issues/25), PR [#28](https://github.com/therealmitchconnors/headlamp-kiali/pull/28)) | `config-views`, `telemetry`, `mesh-security` |
| `advanced-graph` | Partial / open | Four projection modes, request/byte/message units, captured history, per-node namespace position, table grouping, edge inspection and bounded neighbor focus implemented; reporter normalization, remaining appenders, ambient behavior and correlations remain ([#26](https://github.com/therealmitchconnors/headlamp-kiali/issues/26), PR [#31](https://github.com/therealmitchconnors/headlamp-kiali/pull/31); [#32](https://github.com/therealmitchconnors/headlamp-kiali/issues/32), merged PR [#37](https://github.com/therealmitchconnors/headlamp-kiali/pull/37)) | `basic-graph`, `health`, `full-validation`, `mesh-security`, `multi-cluster`, `integrations` |
| `runtime-hardening` | Partial / open | Captured/deadline-bound reads, repeatable hosted smoke and core analysis/rendering budgets implemented; browser-scale memory/responsiveness and both-mode resilience remain ([#5](https://github.com/therealmitchconnors/headlamp-kiali/issues/5), merged PR [#6](https://github.com/therealmitchconnors/headlamp-kiali/pull/6); [#34](https://github.com/therealmitchconnors/headlamp-kiali/issues/34), merged PR [#39](https://github.com/therealmitchconnors/headlamp-kiali/pull/39)) | `advanced-graph`, `diagnostics`, `full-wizards` |
| `parity-release` | Pending | Close the ledger, verify live, document and package with explicit remaining gaps | `runtime-hardening`, `full-validation`, `full-wizards`, `integrations`, `multi-cluster` |

The optional managed-Istio/Bookinfo/Prometheus environment and Desktop debug
target were provisioned for earlier verification. They are historical setup,
not an always-available task environment or current authorization to install,
seed, mutate or clean up resources. Recheck availability and obtain the exact
approval required before any cluster fixture or write.

### Issue-linked execution and catalog map

This table ties current assignments to the pinned inventory records and the
existing milestone IDs above. “Open” means the issue/PR is not integrated into
the baseline; it does not mean work is complete or that downstream acceptance
is unblocked.

| Assignment | Milestone | Individual pinned catalog obligations | Current issue / implementation PR |
| --- | --- | --- | --- |
| Integrated Service-port and declared-scope Gateway increments | `basic-validation` | KIA0601/KIA0602/KIA0701; Gateway listener/status/class and KIA0302 scope; only their documented bounded callers | Merged PR [#1](https://github.com/therealmitchconnors/headlamp-kiali/pull/1) and [#2](https://github.com/therealmitchconnors/headlamp-kiali/pull/2); source is in the base, runtime gates remain open |
| Effective mesh-configuration sources | `mesh-security` → `full-validation` | `resource:ConfigMaps`, `page-source:frontend/src/pages/Namespaces/NamespaceRevisionUtils.ts`, selected mesh fields and their consumers; explicit file/mount overrides and external sources remain guarded | [Issue #3](https://github.com/therealmitchconnors/headlamp-kiali/issues/3), open PR [#4](https://github.com/therealmitchconnors/headlamp-kiali/pull/4) |
| Hosted Headlamp smoke environment | `runtime-hardening` | Runtime import/load, route contribution, translated labels, accessible names and console behavior; no feature-family inventory is promoted | [Issue #5](https://github.com/therealmitchconnors/headlamp-kiali/issues/5), open draft PR [#6](https://github.com/therealmitchconnors/headlamp-kiali/pull/6) |
| Workload inclusion and account provenance | `correlation` → `full-validation` | `checker:business/checkers/workloadgroups/service_accounts_checker.go#ServiceAccountsChecker`, `validation-code:workloadgroup.template.serviceaccount.notfound` (KIA1701), UID-rooted workload inclusion | [Issue #7](https://github.com/therealmitchconnors/headlamp-kiali/issues/7), open draft PR [#11](https://github.com/therealmitchconnors/headlamp-kiali/pull/11) |
| Gateway API attachment/reference checks | `full-validation` | HTTPRoute/GRPCRoute checker and NoHost/NoK8sGateway records; KIA1601; TCPRoute/TLSRoute/UDPRoute identities remain explicit obligations, not inferred from schemas | [Issue #8](https://github.com/therealmitchconnors/headlamp-kiali/issues/8), open draft PR [#12](https://github.com/therealmitchconnors/headlamp-kiali/pull/12) |
| Health protocol/reporter queries | `health` | Seven `health-primitive:*` records and `frontend-contract:frontend/src/types/Health.ts`; per-source completeness, protocol/reporter and unknown-capability cases | [Issue #9](https://github.com/therealmitchconnors/headlamp-kiali/issues/9), open draft PR [#13](https://github.com/therealmitchconnors/headlamp-kiali/pull/13) |
| Existing-resource multi-object traffic workflows | `basic-wizards` → `full-wizards` | Individual traffic-shifting, request-routing, timeout/retry and supported DestinationRule wizard sources; immutable target and per-object outcome behavior | [Issue #10](https://github.com/therealmitchconnors/headlamp-kiali/issues/10), open draft PR [#14](https://github.com/therealmitchconnors/headlamp-kiali/pull/14) |
| Gateway API route create/attach forms | `full-wizards` | `wizard-source` records for `K8sRequestRouting`, `K8sGatewaySelector` and `K8sGRPCRouteHosts`; only source-supported HTTPRoute/GRPCRoute form fields | [Issue #15](https://github.com/therealmitchconnors/headlamp-kiali/issues/15), open draft PR [#19](https://github.com/therealmitchconnors/headlamp-kiali/pull/19) |
| Tempo spanset count/composition | `integrations` | Trace search/filter contract and related-span operators; exact AST, count, backend capability and query-budget obligations | [Issue #16](https://github.com/therealmitchconnors/headlamp-kiali/issues/16), open draft PR [#20](https://github.com/therealmitchconnors/headlamp-kiali/pull/20) |
| Trace-to-current-workload/graph association | `integrations` → `advanced-graph` | `page-source:frontend/src/pages/Graph/SummaryPanelNodeTraces.tsx`, trace/graph identity and current UID owner-chain fields; no historic identity inference | [Issue #17](https://github.com/therealmitchconnors/headlamp-kiali/issues/17), open draft PR [#21](https://github.com/therealmitchconnors/headlamp-kiali/pull/21) |
| Envoy/ztunnel metadata projections | `diagnostics` | Six diagnostic source units and `api:GET /api/namespaces/{namespace}/pods/{pod}/config_dump_ztunnel`; current-resource identity/link obligations | [Issue #18](https://github.com/therealmitchconnors/headlamp-kiali/issues/18), open draft PR [#22](https://github.com/therealmitchconnors/headlamp-kiali/pull/22) |
| Grafana/Perses discovery and links | `integrations` | `api:GET /api/grafana`, `api:GET /api/perses`, and the individual `GrafanaInfo`/`PersesInfo` contracts; external auth remains a separate capability gate | [Issue #23](https://github.com/therealmitchconnors/headlamp-kiali/issues/23), open draft PR [#29](https://github.com/therealmitchconnors/headlamp-kiali/pull/29) |
| VM/custom-workload dashboard attribution | `telemetry` | `api:GET /api/namespaces/{namespace}/workloads/{workload}/dashboard`, `WorkloadAnnotationsWizard.tsx`, supported annotation sources and precedence | [Issue #24](https://github.com/therealmitchconnors/headlamp-kiali/issues/24), open draft PR [#27](https://github.com/therealmitchconnors/headlamp-kiali/pull/27) |
| Shared/per-context telemetry store normalization | `multi-cluster` → `advanced-graph` | `GraphElementsQuery` namespaces/time/metric contracts and explicit context-to-telemetry mapping; no inferred mesh membership | [Issue #25](https://github.com/therealmitchconnors/headlamp-kiali/issues/25), open draft PR [#28](https://github.com/therealmitchconnors/headlamp-kiali/pull/28) |
| Mixed-reporter graph queries | `advanced-graph` | Individual `GraphElementsQuery` HTTP/gRPC/TCP rate, throughput and projection contracts; duplicate/conflicting labels and reporter provenance | [Issue #26](https://github.com/therealmitchconnors/headlamp-kiali/issues/26), open draft PR [#31](https://github.com/therealmitchconnors/headlamp-kiali/pull/31) |
| Authorized proxy sync/logging | `diagnostics` → `safe-mutations` | `api:POST /api/namespaces/{namespace}/pods/{pod}/logging`, Pod/container identity, authorized read-only sync evidence; observed `/debug/syncz` 401 remains a blocker | [Issue #30](https://github.com/therealmitchconnors/headlamp-kiali/issues/30), open draft PR [#36](https://github.com/therealmitchconnors/headlamp-kiali/pull/36) |
| Graph appenders and focused interactions | `advanced-graph` | All 17 individual `graph-appender:*` records: AggregateNode, Ambient, DeadNode, Extensions, Health, IdleNode, Istio, Labeler, MeshCheck, Outsider, ResponseTime, SecurityPolicy, ServiceEntry, SidecarsCheck, Throughput, TrafficGenerator and WorkloadEntry | [Issue #32](https://github.com/therealmitchconnors/headlamp-kiali/issues/32), open draft PR [#37](https://github.com/therealmitchconnors/headlamp-kiali/pull/37) |
| Observed connection-security telemetry | `mesh-security` → `advanced-graph` | Per-protocol/reporter security observations and graph `SecurityPolicyAppenderName` distinction; no configuration, sync, ambient or health verdict from absent samples | [Issue #33](https://github.com/therealmitchconnors/headlamp-kiali/issues/33), open draft PR [#38](https://github.com/therealmitchconnors/headlamp-kiali/pull/38) |
| Large-input budgets | `runtime-hardening` | Cross-cutting graph option/appender, query, selector/reference, dashboard-series and rendered-output records; measured host costs are distinct from pure-core limits | [Issue #34](https://github.com/therealmitchconnors/headlamp-kiali/issues/34), open draft PR [#39](https://github.com/therealmitchconnors/headlamp-kiali/pull/39) |
| Reconciliation and partial-release readiness | `parity-release` | All individual inventory rows retain their current evidence states; this task changes the handoff/readiness map only | [Issue #35](https://github.com/therealmitchconnors/headlamp-kiali/issues/35), this draft PR [#40](https://github.com/therealmitchconnors/headlamp-kiali/pull/40) |

#### Real prerequisite ordering

- #3 is the remaining effective-mesh-source prerequisite for expanding
  configured mTLS to workloads, ports or subsets. Complete workload/account
  attribution (#7) is a separate input for KIA1701/principal-absence and other
  complete-workload claims. Those checker batches require the source-specific
  evidence from **both** tracks; neither assignment alone enables them.
- #8 owns relationship-check semantics. #15 can build guarded proposals
  independently, but a form or submitted `parentRef` is not proof of attachment;
  final Gateway API relationship parity needs the implemented checker and
  complete target/grant evidence.
- #9 may advance against the currently supported subjects, but complete health
  coverage still requires supported workload/capability evidence; unsupported
  variants must remain unavailable rather than inheriting health from #7's
  assignment or current Pod correlation.
- #25's store normalization does not establish configurable cross-context mesh
  membership. Full cross-context graph claims require both the store mapping and
  a separately evidenced membership model. #26 is single-context and can land
  independently; full graph convergence also needs the individual #32 appender
  and interaction gates, plus only those trace/security inputs whose behavior
  is claimed.
- #16 query grammar and #17 UID-proven resource association are separate trace
  increments. Full trace parity additionally needs a real supported provider
  and platform transport evidence. #18 metadata decoding and #30 sync/logging
  controls are likewise separate; the observed 401 does not become a supported
  sync path.
- #23 external dashboard links and #24 VM/custom-workload attribution are
  independent bounded dashboard increments. Neither closes native dashboard
  family coverage, application authentication, or full source attribution.
- #5 is a prerequisite for repeatable hosted smoke evidence, not a substitute
  for Desktop, live-cluster, provider-authentication, or large-mesh measurements.
  #34's pure analysis limits cannot stand in for host rendering/memory data.
- `parity-release` remains pending until every in-scope ledger item is resolved
  for the claimed release scope and each platform claim has its own evidence.
  Open PRs, synthetic fixtures, passing tests, and generated inventories do not
  satisfy these gates by themselves.

## Validation and mesh context: next-task reconciliation (2026-11-03)

The current validation prerequisite is complete managed-namespace/controller
evidence. The new pinned GetRevision label projection is not that inventory,
nor the Namespace DTO injection-revision field. Preserve its literal/empty/
Maistra/injection/ambient precedence without automatically resolving controllers.
Same-context first-webhook tag selection is now implemented and source-tested,
including replacement/empty semantics and raw controller revisions. Do not
mistake it for the full managed-cluster assignment loop: logical cluster
identity, managed-cluster relationships, Kiali visibility and cross-cluster
last-assignment behavior remain prerequisites.
The first-container choice and supported literal environment loop are now
source-aligned: last CLUSTER_ID/SHARED_MESH_CONFIG assignment and exact-string-true
accumulation, with indirect/noncanonical values explicitly guarded.
Self-management is ID == logical cluster name, independent
of ManagesExternal. Explicit per-context `meshClusterName` and captured UI
comparison are now implemented without implicit context/telemetry fallback.
The typed local/default-visibility scope now requires complete controller/tag/
namespace reads and configuration, with supported local topology and explicit
mapping. The scoped Gateway inspector now consumes it for complete default
workload inclusion and Gateway evidence. Service port checks were also integrated
in merged PR #1 and are present in this base; neither these checks nor the scoped
Gateway action has the newer browser/live verification requested by its ledger
entry. Remote contexts
and custom Kiali visibility remain unsupported; do not promote the comparison
hint or prior label-based configuration inspection to complete membership.
Service checks in the pinned caller pool Pods across all managed namespaces,
match selectors without another namespace filter, and treat empty selectors
as matching that pool. Their sidecar test is all-Pod/vacuous-empty, with a
separate any-ambient path and annotation-derived proxy evidence. Deployment port
mapping uses the first cluster-wide metadata-label match. Namespace-local
approximations must not activate KIA0601/KIA0602/KIA0701.

The bounded Gateway increment is complete locally, not live-verified. Its active
caller adds KIA0302, while the existing listener/host/port/status/class predicates
are reused without inventing new diagnostics. PILOT_SCOPE_GATEWAY_TO_NAMESPACE
retains exact-true accumulation from the first declared container; unresolved
flags or multiple eligible controllers block the scoped check. Custom workload
owners, configured nondefault inclusion and full controller health remain open.
The mounted ConfigMap source batch is now implemented with selected-source
provenance, version rechecks and bounded networks-dependency guards. Next audit
nonempty networks acceptance and full protobuf parse/fusion/backend defaults,
then remaining configuration-cluster topology and caller-specific TLS context,
before workload/port/subset mTLS or principal-absence checks. Close the Gateway runtime
gates in an authorized environment independently; do not enable dormant port
helpers or infer listener attachment from this milestone. The separate HTTP/
gRPC route-reference check covers only its documented parent-sharing and
Service-reference predicates; listener selection/protocol/hostname attachment
and TCP/TLS/UDP route predicates remain open.

The older dashboard “next” note is split into independent #23 external-link and
#24 VM/custom-workload attribution assignments; both PRs are still unmerged.
Workload recommendations are now integrated
through an explicit inspector, reusing application recommendation/chart code
while retaining paired app/version filters and a fresh workload overlay.
Selected child controllers are rooted by UID without including sibling Pods.
Native resource details remain the spec/status/conditions/events surface;
the new inspector intentionally does not duplicate them. Captured panels can
now expand without refetching, using a native keyboard-accessible dialog rather
than claiming full upstream viewport/row layout parity. Optional captured rows
now apply the pinned height formula to the browser viewport, preserving
natural sizing unless explicitly enabled and leaving other content in normal
flow. Rows do not inherit from included templates or change query budgets.
Time-axis styles support
line, area, bar and point presentation without reporter pairing or stacking.
Series axes use latest-finite-per-series projection with exact selected times,
explicit unavailable categories and independent placement. Missing chartType
uses the axis default; explicitly empty chartType means line.
Initial chart collapse is supported with local Show/Hide/Expand controls, without
skipping queries or hiding failures. New captures reset visibility to definitions.
Series sorting retains its captured query grouping,
lexical/exact-int64 order and sort-only label-removal semantics. Invalid integer
strings and indistinguishable displayed groups fail explicitly instead of
upstream's silent fallback or ambiguous series. Application recommendations now explicitly
inspect captured UID-owned Pod references, then use namespace-overlaid
discovery only when no references resolve and complete supported-source
correlation permits the configured policy (auto threshold 10 by default).
The three default app labels retain source order and punctuation sanitization;
a full configured app/version pair uses only the app key. The application
caller has no version filter or workload overlay. Later discovery matches
replace whole runtime groups. Embedded charts preserve the winning app selector,
or require an explicit choice for ambiguous reference-only conventions.
Settings/evidence changes clear captures without replay. Do not generalize this
into background fan-out or VM/telemetry-ownership/health inference.
Explicit Namespace/workload annotation overrides are now implemented
for supported Kubernetes kinds, without writes or silent fallback. Built-in definitions and explicit saved-template
discovery, composition and label grouping are implemented for their documented
bounded subsets. Literal includes are now preserved in settings for discovery;
composition still trims them. Broader automatic/background discovery still
depends on complete workload attribution and configured label-policy semantics.
Per-template disabling is implemented: empty items and a Go-trimmed empty
discoverOn remove a name after override precedence. Declaration records remain
saved, and dependent includes fail rather than reviving a bundled default.
Annotation reads are ephemeral and explicit. Namespace definitions apply before
workload definitions; Pod/Job/CronJob use resource metadata, while supported
controllers prefer every non-null pod-template annotation map (including empty).
The UI invalidates source captures on target/settings changes and does not
resurrect them on return. Custom-controller/VM annotation sources remain open.

The pinned `config/dashboards/dashboards.go` catalog contains **21 templates and
91 inline charts, 42 without a unit**. Its extra chart fields are `spans`, `min`
and `aggregations`; no `chartType` or `xAxis` fields occur in that catalog.
Unitless charts, captured axis bounds and responsive spans are now supported.
Aggregation grouping/value controls, explicit bounded chart selection and the
opted-in pinned catalog are implemented without silently dropping panels:
the pinned `thorntail` template expands to nine charts, and histogram expansion
can exceed the eight-query budget independently of chart count. The catalog has
59 aggregation declarations, using only label/displayName and no conflicting
aliases after include expansion. Saved-user inputs retain their 20-template/
64 KiB budget; the bundled 21 templates have a separate 64 KiB guard. Effective
metadata is bounded to 41 templates, 328 resolved charts and 128 KiB, while
requests/series remain independently bounded. Use `dashboards:generate`/
`dashboards:check` for the pinned generated capture.
Preserve strict scalar decoding for ungrouped callers and explicit response,
panel and query cardinality limits.

1. Extend remaining configuration checkers after their source/evidence
   prerequisites. The bounded Gateway increment is complete locally; its runtime
   gates remain open. HTTP/gRPC parent/Service/grant checks and namespace-wide Sidecar
   import/export visibility now exist. Preserve strict group/name grants and
   conservative source boundaries; partial context must defer absence claims.
   The reusable Service host registry now preserves namespace export annotations
   and defaults. VirtualService destination checks, AuthorizationPolicy host
   registry/exemptions and outbound-policy severity are wired; preserve each
   caller's export filtering for remaining destination/policy checker families.
   KIA1701 WorkloadGroup service accounts require workload-attributed Pod-account
   evidence: neither ServiceAccount object existence nor raw Pod presence
   reproduces the pinned input. The pinned-default namespace projection now
   exists, but it does not capture runtime Kiali workload exclusions, custom
   controllers or managed/cross-context membership. VM WorkloadEntry accounts
   remain separate; do not activate KIA1701 or infer absence until those policy
   and scope gates are resolved.
2. Resolve remaining effective mesh configuration sources before extending
   configured mTLS to workloads, ports and subsets. The mounted-file batch is
   implemented; nonempty networks, full parse/fusion/default evidence and
   external configuration mapping remain unsupported. Preserve the distinction
   between configuration, observed connection security and proxy synchronization.
3. Complete health query coverage and supported workload variants.
   Application/Service consumers are now wired. Service-driven creation and
   the bounded existing-pair edit use existing correlation and guarded mutation
   adapters. Extend only after auditing target selection and field preservation;
   multi-object proposals require per-object outcomes, with no blind retry or rollback.
4. Continue tracing workload/graph correlations and remaining
   structural/count intrinsic filters and broader cross-span pipelines. One
   explicit related group with six fixed relationships is implemented.
   Trace-wide root/duration,
   event-name/offset, trace/span/parent/link IDs and instrumentation name/version intrinsics and
   event/link/instrumentation attribute scopes are now implemented.
   Literal attribute names,
   typed attribute comparisons,
   span name/status-message/duration/status/kind predicates and bounded RE2 are
   implemented. On-demand service/operation discovery is now implemented,
   using Jaeger name APIs and Tempo typed tag values rather than component status.
   Span/scope/link metadata and explicit UID-verified Pod references now exist.
   Bounded exact string tags and current/historical search controls also exist.
   Backend service names are not automatically Kubernetes identities.
   Existing HTTP search/detail needs no reimplementation. Live-provider success
   requires an existing backend or separately approved test infrastructure.
   The traffic graph has a bounded source-aligned mixed-reporter projection/query
   surface as well as explicit single-reporter modes. Preserve exact identity,
   missing-label and conflict semantics; broader upstream query/default,
   ambient/waypoint, appender and missing-report reconciliation remains open.
   Do not infer Kubernetes identity, resource health or policy enforcement from
   metric labels.
5. Preserve all 23 generated models and checksum-bound schema captures. Read
   the focused skills for any new resource/detail/settings work rather than
   invoking the whole operator-installing build workflow.
6. Extend the now-proven read-only Envoy transport and cluster/route/listener
   inspection beyond current Service and canonical DestinationRule/VirtualService
   candidate links, while keeping authorized sync evidence separate.
   The managed Istiod Pod-proxy `/debug/syncz` endpoint returned 401; do not
   create credentials or work around that authentication boundary.
   Do not infer synchronization from admin HTTP success, server LIVE state,
   an active configuration or an injected container. Preserve unnamed/repeated
   resources rather than imposing Kubernetes-like name uniqueness.
7. Recheck hosted and Desktop availability, run relevant regression gates and
   verify actual rendering. Keep remaining diagnostics/multi-cluster/dashboard
   transport gaps explicit; no bridge or cluster install to conceal them.

### Recent verification details

The latest hosted checks verified all nine real absent-API banners and synthetic
GatewayClass/Gateway/HTTPRoute/InferencePool details. A browser-intercepted
GatewayClass create exercised SSAR, dry-run and final confirmation without a
namespace in any request. All writes were intercepted; no Gateway CRD or resource
was applied. Native links, named controls and Conditions-before-Events were
inspected, with no plugin execution failure. The first fixture attempt blocked
the host's read-only SelfSubjectRulesReview and triggered its login screen;
the corrected fixture explicitly supplies that review and does not change
cluster RBAC.

The host/reference follow-up was also loaded in hosted Headlamp: synthetic
VirtualService input against real namespace/empty DestinationRule/Sidecar lists
produced KIA1107; an intercepted matching subset removed it; intercepted Sidecar
403 deferred it. Unknown DNS identity deferred checks without guessing.
Gateway listener and ReferenceGrant namespace fixtures produced KIA1503 and
KIA1601 with correct error severity/paths. No resource was written. Actual
NamespaceList items omit type metadata; the decoder now inherits validated
envelope type while rejecting conflicting item types. This has a regression test.

The traffic-weight editor was verified on an intercepted VirtualService in the
same stock hosted instance: an invalid total blocked review; a 50/50 to 80/20
proposal preserved matches, mirror, timeout, headers, ports and metadata; dry-run
preceded explicit confirmation; a subsequent changed resourceVersion blocked
another write. All PUTs were intercepted. Without a real watch event, the host
cache retained the old display, so configuration actions now expose an explicit
Reload page fallback rather than relying on private cache APIs.

Mesh inventory was verified against real managed Istio: `istiod-asm-1-30` in
`aks-istio-system`, 2/2 available replicas, `CLUSTER_ID=Kubernetes`, controller
image `mcr.microsoft.com/oss/v2/istio/pilot:v1.30.5-3`, configured root namespace
`aks-istio-system`, trust domain `cluster.local`, and injector DNS suffix
`cluster.local`. Bookinfo matched the revision label. The Deployment references
`istio-shared-configmap-asm-1-30`, which actually returns 404; this remains a
visible optional-source warning. An intercepted shared source verified local
precedence, alias union and explicit false; an intercepted denial blocked the
projection. No ConfigMap or webhook was written and no Secret was read.

The configured-mTLS page was exercised using real Bookinfo/controller/config/
policy reads and correctly reported UNSET with an explicitly labeled automatic
mTLS default. Intercepted root STRICT policy, denied DestinationRules and
conflicting root policies verified inherited/unknown/conflict handling. The
final view was restored to real data, with no policy writes. Empty selectors
are normalized as namespace-wide in this consumer, and conflicts block rather
than arbitrarily selecting the first policy; these are deliberate safeguards
beyond the pinned low-level helper behavior.

Native tracing was exercised in stock hosted Headlamp with intercepted Jaeger
and Tempo responses: capability probes, search, span details/parents, relative
timing, exact nanoseconds/int64 values, saved settings, reloadable deep links,
same-ID retries, 404 and 403 handling. All tracing success reads were intercepted;
the real missing-Service check returned 404. Request captures confirmed explicit
cluster paths and `Accept: application/json`, with no plugin execution failure.
Temporary tracing settings were disabled again and handlers removed. Unit tests
also cover cancellation, late responses, duplicates, cycles, bounds, unsafe
numbers, timestamp overflow and malformed/error-bearing responses.

Application/Service health was subsequently exercised against real Bookinfo
after 36 bounded productpage GETs. Service `reviews` had healthy inbound requests;
application `reviews` had healthy replica/request health with three 1/1/1
Deployments. Canonical telemetry identity was entered explicitly. An absent
telemetry cluster suppressed health. Application and Service list/detail links
retained exact target names/namespaces. No response fixture or resource mutation
was used, and Prometheus had zero restarts before these reads.

Bookinfo's current fixtures primarily provide Kubernetes objects. Do not assume
representative VirtualService/DestinationRule instances are present. If seeding
is needed, obtain explicit approval for the exact cluster/namespace first.
An empty list or a green build is not describe-parity evidence.

If multiple agents work independently, agree on ownership of shared registration,
configuration, locale and ledger files. Do not run concurrent watchers that
overwrite the same installed plugin.

### Runtime-hardening checkpoint — 2026-11-03

Measured the code at PR base `655e75109cf27f964f55045bdadfe39c72d22022` and
added `scripts/bench-analysis.ts`, runnable with:

```sh
node_modules/.bin/vite-node --script -c node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs scripts/bench-analysis.ts
```

The dense correlation fixture previously retained 2,000,000 Service relation
matches plus 1,000,000 reverse workload-to-Service references from 1,000
Services, 1,000 Deployments and 1,000 owned Pods. Correlation now fails closed
beyond 20,000 total workload/Pod matches; exact accepted and next-match tests preserve complete-result semantics. Resource decoding also
bounds per-map labels/text, owner references and aggregate source labels/text.
The general metric chart now accepts at most 1,928 total points, matching the
existing eight-series × 241-sample comparison shape; larger decoded results show
an explicit error instead of being flattened into chart/table output.

The same harness verifies the existing 4,000-observation/1,000-node/2,000-edge
topology shape and the exact 20,000 VirtualService host×gateway contributions.
Their thresholds and semantics were not changed. Before/after scenario sizes,
counts, single-run measurements, test commands, and the distinction from actual
Headlamp rendering are recorded in `docs/parity.md`. Initial HTTP buffering and
JSON parsing by Headlamp/transport remain outside plugin-side decoding limits.
No live Headlamp browser target was available; browser rendering, memory,
accessibility and responsiveness evidence remain open. No cluster or live
traffic was used.

## Full scoped target and later acceptance gates

### Resource and configuration inventory

Expand coverage from the pinned API criteria and actual discovery, not a guessed
list. The initial inventory includes:

- Istio networking: VirtualService, DestinationRule, Gateway, ServiceEntry,
  Sidecar, WorkloadEntry, WorkloadGroup and EnvoyFilter.
- Security: AuthorizationPolicy, PeerAuthentication and RequestAuthentication.
- Extensions/telemetry: WasmPlugin, Telemetry and TrafficExtension.
- Gateway API: Gateway, HTTPRoute, GRPCRoute, TCPRoute, TLSRoute, UDPRoute,
  ReferenceGrant and InferencePool; supporting GatewayClasses where referenced.
- Supporting resources: namespaces, Services, EndpointSlices/Endpoints, pods,
  controllers, events, control-plane configuration and supported DeploymentConfigs.

For each resource, record scope, versions, schema/getters, list column sources and
visibility, full meaningful detail sections, related links and action behavior.
Use ResourceListView for resources and native tables for logical applications.
Use read-only code blocks for specific free-form fields, not raw JSON as a
substitute for meaningful detail presentation.

### Safe actions and early diagnostics

- Add confirmed CRUD and supported workload/Service/namespace operations through
  Headlamp, with explicit captured targets and resourceVersion handling.
- Surface permission changes, conflicts, validation failures and partial results.
  Do not retry destructive operations blindly.
- Introduce useful missing-target/reference/selector checks before the entire
  validation catalog. Preserve upstream diagnostic codes, severity and field paths.
- A partial snapshot cannot prove a configuration is valid.

### Telemetry, health and first graph

- Port safe query construction and typed Prometheus-compatible result decoding.
- Cover HTTP/gRPC/TCP signals, inbound/outbound metrics, reporter selection,
  histograms/quantiles, throughput, missing samples and duplicate-series handling.
- Health thresholds, annotations, HTTP/gRPC semantics, reporter aggregation and
  absent-versus-zero handling are source/oracle-backed for supported workloads,
  Applications and inbound-only Services. TCP byte metrics do not provide
  request-code health; unsupported protocols, missing directions and unavailable
  capability evidence stay unavailable rather than healthy.
- Build a simple deterministic observed graph before advanced decorations.
  Never synthesize traffic edges from ownership/selector relationships.
- Compare query, health and graph outputs to pinned upstream fixtures.

### Full validation, mesh analysis and wizards

- Complete every scoped checker/code in independently testable batches: routing
  hosts/subsets, Gateway API relationships, security scope/selectors, sidecar
  imports, ambient and remaining extension/telemetry/workload cases.
- Discover control planes, revisions, networks and sidecar/ambient participation.
  Keep policy intent, observed mTLS and proxy state separate.
- Implement wizard logic as pure proposed change sets first. Then present diffs,
  targets, conflicts and impact before applying.
- Cover traffic shifting, routing, timeouts/retries, fault injection, circuit
  breakers, policies, Gateway API forms, annotations and deletion workflows.
- Multi-object changes are not transactions: report per-object outcomes and stop
  safely on failure. No unreviewed automatic rollback.

### Diagnostics and other integrations

- Port supported pod logs, proxy synchronization, Envoy listener/cluster/route
  inspection, ztunnel configuration and confirmed logging controls.
- Complete resource/control-plane/ztunnel/custom dashboards.
- Extend the implemented Jaeger/Tempo HTTP trace/span search, details and
  normalization with workload correlation and graph overlays; add
  Grafana/Perses discovery and dashboard links.
- Use existing HTTP equivalents where they provide the same behavior.
  A deep link alone is not integrated-tracing parity, and browser fetch is not
  a substitute for native gRPC.

### Multi-cluster and advanced graphs

- Keep Headlamp cluster identities separate from Istio/telemetry labels, using
  explicit mapping rather than assuming names match.
- Support cluster-group fan-out and shared/per-cluster metric stores without
  double counting or cross-scope cache leakage.
- Keep graph coverage at the behavior level. The bounded single-context increment
  appends selected/outside/unknown namespace position after each of the four
  projections, groups the node table by none/app/cluster/namespace, and focuses the
  existing diagram on a selected node and its directly observed neighbors. Grouping
  and focus carry the exact captured query scope/time and reset on scope changes.
  These are not Kiali `isBox` graph nodes or node-detail graph requests.
- Unknown identity remains explicit in projections; it is not an independent
  appender and does not imply inaccessible or dead. In particular, zero-rate
  observations are not definition-backed idle nodes, and missing historical
  samples do not prove dead, missing, or healthy. The full per-appender evidence
  boundaries are in `docs/parity.md`.
- Preserve blackhole/passthrough semantics as unsupported; no security/health/config
  decorations, ambient/waypoint behavior, multi-context graph fan-out, or full
  upstream option/default parity is inferred from labels or partial inventories.
- Preserve per-cluster errors and provenance. A graph selection must not silently
  change a mutation target.

#### Current appender coverage

| Appender | Coverage |
| --- | --- |
| AggregateNode | Deferred |
| Ambient | Deferred |
| DeadNode | Deferred |
| Extensions | Deferred |
| Health | Deferred |
| IdleNode | Deferred |
| Istio | Deferred |
| Labeler | Deferred |
| MeshCheck | Deferred |
| Outsider | Partial: namespace-name position only |
| ResponseTime | Deferred |
| SecurityPolicy | Deferred |
| ServiceEntry | Deferred |
| SidecarsCheck | Deferred |
| Throughput | Partial: separate TCP byte measures only |
| TrafficGenerator | Deferred |
| WorkloadEntry | Deferred |

### Runtime and release closure

- Measure query fan-out, memory, analysis/rendering cost and large-mesh behavior.
  Record and enforce actual budgets. Use workers/incremental computation only
  when measurement and host compatibility justify them.
- Complete accessibility, translation, screenshots/coverage documentation and
  packaging. Verify new runtime imports in the actual host.
- Maintain an explicit compatibility matrix and upstream-update review process.
- Reconcile every parity entry; do not stop at convincing screenshots or hide
  unsupported cases behind success-shaped UI.

## Verification environment and operating notes

Last verified local setup:

| Item | Value / behavior |
| --- | --- |
| Kubernetes context | `mitch-auto`; verify it still exists and is the intended target |
| AKS | Automatic; latest hosted discovery reports Kubernetes 1.36.4 |
| Istio | Managed `asm-1-30`, CNI chaining, control plane in `aks-istio-system` |
| Bookinfo | Six injected deployments in `bookinfo` |
| Prometheus | Example Prometheus 3.10.0 in `istio-system`, Service port 9090 |
| Sample source | Istio 1.30.6, commit `b85dac9587f2f997151d205e069e4f4ff091c7c5` |
| Desktop | Headlamp 0.35.0, user-launched CDP on loopback port 9222 |
| Temporary hosted checks | Used loopback port 4487; server is not left running |

The AKS platform blocked self-managed injection webhooks and privileged
`istio-init` capabilities. The supported managed mesh and CNI were used instead.
**No admission policy was weakened.** Do not attempt to recreate the failed OSS
installation, alter protected webhooks/namespaces, or grant privileges to force
an unsupported diagnostic.

The sample setup was explicitly requested for development. It does not change
the no-new-installation product goal. Use `kubectl --context mitch-auto ...`
rather than changing the user's current context. Installation/teardown commands,
source hashes, resource overlays and traffic generation are in the fixture guide.
No persistent traffic generator was left running; rate-based views need fresh
traffic when being checked.

To provide Desktop debugging, the user fully quits Headlamp and launches:

```sh
/Applications/Headlamp.app/Contents/MacOS/Headlamp \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1
```

In another terminal:

```sh
curl --fail http://127.0.0.1:9222/json/list
```

Attach to Headlamp's `page` target with available CDP/browser tools. Do not assume
the original session's helper scripts or screenshots are present. Keep CDP
loopback-only; it grants control of the app. The user launches the Electron GUI.

The pinned SDK's `npm start` copies into the normal Headlamp `plugins/kiali`
directory, not `dev-plugins`. Follow the actual CLI output, avoid competing
watchers, and preserve a production package when stopping temporary helpers.
Do not hand-create symlinks to paper over a plugin load failure.

## Checks and evidence

Latest code validation: **649 Vitest tests**,
TypeScript, lint, production build, packaging and parity consistency passed.
Both health and label oracle regeneration checks reproduced the committed outputs.
The new resource schema generator also passes `npm run resources:check`.
This is historical evidence; rerun the relevant checks after code changes.

```sh
npm run tsc
npm run lint
CI=1 npm test
npm run parity:check
npm run resources:check
npm run build
npm run package
```

Packaging refuses to overwrite an existing tarball; inspect and replace only the
specific generated artifact when intentionally rebuilding it. Use the existing
toolchain rather than modifying its build configuration.

The fixtures do not need Go during ordinary npm tests. Go is used only to
regenerate independent expected outputs. Follow the pinned checkout and source
hash instructions in `test-files/README.md`; do not regenerate expectations from
the TypeScript implementation under test.

Live evidence includes:

- Four Bookinfo Services and six ready Deployment rows with native filtering and
  resource links in Desktop and hosted mode.
- Four applications; reviews has three versions, one matching Service and three
  UID-owned pods detected as native sidecars.
- Per-cluster settings persistence, connection checks, label-override effects,
  and restoration without overwriting Prometheus configuration.
- Actual Desktop ApiProxy access to Prometheus metrics; healthy Bookinfo scrape
  targets during fixture setup.
- Accessible names on the new controls and nonblank English translations.
- No plugin execution or component failure after the runtime compatibility fixes.

Restricted-user, large-scale, other telemetry-provider and full graph scenarios
are not established by those successful checks. Continue negative fixtures and
live coverage rather than extrapolating from the administrator/demo case.

## Known compatibility traps and open risks

| Area | Evidence / required handling |
| --- | --- |
| Runtime values | Type-checking does not prove an externalized value exists in Headlamp. Use documented barrels; deep type imports are different from runtime imports. |
| Service helpers | Headlamp 0.35.0 lacks `Service.getFormattedPorts`; the current renderer uses stable spec fields. Keep its regression test. |
| Links | That host expects `CommonComponents.Link.search` to be a string. Serialize with URLSearchParams; do not trust newer declaration support for objects. |
| Charts/graph internals | The probed generic CommonComponents Chart export was absent. Select documented/exported or compatible bundled renderers before using them; do not deep-import private GraphView internals. |
| Proxy synchronization | `istioctl proxy-status` could not create RPC credentials in the protected managed namespace with this caller. Do not bypass that policy; investigate legitimate read-only transport separately. |
| gRPC-only tracing | Requires an existing equivalent HTTP operation or an explicit stock-host parity gap, not a new bridge. |
| Port forwarding | A listener belongs to the backend machine; hosted-browser localhost is not backend localhost. Track and clean up only forwards the plugin owns. |
| External auth/CORS/TLS | Kubernetes proxy authorization does not automatically authenticate an application. No arbitrary credential forwarding or ConfigStore secrets. |
| Visibility | A user's readable resources can differ from Kiali's service-account-wide view. Incomplete data cannot prove absence, health, security or valid configuration. |
| Background lifecycle | A browser is not an always-on backend; explicitly define refresh, invalidation and cancellation semantics. |
| Host diagnostics | Hosted Headlamp logged its deprecated CRD-v1beta1 discovery 404. Desktop also produced host release-fetch/permission-review or watch-close diagnostics in some runs. Do not misreport all host logs as clean, or confuse them with plugin execution failures. |
| Screenshots | Desktop CDP screenshot capture timed out; DOM/console evidence and hosted Playwright snapshots/screenshots were used. Do not invent Desktop image evidence. |
| Mutations | Freeze target identity, handle resourceVersion conflicts and permission changes, and expose partial multi-object outcomes. |

## Parity accounting and completion

Keep each inventory item tied to upstream source, plugin module/UI, prerequisites,
defaults/versions, tests and separate Desktop/web evidence. Use the ledger states
`planned`, `implemented-unverified`, `verified-parity`, `partial`,
`blocked-stock-host`, `replaced-by-Headlamp` and `excluded-by-user`.

Graph options, appenders, checker codes and wizard actions need individual
coverage entries, not a single family-level success mark. Preserve source
attribution and explain deliberate semantic deviations such as strict UID
ownership. Normalize only non-semantic differences in differential comparisons.

Full scoped parity is reached only when every in-scope behavior is verified or
genuinely replaced by equivalent Headlamp behavior on the claimed platform.
Otherwise release explicitly as partial parity with the remaining gaps. Update
this plan, `docs/parity.md` and the eventual `docs/OVERVIEW.md` together so the
handoff never depends on stale append-only progress notes.
