import { IconServer } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'ai-mcp-servers',
  label: 'MCP servers',
  icon: IconServer,
  suffix: 'ai/mcp-servers',
  group: 'ai',
  order: 70,
});
