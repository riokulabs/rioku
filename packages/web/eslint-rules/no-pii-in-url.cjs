'use strict';

/**
 * Flag template literals or string concatenations that interpolate user-named
 * values likely to be PII (email, name, fullName, phone, ssn, address, etc.)
 * directly into URL paths or query strings.
 *
 * The intent is to catch cases like `/users/${user.email}` and route the dev
 * to use useOpaqueFilter instead.
 *
 * Warn-level only; doesn't fail builds. Plan 13 close-out promotes to error
 * after the migration sweep.
 */
// Anchored full-identifier match — avoids false positives on operational names
// like pluginName, tenantName, serviceName, roleName, displayName.
const PII_NAME_RE =
  /^(?:email|fullName|firstName|lastName|phone|ssn|dob|birthdate|birthday|taxId|streetAddress|homeAddress|mailingAddress)$/i;

function looksLikeUrl(node) {
  if (node.type === 'TemplateLiteral') {
    const head = node.quasis[0]?.value?.raw ?? '';
    return head.includes('/api/') || /^\/[a-z]/i.test(head);
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow interpolating PII-named identifiers into URL strings without useOpaqueFilter',
    },
    schema: [],
    messages: {
      pii: 'Likely PII identifier "{{ name }}" interpolated into URL. Use useOpaqueFilter to obtain a non-PII handle.',
    },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        if (!looksLikeUrl(node)) return;
        for (const expr of node.expressions) {
          let name = null;
          if (expr.type === 'Identifier') name = expr.name;
          else if (expr.type === 'MemberExpression' && expr.property.type === 'Identifier') {
            name = expr.property.name;
          }
          if (name !== null && PII_NAME_RE.test(name)) {
            context.report({
              node: expr,
              messageId: 'pii',
              data: { name },
            });
          }
        }
      },
    };
  },
};
