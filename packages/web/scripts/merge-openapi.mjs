#!/usr/bin/env node
/**
 * merge-openapi.mjs — one-shot build script that reads every swagger 2.0 file
 * emitted by buf at `packages/proto/gen/openapi/rioku/v1/*.swagger.json`,
 * converts the small set of fields that Scalar's OpenAPI 3 renderer needs,
 * and merges them into a single document at
 * `packages/web/src/api-explorer/openapi-merged.json`.
 *
 * This is a minimal, purpose-built transform — NOT a full swagger2openapi
 * migration. We only remap:
 *
 *   - `definitions`                         → `components.schemas`
 *   - `#/definitions/<Name>`                → `#/components/schemas/<Name>`
 *   - `basePath` / `schemes` / `host`       → `servers[]`
 *   - `parameters[in=body]`                 → `requestBody`
 *   - `responses.*.schema`                  → `responses.*.content['application/json'].schema`
 *   - `securityDefinitions`                 → `components.securitySchemes`
 *
 * Run:   node scripts/merge-openapi.mjs
 *
 * The generated JSON is committed; regeneration happens when proto definitions
 * change. Scalar picks this JSON up via the api-explorer feature module.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WEB = resolve(__dirname, '..');
const SWAGGER_DIR = resolve(
  REPO_WEB,
  '..',
  'proto',
  'gen',
  'openapi',
  'rioku',
  'v1',
);
const OUT_PATH = resolve(
  REPO_WEB,
  'src',
  'api-explorer',
  'openapi-merged.json',
);

/**
 * Rewrite `#/definitions/X` refs to `#/components/schemas/X` by round-tripping
 * through JSON.stringify so we catch every occurrence (including nested
 * schemas, array items, allOf, etc.) without walking the AST ourselves.
 */
function rewriteDefinitionRefs(doc) {
  const serialized = JSON.stringify(doc);
  const rewritten = serialized.split('#/definitions/').join('#/components/schemas/');
  return JSON.parse(rewritten);
}

/**
 * Move `responses[*].schema` into `responses[*].content['application/json'].schema`.
 * Mutates in place.
 */
function migrateResponses(responses) {
  if (!responses || typeof responses !== 'object') return;
  for (const response of Object.values(responses)) {
    if (!response || typeof response !== 'object') continue;
    if (response.schema !== undefined) {
      response.content = {
        'application/json': { schema: response.schema },
      };
      delete response.schema;
    }
  }
}

/**
 * Swagger 2.0 keeps schema-shape fields (`type`, `format`, enums, etc.) on the
 * parameter object itself. OAS 3.0 requires these to be nested under a
 * dedicated `schema` object for non-body parameters. Strict validators
 * (Spectral, redocly) reject the swagger-2 shape; Scalar happens to tolerate
 * it but we emit valid OAS 3 for portability.
 */
const SCHEMA_FIELDS = ['type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'pattern'];

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
    // Merge with an existing `schema` (rare in swagger 2.0 non-body params,
    // but preserve caller-provided fields as highest precedence).
    cloned.schema = { ...schema, ...(cloned.schema && typeof cloned.schema === 'object' ? cloned.schema : {}) };
  }
  return cloned;
}

/**
 * Split swagger 2.0 parameters into OpenAPI 3 `parameters` + `requestBody`.
 * Swagger 2.0 lumps body parameters into `parameters[in=body]`; OAS 3 moves
 * them to a dedicated `requestBody` object. Remaining path/query/header
 * parameters are rewritten into OAS 3.0 `schema`-wrapped shape via
 * `migrateNonBodyParam`.
 */
function migrateParameters(operation) {
  const params = operation.parameters;
  if (!Array.isArray(params)) return;
  const nonBody = [];
  let bodyParam;
  for (const p of params) {
    if (p && typeof p === 'object' && p.in === 'body') {
      bodyParam = p;
    } else {
      nonBody.push(p);
    }
  }
  if (bodyParam !== undefined) {
    operation.requestBody = {
      required: bodyParam.required === true,
      content: {
        'application/json': {
          schema: bodyParam.schema ?? {},
        },
      },
    };
    if (typeof bodyParam.description === 'string') {
      operation.requestBody.description = bodyParam.description;
    }
  }
  if (nonBody.length > 0) {
    operation.parameters = nonBody.map(migrateNonBodyParam);
  } else {
    delete operation.parameters;
  }
}

/**
 * Convert a single swagger 2.0 file into a shape we can merge into the
 * OpenAPI 3 document. Returns { paths, schemas, securitySchemes, title }.
 */
function convertFile(swagger) {
  const converted = rewriteDefinitionRefs(swagger);

  const paths = {};
  if (converted.paths && typeof converted.paths === 'object') {
    for (const [pathKey, pathItem] of Object.entries(converted.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      const newItem = {};
      for (const [methodKey, operation] of Object.entries(pathItem)) {
        if (!operation || typeof operation !== 'object') {
          newItem[methodKey] = operation;
          continue;
        }
        const op = { ...operation };
        migrateParameters(op);
        migrateResponses(op.responses);
        newItem[methodKey] = op;
      }
      paths[pathKey] = newItem;
    }
  }

  const schemas = {};
  if (converted.definitions && typeof converted.definitions === 'object') {
    for (const [name, schema] of Object.entries(converted.definitions)) {
      schemas[name] = schema;
    }
  }

  const securitySchemes = {};
  if (
    converted.securityDefinitions &&
    typeof converted.securityDefinitions === 'object'
  ) {
    for (const [name, def] of Object.entries(converted.securityDefinitions)) {
      securitySchemes[name] = def;
    }
  }

  return {
    paths,
    schemas,
    securitySchemes,
    title: typeof swagger.info?.title === 'string' ? swagger.info.title : '',
  };
}

function deriveServers(swagger) {
  const servers = [];
  const schemes = Array.isArray(swagger.schemes) && swagger.schemes.length > 0
    ? swagger.schemes
    : ['https'];
  const host = typeof swagger.host === 'string' && swagger.host.length > 0 ? swagger.host : '';
  const basePath = typeof swagger.basePath === 'string' ? swagger.basePath : '';
  if (host.length > 0) {
    for (const scheme of schemes) {
      servers.push({ url: `${scheme}://${host}${basePath}` });
    }
  }
  return servers;
}

function main() {
  let fileNames;
  try {
    fileNames = readdirSync(SWAGGER_DIR).filter((f) => f.endsWith('.swagger.json'));
  } catch (err) {
    console.error(`✘ cannot read swagger dir ${SWAGGER_DIR}: ${String(err)}`);
    process.exit(1);
  }
  fileNames.sort();

  const mergedPaths = {};
  const mergedSchemas = {};
  const mergedSecuritySchemes = {};
  const collisions = { paths: 0, schemas: 0 };
  const sourceTitles = [];
  let skipped = 0;
  let discoveredServers = [];

  for (const name of fileNames) {
    const full = join(SWAGGER_DIR, name);
    let swagger;
    try {
      const raw = readFileSync(full, 'utf8');
      swagger = JSON.parse(raw);
    } catch (err) {
      console.warn(`⚠ skipping ${name} — parse error: ${String(err)}`);
      skipped++;
      continue;
    }

    const { paths, schemas, securitySchemes, title } = convertFile(swagger);

    if (title.length > 0) sourceTitles.push(title);

    for (const [key, value] of Object.entries(paths)) {
      if (Object.prototype.hasOwnProperty.call(mergedPaths, key)) {
        collisions.paths++;
        console.warn(`⚠ path collision on ${key} (file ${name}) — last write wins`);
      }
      mergedPaths[key] = value;
    }
    for (const [key, value] of Object.entries(schemas)) {
      if (Object.prototype.hasOwnProperty.call(mergedSchemas, key)) {
        collisions.schemas++;
        // Identical protobuf shared types (rpcStatus, protobufAny) collide
        // across every proto file — this is expected and harmless.
      }
      mergedSchemas[key] = value;
    }
    for (const [key, value] of Object.entries(securitySchemes)) {
      mergedSecuritySchemes[key] = value;
    }

    if (discoveredServers.length === 0) {
      discoveredServers = deriveServers(swagger);
    }
  }

  const servers = discoveredServers.length > 0
    ? discoveredServers
    : [{ url: '/api/v1', description: 'Rioku daemon REST surface (stage-1 stub)' }];

  const merged = {
    openapi: '3.0.3',
    info: {
      title: 'Rioku Admin API (stage-1 stub — not all endpoints implemented)',
      version: 'v1',
      description:
        'Admin-facing REST surface for Rioku. Stage-1: many endpoints documented here are not yet implemented on the daemon. Regenerate by running `node scripts/merge-openapi.mjs` whenever proto definitions change.',
    },
    servers,
    paths: mergedPaths,
    components: {
      schemas: mergedSchemas,
      ...(Object.keys(mergedSecuritySchemes).length > 0
        ? { securitySchemes: mergedSecuritySchemes }
        : {}),
    },
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  const endpointCount = Object.values(mergedPaths).reduce((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    return acc + Object.keys(item).length;
  }, 0);

  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  files merged:      ${String(fileNames.length - skipped)}`);
  console.log(`  files skipped:     ${String(skipped)}`);
  console.log(`  paths:             ${String(Object.keys(mergedPaths).length)}`);
  console.log(`  endpoints (ops):   ${String(endpointCount)}`);
  console.log(`  schemas:           ${String(Object.keys(mergedSchemas).length)}`);
  console.log(`  schema collisions: ${String(collisions.schemas)} (expected for shared protobuf types)`);
  console.log(`  path collisions:   ${String(collisions.paths)}`);
}

main();
