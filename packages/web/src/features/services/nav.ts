import { IconServer } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'services',
  label: 'Services',
  icon: IconServer,
  suffix: 'services',
  group: 'apim',
  order: 10,
});
