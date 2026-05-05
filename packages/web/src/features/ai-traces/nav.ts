import { IconHistory } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-traces',
  label: 'Traces',
  icon: IconHistory,
  suffix: 'ai/traces',
  group: 'ai',
  order: 60,
});
