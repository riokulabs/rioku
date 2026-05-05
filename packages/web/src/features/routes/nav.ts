import { IconRoute } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'routes',
  label: 'Routes',
  icon: IconRoute,
  suffix: 'routes',
  group: 'apim',
  order: 20,
});
