import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
const destination = 'src/core/builtinDashboards.json';
const sourcePath = 'config/dashboards/dashboards.go';
const sourceBlob = 'cbbc6cd2ac7834b117fb11e61af613d92016b30f';
const checksum = 'ef584498688cbf0cf3a7b5ffd314d45e373ad1176484cb8523691ba53a5ef35a';
let content;
if (values.source) {
  const bytes = await readFile(join(values.source, sourcePath));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    sourceBlob
  );
  const text = bytes.toString('utf8');
  const match = text.match(/const DEFAULT_DASHBOARDS_YAML = `([\s\S]*)`/);
  assert.ok(match, 'Expected the pinned dashboard literal');
  const dashboards = yaml.load(match[1]);
  content =
    JSON.stringify(
      {
        version: 'v2.33.0',
        commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
        sourcePath,
        sourceBlob,
        dashboards,
      },
      null,
      2
    ) + '\n';
} else {
  assert.ok(values.check, 'Pass --source for the pinned Kiali checkout when generating');
  content = await readFile(destination, 'utf8');
}
assert.equal(
  createHash('sha256').update(content).digest('hex'),
  checksum,
  'Pinned dashboard capture changed'
);
const document = JSON.parse(content);
assert.equal(document.dashboards.length, 21);
assert.equal(
  document.dashboards.flatMap(dashboard => dashboard.items).filter(item => item.chart).length,
  91
);
if (values.check) assert.equal(await readFile(destination, 'utf8'), content);
else await writeFile(destination, content);
console.log(
  `${
    values.check ? 'Verified' : 'Generated'
  } 21 pinned dashboard templates with 91 inline charts (${checksum}).`
);
