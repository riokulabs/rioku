#!/usr/bin/env node
/**
 * normalize-to-oas3.mjs
 *
 * Normalizes `packages/proto/gen/openapi/rioku/v1/api.full.json` in-place.
 * The openapi-merge Go tool produces a hybrid swagger 2.0 / OAS 3.x document;
 * this script converts it to a valid OpenAPI 3.0.3 document.
 *
 * Transformations applied:
 *   1. Moves `definitions` → `components.schemas`
 *   2. Rewrites all `#/definitions/<Name>` refs → `#/components/schemas/<Name>`
 *   3. Migrates `parameters[in=body]` → `requestBody`
 *   4. Wraps `responses[*].schema` → `responses[*].content['application/json'].schema`
 *   5. Fixes inline anonymous schemas that cause orval duplicate-name errors
 *   6. Sets `openapi: '3.0.3'` and removes `swagger` + swagger-2.0-only top-level fields
 *
 * Usage: node packages/proto/scripts/normalize-to-oas3.mjs <path-to-api.full.json>
 *
 * Called automatically by `make openapi` after the Go merge step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('Usage: normalize-to-oas3.mjs <path-to-api.full.json>');
  process.exit(1);
}

const FILE = resolve(targetArg);

const SCHEMA_FIELDS = ['type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'pattern'];
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

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
  const raw = readFileSync(FILE, 'utf8');
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

  writeFileSync(FILE, JSON.stringify(spec, null, 2) + '\n', 'utf8');

  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
  const pathCount = Object.keys(spec.paths ?? {}).length;
  const opCount = Object.values(spec.paths ?? {}).reduce((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    return acc + Object.keys(item).filter(k => HTTP_METHODS.includes(k)).length;
  }, 0);

  console.log(`normalize-to-oas3: wrote ${FILE}`);
  console.log(`  schemas:    ${schemaCount}`);
  console.log(`  paths:      ${pathCount}`);
  console.log(`  operations: ${opCount}`);
}

main();
