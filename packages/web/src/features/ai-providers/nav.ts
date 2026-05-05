import { IconBrain } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-providers',
  label: 'Providers',
  icon: IconBrain,
  suffix: 'ai/providers',
  group: 'ai',
  order: 10,
});
