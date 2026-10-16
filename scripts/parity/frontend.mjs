import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
assert.ok(values.source, 'Pass --source with the pinned Kiali checkout path');
const inventory = JSON.parse(await readFile('test-files/parity/upstream.json', 'utf8'));
assert.equal(inventory.commit, '0e8be887b8217bbcac5e3ae0bfcd258073949cca');

async function parseSource(path) {
  const pinned = inventory.sources.find(source => source.path === path);
  assert.ok(pinned, `Missing pinned source: ${path}`);
  const content = await readFile(join(values.source, path));
  const hash = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  assert.equal(hash, pinned.blob, `Upstream source changed: ${path}`);
  return ts.createSourceFile(path, content.toString('utf8'), ts.ScriptTarget.Latest, true);
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

const pathsFile = await parseSource('frontend/src/config/Paths.ts');
const paths = new Map();
visit(pathsFile, node => {
  if (ts.isEnumDeclaration(node) && node.name.text === 'Paths') {
    for (const member of node.members) {
      assert.ok(member.initializer && ts.isStringLiteral(member.initializer));
      paths.set(member.name.getText(pathsFile), member.initializer.text);
    }
  }
});

function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map(span => {
          const expression = span.expression;
          assert.ok(
            ts.isPropertyAccessExpression(expression) &&
              ts.isIdentifier(expression.expression) &&
              expression.expression.text === 'Paths',
            `Unsupported route expression: ${expression.getText()}`
          );
          const value = paths.get(expression.name.text);
          assert.notEqual(value, undefined, `Unknown path constant: ${expression.name.text}`);
          return value + span.literal.text;
        })
        .join('')
    );
  }
  throw new Error(`Unsupported route path: ${node.getText()}`);
}

const routesFile = await parseSource('frontend/src/routes.tsx');
const routes = [];
visit(routesFile, node => {
  if (ts.isVariableDeclaration(node) && node.name.getText() === 'pathRoutes') {
    assert.ok(node.initializer && ts.isArrayLiteralExpression(node.initializer));
    for (const route of node.initializer.elements) {
      assert.ok(ts.isObjectLiteralExpression(route));
      const property = name =>
        route.properties.find(
          property => ts.isPropertyAssignment(property) && property.name.getText() === name
        )?.initializer;
      const path = property('path');
      const element = property('element');
      assert.ok(path && element, 'Route is missing its path or component');
      const location = routesFile.getLineAndCharacterOfPosition(route.getStart());
      routes.push({
        id: `route:${literal(path)}`,
        path: literal(path),
        element: element.getText(routesFile),
        source: 'frontend/src/routes.tsx',
        line: location.line + 1,
      });
    }
  }
});
assert.ok(routes.length > 0, 'Route registry not found');
assert.equal(new Set(routes.map(route => route.id)).size, routes.length);

const declarations = [];
for (const source of inventory.sources) {
  if (
    ![
      'frontend/src/types/Graph.ts',
      'frontend/src/config/HealthConfig.ts',
      'frontend/src/components/IstioWizards/WizardActions.ts',
    ].includes(source.path)
  ) {
    continue;
  }
  const file = await parseSource(source.path);
  visit(file, node => {
    if (!ts.isEnumDeclaration(node) && !ts.isInterfaceDeclaration(node)) {
      return;
    }
    for (const member of node.members) {
      if (!member.name) {
        continue;
      }
      const name = member.name.getText(file);
      const declaration = {
        id: `contract:${source.path}#${node.name.text}.${name}`,
        source: source.path,
        line: file.getLineAndCharacterOfPosition(member.getStart()).line + 1,
        symbol: `${node.name.text}.${name}`,
        definition: member.getText(file),
      };
      const existing = declarations.find(entry => entry.id === declaration.id);
      if (existing) {
        assert.equal(
          existing.definition,
          declaration.definition,
          `Conflicting merged interface field: ${declaration.id}`
        );
        existing.additionalLines ??= [];
        existing.additionalLines.push(declaration.line);
      } else {
        declarations.push(declaration);
      }
    }
  });
}

const output = {
  version: inventory.version,
  commit: inventory.commit,
  routes: routes.sort((a, b) => a.id.localeCompare(b.id)),
  declarations: declarations.sort((a, b) => a.id.localeCompare(b.id)),
};
const path = 'test-files/parity/frontend.json';
const serialized = JSON.stringify(output, null, 2) + '\n';
if (values.check) {
  assert.equal(await readFile(path, 'utf8'), serialized, 'Frontend inventory drift');
} else {
  await writeFile(path, serialized);
}
console.log(`Verified ${routes.length} frontend routes and ${declarations.length} contract fields`);
