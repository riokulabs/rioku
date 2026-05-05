#!/usr/bin/env node
/**
 * patch-openapi-for-orval.mjs
 *
 * Converts `packages/proto/gen/openapi/rioku/v1/api.full.json` (a hybrid
 * swagger 2.0 / openapi 3.x document) into a valid OpenAPI 3.0.3 document
 * suitable for consumption by Orval.
 *
 * Transformations applied:
 *   1. Moves `definitions` → `components.schemas`
 *   2. Rewrites all `#/definitions/<Name>` refs → `#/components/schemas/<Name>`
 *   3. Migrates `parameters[in=body]` → `requestBody`
 *   4. Wraps `responses[*].schema` → `responses[*].content['application/json'].schema`
 *   5. Sets `openapi: '3.0.3'` and removes `swagger` field
 *
 * Output: `packages/web/src/api/openapi-patched.json`
 *
 * Run: node scripts/patch-openapi-for-orval.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WEB = resolve(__dirname, '..');
const SRC = resolve(REPO_WEB, '..', 'proto', 'gen', 'openapi', 'rioku', 'v1', 'api.full.json');
const OUT = resolve(REPO_WEB, 'src', 'api', 'openapi-patched.json');

const SCHEMA_FIELDS = ['type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'pattern'];

function rewriteDefinitionRefs(obj) {
  const serialized = JSON.stringify(obj);
  const rewritten = serialized.split('#/definitions/').join('#/components/schemas/');
  return JSON.parse(rewritten);
}

function migrateNonBodyParam(param) {
  if (!param || typeof param !== 'object') return param;
  const cloned = { ...param };
  const schema = {};
  let moved = false;
  for (const field of SCHEMA_FIELDS) {
    if (field in cloned) {
      schema[field] = cloned[field];
      delete cloned[field];
      moved = true;
    }
  }
  if (moved) {
    cloned.schema = {
      ...schema,
      ...(cloned.schema && typeof cloned.schema === 'object' ? cloned.schema : {}),
    };
  }
  // Remove swagger 2.0-only parameter fields not valid in OAS 3
  // collectionFormat → OAS 3 uses style/explode on the parameter
  if ('collectionFormat' in cloned) {
    const fmt = cloned.collectionFormat;
    delete cloned.collectionFormat;
    // Map swagger 2.0 collectionFormat to OAS 3 style/explode
    if (fmt === 'multi') {
      cloned.style = 'form';
      cloned.explode = true;
    } else if (fmt === 'csv') {
      cloned.style = 'form';
      cloned.explode = false;
    } else if (fmt === 'ssv') {
      cloned.style = 'spaceDelimited';
      cloned.explode = false;
    } else if (fmt === 'pipes') {
      cloned.style = 'pipeDelimited';
      cloned.explode = false;
    }
  }
  return cloned;
}

function migrateOperation(operation) {
  if (!operation || typeof operation !== 'object') return operation;
  const op = { ...operation };

  // Migrate parameters: split body param into requestBody
  const params = op.parameters;
  if (Array.isArray(params)) {
    const nonBody = [];
    let bodyParam;
    for (const p of params) {
      if (p && typeof p === 'object' && p.in === 'body') {
        bodyParam = p;
      } else {
        nonBody.push(p);
      }
    }
    if (bodyParam !== undefined && !op.requestBody) {
      op.requestBody = {
        required: bodyParam.required === true,
        content: {
          'application/json': {
            schema: bodyParam.schema ?? {},
          },
        },
      };
      if (typeof bodyParam.description === 'string') {
        op.requestBody.description = bodyParam.description;
      }
    }
    if (nonBody.length > 0) {
      op.parameters = nonBody.map(migrateNonBodyParam);
    } else {
      delete op.parameters;
    }
  }

  // Migrate responses: move schema into content
  if (op.responses && typeof op.responses === 'object') {
    for (const [code, response] of Object.entries(op.responses)) {
      if (!response || typeof response !== 'object') continue;
      if (response.schema !== undefined && !response.content) {
        op.responses[code] = {
          ...response,
          content: {
            'application/json': { schema: response.schema },
          },
        };
        delete op.responses[code].schema;
      }
    }
  }

  return op;
}

function main() {
  const raw = readFileSync(SRC, 'utf8');
  let spec = JSON.parse(raw);

  // Step 1: rewrite all #/definitions/ refs
  spec = rewriteDefinitionRefs(spec);

  // Step 2: merge definitions into components.schemas
  const existingSchemas = spec.components?.schemas ?? {};
  const definitions = spec.definitions ?? {};
  spec.components = {
    ...spec.components,
    schemas: { ...definitions, ...existingSchemas },
  };
  delete spec.definitions;

  // Step 3: migrate paths
  const paths = {};
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  for (const [pathKey, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') {
      paths[pathKey] = pathItem;
      continue;
    }
    const newItem = {};
    for (const [key, value] of Object.entries(pathItem)) {
      if (HTTP_METHODS.includes(key)) {
        newItem[key] = migrateOperation(value);
      } else {
        newItem[key] = value;
      }
    }
    paths[pathKey] = newItem;
  }
  spec.paths = paths;

  // Step 3b: fix inline anonymous schemas that cause orval duplicate-name errors.
  // Orval generates TypeScript names for inline object properties by combining the parent
  // schema name with the property name. v1PluginConfig has a property named "schema" (type: object)
  // which produces "V1PluginConfigSchema" — conflicting with orval's internal naming. Replace the
  // anonymous object with a named schema ref to give it a stable, unique TypeScript type name.
  const schemas = spec.components?.schemas ?? {};
  if (schemas['v1PluginConfig']?.properties?.['schema']?.type === 'object') {
    schemas['V1PluginConfigSchemaValue'] = { type: 'object', additionalProperties: true };
    schemas['v1PluginConfig'].properties['schema'] = { '$ref': '#/components/schemas/V1PluginConfigSchemaValue' };
    spec.components.schemas = schemas;
  }

  // Step 4: normalize openapi version, remove swagger field
  spec.openapi = '3.0.3';
  delete spec.swagger;
  // Remove swagger 2.0-only top-level fields
  delete spec.consumes;
  delete spec.produces;
  delete spec.host;
  delete spec.basePath;
  delete spec.schemes;
  delete spec.securityDefinitions;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n', 'utf8');

  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
  const pathCount = Object.keys(spec.paths ?? {}).length;
  const opCount = Object.values(spec.paths ?? {}).reduce((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    return acc + Object.keys(item).filter(k => HTTP_METHODS.includes(k)).length;
  }, 0);

  console.log(`✓ wrote ${OUT}`);
  console.log(`  schemas:    ${schemaCount}`);
  console.log(`  paths:      ${pathCount}`);
  console.log(`  operations: ${opCount}`);
}

main();
