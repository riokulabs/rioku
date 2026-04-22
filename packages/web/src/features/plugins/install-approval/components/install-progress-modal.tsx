/**
 * <InstallProgressModal> — streaming 4-stage install progress (Plan 6, Task 6b.4).
 *
 * Flow:
 *   - On open with candidate → calls installPluginWithProgress() once, stores
 *     the emitter in a ref, subscribes to progress/complete/failed events.
 *   - On `progress` → updates stage + pct + appends the log message (tail of 20).
 *   - On `complete` → shows success, then after 1.5s calls onComplete(plugin.id)
 *     and closes. Toast fired from the outer approval modal to avoid duplicates.
 *   - On `failed` → shows error alert + log tail + a "View build log" button that
 *     invokes onViewLog() (parent navigates/opens the relevant detail).
 *   - Cancel → emitter.cancel(), notify info, close.
 *
 * Visual:
 *   - Horizontal stage strip: Fetching → Verifying → Building → Swapping.
 *     Earlier stages get a checkmark; current stage is highlighted; failed
 *     stage is red.
 *   - Progress bar underneath.
 *   - Monospace log viewer, last 20 lines, aria-live="polite".
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Progress,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconFileText,
  IconPackage,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import {
  installPluginWithProgress,
  type InstallProgressEmitter,
  type InstallProgressStage,
  type InstallCompleteEvent,
  type InstallFailedEvent,
  type InstallProgressEvent,
} from '../../installed/api';
import type { ApprovalCandidate } from '../types';

/** Visual stages in the order they appear in the top strip. */
const STRIP_STAGES: Exclude<InstallProgressStage, 'complete' | 'failed'>[] = [
  'fetching',
  'verifying',
  'building',
  'swapping',
];

const STAGE_LABEL: Record<
  Exclude<InstallProgressStage, 'complete' | 'failed'>,
  string
> = {
  fetching: 'Fetching',
  verifying: 'Verifying',
  building: 'Building',
  swapping: 'Swapping',
};

const STAGE_ICON: Record<
  Exclude<InstallProgressStage, 'complete' | 'failed'>,
  typeof IconDownload
> = {
  fetching: IconDownload,
  verifying: IconShieldCheck,
  building: IconPackage,
  swapping: IconFileText,
};

interface InstallProgressModalProps {
  opened: boolean;
  candidate: ApprovalCandidate | null;
  onClose: () => void;
  /** Called after the terminal success event fires (plus a short dwell). */
  onComplete: (pluginId: string) => void;
  /** Called when the user clicks "View build log" on a failed install. */
  onViewLog?: (log: string) => void;
}

interface RunState {
  stage: InstallProgressStage;
  progress: number;
  log: string[];
  /** Set when install finishes (success or failure). */
  terminal: 'complete' | 'failed' | null;
  /** Captured failure payload (log + message + stage) for the error view. */
  failure?: InstallFailedEvent;
}

const EMPTY_STATE: RunState = {
  stage: 'fetching',
  progress: 0,
  log: [],
  terminal: null,
};

/** Clamp a log array to the last 20 entries. */
function tailLog(existing: string[], next: string): string[] {
  const combined = [...existing, next];
  if (combined.length <= 20) return combined;
  return combined.slice(combined.length - 20);
}

export function InstallProgressModal({
  opened,
  candidate,
  onClose,
  onComplete,
  onViewLog,
}: InstallProgressModalProps) {
  const [run, setRun] = useState<RunState>(EMPTY_STATE);
  const emitterRef = useRef<InstallProgressEmitter | null>(null);

  // Kick off the install when the modal opens with a fresh candidate.
  // Run-reset is merged into the first `progress` dispatch rather than a
  // top-of-effect setState to avoid the "setState synchronously within an
  // effect body" rule — the handler below detects the first event of a new
  // run via `firstTick` and replaces state instead of merging.
  useEffect(() => {
    if (!opened || !candidate) return;

    const emitter = installPluginWithProgress(candidate);
    emitterRef.current = emitter;
    let firstTick = true;

    const onProgress = (e: Event): void => {
      const detail = (e as CustomEvent<InstallProgressEvent>).detail;
      if (firstTick) {
        firstTick = false;
        setRun({
          stage: detail.stage,
          progress: detail.progress,
          log: [detail.message],
          terminal: null,
        });
        return;
      }
      setRun((prev) => ({
        ...prev,
        stage: detail.stage,
        progress: detail.progress,
        log: tailLog(prev.log, detail.message),
      }));
    };

    const onCompleteEvt = (e: Event): void => {
      const detail = (e as CustomEvent<InstallCompleteEvent>).detail;
      setRun((prev) => ({
        ...prev,
        stage: 'complete',
        progress: 100,
        terminal: 'complete',
      }));
      // Short dwell so the user can see the green state, then hand control back.
      const timer = setTimeout(() => {
        notify.success(
          'Plugin installed',
          `${detail.plugin.display_name} v${detail.plugin.version} is now active.`,
        );
        onComplete(detail.plugin.id);
      }, 1500);
      // Cleanup if the modal closes before the timer fires.
      emitter.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
        },
        { once: true },
      );
    };

    const onFailed = (e: Event): void => {
      const detail = (e as CustomEvent<InstallFailedEvent>).detail;
      setRun((prev) => ({
        ...prev,
        stage: detail.stage,
        terminal: 'failed',
        failure: detail,
        // Append final log lines from the emitter so the tail matches the
        // captured build log.
        log: tailLog(prev.log, `[error] install failed at ${detail.stage}`),
      }));
    };

    emitter.addEventListener('progress', onProgress);
    emitter.addEventListener('complete', onCompleteEvt);
    emitter.addEventListener('failed', onFailed);

    return (): void => {
      emitter.removeEventListener('progress', onProgress);
      emitter.removeEventListener('complete', onCompleteEvt);
      emitter.removeEventListener('failed', onFailed);
      // If we unmount mid-flight, cancel the emitter so it stops dispatching.
      // (Terminal paths already clear the interval internally.)
      emitter.dispatchEvent(new Event('abort'));
      emitterRef.current = null;
    };
    // We intentionally depend only on `opened` + `candidate` identity so a
    // single install is kicked off per modal open, not on every parent re-render.
  }, [opened, candidate, onComplete]);

  function handleCancel(): void {
    const emitter = emitterRef.current;
    if (emitter && run.terminal === null) {
      emitter.cancel();
      notify.info('Install cancelled', 'No changes were made.');
    }
    emitterRef.current = null;
    setRun(EMPTY_STATE);
    onClose();
  }

  function handleClose(): void {
    if (run.terminal === null) {
      // Mid-flight close = cancel.
      handleCancel();
      return;
    }
    emitterRef.current = null;
    setRun(EMPTY_STATE);
    onClose();
  }

  const activeStageIdx = STRIP_STAGES.indexOf(
    run.stage as Exclude<InstallProgressStage, 'complete' | 'failed'>,
  );
  const succeeded = run.terminal === 'complete';
  const failed = run.terminal === 'failed';
  const canCancel = run.terminal === null;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <IconDownload size={18} />
          <Text fw={600}>
            {candidate ? `Installing ${candidate.display_name}` : 'Installing plugin'}
          </Text>
        </Group>
      }
      size="min(600px, 95vw)"
      // While in-flight we disallow backdrop dismiss to prevent orphaned runs.
      closeOnClickOutside={!canCancel}
      closeOnEscape={!canCancel}
      withCloseButton={!canCancel}
    >
      {candidate && (
        <Stack gap="md">
          {/* Identity */}
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {candidate.display_name}
            </Text>
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {candidate.slug} · v{candidate.version}
            </Text>
          </Stack>

          {/* Stage strip */}
          <Group gap="xs" wrap="nowrap">
            {STRIP_STAGES.map((s, idx) => {
              const Icon = STAGE_ICON[s];
              const isActive = !succeeded && !failed && idx === activeStageIdx;
              const isPast = succeeded || idx < activeStageIdx;
              const isFailedHere = failed && idx === activeStageIdx;
              let color = 'gray';
              if (isFailedHere) color = 'red';
              else if (isPast) color = 'green';
              else if (isActive) color = 'blue';

              return (
                <Badge
                  key={s}
                  color={color}
                  variant={isActive ? 'filled' : 'light'}
                  leftSection={
                    isPast && !isFailedHere ? (
                      <IconCheck size={12} />
                    ) : (
                      <Icon size={12} />
                    )
                  }
                  style={{ flex: 1, textAlign: 'center' }}
                  data-testid={`install-progress-stage-${s}`}
                  data-active={isActive ? 'true' : 'false'}
                  data-past={isPast ? 'true' : 'false'}
                >
                  {STAGE_LABEL[s]}
                </Badge>
              );
            })}
          </Group>

          {/* Progress bar */}
          <Progress
            value={succeeded ? 100 : run.progress}
            color={failed ? 'red' : succeeded ? 'green' : 'blue'}
            animated={!succeeded && !failed}
            striped={!succeeded && !failed}
            size="md"
            radius="sm"
            aria-label="Install progress"
          />

          {/* Log tail — aria-live for screen readers */}
          <Stack gap={4}>
            <Text size="xs" fw={600} c="var(--mantine-color-gray-8)">
              Build log
            </Text>
            <div
              role="status"
              aria-live="polite"
              aria-atomic="false"
              data-testid="install-progress-log"
              style={{
                background: 'var(--mantine-color-gray-0)',
                border: '1px solid var(--mantine-color-gray-3)',
                borderRadius: 4,
                padding: '8px 10px',
                maxHeight: 220,
                overflowY: 'auto',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {run.log.length === 0 ? (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  Waiting for output…
                </Text>
              ) : (
                run.log.map((line, idx) => (
                  <div key={`${String(idx)}-${line.slice(0, 24)}`}>{line}</div>
                ))
              )}
            </div>
          </Stack>

          {/* Terminal states */}
          {succeeded && (
            <Alert
              color="green"
              variant="light"
              icon={<IconCheck size={16} />}
              role="status"
            >
              <Text size="sm" fw={600}>
                Installed successfully
              </Text>
              <Text size="xs" mt={2}>
                Closing in a moment…
              </Text>
            </Alert>
          )}

          {failed && run.failure && (
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
              role="alert"
              title={`Install failed during ${run.failure.stage}`}
            >
              <Stack gap="xs">
                <Text size="xs">{run.failure.message}</Text>
                <Code block style={{ maxHeight: 120, overflowY: 'auto' }}>
                  {run.failure.log}
                </Code>
                {onViewLog && (
                  <Group>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconFileText size={14} />}
                      onClick={() => {
                        onViewLog(run.failure?.log ?? '');
                      }}
                    >
                      View build log
                    </Button>
                  </Group>
                )}
              </Stack>
            </Alert>
          )}

          {/* Actions */}
          <Group justify="flex-end" gap="sm">
            {canCancel && (
              <Button
                variant="default"
                leftSection={<IconX size={14} />}
                onClick={handleCancel}
              >
                Cancel install
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
