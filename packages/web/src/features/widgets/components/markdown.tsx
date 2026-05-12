/**
 * <MarkdownWidget> — text/markdown panel for annotations and documentation.
 *
 * Renders plain text with light markdown-ish formatting (line breaks,
 * **bold**, *italic*, # headings, - bullets) without pulling a real
 * markdown parser. Expected data shape: `{ content: string }`. Falls back
 * to `widget.config.content` when the data shape is empty.
 */
import { Alert, Box, Skeleton, Stack, Text, Title } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface MarkdownData {
  content?: string;
}

function isMarkdownData(data: unknown): data is MarkdownData {
  return typeof data === 'object' && data !== null;
}

export function MarkdownWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={120} width="100%" radius="md" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );

  let content = '';
  let dataInvalid = false;
  if (isMarkdownData(data) && typeof data.content === 'string') {
    content = data.content;
  } else if (data !== undefined && data !== null) {
    // Data was supplied but did not include a `content: string`. Surface the
    // mismatch instead of silently falling back to widget.config — the test
    // suite + builder both rely on this alert to flag bad data sources.
    dataInvalid = true;
  } else if (typeof widget.config.content === 'string') {
    content = widget.config.content;
  }

  if (dataInvalid) {
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ content: string }'}
      </Alert>
    );
  }

  if (content.trim().length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        Empty markdown. Configure `content` in widget config.
      </Text>
    );
  }

  return (
    <Box style={{ overflowY: 'auto' }} aria-label={`Markdown widget for ${widget.title}`}>
      <Stack gap="xs">{renderLines(content)}</Stack>
    </Box>
  );
}

/** Light-touch markdown renderer — line by line. */
function renderLines(content: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('# ')) {
      out.push(
        <Title key={i} order={4}>
          {line.slice(2)}
        </Title>,
      );
    } else if (line.startsWith('## ')) {
      out.push(
        <Title key={i} order={5}>
          {line.slice(3)}
        </Title>,
      );
    } else if (line.startsWith('- ')) {
      out.push(
        <Text key={i} size="sm" pl="md" style={{ position: 'relative' }}>
          <Box
            component="span"
            aria-hidden
            style={{
              position: 'absolute',
              left: 4,
              top: '0.4em',
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'var(--mantine-color-riokuOrange-6)',
            }}
          />
          {renderInline(line.slice(2))}
        </Text>,
      );
    } else if (line.trim().length === 0) {
      out.push(<Box key={i} h={4} />);
    } else {
      out.push(
        <Text key={i} size="sm">
          {renderInline(line)}
        </Text>,
      );
    }
  }
  return out;
}

/** Inline **bold** and *italic*. */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/;
  while (rest.length > 0) {
    const match = re.exec(rest);
    if (!match) {
      parts.push(rest);
      break;
    }
    if (match.index > 0) parts.push(rest.slice(0, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(
        <Text key={key++} component="span" fw={700} inherit>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <Text key={key++} component="span" ff="monospace" inherit>
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={key++} component="span" fs="italic" inherit>
          {token.slice(1, -1)}
        </Text>,
      );
    }
    rest = rest.slice(match.index + token.length);
  }
  return parts;
}
