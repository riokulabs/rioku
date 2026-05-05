// packages/web/orval.config.ts
import { defineConfig } from 'orval';

export default defineConfig({
  rioku: {
    input: {
      // openapi-patched.json is generated from api.full.json (see scripts/patch-openapi-for-orval.mjs).
      // The source api.full.json mixes swagger 2.0 and OAS 3.x; the patch converts it to valid OAS 3.0.3.
      target: 'src/api/openapi-patched.json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/api/generated/rioku.ts',
      schemas: 'src/api/generated/schemas',
      client: 'react-query',
      httpClient: 'fetch',
      mock: {
        type: 'msw',
        useExamples: true,
      },
      override: {
        mutator: {
          path: 'src/api/mutator.ts',
          name: 'customFetch',
        },
        query: {
          useQuery: true,
          useInfinite: true,
          signal: true,
        },
      },
      prettier: true,
    },
  },
  riokuZod: {
    input: {
      target: 'src/api/openapi-patched.json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/api/generated/zod.ts',
      client: 'zod',
      fileExtension: '.zod.ts',
      prettier: true,
    },
  },
});
