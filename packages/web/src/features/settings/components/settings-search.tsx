/**
 * <SettingsSearch> — search/filter bar for the settings sidebar.
 *
 * Filters visible sections by label or slug (case-insensitive substring match).
 * Supports keyboard navigation:
 *   `/`           — focus the search input
 *   ArrowDown/Up  — move selection through filtered results
 *   Enter         — navigate to the focused section
 *   Escape        — clear search and unfocus
 */
import { useRef, useEffect, useCallback } from 'react';
import { TextInput, Stack, NavLink, Text } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

interface SettingsSection {
  slug: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

interface SettingsSearchProps {
  sections: SettingsSection[];
  query: string;
  onChange: (q: string) => void;
  activeSlug: string;
  focusedIndex: number;
  onFocusedIndexChange: (idx: number) => void;
  onSectionClick: (slug: string) => void;
}

export function SettingsSearch({
  sections,
  query,
  onChange,
  activeSlug,
  focusedIndex,
  onFocusedIndexChange,
  onSectionClick,
}: SettingsSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // `/` key focuses the search input (document-level listener)
  const handleDocumentKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement !== inputRef.current &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    },
    [],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [handleDocumentKeyDown]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onChange('');
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (sections.length === 0) return;
      onFocusedIndexChange(
        focusedIndex < sections.length - 1 ? focusedIndex + 1 : 0,
      );
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (sections.length === 0) return;
      onFocusedIndexChange(
        focusedIndex > 0 ? focusedIndex - 1 : sections.length - 1,
      );
      return;
    }
    if (e.key === 'Enter') {
      const target = sections[focusedIndex];
      if (target) {
        onSectionClick(target.slug);
        onChange('');
        inputRef.current?.blur();
      }
      return;
    }
  }

  return (
    <>
      <TextInput
        ref={inputRef}
        data-testid="settings-search-input"
        placeholder="Search settings…"
        size="xs"
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
        aria-label="Search settings sections"
        mb="xs"
      />

      {sections.length === 0 ? (
        <Text
          size="xs"
          c="var(--mantine-color-gray-7)"
          px="xs"
          data-testid="settings-search-empty"
        >
          No settings match &ldquo;{query}&rdquo;
        </Text>
      ) : (
        <Stack gap={2}>
          {sections.map((section, idx) => (
            <NavLink
              key={section.slug}
              label={section.label}
              leftSection={<section.icon size={16} />}
              active={activeSlug === section.slug}
              data-focused={focusedIndex === idx && query.length > 0 ? 'true' : undefined}
              style={
                focusedIndex === idx && query.length > 0
                  ? { outline: '2px solid var(--mantine-color-blue-5)', borderRadius: 4 }
                  : undefined
              }
              onClick={() => { onSectionClick(section.slug); }}
              data-testid={`settings-nav-${section.slug}`}
            />
          ))}
        </Stack>
      )}
    </>
  );
}
