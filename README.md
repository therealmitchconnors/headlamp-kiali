# Kiali

A Headlamp plugin for Kiali, scaffolded with
`@kinvolk/headlamp-plugin@0.14.0` following the
[Headlamp getting-started guide](https://headlamp.dev/docs/latest/development/plugins/getting-started/).

The native plugin adds a **Kiali** sidebar with an overview, Applications,
namespace and Service lists, workload-kind tabs, and per-cluster settings.
Namespace filters and resource details reuse Headlamp's native components.
The overview checks Istio API availability and an explicitly configured existing
Prometheus Service through Headlamp's Kubernetes proxy.

This is **not full Kiali parity**: Istio configuration views/actions, traffic
graphs, metric charts, mesh-health calculations and
validation are still planned. The workload tabs currently cover Deployments,
StatefulSets, DaemonSets, Jobs and CronJobs. Resource names open Headlamp's
built-in detail view or drawer, not a Kiali-specific detail page.
The initial browsing routes require one selected cluster and do not expose
create/delete/bulk actions. Headlamp's own resource details keep their existing
behavior.

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

## Using the native slice

Select one cluster, then open **Kiali > Overview**. Istio API presence is reported
separately from control-plane health: having the CRDs does not prove a healthy
mesh. Resource browsing works without configuring Prometheus.

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
a maximum of four 250-item pages per resource kind. Denials, malformed responses
and truncated lists are explicit; incomplete counts are not presented as zero.
Refresh is manual. Multi-namespace correlation, external workloads, WorkloadGroups
and OpenShift-specific controllers remain outside this initial slice.

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
