// @rioku/ui — Plugin developer API surface
// Re-exports all UI primitives, Rioku components, and hooks.

// shadcn/ui primitives
export { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
export { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
export { Badge, badgeVariants } from '@/components/ui/badge'
export { Button, buttonVariants } from '@/components/ui/button'
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from '@/components/ui/dropdown-menu'
export { Input } from '@/components/ui/input'
export { InputGroup, InputGroupText } from '@/components/ui/input-group'
export { Label } from '@/components/ui/label'
export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
export { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
export { Separator } from '@/components/ui/separator'
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
export { Skeleton } from '@/components/ui/skeleton'
export { Switch } from '@/components/ui/switch'
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '@/components/ui/table'
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants } from '@/components/ui/tabs'
export { Textarea } from '@/components/ui/textarea'
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip'

// Rioku components
export { StatCard } from '@/components/rioku/stat-card'
export { DataTable } from '@/components/rioku/data-table'
export { PageHeader } from '@/components/rioku/page-header'
export { EmptyState } from '@/components/rioku/empty-state'
export { StatusBadge } from '@/components/rioku/status-badge'
export { CodeBlock } from '@/components/rioku/code-block'
export { Sparkline } from '@/components/rioku/sparkline'
export { ConfirmDialog } from '@/components/rioku/confirm-dialog'
export { TimeAgo } from '@/components/rioku/time-ago'

// Rioku types
export type { StatCardProps } from '@/components/rioku/stat-card'
export type { DataTableProps, Column } from '@/components/rioku/data-table'
export type { PageHeaderProps } from '@/components/rioku/page-header'
export type { EmptyStateProps } from '@/components/rioku/empty-state'
export type { StatusBadgeProps, Status } from '@/components/rioku/status-badge'
export type { CodeBlockProps } from '@/components/rioku/code-block'
export type { SparklineProps } from '@/components/rioku/sparkline'
export type { ConfirmDialogProps } from '@/components/rioku/confirm-dialog'
export type { TimeAgoProps } from '@/components/rioku/time-ago'

// Hooks
export { useAuth } from '@/hooks/use-auth'
export { useTheme } from '@/hooks/use-theme'
export { useSse } from '@/hooks/use-sse'
