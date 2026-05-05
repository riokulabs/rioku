import { IconBook } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'api-explorer',
  label: 'API Explorer',
  icon: IconBook,
  suffix: 'api-explorer',
  group: 'apim',
  order: 50,
});
