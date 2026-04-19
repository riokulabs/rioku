import { Paper, Text } from '@mantine/core';

/**
 * Widget type registered at `com.example.hello:greeter`.
 * Receives `data` + `config` per the widget registration schema; both are
 * unused at stage 1 — the widget is just a visible marker.
 */
export function HelloWidget() {
  return (
    <Paper p="sm" withBorder data-testid="sample-plugin-widget">
      <Text size="sm">Hello Widget</Text>
    </Paper>
  );
}
