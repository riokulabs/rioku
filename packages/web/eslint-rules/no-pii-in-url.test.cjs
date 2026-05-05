'use strict';
const { RuleTester } = require('eslint');
const rule = require('./no-pii-in-url.cjs');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('no-pii-in-url', rule, {
  valid: [
    'const url = `/api/v1/services/${pluginName}`;',
    'const url = `/api/v1/services/${tenant.name}`;',
    'const url = `/api/v1/users/${user.id}`;',
  ],
  invalid: [
    {
      code: 'const url = `/api/v1/users/${user.email}`;',
      errors: [{ messageId: 'pii' }],
    },
    {
      code: 'const url = `/api/v1/users/${firstName}`;',
      errors: [{ messageId: 'pii' }],
    },
  ],
});

console.log('no-pii-in-url: passed');
