import {
  IconBadge,
  IconDevices,
  IconFileText,
  IconKey,
  IconScale,
  IconShield,
  IconUsers,
} from '@tabler/icons-react';
import { registerNavEntries } from '@/components/app-shell/nav-registry';

registerNavEntries(
  {
    id: 'security-users',
    label: 'Users',
    icon: IconUsers,
    suffix: 'security/users',
    group: 'security',
    order: 10,
  },
  {
    id: 'security-roles',
    label: 'Roles',
    icon: IconBadge,
    suffix: 'security/roles',
    group: 'security',
    order: 20,
  },
  {
    id: 'security-api-keys',
    label: 'API keys',
    icon: IconKey,
    suffix: 'security/api-keys',
    group: 'security',
    order: 30,
  },
  {
    id: 'security-rbac-policies',
    label: 'RBAC policies',
    icon: IconScale,
    suffix: 'security/rbac-policies',
    group: 'security',
    order: 40,
  },
  {
    id: 'security-sessions',
    label: 'Sessions',
    icon: IconDevices,
    suffix: 'security/sessions',
    group: 'security',
    order: 50,
  },
  {
    id: 'security-audit',
    label: 'Audit',
    icon: IconFileText,
    suffix: 'security/audit',
    group: 'security',
    order: 60,
  },
  // Access policies appears in the AI section panel but routes under /security/.
  // It is registered here because security owns the underlying feature.
  {
    id: 'ai-access-policies',
    label: 'Access policies',
    icon: IconShield,
    suffix: 'security/access-policies',
    group: 'ai',
    order: 80,
  },
);
