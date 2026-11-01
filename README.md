# Kiali

A Headlamp plugin for Kiali, scaffolded with
`@kinvolk/headlamp-plugin@0.14.0` following the
[Headlamp getting-started guide](https://headlamp.dev/docs/latest/development/plugins/getting-started/).

The native plugin adds a **Kiali** sidebar with an overview, Applications,
namespace and Service lists, workload-kind tabs, mesh inventory/configuration,
traffic metrics, application/Service/workload health, trace browsing, pod/proxy
diagnostics and per-cluster settings.
Namespace filters and resource details reuse Headlamp's native components.
The overview checks Istio API availability and an explicitly configured existing
Prometheus Service through Headlamp's Kubernetes proxy.

This is **not full Kiali parity**: the first Istio configuration, mutation,
traffic-chart/graph, Gateway API resources and limited-validation surfaces are implemented, but
full mesh-health/validation semantics, advanced graph
behavior, full tracing correlations and traffic-management wizards remain open.
The workload tabs currently cover Deployments,
StatefulSets, DaemonSets, Jobs and CronJobs. Resource names open Headlamp's
built-in detail view or drawer, not a Kiali-specific detail page.
The initial browsing routes require one selected cluster and do not expose
create/delete/bulk actions. Istio configuration has its own confirmed mutation
workflow; Headlamp's built-in resource details keep their existing behavior.

The plugin does not install cluster components. An optional, explicitly requested
development setup runs managed Istio, Bookinfo and example Prometheus; see the
[fixture guide](test-files/README.md#live-aks-automatic-setup).
The repository root is the plugin directory.

See [PLAN.md](PLAN.md) for the current implementation roadmap and agent handoff,
[the parity ledger](docs/parity.md) for scope, implementation evidence and
Desktop/web capability gaps, and [the fixture guide](test-files/README.md) for
reproducible checks. Full parity is not claimed.

## Development

Use Node.js 22 LTS or 24 LTS and npm 11 or later, with a running Headlamp instance.
Run these commands from the repository root:

```sh
npm ci
npm start
```

The lockfile pins dependency versions and integrity hashes without hard-coding
a registry mirror; `.npmrc` keeps it portable across npm registry configurations.

`npm start` watches the source. The pinned 0.14.0 toolchain copies its output to
Headlamp's normal `plugins/kiali` directory (on macOS,
`~/Library/Application Support/Headlamp/plugins/kiali`), not `dev-plugins`.
Follow the actual CLI output when using other toolchain versions; newer
Headlamp development-directory flows may require Plugin Development Mode.
The native slice has been loaded in Headlamp 0.35.0 Desktop and hosted-web mode.

```sh
npm run tsc
npm run lint
npm run build
npm run package
```

The production build is written to `dist/main.js`; packaging creates a tarball
for installation into Headlamp's plugins directory. The scaffold also provides
formatting, Storybook, i18n, and Vitest commands in `package.json`.
Run `npm run parity:check` and `CI=1 npm test` for the offline inventory and
core-logic checks. A successful build alone does not verify loading in Headlamp:
check the actual Kiali route and browser console in a running instance.

For focused tests, use the toolchain's runner configuration directly:
`npx vitest run -c node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs <test-paths>`.
The `npm test` wrapper does not forward Vitest runner arguments.

## Using the native slice

Select one cluster, then open **Kiali > Overview**. Istio API presence is reported
separately from control-plane health: having the CRDs does not prove a healthy
mesh. Resource browsing works without configuring Prometheus.

Istio and Gateway API detail pages now offer **Run scoped Gateway checks**.
Configure an explicit logical mesh cluster name first. Complete versioned
evidence is projected onto the declared local namespace scope; unavailable,
stale or incomplete sources do not produce partial findings. Istio selector
checks use pinned-default workload inclusion and the captured controller scope
flag, not raw Pod matches. Existing listener/port-conflict/status/class checks
remain bounded; dormant Istio port-name helpers and route attachment rules are
not enabled. This increment has not passed browser, hosted fixture, Desktop or
live-cluster verification in the current environment.

Under **Kiali > Connection settings** (also available in Headlamp's plugin
settings), select a cluster and enable an existing Prometheus Service connection.
Enter its namespace, Service name, numeric or named port, and optional base path.
Use **Check connection**, then **Save cluster settings**. Settings are stored per
cluster in the current browser profile; the overview reacts to saved changes.
No kubeconfig, tokens, external URL or other credentials are stored by this form.

For the supplied demo, the endpoint is `istio-system/prometheus:9090`, with an
empty base path. Missing, forbidden, unauthenticated and malformed responses are
reported explicitly. Unknown configuration versions are not silently overwritten;
resetting invalid Kiali settings requires confirmation.

Use the native namespace selector to limit Services and Workloads to `bookinfo`.
Workload-kind selection is kept in the URL. Replica counts are Kubernetes
readiness only; they are not the ported Kiali mesh-health calculation.

## Application relationships

Open **Kiali > Applications** and select or enter one namespace. For `bookinfo`,
the view groups the six Deployments into `details`, `productpage`, `ratings` and
`reviews`. The reviews application links its three versions, matching Service,
and three owned pods, including detection of native sidecars.

Default application/version labels follow pinned Kiali precedence: canonical
Istio labels, then `app.kubernetes.io` labels, then `app`/`version`. You can replace
that order with a validated pair of label keys in per-cluster settings. Existing
Prometheus settings are preserved. An empty label value is distinguished from a
missing label instead of silently falling back.

Relationships are computed from configuration and owner UIDs, not traffic.
Owned ReplicaSets/Jobs are collapsed into observed parent controllers; unresolved
owners are reported rather than matched by name. Selectorless Services do not
select every pod. Reads are namespace-scoped, with three concurrent requests and
a maximum of four 250-item pages per resource kind and a shared 15-second
deadline. Denials, malformed responses
and truncated lists are explicit; incomplete counts are not presented as zero.
Refresh is manual. Multi-namespace correlation, arbitrary external workloads,
custom controllers and OpenShift-specific controllers remain incomplete.

WorkloadGroup-backed VM workloads are included when the API is served. Group
`spec.metadata.labels` select entries by `spec.labels` in the same namespace;
empty selectors match none. Following pinned Kiali, the **first matching entry
in the captured list** supplies workload labels, or the group's selector labels
when no entries match. Entry order can therefore affect application/version
labels. Object metadata and `template.labels` are not substitutes.

Group identity and resourceVersion remain separate from first-entry label
provenance. Tables show the contributing entry's name, observed UID/version and
matching-entry count, with cluster-scoped group/entry links. Entries never
become Pods or replica readiness. VM application health remains unassessed,
and the Service routing wizard rejects VM workloads until complete per-entry
version handling is implemented. Graph resource candidates include these
current group identities without claiming historical traffic attribution.
Denied, limited or malformed VM reads never fall back silently to group labels;
successful API absence is distinguished from inaccessible discovery.

Applications also disclose the service-account names reported by their
UID-attributed Pods, with counts per workload and per-Pod evidence. Missing
or malformed `spec.serviceAccountName` remains unavailable; `default` is shown
only when actually reported. Unresolved owners never contribute accounts to
a same-named workload. No ServiceAccount objects are read, no trust-domain
principals or permissions are inferred, and VM entry accounts are kept separate.
This is positive observed provenance, not a complete mesh account inventory
or activation of account-absence validation checks.

## Read-only pod and proxy diagnostics

Open **Kiali > Pod diagnostics**, or follow a diagnostic link from an
Application's owned pods. Load the exact namespace/Pod identity, select a
regular, init/native-sidecar or ephemeral container, then explicitly read
current or previous logs. Snapshots are limited to 1,000 lines, a 24-hour
lookback, 256 KiB and 15 seconds. Missing restart/readiness evidence stays
unknown; changing pods or controls clears stale output.

For pods with an observed `istio-proxy`, read Envoy server information or
configuration. The plugin uses Headlamp's public Kubernetes WebSocket
forwarding transport and the user's pod port-forward permissions. It does not
bind a local port, execute commands, install a backend or create credentials.
Only fixed read-only admin GETs are exposed. Responses are capped at 256 KiB
for server information and 4 MiB for configuration, with a 15-second deadline
and before/after pod UID/restart checks.

Cluster, route and listener entries show their observed configuration states,
versions and timestamps; **Inspect** opens the selected entry as read-only JSON.
Repeated or unnamed entries remain distinct. Bootstrap, secrets and endpoint
details are not displayed. Logs and configuration can contain sensitive workload
information and are not saved to settings.

Selected clusters add parsed port/subset/direction and metadata-reference
summaries; Kubernetes namespace interpretation requires the explicitly saved
service DNS identity. Route inspection retains complete match constraints and
all actions, including redirects/direct responses. Listener inspection includes
default chains, protocol matches and destinations. Unknown fields remain in the
full JSON rather than disappearing from the diagnostic view.

For a canonical outbound cluster with an explicit Service DNS suffix,
**Find current Service candidate** performs one scoped Kubernetes GET. Only a
four-part outbound name with an unambiguous Service FQDN and port 1..65535 is
eligible; short, external, wildcard and inbound names are not guessed.
The result shows the current UID/resource version, Service type and declared
ports, with a native Service link. A missing port is a warning, not a missing
Service. This verifies current name-based evidence only, not historical identity,
subsets, endpoints, protocol compatibility, routing or traffic origin.
The lookup expires after 15 seconds; cluster/name/DNS changes discard results
without replaying either the lookup or the proxy read.

Canonical cluster DestinationRule and selected-route VirtualService metadata
also offer explicit current-object lookups. References must use the pinned
`networking.istio.io/v1` path format and the expected plural resource kind;
arbitrary URLs, other resource types and invalid identities are rejected.
DNS configuration is not needed because the reference supplies a namespace.
The reader discovers a supported current API version, verifies the returned
identity/UID/version and links to the plugin's detail page. Reported reference
version and current served version stay separate. This does not prove which
historical object generated the snapshot or validate the current policy.

For an existing ztunnel pod, choose **ztunnel** as the diagnostic format and
select **Read ztunnel configuration**. The same bounded forwarding transport
feeds native service/workload tables, local filters, waypoint information and
selected-entry JSON. Missing endpoint data stays unknown rather than becoming
zero. Registry IDs are not treated as Kubernetes UIDs or Headlamp cluster names.
Top-level certificate material and policy bodies are not displayed.
This view is fixture-verified only; no ztunnel was installed for testing.

These are observations, **not proxy synchronization or mesh-health verdicts**.
Live hosted Bookinfo Envoy/Service reads work; configuration-reference success is
fixture-backed. Desktop, broader metadata formats, ztunnel metrics/live-backend
evidence and logging changes remain open. The managed test
control-plane sync endpoint requires additional authorization; no credentials
are created to bypass that boundary. Older hosts also have
a late-socket cancellation limitation, documented in the parity ledger.

## Mesh configuration

**Kiali > Mesh configuration** provides schema-derived models, lists and detail
routes for the 14 Istio kinds captured from the test cluster: VirtualService,
DestinationRule, Gateway, ServiceEntry, Sidecar, WorkloadEntry, WorkloadGroup,
EnvoyFilter, AuthorizationPolicy, PeerAuthentication, RequestAuthentication,
WasmPlugin, TrafficExtension and Telemetry.

It also includes GatewayClass, Gateway, HTTPRoute, GRPCRoute, TCPRoute, TLSRoute,
UDPRoute, ReferenceGrant and InferencePool. These nine models use checksum-pinned
Gateway API 1.6.0 and inference-extension 1.5.0 schemas, matching the Kiali
baseline. Experimental fields are included. They are **not installed** in the
test cluster; the plugin never installs them. Discovery distinguishes absent
APIs from permission failures.

The two Gateway kinds have separate group-aware routes. GatewayClass lists,
details and confirmed operations are cluster-scoped. Root, listener and parent
conditions appear in the final Conditions section, retaining parent identities.
References include GatewayClass, Gateway parents, backend and mirror Services,
TLS Secrets, named grant targets and inference picker Services; links do not
prove cross-namespace permission or controller acceptance.

Discovery selects a supported served version for the selected cluster. Forbidden
access is not treated as "not installed"; an installed-but-empty kind is a normal
empty list. Lists include CRD printer columns and additional configuration
summaries. Detail sections preserve all supplied spec and status fields, including
unknown extension fields, false/zero values and nested collections. Conditions
are placed immediately above Events. Embedded multiline code is read-only.

Create, edit-specification, validation-exclusion and delete operations require a
permission review, server dry-run and explicit confirmation. Specification edits
replace only the spec; exclusion edits change only their dedicated annotation.
Other metadata is retained. Updates and deletes check the captured UID and
resourceVersion, and uncertain write outcomes are never retried automatically.
These controls are real cluster mutations when confirmed, not a local editor.

**Edit validation exclusions** offers restore-normal, selected-code and
ignore-all modes for `kiali.io/ignore-validations`. Restoring removes the key;
ignore-all writes an empty string. Selected codes are case-sensitive and limited
to 100 `KIA####`/`GWAPI` entries and 4,096 characters. The read-only review shows
only that annotation, not unrelated annotations. Exclusions hide findings; they
do not fix configuration or change enforcement. Scope changes close pending
reviews, and unexpected server acknowledgements cannot be reported as success.
All successful exclusion-write checks were intercepted; no live exclusion
annotation was changed.

For an existing VirtualService, **Edit HTTP route behavior** changes selected
forwarding-route timeout, retry, fixed-delay or HTTP-abort settings. Every group
starts at **Keep existing**; choose **Set value** or **Remove setting** explicitly.
Other routes, destinations, headers, mirrors and unknown fields are preserved.
Current/proposed specifications use read-only JSON previews and the same
dry-run/confirmation/version guards.

Convenience controls support durations from 1 ms to 24 h, zero route timeout
to disable it, 0..10 retry attempts, percentages from 0..100 and integer HTTP
abort statuses 100..599. Removing settings restores inheritance, not necessarily
disabled behavior. Faults require explicit removal of timeout/retry settings.
Setting a fixed delay or HTTP abort replaces its known alternative fault type.
Advanced unsupported values remain available in the specification editor.
All fault/update success checks were intercepted; no live traffic fault was applied.

The same HTTP controls are optional in **Create traffic routing**, excluded
by default. They compose with version weights and mirroring in the new
VirtualService without changing the DestinationRule. Choose **Not included**
to clear a draft group. Timing/retries cannot be combined with faults, and
TCP proposals reject HTTP behavior until it is explicitly excluded.
Fault and retry side-effect warnings remain visible during confirmation.

Service creation also accepts up to 20 **HTTP request conditions**: headers,
URI, scheme, method and authority, using exact/prefix/RE2 matching or header
presence. As in the pinned Kiali wizard, all headers are ANDed in one alternative;
each other condition is a separate OR alternative. Every alternative retains
the selected port. Conditions are routing selection, not access control.
Duplicate headers/conditions, ignored header names, invalid RE2 and surrounding
whitespace are rejected explicitly. Use JSON for other compound arrangements.

For an existing DestinationRule, **Edit circuit breaking** manages the top-level
TCP maximum connections, HTTP/1 pending requests and consecutive-5xx ejection
threshold. Each group can be kept, set or explicitly removed. TLS, load balancing,
advanced fields and subset/port overrides are preserved unless the entire owned
group is removed. Setting an outlier threshold writes `consecutive5xxErrors` and
removes the deprecated `consecutiveErrors` alias, with that migration shown before
confirmation. Zero is explicit; limits use protobuf integer bounds.

The same optional settings are available when creating Service traffic routing.
They are added only to the proposed DestinationRule. Existing-resource changes
and new-resource batches use the normal permission, dry-run, confirmation and
identity/version guards. Circuit breaking may reject requests or eject backends;
it is not a readiness guarantee.

**Edit load balancing** on a DestinationRule manages simple algorithms or
header/cookie/source-IP affinity. Optional affinity is also available in Service
traffic creation. Strategy changes replace incompatible keys while retaining
unrelated locality/warmup settings and applicable hash/cookie metadata.
Cookie TTLs use protobuf seconds, including explicit `0s`; removal of the
entire group is a separate reviewed action. Subset and port overrides remain
unchanged. Source-IP affinity uses the address observed by the proxy.

**Edit outbound TLS** on a DestinationRule keeps, sets or removes the top-level
TLS block. Modes are `DISABLE`, `SIMPLE`, `MUTUAL` and `ISTIO_MUTUAL`; no mode
is inferred from mesh health. MUTUAL requires client-certificate/private-key
file paths inside the proxy container, not certificate/key contents or files
on the Headlamp host. SIMPLE/MUTUAL support an optional CA path and preserve
existing SNI, SAN, CRL and verification flags, but replace `credentialName`
with file references. Secret-backed TLS remains available in the JSON editor.
DISABLE/ISTIO_MUTUAL clear the other TLS fields, as explicitly shown before
confirmation. Removing the block restores inheritance rather than disabling TLS.
Subset/port overrides and PeerAuthentication are unchanged. Optional TLS settings
also compose with Service creation, only when deliberately selected.

**Edit inbound mTLS** on a PeerAuthentication changes only its top-level
`mtls` block. Choose `UNSET`, `DISABLE`, `PERMISSIVE` or `STRICT` explicitly,
or remove the block to restore inheritance. Existing selectors and workload-port
overrides remain intact. This may affect a whole namespace or mesh depending
on policy placement; it does not update DestinationRules or infer effective
scope. The review retains mode-specific compatibility/plaintext warnings,
including DISABLE's ambient limitation. No live policy was changed during checks.

**Adjust Gateway backend weights** on HTTPRoute or GRPCRoute changes one
existing rule's backend weights. Gateway API weights are relative ratios, not
percentages, and need not total 100. Omitted weights default to 1; zero removes
that backend from weighted forwarding. The editor accepts integers 0..1,000,000
and requires at least one positive backend. Parent references, backend
group/kind/namespace/port, matches, filters and other rules are preserved.
The same permission, dry-run, version and confirmation guards apply.
This does not verify ReferenceGrants, backend health or controller acceptance;
use JSON for deliberate all-zero rules or lists beyond the 16-rule/16-backend
convenience limits.

For an existing VirtualService, **Adjust traffic weights** edits one HTTP, TCP
or TLS route. Integer percentages must total 100. The proposal preserves
destinations, matches, mirrors, timeouts, headers and all other routing fields;
it then uses the same permission/dry-run/confirmation checks. The review shows
old/new weights and the full specifications. Original identity/version/spec are
captured when the editor opens, so a later object change requires a fresh review.
The form supports up to 100 routes and 20 destinations per route; larger cases
remain available in the specification editor.

The weight editor does not rebalance locks or verify target health. Use
**Reload page** if native watch updates have not refreshed data after a mutation;
this avoids relying on private Headlamp cache APIs.

**Reorder HTTP routes** moves one existing VirtualService rule to an explicit
position while retaining complete rules, redirects, delegates, matches,
destinations and policies. HTTP uses first-match order. Clearly unconditional
rules must remain last; delegated rules and more complex overlap are not
analyzed. The editor supports 2..100 rules with up to 100 match alternatives
per non-delegated rule and uses the same immutable review/confirmation guards.

**Edit HTTP match conditions** sets or removes one supported condition in one
existing alternative, retaining port, source, gateway, query, negative-header
and other fields. Unlike the creation wizard's flat list, existing alternatives
keep their original structure: fields are ANDed inside an alternative, and
alternatives are ORed. A header edit adds/updates that name rather than renaming
another header. No-op edits and removal of the final condition are blocked.
Use JSON to add/remove alternatives or deliberately make a route unconditional.
The preserved `ignoreUriCase` flag affects exact/prefix URI matches, not regex.

**Edit HTTP mirroring** configures one shadow destination on an existing
VirtualService forwarding route. Keep, replace and remove actions are explicit.
Replacement clears competing mirror lists and deprecated percentage aliases,
while preserving forwarding weights, matches, other routes and unrelated fields.
Use the specification editor for multiple mirror targets. Hosts and optional
subsets use DNS names/labels; ports are 1..65535 and percentages are decimal
0..100, including explicit zero. Target existence/readiness is not inferred.
Mirrored requests can repeat writes and other side effects even though their
responses are not returned to callers. This warning remains visible during review.

For a Service without potentially overlapping routing, **Create traffic routing**
in the Services table opens a separate creation workflow. Enter the actual
Service DNS suffix and load observed versions. A version label is inferred only
when the workloads agree on one key; otherwise choose it explicitly. Matching
workloads with the same version share a subset. Defaults distribute traffic
evenly per workload, with the integer remainder assigned last and version
weights combined.

Optionally choose one **Mirrored version** and its independent mirror percentage.
That version still gets a DestinationRule subset, but is excluded from forwarding
in the generated rule. Other/default routes, including traffic not matching its
conditions, can still send ordinary traffic to that version.
Explicitly adjust the remaining forwarding weights to total 100; the wizard
does not silently redistribute traffic when enabling or disabling mirroring.

Choose **HTTP/gRPC** or **TCP** routing explicitly, subset names, integer
forwarding weights totaling 100, an observed TCP Service port,
and new DestinationRule/VirtualService names. Review both full read-only JSON
objects after server dry-run, then explicitly confirm. The generated objects
are namespace-local (`exportTo: ["."]`), mesh-only and port-scoped. No gateway
is created; TLS policy is added only when explicitly selected. Limits are
100 workloads and 20 distinct versions;
external-name/selectorless Services and existing routing edits are excluded.

Service identity/version, version membership, potential overlaps, target absence
and permissions are rechecked. Writes run DestinationRule first, then
VirtualService, with per-object outcomes and a single-use reviewed batch.
These writes are not a transaction: failure stops the sequence, earlier success
remains, and there is no automatic retry or rollback. Creation success and
partial-failure checks used intercepted browser writes; no live routing was
changed.

TCP proposals create `spec.tcp`, route connections instead of HTTP requests and
retain the selected Service-port constraint. Switching protocol preserves the
draft: remove request mirroring and replace HTTP header/cookie affinity explicitly
before reviewing TCP. Source-IP affinity and simple algorithms remain available.
This does not change Service port names/appProtocol or Istio's classification;
the chosen route type must match the application's mesh configuration.

The optional **Run initial checks** action implements KIA1104 (single-route
weight), KIA1105 (duplicate host/subset), KIA0004 (unmatched workload selector),
KIA0005 (export namespace),
KIA1107 (missing subset), KIA1401 (HTTP/gRPC Gateway parent), KIA1402
(HTTP/gRPC Service references), KIA1503 (Gateway API listener uniqueness) and KIA1601
(ReferenceGrant namespace presence). It respects ignore annotations and reports
incomplete context. This is not the full validator or a validity verdict.

KIA0004 is restricted to the pinned active callers: AuthorizationPolicy,
PeerAuthentication and RequestAuthentication use `selector.matchLabels`;
Sidecar uses `workloadSelector.labels`. A selector-looking field on another
kind/group does not activate this check. Malformed selectors are deferred
explicitly. The current validation reader still lacks complete mesh-workload
inclusion evidence, so it does not report workload absence from the bounded
application/resource snapshots.

Istio VirtualService Gateway checks add KIA1102 (missing Gateway) and KIA1108
(legacy dotted reference syntax), including nested HTTP/TCP/TLS matches.
Short names and explicit `namespace/name` references work without a DNS setting;
legacy dotted names require the configured service DNS identity. A complete,
group-correct Istio Gateway list is required before reporting absence. Gateway
API objects cannot satisfy these references, and a denied list is not treated
as an empty one.

AuthorizationPolicy checks add KIA0101 for unmatched positive namespace patterns
and KIA0102 for unsupported HTTP-method patterns. Exact/prefix/suffix/presence
patterns follow pinned Kiali behavior. Method checks require no Kubernetes
context; namespace absence requires a complete namespace list. Negative patterns,
principals, trust domains and effective allow/deny decisions are not evaluated.

KIA0104 adds a scoped host-registry hint for positive `operation.hosts`.
Wildcard/prefix/suffix matchers and multi-dot Host-header values are exempt,
including fully qualified Service names. Single-dot names are registry-checked
only when their suffix is a known namespace. Internal names use complete
Service, ServiceEntry and VirtualService evidence, with per-kind export
defaults and autogenerated VirtualServices excluded. Namespace evidence is read
first so external names do not trigger unnecessary registry reads.

Only configured `ALLOW_ANY` lowers missing-host severity to Warning. Missing
DNS configuration, denied/incomplete lists or unresolved visibility/policy
defer the check; they do not imply a valid policy. This follows the pinned
checker, including its ServiceEntry suffix matching, and is not an HTTP
Host-header validity check or an authorization/enforcement decision.

WorkloadGroup checks add KIA1702 for duplicate label sets in the same namespace.
They use namespace-scoped evidence and verify the selected object's UID and
labels before reporting a conflict. Replaced/stale objects, denied lists and
cross-namespace responses defer the check rather than inventing a result.

WorkloadGroup details also offer **Load matching WorkloadEntries**. This compares
`spec.metadata.labels` with each WorkloadEntry's `spec.labels` in the same
cluster/namespace, not object metadata labels. Missing or empty selectors match
no entries under the pinned Kiali helper and issue no detail lookup. Results
show names, declared addresses/networks/service accounts and observed UIDs.
Links use names rather than permanent UID bindings; these are selector matches,
not ownership, registration, connectivity or VM-health evidence.

The explicit lookup captures its selector, stops after 15 seconds and reads at
most four 250-item pages. Partial/denied/oversized results remain marked
incomplete. Shared application correlation separately uses complete VM evidence
as described above; this detail lookup does not establish complete
workload/service-account validation.

The matching-entry table also explains the pinned Kiali probe interpretation.
Enabled checks use the **first** `Healthy` condition; absent or unknown values
default to unavailable. Disabled checks—and unrecognized boolean annotation
strings—are explicitly labeled as **assumed available by Kiali**, not observed
healthy VMs. Expand the reported probe fields to inspect the annotation, reason,
message and timestamps. No timestamp freshness, live VM probe or proxy
synchronization is inferred. Malformed probe data is shown per row without
discarding an otherwise valid label association. This does not enable VM
application replica health or traffic creation.

Gateway API Gateway checks add **KIA1504** for a class absent from the resolved
Kiali registry, not for a missing Kubernetes object. **Gateway API class registry
(JSON)** in per-cluster settings accepts `classes` entries with `name` and
`className`, and a `selector` equality-label map. Explicit classes take precedence
and require no class-list read. Without them, successful discovery selects the
pinned `istio.io` controller prefix; a nonempty selector permits matching
non-Istio controllers. An empty successful result uses `istio` and `istio-remote`
defaults. Conditional east-west/waypoint defaults remain unknown without
mesh-wide context. Denied, malformed or incomplete lists never become fallback
success. Expand the registry disclosure to inspect provenance and membership.
These settings are browser-local and do not install resources or grant access.

Gateway collision checks add **KIA1501** for identical explicit
hostname/port/protocol listeners and **KIA1502** for identical explicit
address-type/value pairs across Gateways. They require a complete bounded
Gateway list and recheck the selected UID/listener/address fields. The pinned
checker skips peers with the same name even in another namespace; wildcards
are compared literally and omitted hostname/address types are not defaulted.
Related Gateway API objects include observed UIDs. These warnings do not prove
attachment, address allocation or controller failure.

Set **Default Istio metric cluster label** in Connection settings to associate
this Headlamp cluster with the exact Istio `source_cluster`/`destination_cluster`
label. Metrics, topology and workload/Application/Service health forms share this
editable default; local overrides are not saved. Blank means unknown, not the
Headlamp context name or Service DNS suffix. Saved identities are limited to
256 characters and reject surrounding whitespace/control characters.
Changing the identity or Prometheus endpoint discards submitted queries and
local overrides. Health also invalidates submissions when its rules or
application-label settings change. Queries must then be submitted explicitly.
This association does not establish mesh membership or merge metrics from
different providers.

**Kiali > Cluster comparison** reads up to eight explicitly chosen Headlamp
contexts, defaulting to the current selection. It compares Istio API discovery,
a named Namespace and five-minute destination-reporter request observations.
Each context uses its own saved endpoint/metric identity; missing mappings skip
metrics rather than querying broadly. Three targets run concurrently, each
with a 15-second deadline. API denial, namespace absence and missing/failed
metrics remain separate observations. Earlier completed observations survive
a target timeout.

Results retain provider and cluster provenance. Repeated metric identities
produce a warning, and rates are never summed across contexts/providers.
There is no mesh-membership inference, health verdict or multi-cluster mutation.
Changing selections, availability, endpoint or metric identity discards the
submission instead of replaying it. Cluster links open a single-context overview;
existing configuration and mutation pages remain single-cluster.

ServiceEntry checks add KIA1211 for shared host/port definitions and KIA1212
for differing protocols on the same host/port. They apply namespace exports,
resolved mesh export defaults, ambient export behavior and namespace-wide
Sidecar imports before grouping. The selected UID and relevant specification
must still match the collection snapshot. Related configurations open in a
paginated dialog with observed UIDs and explicitly cluster-scoped links.
These are configuration warnings, not traffic or enforcement verdicts.

DestinationRule checks add KIA0201 for overlapping normalized hosts and subsets.
They require an explicit Service DNS identity domain and complete scoped
evidence. Host suffix boundaries, export/default visibility and Sidecar imports
are preserved; only exact legacy mesh-wide or same-namespace `ISTIO_MUTUAL`
defaults are exempt. A service-scoped wildcard is not automatically exempt.
Related rules are shown with their kind, observed UID and cluster-scoped link.

KIA0204 additionally detects the pinned TLS-override configuration pattern.
An explicit top-level TLS object or any port-level TLS object counts as supplied
settings, even when its mode is disabled; subset-only TLS does not satisfy this
particular checker. The warning is not evidence that encryption is disabled.

Sidecar KIA1006 warns when a nonempty workload selector is declared in the
namespace's resolved mesh root. It uses observed configuration, not an
`istio-system` naming assumption. Empty selectors need no mesh reads; unknown,
denied, ambiguous or excluded mesh context defers the check. It does not imply
workload absence or assess effective Sidecar selection.

VirtualService KIA1101 now checks HTTP/TCP/TLS forwarding destinations against
the same scoped registry, including short and namespace-qualified host aliases.
Its severity follows the pinned Kiali classifier: `ALLOW_ANY` yields a warning;
`REGISTRY_ONLY` and `ALLOW_ANY_DYNAMIC_DNS` yield errors. A resolved configuration
with no policy uses Kiali's `ALLOW_ANY` default, while an explicit empty policy
has protobuf's zero-valued `REGISTRY_ONLY` mode. Unknown configuration defers
severity instead of guessing. These are configuration diagnostics, not firewall
or reachability conclusions; mirror/redirect destination coverage is separate.

VirtualService KIA1106 checks host conflicts within literal gateway, normalized
DNS-domain and namespace buckets. Omitted gateways use the pinned `no-gateway`
bucket, distinct from explicit `mesh`; gateway references are not normalized.
Internal namespace wildcards participate, but arbitrary external DNS wildcard
overlaps are not inferred. Duplicate hosts/gateways can flag one object without
related peers. Export defaults and namespace-wide Sidecar imports select whole
VirtualServices: once any host imports an object, all its hosts contribute.
Current UID/relevant-specification checks and complete bounded evidence protect
the result; related links show observed UIDs and explicit cluster scope. This
warning is not a routing, controller acceptance or reachability verdict.

Istio Gateway KIA0301 compares hosts inside exact selector/port groups,
respecting target-namespace prefixes and pinned case-insensitive hostname
matching. It does not compare protocol/TLS or infer controller acceptance.
The per-cluster **Skip bare wildcard hosts in Istio Gateway conflict checks**
setting defaults off. Enabling it excludes comparisons involving a bare `*`,
not `*.example.com`; it changes only local checks, not cluster configuration
or Gateway API validation. Settings are captured for each read. Related
Gateways are object-level references with observed UIDs and networking-group
links. Unsupported or incomplete context is explicitly deferred.

Sidecar KIA1004 checks egress hosts against complete Service and ServiceEntry
snapshots using the configured Service DNS suffix. Service export annotations
override per-namespace mesh defaults, including an explicit empty annotation;
unknown matching visibility defers the finding. The pinned checker's wildcard,
host parsing and ServiceEntry suffix rules are preserved. In particular, its
namespace prefix is not a namespace-existence check. These findings do not
prove traffic reachability or effective Sidecar enforcement.

PeerAuthentication checks add KIA0401/KIA0501 for missing mesh/namespace
DestinationRule patterns when STRICT mode requires them, and KIA0505/KIA0506
for conflicting DISABLE patterns. Automatic mTLS defaults apply only after
configuration is resolved. Any present selector, including an empty one,
excludes these particular checks; the namespace mTLS indicator uses different
empty-selector semantics. Only top-level DestinationRule TLS participates.
Relevant export uncertainty is deferred, and conflicting rules have scoped
links. These are configuration diagnostics, not encryption observations.

PeerAuthentication KIA0002 separately detects multiple selectorless policies
in the same namespace. **Absent, null and empty selectors all participate**,
regardless of mTLS mode. A mesh-root policy is not a same-namespace conflict
with a policy in an application namespace. The check requires a complete policy
list, a matching current UID/selector, and resolved managed namespace evidence;
it does not infer workload overlap or effective policy. Related policies use
observed-UID security-group links. This does not enable KIA0003 or generic
RequestAuthentication multi-match checks.

DestinationRule counterparts KIA0205–KIA0208 compare namespace/root
PeerAuthentication patterns against top-level `ISTIO_MUTUAL` or `DISABLE`.
They retain automatic-mTLS shortcuts and policy ordering, verify the selected
rule's UID/relevant specification, and respect its export scope without adding
Sidecar import filtering. Related policies use security-group detail links.
Missing or denied peer evidence is never treated as an empty policy set.

When resolved configuration omits its root namespace, Kiali's pinned fallback
uses the observed controller namespace. Mesh inventory retains the raw field
and shows the resolved root separately; the mTLS view labels the fallback.
Denied or unresolved configuration never receives this fallback.

Local checks also cover omitted Sidecar outbound mode (KIA1007) and current
Gateway/controller conditions (GWAPI). ServiceEntry and Istio Gateway
port-naming helpers are not enabled by the pinned Kiali checker pipeline, so
the plugin does not enforce them. Active Kubernetes Service port checks remain
separate implementation work.
Explicit JSON outbound modes remain unambiguous. Stale/missing condition
generations are not treated as current configuration errors.

Set **Service DNS identity domain** explicitly in per-cluster settings before
host-alias or subset checks, for example `svc.cluster.local` when that is the
mesh's actual suffix. Unknown domains are not guessed. Subset checks require
complete namespace/DestinationRule/Sidecar reads. Namespace-wide Sidecar imports,
root fallback, exclusions and local precedence are evaluated, along with
DestinationRule exports and resolved mesh export defaults. A VirtualService
with no imported host is explicitly skipped. Conflicting Sidecars, unresolved
root/default configuration and unresolved discovery membership defer affected checks rather
than guessing. Workload-selected Sidecar overrides are not evaluated.
No-workload warnings remain deferred because external/custom workload coverage
is incomplete. The mesh inventory now shows configured default export lists
separately from runtime defaults.
Reference reads are bounded to four 250-item pages per source, with at most
three simultaneous reads and a 15-second context-read deadline. The cluster,
specification and registry settings are captured before deferred work. A timeout
shows an explicit failure without old findings or an inferred absence result;
retry remains an explicit action. Denials and truncation cannot prove absence.

HTTPRoute/GRPCRoute checks include core Service parents, backends and mirrors.
Cross-namespace Gateway sharing supports full namespace label selectors.
Service references require a ReferenceGrant matching source/target groups,
kinds, namespaces and any target-name restriction. A denied grant list is
unknown permission, not a confirmed missing grant. These checks do not prove
listener attachment, protocol/hostname compatibility, Service port validity or
controller acceptance; unsupported backend kinds remain explicitly unevaluated.

Headlamp's Map includes an opt-in **Kiali configuration (not traffic)** source.
Its Service-reference edges describe configuration, not measured requests.
All 23 kinds have opt-in Map sources. Edges cover Service references and
same-scope WorkloadGroup label matches to WorkloadEntries, including target
nodes even without a separate WorkloadEntry source enabled. Matching is bounded
to 1,000 groups/entries, 10,000 comparisons and aggregate label-text limits;
incomplete data is reported. Stock Headlamp 0.35 does not draw edge captions:
open the WorkloadGroup node's detail panel for the selector explanation.
Remaining reference-edge families are still open.

Gateway populated pages and cluster-wide confirmation were verified using
explicitly intercepted browser fixtures, with all writes intercepted. Their
actual absent-API states were checked against the selected cluster. Real
Gateway resources, controller reconciliation and new Desktop checks remain
unverified.

## Traffic metrics

Configure an existing Prometheus Service, then open **Kiali > Traffic metrics**.
Enter a namespace and the exact Istio metric cluster label: it is not guessed
from the Headlamp cluster name. Choose inbound/outbound and a 5-, 15- or 60-minute
display window. Queries use one reporter, a five-minute rate interval, 15-second
samples and an explicit end time; refresh is manual.
The whole multi-panel read has a 15-second deadline, with cluster, endpoint
and query captured before either counter batch begins. A timeout is shown
explicitly and requires a new load; it is not interpreted as zero traffic.

The initial views show request rates and basic HTTP/gRPC error percentages,
95th-percentile latency, TCP sent throughput, and an observed request graph with
a keyboard-accessible node selection and equivalent connection table. This is
not the complete Kiali health calculator or advanced traffic graph. No data and
non-finite samples remain unavailable rather than becoming zero or healthy.
Each query reports its own failure and Prometheus warnings. Results are bounded
to 2,000 series/100,000 samples; the SVG graph renders at most 50 nodes/200 edges
and otherwise directs users to the table.

The separate **Observed connection security** panel uses destination-reported
`connection_security_policy` for HTTP/gRPC rates, including outbound scope.
It preserves unknown labels and unavailable zero-rate shares. A `mutual_tls`
percentage describes returned samples only, not all traffic or certificate,
authorization or policy-enforcement validity.

After the authorized Prometheus history reset, request-rate/latency charts and
the six-edge Bookinfo request graph were exercised against real telemetry in
stock hosted Headlamp 0.35.0. TCP series were absent and remain explicitly
unavailable. The demo's unchanged 1 GiB memory cap is still a recurrence risk.
Configuration mutation success remains browser-fixture-backed, not a live write.

## Traffic histograms

**Kiali > Traffic histograms** explores request duration in milliseconds, request
size in bytes and response size in bytes. Select average and/or P50/P90/P95/P99,
an explicit namespace/telemetry cluster, inbound/outbound direction and optional
workload. A current or historical end time captures the 5-, 15- or 60-minute
display window. Editing drafts does not change already submitted results.

Queries use the existing Prometheus Service, five-minute rates and 15-second
samples. At most three of the five summaries run concurrently, within one
15-second deadline. Each summary retains its own errors and warnings; only one
unlabelled aggregate series is accepted, with a window-derived sample budget.
Non-finite samples remain gaps, zero remains zero and an isolated finite sample
is shown as a point. Units and expandable numeric values accompany the charts.

Hosted checks reached the real Bookinfo duration histograms, but both returned
only non-finite samples in the checked window; no live finite histogram values
are claimed. Byte charts, historical/workload scope, partial failures, gaps and
the concurrency limit were verified with intercepted responses and no writes.
This is not yet custom-dashboard, Grafana or Perses parity.

## Traffic signals

**Kiali > Traffic signals** adds request/response byte throughput, gRPC
request/response message rates and TCP sent/received byte plus connection
open/close rates. Select one to eight signals with explicit namespace,
telemetry identity, direction, optional workload and current/historical time.
All panels show their raw Istio metric names and units.

TCP labels follow the pinned Kiali mapping: sent uses
`istio_tcp_received_bytes_total`, while received uses
`istio_tcp_sent_bytes_total`. This preserves Kiali's compensation for an Istio
L4 naming issue, not a universal wire-direction claim. The original Traffic
metrics TCP panel still uses its original raw counter and now explains that
difference. Connection open/close rates are not active connection counts.

Signals and histograms share captured, three-worker range reads with one
15-second deadline and strict scalar-matrix/time/sample bounds. Individual
errors remain separate; empty/non-finite data is not zero or healthy.
Real Bookinfo throughput reads returned 61 zero samples per panel in the
checked window. Positive signal charts and failure cases are fixture-backed;
no traffic generator was run. Custom dashboards and complete upstream query/
default parity remain open.

## Custom aggregate dashboards

**Kiali > Custom dashboards** renders a bounded subset of Kiali's custom chart
definitions through the existing Prometheus Service. Save definitions in
**Connection settings > Custom aggregate dashboards (JSON)**, per browser and
Headlamp cluster. For example:

```json
{
  "namespaceLabel": "namespace",
  "clusterLabel": null,
  "dashboards": [
    {
      "name": "memory",
      "title": "Namespace memory metric",
      "items": [
        {
          "chart": {
            "name": "Memory working-set aggregate",
            "metricName": "container_memory_working_set_bytes",
            "unit": "bytes",
            "dataType": "raw",
            "aggregator": "sum",
            "unitScale": 1
          }
        }
      ]
    }
  ]
}
```

Use the actual namespace/cluster label names of your metrics. A non-null
`clusterLabel` requires an explicit metric cluster value. With `clusterLabel:
null`, every source/settings change clears the form's required **single-cluster
source confirmation**; Headlamp cannot verify that assertion. Do not omit the
cluster selector for a shared multi-cluster data source.

**Include the bundled Kiali dashboard catalog** opts this browser's cluster
settings into 21 pinned Kiali v2.33.0 templates (91 inline charts), including
Istiod, Envoy, Go, JVM, Node.js and Vert.x families. It defaults off to preserve
existing saved-dashboard behavior. The JSON equivalent is `includeBuiltins:
true`. Definitions are bundled locally, not fetched or installed in Kubernetes.
Your saved definitions take precedence by exact template name, including in
included dependencies, and are listed first. Built-in copies are never inserted
into the saved user array. Dropdowns and captured references disclose their source.
Scope labels, metric-cluster identity/acknowledgment and explicit loading remain
required; enabling the catalog does not prove those metrics are available.

A saved declaration such as `{"name":"go","items":[]}` disables that name.
Missing/null items also mean an empty list; an absent or Go-whitespace-only
`discoverOn` makes the empty definition a disable declaration. It remains saved
and consumes the normal user-definition budget but is excluded from selection
and discovery. Dependent includes fail explicitly instead of resurrecting the
bundled template. Remove the declaration to restore the bundled default, or
replace it with an active definition. A nonempty `discoverOn` with no items is
discovery-only, not disabled; it cannot load charts.

**Use namespace/workload dashboard annotations for this view** enables explicit
reads of `dashboards.kiali.io/templates`. Enter **Dashboard namespace**, optionally
choose a supported workload kind/name, then **Read dashboard annotation overrides**.
The selected Headlamp identity reads the Namespace first and workload second;
namespace definitions override saved/bundled names, then workload definitions
apply last. UID/resourceVersion and the exact annotation location are displayed.
No resource is written, and snapshots are not live watches or proof of metric
origin.

Deployment, DaemonSet, StatefulSet, ReplicaSet and ReplicationController use a
non-null pod-template annotation map—even an empty map—before resource metadata.
Pod, Job and CronJob use their own metadata, matching the pinned workload caller.
Custom controllers and WorkloadGroups are not selected here. The Kubernetes
annotation namespace is the same literal value as Dashboard namespace; this does
not prove that telemetry with that label came from that resource.

Annotation YAML must be a list of at most 20 supported definitions within 64 KiB.
Aliases/cycles, excessive structure, multiple documents and malformed data fail
explicitly. Use `[]` for no overrides: a present empty/null document is an error,
not an inferred deletion or fallback. Existing effective catalog and query limits
remain in force. Denial, parse failures, namespace/target edits and reloads block
chart loading/discovery until a current capture succeeds; explicitly turn off
annotation usage to return to saved/bundled definitions.

For several metrics on the same chart, replace `metricName` with a `metrics`
list of `{"metricName":"used_bytes","displayName":"Used"}` entries. A nonempty
list takes precedence over the legacy single field; an empty/absent list uses
the legacy metric and chart name. Display names must be nonblank and distinct
within a chart. Metrics share the chart's declared unit, scale and aggregation;
they are drawn as separate named lines, never added together. The numeric
comparison table preserves zero and missing-timestamp gaps. A failed metric
is reported without hiding successful responses from its siblings or changing
their declared series colors for ungrouped comparisons.

Set chart `groupLabels`, for example `["pod","revision"]`, to aggregate separately
by those metric labels. This applies to raw values, rates, histogram averages
and quantiles. Each named metric/group becomes its own line and numeric column;
group labels do not establish Kubernetes resource identity. Missing grouping
labels are shown as `<absent>`, not a guessed value. Empty and absent labels
cannot produce duplicate series for the same metric. Group order is deterministic
for a captured set; colors can change when group membership changes. Long group
captions wrap in a separate legend rather than squeezing the chart.

Grouping accepts up to four distinct labels totaling 256 name characters;
`__name__` is excluded, as is `le` for classic histograms. Each response permits
at most eight groups, each with at most 241 samples. A chart/summary panel also
permits at most eight series **across all its metrics**. Excess groups, unexpected
dimensions, duplicate groups or labels contradicting captured equality filters
are errors, never silently truncated or merged. Group values are bounded to 256
characters and group captions to 1,024 characters, excluding the separately
bounded metric display name. Without grouping, the
strict single-unlabeled-series response contract is unchanged.

Templates can reuse other definitions saved in the **same cluster's** dashboard
settings. For example, append
`{"name":"overview","title":"Runtime overview","items":[{"include":"memory"}]}`
to the `dashboards` array above. An item containing
`{"include":"memory$Memory working-set aggregate"}` selects that exact chart
instead of the whole template. Includes preserve chart order and take precedence
over a chart on the same item. Empty includes fall back to the item's chart.
No remote template or built-in catalog is fetched.

Following pinned Kiali behavior, each template may be visited only once per
selection: repeated references are rejected even across separate sibling
includes, not just actual cycles. The entire referenced template is resolved
before selecting a named chart. Missing templates/charts are explicit errors
before metrics requests; malformed extra `$` suffixes are also rejected rather
than ignored. Saved definitions stay unexpanded. Results capture the resolved
charts and visited template names/titles; changing an included definition clears
the capture without automatically querying again.

For explicit discovery of saved definitions, add a template-level `discoverOn`
metric name and optional `runtime` display label. **Discover saved dashboards**
issues a single namespace/metric-cluster/filter-scoped `count(...) by (__name__)`
query at the captured end instant, not across the selected chart time range.
Results match exact returned metric names; a runtime label is your declaration,
not proof that an application uses that runtime. Selecting a result changes the
template draft without loading charts. Denials/timeouts remain failures, not an
empty successful match.

Following the pinned matcher, a matching parent suppresses a standalone child
only when its **literal direct include** equals the child's name. `"child"`
suppresses it; `" child "` and `"child$Chart"` do not. Include text is now
preserved when saving and trimmed only for composition; previously saved
canonical includes remain valid. Discovery does not resolve includes, so a
matched definition can still have an error when loaded. The namespace dashboard
page does not implicitly inspect application Pods; application recommendations
use the separate explicit workflow below.

Discovery accepts the same twenty saved definitions, protected equality filters
and 16 KiB encoded-query bound, with at most 2,000 returned metric names and a
15-second deadline. Counts are not interpreted as health or runtime evidence.
`discoverOn` must be a canonical metric name without surrounding whitespace;
raw selectors/PromQL and regex discovery expressions are not accepted.
An actual Bookinfo discovery read matched `istio_requests_total` using explicit
destination namespace, cluster `Kubernetes` and reporter selectors; no backend
or new cluster component was installed.

**Application dashboard recommendations**

On an application's detail page, **Inspect application dashboard recommendations**
captures its UID-attributed Pods and reads the Namespace's
`dashboards.kiali.io/templates` overlay. This does not write cluster resources or
start background discovery across applications. Captured Pod UIDs/versions and
Namespace definition provenance are inspectable.

Pod `kiali.io/runtimes` references are followed by `kiali.io/dashboards`,
comma-split, Go-trimmed and deduplicated. Any resolved reference takes precedence
over metric discovery. Unknown/disabled names remain visible; malformed or
uncollected reference evidence blocks inspection rather than becoming absence.
Incomplete supported-source correlation can show positive explicit references,
but cannot initiate absence-based fallback.

Optional per-cluster dashboard JSON settings control fallback:
`discoveryMode` is `"auto"` (default), `"enabled"` or `"disabled"`;
`discoveryAutoThreshold` is an integer 0..1000 (default 10).
Auto skips applications above the observed Pod threshold, enabled bypasses that
threshold, and disabled still permits explicit references. Settings are local to
the browser profile, including when no templates are saved.

Fallback sequentially tries the three pinned app-label conventions
(`service.istio.io/canonical-name`, `app.kubernetes.io/name`, `app`), or only the
configured application key when an app/version override pair exists.
Punctuation maps to underscores for metric-label names; invalid/protected
mapped labels are rejected before metric transport. Application version is not
added. Later matches replace an entire runtime group rather than unioning it.
Namespace and discovery reads share a fifteen-second deadline.

**Inspect … charts** retains the Namespace overlay, endpoint, end instant and
application scope. A discovered candidate uses its winning selector. Explicit
references require a metric-label choice when multiple conventions exist.
Charts reuse bounded chart selection, grouping, histograms and the eight-expanded-
request cap. Changes to configuration or captured application evidence invalidate
results without replay. Recommendations and matching metric names do not prove
runtime, telemetry ownership or health. VM entries are not treated as Pods, and
arbitrary custom-controller provenance remains incomplete.

**Workload dashboard recommendations**

Use **Inspect dashboards** from Kiali Workloads or an application's associated
workloads, or open `/kiali/workload-dashboards`. The link carries the resource
kind/name/namespace/UID without changing Headlamp's native resource-name links.
Choose **Read workload dashboard evidence**, then **Inspect workload dashboard
recommendations**. These are separate explicit operations; navigation alone
does not read ownership or query metrics.

The inspector supports Deployment, DaemonSet, StatefulSet, ReplicaSet,
ReplicationController, Pod, Job and CronJob. Ownership is rooted at the selected
UID even when it has a parent, so a selected ReplicaSet or Job does not inherit
its siblings' Pods. The workload's app and version values feed the three paired
label conventions, or the configured custom pair. An absent/empty version adds
no version filter; it is never guessed. Sanitized app/version-key collisions
are rejected. Other workloads with the same labels can still contribute metrics.

Namespace templates apply first and the selected workload's templates last.
Supported controllers prefer their non-null pod-template annotation map; Job,
CronJob and Pod use their own metadata. The annotation read must match the
captured workload UID and resourceVersion. If it changed, read ownership again;
a denied/stale source never falls back to a Namespace/base definition.

The shared recommendation policy, captured chart scope, grouping, sorting and
request limits apply. Ownership collection and the later annotation/discovery
inspection each have their own fifteen-second deadline. Draft/configuration
changes discard captures without replay. This is a focused dashboard inspector,
not a replacement for native spec/status/conditions/events pages. VM and
arbitrary custom-controller annotation sources remain unsupported.

Raw charts support `sum`, `avg`, `min` and `max`, preserving signed values.
Rate charts use `sum(rate(metric{...}[5m]))`. `unitScale` multiplies finite
samples; the pinned zero default means one. Overflow/underflow is an error,
not a zero substitution. Matching series are aggregated within each selected
group, or into one aggregate without grouping; duplicate scrapes
and metric-specific dimensions are not deduplicated.

The `unit` field is optional. Omitted, null or empty units stay **unspecified**;
the plugin does not infer a dimension from a metric name or replace it with a
physical unit. Scalar tables use a neutral **Value** heading, and comparisons
explicitly warn that metric dimensions must be checked. `unitScale` still applies
without declaring a unit. Nonempty units retain their existing display behavior;
malformed or whitespace-only unit values remain errors.

Optional integer `min`/`max` values set **display-only** bounds after unit scaling;
the minimum must be lower than the maximum when both are given. Samples outside
the view are counted and remain unchanged in the numeric table. A missing edge
is automatic; if all values lie outside a one-sided bound, only the automatic
edge is expanded to keep a valid axis. Unsafe display geometry is reported
without discarding the numeric table.

Optional `spans` chooses 1..12 columns of a twelve-column chart grid. Omitted,
null or zero spans retain full-width cards. On viewports below 900 pixels,
cards stack at full width for readability; this is a native responsive choice,
not pixel-for-pixel reproduction of Kiali's layout. Histogram summary panels
inherit the original chart's span and bounds.

Use plural `aggregations` to declare optional grouping choices, for example
`[{"label":"pod_name","displayName":"Pod","singleSelection":false}]`. These are
label choices, not the numeric `aggregator` operation. Select **Group by ...**
and explicitly load to append those labels after fixed `groupLabels`. The
combined labels retain the four-label limit; repeating a fixed label is rejected
rather than silently deduplicated.

**Filter captured aggregation values (display only)** then offers observed
values from successful responses. These controls change charts/tables locally,
not requests, authorization or captured responses. Series lacking a label remain
visible. `singleSelection: true` initially selects the first observed value and
uses radio controls. Display selections reset on a new result and are not saved
to settings or navigation URLs. Hidden-series counts are explicit; no hidden
series is reported as an empty provider response.

There are at most eight declarations per chart and 32 distinct display-name
choices per dashboard. Repeated display names use the last declaration, following
the source converter; aliases for one metric label use the last sorted display
name. Aliases with conflicting `singleSelection` modes are rejected. Captured
values remain bounded by eight responses/eight series/four labels each, with
at most 64 values per label. Display filters do not relax provider-response limits;
use the explicit server-side equality filters when a query returns too many groups.

**Additional metric labels (JSON)** supplies up to ten exact equality filters,
for example `{"job":"my-runtime","container":"reviews"}`. Values are literal
strings; empty equality also matches an omitted label under Prometheus
semantics. Required namespace and configured metric-cluster labels cannot be
overridden, and invalid label names are rejected rather than renamed. These
are query filters, not authorization controls. Drafts are neither saved to
settings nor included in navigation URLs; the submitted filter map is shown
with the captured result. Encoded query parameters are capped at 16 KiB before
any request, including after histogram expansion.

Set `dataType` to **`histogram`** for classic `_sum`/`_count`/`_bucket` metric
families, using the base metric name. Choose Average/P50/P90/P95/P99 in the
dashboard view; Average and P95 are the initial view selection. Averages use
aggregate sum/count rates and quantiles aggregate cumulative buckets, not
precomputed percentiles. Each summary becomes one request and one labeled
panel. Signed custom histogram values are preserved (for example temperature);
the built-in Istio latency/size histogram checks remain nonnegative.

Limits are 20 saved definitions (64 KiB), plus the separately bounded 21-template
bundled catalog (64 KiB). The effective catalog is capped at 41 templates and
128 KiB; eight source items per template allow at most 328 resolved charts of
metadata within that same 128 KiB budget,
**eight requests after expanding metrics and histogram summaries**, three
concurrent reads, a 15-second deadline and 15-second
samples over 5/15/60-minute captured windows. Settings/provider changes clear
submitted results without replay. Individual chart errors, non-finite gaps
and explicit zero remain distinct.

**Choose dashboard charts** makes larger compositions usable without raising
the request limit. All charts start selected; explicitly narrow an over-budget
selection rather than receiving a silently truncated dashboard. A submitted
batch contains one to eight distinct charts and must still fit eight expanded
metric/summary requests. Queries and panels keep definition order and original
chart indices. Results disclose the captured selection count, while later draft
edits neither refetch nor relabel that capture. Source/template changes reset
the draft selection. Only selected charts receive query-specific grouping and
histogram-summary expansion; declarations are still validated as a whole.

Chart `sortLabel` adds ascending ordering within each metric/summary.
Ordering is UTF-8 lexical unless `sortLabelParseAs: "int"` selects exact signed
64-bit decimal comparison, including values outside JavaScript's safe-integer
range. A label already in fixed or selected optional groups remains visible;
otherwise it is appended to the query grouping and removed from display labels
after sorting. The four-label/eight-series bounds still apply.

Unlike upstream's ignored integer-conversion errors, invalid, missing or
out-of-range integer values fail the affected chart explicitly. Hiding a sort
label must not make series indistinguishable: include it in `groupLabels` or
narrow filters if that happens. No samples are merged, summed or reordered
within a time series. Local display filtering preserves the captured order;
charts without sorting retain their existing deterministic label ordering.

**Expand chart** opens a larger, read-only view of a captured panel, including
its current display filters, ordering, units, bounds, warnings and numeric
values. The dialog shows the captured namespace, metric-cluster scope, end
instant and equality filters. Opening or closing it sends no request and does
not alter the query budget. Escape/Close returns focus to the expand control;
new queries or source changes close it without replay. The same interaction
works in custom, application and workload dashboards. Narrow screens use
vertical dialog scrolling rather than horizontal overflow.

Optional `chartType` selects `line`, `area`, `bar` or `scatter` (points) for
time-axis panels. Missing/null/empty retains the native line default. Styles
change presentation only: queries, captured values, units, bounds, sorting,
local filters and expansion stay unchanged. Named/grouped bars and filled
areas remain independent, not stacked or summed; points have no connecting
stroke. Missing samples stay unavailable, and isolated finite samples remain
visible on line/area plots. Unknown styles are rejected instead of silently
falling back. This does not add reporter-paired envelopes.

`xAxis: "series"` compares the latest **finite** sample of each visible series
within the captured range, preserving its actual sample timestamp. It does not
switch to an instant query, sum or average the range, or substitute zero for
missing data. Older finite values can be selected when later samples are
unavailable; differing sample times are disclosed. Numeric rows retain
all-unavailable categories without inventing timestamps.

The series axis defaults to bars when `chartType` is absent/null. Explicit
line/area/point styles keep each category independent rather than joining
different series. An explicitly empty `chartType` is normalized to `line`,
preserving the pinned caller's distinction from an axis-dependent default.
`xAxis` omitted/null/empty or `"time"` retains the existing time-axis behavior.
Captured sorting, local filters, units, bounds and expansion apply to both axes.

`startCollapsed: true` initially hides a chart's presentation after the captured
reads finish. **Show chart** / **Hide chart** change only local visibility;
**Expand chart** can inspect a collapsed panel without changing that preference.
Errors, warnings and unavailable-data notices stay visible. Each histogram
summary toggles independently, and existing display filters are retained.
A new capture resets visibility to the definition. Collapsing does **not** skip
queries, alter values or increase the eight-expanded-request limit.

Template-level `rows: 3` enables **Size plots by viewport rows** for the captured
dashboard. Plot height follows `max(floor((viewportHeight - (rows - 1) * 16) / rows), 150)`.
Zero/negative integers use two rows; omitted/null rows preserve natural heights
unless you opt in locally. Included templates do not override the selected
template's row preference. The control and browser resizing never refetch;
new captures reset to their definition. Expanded plots use one viewport when
enabled, otherwise the existing 520 px height.

This is native **plot sizing**, not pagination: captions, errors, controls and
numeric tables remain in normal page flow. Chart spans still stack below
900 pixels, and row preferences never drop charts or change request budgets.

This is **not full custom-dashboard parity**: exact upstream parent-container layout, native histograms,
background runtime discovery, VM/custom-controller recommendation integration
and Grafana/Perses links remain unsupported. Unsupported fields are
rejected rather than silently ignored. The raw Bookinfo memory-metric aggregate
was queried successfully through hosted Headlamp; other chart/error/budget
scenarios were fixture-backed.

The bundled capture is generated, not hand-edited:
`npm run dashboards:generate -- --source /path/to/pinned/kiali`.
`npm run dashboards:check` verifies its pinned checksum offline.

## Traffic graph

**Kiali > Traffic graph** adds workload, canonical-application, versioned-application
and Service projections without changing the existing metrics page. Select an
explicit metric cluster, namespace and source/destination reporter. Capture
current or historical time with a 1-, 5-, 10-, 15- or 60-minute rate window.
HTTP/gRPC requests, TCP sent/received/total bytes and gRPC sent/received/total
messages use separate units. Total measures require both counter reads to succeed.

Projection changes and node/neighbor filters reuse the captured snapshot.
Keyboard-selectable nodes and paginated connection tables expose reported
workloads/revisions, response codes, response flags, destination hosts and
connection-security labels. Unknown labels remain unknown; metric names do not
become unverified Kubernetes links. Optional zero-rate edges are dashed, not
treated as proof of liveness.

Diagram captions, node tables and keyboard inspection distinguish the selected
namespace, outside namespace names and unknown namespace provenance. This is
a name-based comparison against the captured query: the same namespace name
in another metric cluster still matches. It does not establish Kubernetes
accessibility, mesh membership or current resource existence. Editing the
namespace clears the old graph without replay; explicitly loading a new
snapshot recomputes these annotations. No extra reads are needed for captions.

Selected nodes can explicitly **Find current resource candidates** in the
Headlamp context resolved from the captured metric identity or a unique saved
mapping. Missing or ambiguous mappings block lookup. This reads complete,
bounded namespace lists and matches up to 20 reported workload names, or one
Service name. Ambiguous workload kinds, incomplete reads and unresolved
ownership do not produce guessed links. Candidate tables show the current UID
and application/version labels beside native resource links.
Telemetry does not contain a Kubernetes UID: these are current name matches,
not proof that the resource existed at the graph time or produced that traffic.
Lookup is on demand, has a 15-second deadline, and is invalidated when the node
or mapping changes.

Service graphs derive adjacency through observed workloads rather than inventing
a `source_service` label. Derived edges are marked; a workload backing multiple
Services repeats its outgoing observations across those aliases, so their rates
must not be added together. Direct workload paths without a retained Service
path are explicitly reported as omitted.

Reads have a 15-second deadline and at most two concurrent requests. Limits are
2,000 series per counter, 4,000 observations, 1,000 intermediate nodes,
2,000 projected edges and 20,000 projection contributions. Diagrams retain the
50-node/200-edge cap; complete bounded tables remain paginated and filterable.
Historical timestamps, reporter and cluster scope are validated before display.

Real hosted Bookinfo checks exercised all four projections, node/edge inspection
and destination-reported `mutual_tls`; the source reporter correctly left that
label unknown. TCP/message success paths, error metadata, historical controls
and large-graph pagination were fixture-verified. Combined reporter selection,
unserviced ingress recovery, ambient/waypoint deduplication, health/configuration
appenders, historical UID verification and full advanced-graph parity remain open.

## Traces

Enable **Connect to an existing tracing Service** under **Connection settings**.
Choose Jaeger or Tempo and enter the Kubernetes namespace, query Service, HTTP
port and optional base path. Use **Check tracing connection**, then save.
The query port is commonly 16686 for Jaeger or 3200 for Tempo; ingestion and
gRPC ports are not interchangeable. This does not install a provider.

Open **Kiali > Traces**, enter the service name as reported by your tracing
backend (not necessarily its Kubernetes Service name), and search. Filters
include operation, minimum duration and reported errors, with captured 5/15/60
minute or 24-hour windows and 20/50/100 result limits. Current or historical
end time is explicit. Up to ten additional exact string-valued tags are combined
with AND; duplicate keys and contradictory error filters fail locally.
Jaeger uses literal JSON tag keys. Tempo preserves simple identifiers and quotes
punctuation, embedded spaces and Unicode in literal attribute/tag names; enter
names without adding query quotes or escapes. Controls, unpaired surrogates,
surrounding whitespace and names over 256 characters are rejected. Values are
escaped as TraceQL string literals, not raw query syntax.
`error=true/false` maps to reported status in Tempo; false can
include unset status and never means healthy. Tags are not saved to settings or
navigation URLs. Search requests have a 15-second deadline and a 16 KiB encoded
path cap; captured filter details remain separate from subsequent draft edits.
Tempo additionally supports ten typed attribute comparisons across span,
resource, event, span-link, instrumentation and unscoped attributes:
strings, signed 64-bit integers, finite floats and
booleans, plus missing/null checks. Choose **Missing/null** with `=` for absence/
null or `!=` for presence/non-null; no value is required or retained.
Range comparisons and string RE2 regexes are available; string ranges
are lexicographic and Tempo regexes use whole-string matching. Values are
typed explicitly, not inferred. All conditions apply to the same matched span.
These are attribute filters, not intrinsic/status expressions or raw TraceQL.
Integers retain their decimal precision; provider-specific array/version
semantics still apply. Unsupported Jaeger use is blocked until the typed
filters are removed. Changing the tracing connection clears submitted searches
instead of replaying them against a different endpoint.
Filters are sent in provider request URLs and can appear in request logs,
even though they are not saved to settings or page navigation URLs.

Event, link and instrumentation filters use `event.`, `link.` and
`instrumentation.` prefixes, including automatically quoted literal keys.
They share all existing scalar types, nil/presence predicates, operator and
size limits. These controls do not express a same-event/link join, follow
linked traces, or infer scope from an attribute name. Backend storage/version
and array semantics still determine matching behavior.

**Tempo intrinsic filters** expose up to ten combined comparisons
on reported span name, status message, duration, status and kind, plus whole-trace
duration, root span name, root service name, event name and instrumentation
scope name/version, trace/span/parent/link IDs and event time since span start. The intrinsic
`span:status` is different from an attribute named `span.status`. Name/message
strings support ranges and whole-string RE2; status/kind accept only their
reported enum names with `=`/`!=`, not arbitrary strings or health assessments.
Duration accepts a single nonnegative quantity in ns/us/ms/s/m/h, with exact
whole-nanosecond precision up to 9223372036854775807ns. Fractional nanoseconds
and overflow fail rather than rounding. These filters are ANDed with existing
conditions; they do not replace them, and conflicting filters may return no
traces. `span:duration` and `trace:duration` remain distinct. Root names use
`trace:rootName` and `trace:rootService`; a reported root service may differ
from the matched span's service. Captured rows show the exact scope independently
of draft edits, and no root-service-to-Kubernetes association is inferred. Intrinsic drafts
remain visible on Jaeger for explicit removal; connection changes never replay
them automatically.

`event:name`, `instrumentation:name` and `instrumentation:version` are reported
metadata, distinct from attributes such as `event.name`. They support the same
bounded literal-string/range/RE2 comparisons. Version ordering is lexicographic,
not semantic-version ordering. Multiple event conditions do not establish that
the same event matched them all; instrumentation names are reporting-library
identities, not Kubernetes workload or Service identities.

ID intrinsics use `trace:id`, `span:id`, `span:parentID`, `link:traceID` and
`link:spanID`, with only `=`/`!=`. Native inputs allow at most 32 hex characters
for trace IDs and 16 for span IDs, without prefixes, whitespace or base64.
Case, leading zeros and empty literals are preserved; zero/empty IDs do not
automatically mean a missing parent or valid object. These predicates do not
traverse links or load other traces.

`event:timeSinceStart` accepts signed single-unit offsets relative to **span**
start, including `-1.5ms`. Whole-nanosecond precision and a magnitude limit of
9223372036854775807ns apply. The extreme negative int64 value is rejected because
its positive duration token is not parseable; no floating-point arithmetic
workaround is used. Span and whole-trace durations remain nonnegative.
Seventeen selectable fields still share the ten-intrinsic-predicate limit.

**Require a related span group** adds one explicit Tempo group with its own
service, optional exact operation and reported-errors-only flag. Choose
same-trace AND, child, parent, descendant, ancestor or sibling relative to the
primary group. Existing tags and typed/intrinsic predicates remain on the
primary left group; the captured related clause shows the separate right group.

Same-trace AND can match the **same** span and returns both groups. Structural
relations return matching right-group spans; parentage does not establish
temporal ordering or causality. This remains one bounded search, not link
traversal or a second provider query. Provider changes discard submissions;
disable the group explicitly before searching Jaeger. Arbitrary pipelines,
unions, negated relations and additional groups remain unsupported.

Open a trace to inspect relative
span timing, parents, references, attributes and events. Trace-ID URLs load
directly; **Load trace** also retries missing or failed reads. Detail reads and
the settings connection check each have a 15-second deadline and capture the
cluster, endpoint and provider before asynchronous work. Timeouts clear the
result instead of showing an empty trace or a successful connection; retry is
explicit. A capability response alone does not establish search/read permissions.

**Browse tracing services** and **Browse tracing operations** fetch suggestions
only when requested. Choose a service before browsing its operations. Selection
updates the search draft without submitting a query; manual entry remains
available. Lists are locally filterable and paginated, with a 15-second deadline
and a 1,000-entry limit. Jaeger name lists are not time-filtered. Tempo uses its
typed v2 tag-value API, the captured search window and a literal service filter
for operation names. Unsupported endpoints and malformed/oversized responses
remain visible errors, not empty successful inventories. These names are
backend observations, not Kubernetes identities.

Selected spans also expose reported sampling/debug flags, trace state, status
messages, resource/scope schema metadata, instrumentation scope and dropped-data
counts. **Metadata** on a span link opens its flags, trace state and attributes.
Explicit zero/false values differ from missing metadata; unknown flag bits and
status codes are retained rather than interpreted as health.

When a span reports unambiguous `k8s.namespace.name`, `k8s.pod.name` and
`k8s.pod.uid` attributes, **Verify reported pod in this cluster** performs one
explicit current-cluster read. Native Pod and diagnostic links appear only when
the current Pod UID matches exactly. Service names and backend cluster labels
are not used to guess an identity. This verifies a reported object reference at
check time, not trace origin, historical existence or workload health.

Provider responses use the selected cluster's Kubernetes Service proxy and
request JSON explicitly. Nanosecond timestamps and 64-bit OTLP integers retain
their exact decimal values. Missing parents, cycles, dropped data, backend
warnings and response limits are explicit. Missing error flags and empty
searches are not health verdicts. Trace attributes may contain sensitive
application data; they are not saved in plugin settings.

This is bounded HTTP trace browsing, not full tracing parity. Broader workload/
graph correlations, structural/count intrinsic Tempo filters and
unrestricted cross-span pipelines,
external-auth/tenant headers, gRPC-only
backends, Tempo v2 partial/pruned-trace envelopes and a lossless raw trace viewer
remain open. No tracing backend is installed in the development
cluster: hosted success paths were verified with intercepted synthetic
responses, not live collected traces. Desktop checks remain outstanding.

## Health

Workload, Application and Service health reads capture their context, endpoint,
query, label configuration and custom rules before asynchronous work. Resource
and metric requests share a 15-second deadline, so a stalled inventory or
provider cannot leave the view loading indefinitely or redirect later requests.
Completed failures remain explicit; timeout produces unavailable health evidence
and an explicit retry, never a healthy fallback.

Open **Kiali > Health**, or **Inspect health** beside an application, Service or workload.
For an **Application**, select its namespace/name and explicitly enter the Istio
`canonical_service` metric value. Custom application labels are not assumed to
be telemetry identities. The page combines the supported correlated controllers
with inbound/outbound request health; owned ReplicaSets are not counted twice.
It reuses the bounded namespace snapshot rather than fetching each controller
again. Up to 100 application workloads are assessed; unsupported kinds, stale
generations, ownership issues and incomplete lists suppress combined health.
Application health rules apply, not individual workload rate annotations.

For a **Service**, the page evaluates inbound request health using the exact
Service name/namespace and its health annotation. This is not endpoint or
replica readiness. All health subjects use explicit telemetry cluster identity
and fixed five-minute rates.

**Health reporters** defaults to **Kiali inbound combination**: rates are summed
within each reporter, then the greater source/destination rate is selected per
protocol/response code. Outbound uses source reporting only. **Single reporter**
retains the earlier destination-inbound/source-outbound behavior.
No-response `response_code=0` takes precedence over gRPC status, and a missing
gRPC status falls back to the HTTP response code, matching Kiali.
The combiner has 372 independent Go oracle cases. The native combined-mode
consumer requires explicit source/destination labels; malformed or missing
reporter evidence cannot produce healthy status. Unknown-cluster fallback and
external registry Services remain open.

For a workload,
select the controller, namespace, name and exact telemetry cluster label
(`Kubernetes` in the supplied test mesh, not `mitch-auto`). The initial adapter
supports Deployment, StatefulSet, DaemonSet, ReplicaSet and ReplicationController.
It combines replica availability with inbound/outbound five-minute request rates
at a captured time. Missing, stale, invalid or warning-bearing inputs do not
produce a healthy verdict. Proxy synchronization, ambient health and mesh
security are explicitly not assessed.

Duplicate instant series and timestamps that differ by more than one second
from the captured query time are rejected. The pure health aggregator still
supports combining distinct observations of the same protocol/code.
With zero observed rates, Service request health is Not assessed; Application
and workload results are labeled replica-only, not healthy request traffic.

Real hosted Bookinfo checks showed healthy `reviews` Service requests and
application replica/request health across all three reviews Deployments.
An intentionally nonexistent telemetry cluster produced unavailable health,
not a healthy default. No response interception or cluster configuration write
was used for those checks; Desktop evidence remains open.

The reusable calculator implements Kiali's protocol/direction-specific
tolerances, first-match rules, annotation overrides and replica merging, checked
against 271 independent executions of the pinned Go implementation. Optional
**Custom health rules (JSON)** in per-cluster settings precede Kiali defaults:

```json
[
  {
    "namespace": "bookinfo",
    "kind": "workload",
    "name": "reviews-.*",
    "tolerance": [
      { "code": "5xx", "degraded": 1, "failure": 10, "protocol": "http", "direction": ".*" }
    ]
  }
]
```

Thresholds are percentages. Patterns use bounded, linear-time RE2 syntax.
Invalid saved rules are rejected, and malformed resource annotations report
fallback warnings. These settings contain no credentials and require no cluster
write. Application/Service health integration and complete mesh health remain
open; this is not a full-health-parity claim.

## Mesh inventory

**Kiali > Mesh inventory** discovers local `app=istiod` Deployments, namespace
injection labels and revision-tag labels through the selected cluster. It shows
reported controller replicas, image and literal `CLUSTER_ID` separately from
runtime health. Namespace/controller matches are explicitly label hints;
conflicting labels, ambiguous tags and incomplete reads are not resolved
automatically.

The **First container** column identifies the source of controller image,
`CLUSTER_ID` and shared/configuration observations. Pinned Kiali inspects the
first declared container, even if a later container is named `discovery`.
Malformed first entries are not skipped; missing containers keep configuration
unresolved. This is observation provenance, not proof of which process runs Istiod.

Within that container, the final `CLUSTER_ID` and `SHARED_MESH_CONFIG`
declarations win, including empty clears. A final indirect value is not replaced
by an earlier literal. Exact `EXTERNAL_ISTIOD=true` declarations accumulate;
a later `false` does not undo one. Noncanonical flag values and indirection stay
explicitly unresolved and block configuration eligibility rather than being
silently interpreted or dereferenced.

**Logical mesh cluster name (optional)** in Connection settings stores an
explicit per-context name for Kiali's local-management comparison. It is
separate from both the Headlamp context name and the metric cluster label;
none is inferred from another. Mesh inventory captures it only when you select
**Discover mesh**, then compares it exactly with each literal controller ID.
Missing mappings or unresolved IDs remain unavailable.

Changing or clearing the logical name discards the mesh capture, including
pending reads, without refetching or resurrecting it when the old value returns.
Unrelated metric settings do not invalidate that capture. Equality is independent
of `EXTERNAL_ISTIOD` and does not clear topology/configuration guards. This
setting currently supplies declared comparison evidence only: it does not
certify managed namespaces, alter existing label-based configuration inspection,
route Kubernetes requests, or enable Service port checks.

With an explicit mapping, **Declared local namespace scope** additionally
projects eligible namespaces for the supported local/default-visibility case.
It requires complete versioned namespace/controller/tag reads and resolved,
mapped, non-external controller configuration. It preserves first-tag selection,
Istio selectors, visible controller/root namespaces and observed Maistra
classification. Default Kiali system-namespace exclusions are shown separately.
Unsupported or incomplete evidence produces an unavailable result, not an
empty successful inventory. This does not discover remote mesh contexts,
apply custom Kiali visibility overrides, select a unique controller, or yet
activate Service port checks.

The **Pinned Kiali revision candidate** column separately follows the pinned
managed-revision label selector. Maistra membership takes precedence unless the
ignore label is present (even with value `false`); enabled legacy injection takes
precedence over an Istio revision, and ambient without a revision selects
`default`. Explicit empty revisions remain empty. This is not the Namespace
DTO's injection-revision field, a resolved controller, or a complete managed-
namespace inventory. Maistra-only/ignored labels remain inspectable in the
mesh-labelled filter.

Coincident Istiod revision labels no longer resolve a Maistra membership to an
Istio configuration automatically. Own/root namespace exceptions remain intact,
and resolved-configuration links are offered only for ready contexts. Malformed
relevant label values remain unavailable rather than becoming a fallback.

**Show captured revision-tag precedence** lists the observed webhooks in capture
order. Following pinned Kiali behavior, the first tag for each raw revision wins;
its tag replaces the revision as a namespace lookup key. Later aliases are shown
but not combined, and distinct revisions sharing a selected tag remain ambiguous.
Empty tags suppress raw-revision fallback. Missing controller revision labels
stay empty rather than becoming `default`; empty/default ConfigMap suffixes
still use standard names. This is same-context evidence, not complete
cross-cluster tag assignment or managed-namespace membership.

The **Namespace configuration context** table separately evaluates configured
Istio discovery selectors after resolving a local controller. Selectors are
OR-combined, with AND semantics within each selector; control-plane and root
namespaces retain their explicit exceptions. Matching configuration does not
prove injection, traffic or health. Malformed selectors, ambiguous associations
and missing sources remain unresolved. The plugin does not invent an association
for an unrelated unlabelled namespace or apply Kiali-server visibility overrides.

Standard revision ConfigMaps, supported direct ConfigMap-backed mounted mesh
files and a literal same-cluster `SHARED_MESH_CONFIG` reference provide selected
configuration fields. The first container's `--meshConfig` flag selects the file
path (default `/etc/istio/config/mesh`); `--meshConfigFile` is not that flag.
Supported mappings include the most-specific mount, item path-to-key mappings
and exact-file `subPath`. A selected alternate map/key replaces the standard
source, rather than merging both local sources. Local values take precedence,
trust-domain aliases are combined, and explicit false automatic-mTLS values are
preserved. Supported fields accept protobuf names such as `root_namespace` and
`enable_auto_mtls` as well as `rootNamespace` and `enableAutoMtls`. When both
spellings occur, the camelCase name wins even when null, regardless of key order.
Selector and label-map keys are not renamed.
Missing shared configuration is reported; denied/invalid sources
block the merged projection. A missing or failed mounted file never silently
falls back to the standard map. Mounted captures require complete discovery and
versioned controller/ConfigMap evidence, rechecked within the shared deadline.
Mesh inventory shows the selected map, key, path and captured UID/resource
version; consumer inspectors retain the source provenance.

Mounted-file acceptance also checks directly mapped networks-file dependencies:
absent keys and empty YAML/network maps are supported, but denied/missing maps,
malformed or nonempty networks remain unavailable. This guard does not implement
network topology; it prevents a failed dependency from certifying the file source.

Unresolved environment references/expansion, `envFrom`, projected/Secret/host/CSI
volumes, ambiguous or masking mounts, directory `subPath`, `subPathExpr` and
external configuration topology remain blocked. No Secret or container-file
endpoint is read. This does not apply Istio runtime defaults or merge all
ProxyConfig/extension fields, networks or external configuration clusters.
The injector's configured DNS suffix remains distinct from trust domain,
Headlamp cluster name and metric cluster labels.

This source batch has no new live-load evidence: browser contribution, console,
i18n/accessibility, hosted fixtures, Desktop and live-cluster gates remain open.
Local tests/builds do not establish injection, encryption, proxy synchronization
or complete effective configuration.

No Secrets are read. Collections, configuration reads and parser input are
bounded; at most 20 controllers receive configuration lookups, with three
simultaneous requests and a shared fifteen-second discovery deadline. Cluster
scope is captured before awaiting reads; timeout cancels outstanding work and
requires an explicit retry. This is read-only inventory and selected-field projection,
not observed mTLS, certificate, proxy-sync or full mesh-security parity.

## Configured mTLS assessment

**Kiali > mTLS configuration** accepts an explicit namespace and local controller,
or a label-based candidate link from Mesh inventory. It reads namespace/root
PeerAuthentications and DestinationRules and displays Kiali's configured status
separately from observed encryption. The calculation uses an explicitly reported
automatic-mTLS value, or the documented Istio default with that provenance shown.
DNS comes from an explicit setting or the observed injector configuration, never
the trust domain or Headlamp cluster name.

Incomplete reads, ambiguous namespace-wide policies, matching wildcard-rule
conflicts, excluded/unresolved discovery selectors, unknown selector fields
and unsupported ambient contexts suppress the
indicator. The reusable composition core has 2,600 original-Go oracle cases.
This initial consumer is namespace-wide only: per-service/subset/port behavior,
authorization, complete semantic validation and observed security remain open.

## Agent skills

Project skills live in [`.github/skills/`](.github/skills/), Copilot's
repository-local skill discovery directory. Each has its own `SKILL.md`.
[AGENTS.md](AGENTS.md) supplies the always-on plugin guidance and compatibility
notes for the upstream Claude-oriented workflows.

| Skill | Purpose |
| --- | --- |
| `create-crd-plugin` | Orchestrate the initial CRD-plugin buildout |
| `plan-plugin` | Plan resource coverage and navigation |
| `define-resource` | Model typed custom resources |
| `add-list-view` | Add list pages, routes, sidebar entries, and topology |
| `add-detail-view` | Add resource detail pages |
| `add-settings` | Add persisted plugin settings |
| `ensure-dependency` | Check or install a project's cluster dependencies |
| `seed-test-data` | Prepare cluster fixtures |
| `run-and-verify` | Verify the plugin in a running Headlamp instance |
| `document-plugin` | Document implemented resource coverage |
| `pr-triage` | Read-only repository PR triage |

### Source and compatibility

All 11 skill files were extracted without content changes from
[kubernetes-sigs/headlamp#6096](https://github.com/kubernetes-sigs/headlamp/pull/6096),
pinned to commit
[`0de15ca93a4fa345be1bc4afc4346fc977523198`](https://github.com/kubernetes-sigs/headlamp/commit/0de15ca93a4fa345be1bc4afc4346fc977523198).
Their Git blob hashes were checked against that commit during extraction.
The 10 plugin workflows came from
`plugins/headlamp-plugin/template-claude/.claude/skills/`; `pr-triage` came
from the upstream repository's `.claude/skills/`.

The skills were reviewed before installation. They are **medium risk** when
executed: some workflows install packages, modify a selected Kubernetes cluster,
change the active kubectl context, or manage Headlamp development artifacts.
Installing the skill files does not execute those operations.
Obtain explicit approval for cluster mutations and use an explicit target
context rather than changing shared kubeconfig state.

The upstream skill bodies retain references to `CLAUDE.md`, Claude slash
commands, permission metadata, and Kubernetes/Helm/Chrome DevTools MCP servers.
These are not Copilot permissions or automatically available tools; see
`AGENTS.md` for the mapping. No Claude settings, permission allowlists, or MCP
server configuration were imported.

Upstream material is licensed under Apache-2.0; see [LICENSE](LICENSE) and
[NOTICE](NOTICE).
