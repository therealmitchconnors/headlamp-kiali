import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
assert.ok(values.source, 'Pass --source for the pinned Kiali checkout');
const source = 'models/health.go';
const blob = 'd3df3111150fc1143c7678fdf73c3b898a0e0487';
const bytes = await readFile(join(values.source, source));
assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob);
const text = bytes.toString('utf8');
function extract(pattern) {
  const match = text.match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0].replaceAll('model.Sample', 'Sample').replaceAll('model.LabelName', 'string');
}
const functions = [
  extract(/^type RequestHealth struct \{[\s\S]*?^\}/m),
  extract(/^func NewEmptyRequestHealth\([\s\S]*?^\}/m),
  ...['AggregateInbound', 'AggregateOutbound', 'CombineReporters'].map(name =>
    extract(new RegExp(`^func \\(in \\*RequestHealth\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract(/^func aggregate\([\s\S]*?^\}/m),
];
const labels = [
  { request_protocol: 'http', response_code: '200' },
  { request_protocol: 'http', response_code: '503' },
  { request_protocol: 'http', response_code: '0' },
  { request_protocol: 'grpc', response_code: '200', grpc_response_status: '0' },
  { request_protocol: 'grpc', response_code: '200', grpc_response_status: '13' },
  { request_protocol: 'grpc', response_code: '0', grpc_response_status: '0' },
  { request_protocol: 'grpc', response_code: '200' },
  { request_protocol: 'grpc', grpc_response_status: '1' },
  { request_protocol: 'custom', response_code: '201' },
  {},
];
const cases = [];
for (const metric of labels) {
  for (const reporter of [undefined, '', 'other', 'source', 'destination'])
    for (const value of [0, 0.25, 1, 7]) {
      const sample = {
        labels: { ...metric, ...(reporter === undefined ? {} : { reporter }) },
        value,
      };
      cases.push({ inbound: [sample], outbound: [sample] });
    }
  for (const source of [0, 0.25, 1, 7])
    for (const destination of [0, 0.25, 1, 7])
      cases.push({
        inbound: [
          { labels: { ...metric, reporter: 'source' }, value: source },
          { labels: { ...metric, reporter: 'destination' }, value: destination },
        ],
        outbound: [
          { labels: { ...metric, reporter: 'source' }, value: source },
          { labels: { ...metric, reporter: 'destination' }, value: destination },
        ],
      });
  cases.push({
    inbound: [
      { labels: metric, value: 9 },
      { labels: { ...metric, reporter: 'source' }, value: 1 },
      { labels: { ...metric, reporter: 'source' }, value: 2 },
      { labels: { ...metric, reporter: 'destination' }, value: 5 },
    ],
    outbound: [],
  });
}
cases.push({ inbound: [], outbound: [] });
cases.push({
  inbound: labels.flatMap((metric, index) => [
    { labels: { ...metric, reporter: 'source' }, value: index },
    { labels: { ...metric, reporter: 'destination' }, value: 10 - index },
  ]),
  outbound: labels.map((metric, index) => ({
    labels: { ...metric, reporter: 'source' },
    value: index,
  })),
});

const directory = await mkdtemp(join(tmpdir(), 'kiali-health-reporters-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
type Sample struct { Metric map[string]string \`json:"labels"\`; Value float64 \`json:"value"\` }
var log = struct{ Tracef func(string, ...any) }{func(string, ...any){}}
${functions.join('\n\n')}
type Input struct { Inbound []Sample; Outbound []Sample }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 results:=[]any{}
 for _, in:=range inputs {
  health:=NewEmptyRequestHealth()
  for _, sample:=range in.Inbound { health.AggregateInbound(&sample) }
  for _, sample:=range in.Outbound { health.AggregateOutbound(&sample) }
  health.CombineReporters()
  results=append(results,map[string]any{"inbound":health.Inbound,"outbound":health.Outbound})
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results); err!=nil { panic(err) }
}
`
  );
  output = JSON.parse(
    execFileSync('go', ['run', 'main.go'], {
      cwd: directory,
      input: JSON.stringify(cases),
      encoding: 'utf8',
      env: { ...process.env, GO111MODULE: 'off', GOPROXY: 'off', GOTOOLCHAIN: 'local' },
      maxBuffer: 8 * 1024 * 1024,
    })
  );
} finally {
  await rm(directory, { recursive: true });
}
const artifact = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources: { [source]: blob },
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/health-reporters-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Health reporter oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent request reporter cases`);
