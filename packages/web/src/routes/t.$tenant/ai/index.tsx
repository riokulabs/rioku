/**
 * AI section index — redirects to the providers list as the landing view.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/t/$tenant/ai/')({
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: '/t/$tenant/ai/providers',
      params,
      search: { search: '', kinds: [] },
    });
  },
});
