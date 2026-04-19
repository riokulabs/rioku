/**
 * @rioku/plugin-sdk — B3 strict re-export surface.
 *
 * Plugin authors import from `@rioku/plugin-sdk`. First-party admin code does NOT
 * import from this module (enforced by `no-restricted-imports` rule in the
 * ESLint config, per B2).
 *
 * NO WRAPPERS. Every export is a literal pass-through. Any PR adding a wrapper
 * here is rejected in review. See spec §9.10.1 B3.
 */

// ─── React + ReactDOM ─────────────────────────────────────────────────────────

export {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useContext,
  useReducer,
  useTransition,
  useDeferredValue,
  useId,
  Fragment,
  Suspense,
  createContext,
  memo,
  forwardRef,
  lazy,
} from 'react';
export type {
  ReactNode,
  ComponentType,
  FC,
  PropsWithChildren,
  RefObject,
  CSSProperties,
} from 'react';

// ─── Mantine — full set plugins are allowed to use ───────────────────────────
// (must stay in sync with the externals list in the plugin build contract)

export {
  Button,
  TextInput,
  Textarea,
  PasswordInput,
  NumberInput,
  Checkbox,
  Switch,
  Radio,
  Select,
  MultiSelect,
  ColorPicker,
  SegmentedControl,
  FileInput,
  Stack,
  Group,
  Flex,
  Grid,
  SimpleGrid,
  Center,
  Container,
  Box,
  Space,
  Divider,
  Paper,
  Card,
  ActionIcon,
  Title,
  Text,
  Code,
  Mark,
  Anchor,
  List,
  Badge,
  Avatar,
  Table,
  Progress,
  Skeleton,
  Loader,
  Indicator,
  Alert,
  Notification,
  Tooltip,
  Menu,
  Popover,
  Modal,
  Drawer,
  Tabs,
  Accordion,
  Pagination,
  Spoiler,
  Collapse,
  ScrollArea,
  AppShell,
  Kbd,
  CopyButton,
} from '@mantine/core';
export { useForm, schemaResolver, isNotEmpty, matches } from '@mantine/form';
export type { UseFormReturnType } from '@mantine/form';
export {
  useDisclosure,
  useHotkeys,
  useLocalStorage,
  useMediaQuery,
  useDebouncedValue,
  useClickOutside,
  useClipboard,
} from '@mantine/hooks';
export { notifications } from '@mantine/notifications';
export { modals } from '@mantine/modals';
export { spotlight } from '@mantine/spotlight';

// ─── TanStack Router ─────────────────────────────────────────────────────────

export {
  Link,
  useNavigate,
  useLocation,
  useParams,
  useSearch,
  useRouter,
  createFileRoute,
  createRoute,
} from '@tanstack/react-router';

// ─── TanStack Query ───────────────────────────────────────────────────────────

export {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
export type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';

// ─── Icons ────────────────────────────────────────────────────────────────────
// Plugins import @tabler/icons-react directly AND list it in their Vite
// `external` config so the host's copy is shared at runtime.  We re-export
// only the types so plugin code can type Icon props without a separate import.

export type { Icon, IconProps } from '@tabler/icons-react';

// ─── Host APIs — one entry point exposing all registries ─────────────────────

export { useHost } from '@/hooks/use-host';
export type {
  RiokuHost,
  HostNotify,
  HostThemes,
  HostSpotlight,
  HostZones,
  HostRoutes,
  HostSidebar,
  HostSettings,
  HostWidgets,
  HostEvents,
  HostApiEndpoints,
  HostOpenApi,
  HostPermissions,
} from '@/hooks/use-host';

// ─── ABI ─────────────────────────────────────────────────────────────────────

export { CURRENT_ABI_VERSION, MIN_SUPPORTED_ABI } from './abi';

// ─── Permission catalog (read-only for plugins) ───────────────────────────────
// Plugins register via host.permissions (useHost().permissions.register), not this.

export { BUILT_IN_PERMISSIONS } from './permissions';
export type { Permission } from '@/api/resources/types';

// ─── Manifest types (for authoring) ──────────────────────────────────────────

export type { PluginManifest } from './manifest-schema';
