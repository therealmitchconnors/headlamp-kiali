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
const sources = {
  'prometheus/metrics.go': '941c8de27de564abace6ee0cf717c6b2fb8a1d01',
  'business/metrics_definitions.go': '2d9c32a25b1769e44ce927db14e75f7e544544f5',
};
const text = {};
for (const [path, hash] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    hash
  );
  text[path] = bytes.toString('utf8');
}
const extract = (file, pattern) => {
  const match = text[file].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0];
};
const code = [
  extract('business/metrics_definitions.go', /^type istioMetric struct \{[\s\S]*?^\}/m),
  extract('business/metrics_definitions.go', /^var istioMetrics = \[\]istioMetric\{[\s\S]*?^\}/m),
  extract('prometheus/metrics.go', /^func fetchRateRange\([\s\S]*?^\}/m).replaceAll(
    'prom_v1.API',
    'API'
  ),
];
const signals = [
  'request_throughput',
  'response_throughput',
  'grpc_sent',
  'grpc_received',
  'tcp_sent',
  'tcp_received',
  'tcp_opened',
  'tcp_closed',
];
const cases = [];
for (const direction of ['inbound', 'outbound'])
  for (const telemetryCluster of ['Kubernetes', 'east"cluster', 'west\\zone'])
    for (const workload of [undefined, 'reviews-v1'])
      for (const selected of [...signals.map(signal => [signal]), signals])
        cases.push({
          direction,
          telemetryCluster,
          ...(workload ? { workload } : {}),
          namespace: 'bookinfo',
          minutes: 15,
          end: 10000,
          signals: selected,
        });
const directory = await mkdtemp(join(tmpdir(), 'kiali-traffic-signals-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("context";"encoding/json";"fmt";"os")
type API interface{}
type Range struct{}
type RangeQuery struct{RateFunc string;RateInterval string;Range Range}
type Metric string
func fetchRange(ctx context.Context,api API,query string,bounds Range)Metric{return Metric(query)}
${code.join('\n\n')}
type result struct{Key string \`json:"key"\`;Metric string \`json:"metric"\`;Expression string \`json:"expression"\`}
func main(){
 var inputs []struct{Direction string;TelemetryCluster string;Workload string;Namespace string;Signals []string}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 results:=[][]result{}
 for _,in:=range inputs{
  side:="destination";if in.Direction=="outbound"{side="source"}
  labels:=fmt.Sprintf("{reporter=%q,%s_workload_namespace=%q,%s_cluster=%q",side,side,in.Namespace,side,in.TelemetryCluster)
  if in.Workload!=""{labels+=fmt.Sprintf(",%s_workload=%q",side,in.Workload)}
  labels+="}"
  row:=[]result{}
  for _,key:=range in.Signals{
   found:=false
   for _,metric:=range istioMetrics{
    if metric.kialiName!=key{continue}
    if metric.isHisto||metric.useErrorLabels{panic("Expected simple counter")}
    expression:=fetchRateRange(context.Background(),nil,metric.istioName,[]string{labels},"",&RangeQuery{RateFunc:"rate",RateInterval:"5m"})
    row=append(row,result{key,metric.istioName,string(expression)});found=true;break
   }
   if !found{panic(key)}
  }
  results=append(results,row)
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results);err!=nil{panic(err)}
}`
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
const document = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/traffic-signals-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go signal definition/rate-query cases.`
);
