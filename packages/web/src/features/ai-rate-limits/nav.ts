import { IconGauge } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-rate-limits',
  label: 'Rate limits',
  icon: IconGauge,
  suffix: 'ai/rate-limits',
  group: 'ai',
  order: 50,
});
