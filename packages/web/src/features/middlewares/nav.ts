import { IconStack } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'middlewares',
  label: 'Middlewares',
  icon: IconStack,
  suffix: 'middlewares',
  group: 'apim',
  order: 40,
});
