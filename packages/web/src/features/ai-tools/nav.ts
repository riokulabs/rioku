import { IconTool } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-tools',
  label: 'Tools',
  icon: IconTool,
  suffix: 'ai/tools',
  group: 'ai',
  order: 30,
});
