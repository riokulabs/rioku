import { IconRobot } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-agents',
  label: 'Agents',
  icon: IconRobot,
  suffix: 'ai/agents',
  group: 'ai',
  order: 20,
});
