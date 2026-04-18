import { useLocalStorage } from '@mantine/hooks';

export function useActiveTheme() {
  return useLocalStorage({
    key: 'rioku-active-theme',
    defaultValue: 'dark',
  });
}
