/**
 * toolbar.tsx — DataTable toolbar: global-search input, column-visibility
 * menu, and bulk-actions row.
 */

import { useState } from 'react';
import { Group, TextInput, Menu, Button, Checkbox, ActionIcon, Text } from '@mantine/core';
import { IconSearch, IconColumns, IconChevronDown } from '@tabler/icons-react';
import type { Table } from '@tanstack/react-table';

// ── GlobalSearchInput ────────────────────────────────────────────────────────

export interface GlobalSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function GlobalSearchInput({ value, onChange }: GlobalSearchInputProps) {
  return (
    <TextInput
      leftSection={<IconSearch size={16} />}
      placeholder="Search…"
      value={value}
      onChange={(e) => { onChange(e.currentTarget.value); }}
      size="sm"
      aria-label="Search table"
      style={{ minWidth: 200 }}
    />
  );
}

// ── ColumnVisibilityMenu ─────────────────────────────────────────────────────

export interface ColumnVisibilityMenuProps<TData> {
  table: Table<TData>;
}

export function ColumnVisibilityMenu<TData>({ table }: ColumnVisibilityMenuProps<TData>) {
  const [opened, setOpened] = useState(false);

  const columns = table.getAllLeafColumns().filter((col) => col.getCanHide());

  return (
    <Menu opened={opened} onChange={setOpened} closeOnItemClick={false} withinPortal>
      <Menu.Target>
        <Button
          variant="default"
          size="sm"
          leftSection={<IconColumns size={16} />}
          rightSection={<IconChevronDown size={14} />}
          aria-label="Toggle column visibility"
          aria-expanded={opened}
        >
          Columns
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {columns.length === 0 && (
          <Menu.Item disabled>
            <Text size="sm" c="dimmed">
              No hideable columns
            </Text>
          </Menu.Item>
        )}
        {columns.map((col) => {
          const header =
            typeof col.columnDef.header === 'string'
              ? col.columnDef.header
              : col.id;

          return (
            <Menu.Item
              key={col.id}
              onClick={col.getToggleVisibilityHandler()}
              leftSection={
                <Checkbox
                  size="xs"
                  checked={col.getIsVisible()}
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                />
              }
            >
              <Text size="sm">{header}</Text>
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}

// ── BulkActionsBar ───────────────────────────────────────────────────────────

export interface BulkAction {
  label: string;
  onClick: (selectedRowIds: string[]) => void;
  color?: string;
  disabled?: boolean;
}

export interface BulkActionsBarProps {
  selectedCount: number;
  selectedRowIds: string[];
  actions: BulkAction[];
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedCount,
  selectedRowIds,
  actions,
  onClearSelection,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <Group
      gap="sm"
      py="xs"
      px="sm"
      style={(theme) => ({
        background: theme.colors.blue[0],
        borderRadius: theme.radius.sm,
        border: `1px solid ${theme.colors.blue[2]}`,
      })}
      role="status"
      aria-live="polite"
    >
      <Text size="sm" fw={500}>
        {selectedCount} selected
      </Text>
      {actions.map((action) => (
        <Button
          key={action.label}
          size="xs"
          variant="light"
          color={action.color ?? 'blue'}
          disabled={action.disabled ?? false}
          onClick={() => { action.onClick(selectedRowIds); }}
        >
          {action.label}
        </Button>
      ))}
      <ActionIcon
        size="sm"
        variant="subtle"
        color="gray"
        onClick={onClearSelection}
        aria-label="Clear selection"
        ml="auto"
      >
        ×
      </ActionIcon>
    </Group>
  );
}

// ── DataTableToolbar ─────────────────────────────────────────────────────────

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  showGlobalFilter?: boolean;
  globalFilter: string;
  onGlobalFilterChange: (v: string) => void;
  showColumnVisibility?: boolean;
  selectedCount: number;
  selectedRowIds: string[];
  bulkActions?: BulkAction[];
  onClearSelection: () => void;
}

export function DataTableToolbar<TData>({
  table,
  showGlobalFilter,
  globalFilter,
  onGlobalFilterChange,
  showColumnVisibility,
  selectedCount,
  selectedRowIds,
  bulkActions = [],
  onClearSelection,
}: DataTableToolbarProps<TData>) {
  const showToolbar = (showGlobalFilter ?? false) || (showColumnVisibility ?? false) || bulkActions.length > 0;

  if (!showToolbar && selectedCount === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {((showGlobalFilter ?? false) || (showColumnVisibility ?? false)) && (
        <Group justify="space-between" gap="sm">
          {showGlobalFilter && (
            <GlobalSearchInput value={globalFilter} onChange={onGlobalFilterChange} />
          )}
          {showColumnVisibility && <ColumnVisibilityMenu table={table} />}
        </Group>
      )}
      {selectedCount > 0 && (
        <BulkActionsBar
          selectedCount={selectedCount}
          selectedRowIds={selectedRowIds}
          actions={bulkActions}
          onClearSelection={onClearSelection}
        />
      )}
    </div>
  );
}
