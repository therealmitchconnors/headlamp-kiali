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
  'prometheus/client.go': 'e0d914d91a981d2963bf59672fdd28293fe0d7ab',
  'prometheus/metrics.go': '941c8de27de564abace6ee0cf717c6b2fb8a1d01',
  'business/dashboards.go': '2707361491dc93e769f363c6bdb9122af230bd20',
  'config/dashboards/dashboards_config.go': '1eace997db22287475c17be2763c838334f1304e',
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
assert.ok(
  text['business/dashboards.go'].includes(
    'promClient.FetchRange(ctx, ref.MetricName, filters, grouping, aggregator, &params.RangeQuery)'
  )
);
assert.ok(
  text['business/dashboards.go'].includes(
    'promClient.FetchRateRange(ctx, ref.MetricName, []string{filters}, grouping, &params.RangeQuery)'
  )
);
const fullRaw = text['prometheus/client.go'].match(
  /^func \(in \*Client\) FetchRange\([\s\S]*?^\}/m
)?.[0];
assert.ok(fullRaw);
const rawBody = fullRaw.slice(fullRaw.indexOf('\tquery := fmt.Sprintf'), fullRaw.lastIndexOf('}'));
assert.ok(rawBody.includes('return fetchRange'));
const rate = text['prometheus/metrics.go'].match(/^func fetchRateRange\([\s\S]*?^\}/m)?.[0];
assert.ok(rate);
const cases = [];
for (const [dataType, aggregator] of [
  ['raw', 'sum'],
  ['raw', 'avg'],
  ['raw', 'min'],
  ['raw', 'max'],
  ['rate', 'sum'],
])
  for (const metricName of ['memory_bytes', 'requests_total', 'runtime:queue_depth'])
    for (const scope of [
      { namespaceLabel: 'namespace', clusterLabel: 'cluster', metricCluster: 'east' },
      {
        namespaceLabel: 'kubernetes_namespace',
        clusterLabel: 'metric_cluster',
        metricCluster: 'east"\\west',
      },
      { namespaceLabel: 'namespace', clusterLabel: null, metricCluster: '' },
    ])
      cases.push({
        ...scope,
        namespace: 'bookinfo',
        chart: { name: 'Chart', unit: 'value', metricName, dataType, aggregator },
      });
const directory = await mkdtemp(join(tmpdir(), 'kiali-custom-query-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("context";"fmt";"encoding/json";"os";"strconv")
type Metric=string
type RangeQuery struct{RateFunc string;RateInterval string;Range int}
type Client struct{api interface{}}
func fetchRange(ctx context.Context,api interface{},query string,bounds int)Metric{return query}
func(in *Client) FetchRange(ctx context.Context,metricName,labels,grouping,aggregator string,q *RangeQuery)Metric{
${rawBody}
}
${rate.replaceAll('prom_v1.API', 'interface{}')}
func main(){
 var inputs []struct{Namespace string;NamespaceLabel string;ClusterLabel *string;MetricCluster string;Chart struct{MetricName string;DataType string;Aggregator string}}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 output:=[]string{}
 for _,in:=range inputs{
  labels:="{"+in.NamespaceLabel+"="+strconv.Quote(in.Namespace)
  if in.ClusterLabel!=nil{labels+=","+*in.ClusterLabel+"="+strconv.Quote(in.MetricCluster)}
  labels+="}"
  q:=RangeQuery{RateFunc:"rate",RateInterval:"5m"}
  var value string
  if in.Chart.DataType=="rate"{value=fetchRateRange(context.Background(),nil,in.Chart.MetricName,[]string{labels},"",&q)
  }else{value=(&Client{}).FetchRange(context.Background(),in.Chart.MetricName,labels,"",in.Chart.Aggregator,&q)}
  output=append(output,value)
 }
 if err:=json.NewEncoder(os.Stdout).Encode(output);err!=nil{panic(err)}
}`
  );
  output = JSON.parse(
    execFileSync('go', ['run', 'main.go'], {
      cwd: directory,
      input: JSON.stringify(cases),
      encoding: 'utf8',
      env: { ...process.env, GO111MODULE: 'off', GOPROXY: 'off', GOTOOLCHAIN: 'local' },
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
const destination = 'test-files/parity/custom-dashboard-query-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), document);
else await writeFile(destination, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go custom dashboard query cases.`
);
