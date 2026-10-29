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
const method = text['prometheus/metrics.go'].match(
  /^func buildHistogramQueries\([\s\S]*?^\}/m
)?.[0];
assert.ok(method);
for (const name of [
  'istio_request_duration_milliseconds',
  'istio_request_bytes',
  'istio_response_bytes',
])
  assert.ok(text['business/metrics_definitions.go'].includes(`"${name}"`));
const cases = [];
for (const metric of ['duration', 'requestSize', 'responseSize'])
  for (const direction of ['inbound', 'outbound'])
    for (const telemetryCluster of ['Kubernetes', 'east"cluster', 'west\\zone'])
      for (const workload of [undefined, 'reviews-v1'])
        for (const summaries of [
          ['avg'],
          ['p50'],
          ['p95'],
          ['avg', 'p95'],
          ['avg', 'p50', 'p90', 'p95', 'p99'],
        ])
          cases.push({
            metric,
            direction,
            telemetryCluster,
            ...(workload ? { workload } : {}),
            summaries,
            namespace: 'bookinfo',
            minutes: 15,
            end: 10000,
          });
const directory = await mkdtemp(join(tmpdir(), 'kiali-histogram-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("context";"encoding/json";"fmt";"os";"strings")
${method}
func main(){
 var inputs []struct{Metric string;Direction string;TelemetryCluster string;Workload string;Summaries []string;Namespace string}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 names:=map[string]string{"duration":"istio_request_duration_milliseconds","requestSize":"istio_request_bytes","responseSize":"istio_response_bytes"}
 qs:=map[string]string{"p50":"0.5","p90":"0.9","p95":"0.95","p99":"0.99"}
 results:=[]map[string]string{}
 for _,in:=range inputs{
  side:="destination";if in.Direction=="outbound"{side="source"}
  labels:=fmt.Sprintf("reporter=%q,%s_workload_namespace=%q,%s_cluster=%q",side,side,in.Namespace,side,in.TelemetryCluster)
  if in.Workload!=""{labels+=fmt.Sprintf(",%s_workload=%q",side,in.Workload)}
  quantiles:=[]string{};avg:=false
  for _,summary:=range in.Summaries{if summary=="avg"{avg=true}else{quantiles=append(quantiles,qs[summary])}}
  queries:=buildHistogramQueries(context.Background(),names[in.Metric],"{"+labels+"}","","5m",avg,quantiles)
  translated:=map[string]string{}
  for _,summary:=range in.Summaries{key:=summary;if summary!="avg"{key=qs[summary]};translated[summary]=strings.TrimSpace(queries[key])}
  results=append(results,translated)
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
      maxBuffer: 4 * 1024 * 1024,
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
const path = 'test-files/parity/histogram-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${cases.length} original-Go histogram query cases.`
);
