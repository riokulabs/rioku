import { IconPlug } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'plugins',
  label: 'Plugins',
  icon: IconPlug,
  suffix: 'plugins',
  group: 'system',
  order: 20,
});
