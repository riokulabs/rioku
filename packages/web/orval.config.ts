// packages/web/orval.config.ts
import { defineConfig } from 'orval';

export default defineConfig({
  rioku: {
    input: {
      // api.full.json is normalized to OAS 3.0.3 in-place by `make openapi`
      // (packages/proto/scripts/normalize-to-oas3.mjs runs after the Go merge step).
      target: '../proto/gen/openapi/rioku/v1/api.full.json',
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
          useInfinite: true,
          signal: true,
        },
      },
      prettier: true,
    },
  },
  riokuZod: {
    input: {
      target: '../proto/gen/openapi/rioku/v1/api.full.json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/api/generated/zod.ts',
      client: 'zod',
      fileExtension: '.zod.ts',
      // prettier removed — formatting handled by explicit prettier step in types:gen script
    },
  },
});
