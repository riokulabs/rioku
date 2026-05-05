import { IconTopologyRing } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'cluster',
  label: 'Cluster',
  icon: IconTopologyRing,
  suffix: 'cluster',
  group: 'system',
  order: 10,
});
