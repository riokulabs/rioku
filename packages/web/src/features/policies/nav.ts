import { IconShield } from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries({
  id: 'policies',
  label: 'Policies',
  icon: IconShield,
  suffix: 'policies',
  group: 'apim',
  order: 30,
});
