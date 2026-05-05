import { IconRouter } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-tool-routing',
  label: 'Tool routing',
  icon: IconRouter,
  suffix: 'ai/tool-routing',
  group: 'ai',
  order: 40,
});
