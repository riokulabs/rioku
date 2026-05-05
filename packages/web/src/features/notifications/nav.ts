import { IconBell } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'notifications',
  label: 'Notifications',
  icon: IconBell,
  suffix: 'notifications',
  group: 'system',
  order: 30,
});
