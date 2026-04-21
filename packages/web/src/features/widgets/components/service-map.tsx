/**
 * <ServiceMapWidget> — simple SVG node-link diagram.
 *
 * Expected data shape: { nodes: { id: string; label: string }[];
 *                         edges: { from: string; to: string }[] }.
 *
 * Stage 1 uses manual polar layout around a circle — real layout arrives with
 * the traffic-topology plugin in a later phase.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface ServiceMapData {
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string }[];
}

function isServiceMapData(data: unknown): data is ServiceMapData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { nodes?: unknown; edges?: unknown };
  return Array.isArray(d.nodes) && Array.isArray(d.edges);
}

const WIDTH = 300;
const HEIGHT = 200;
const NODE_R = 18;

export function ServiceMapWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={HEIGHT} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isServiceMapData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ nodes, edges }'}
      </Alert>
    );

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) / 2 - NODE_R - 8;
  const positions = new Map<string, { x: number; y: number }>();
  data.nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
    positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  return (
    <Box role="img" aria-label={`Service map for ${widget.title}`}>
      <svg width="100%" height={HEIGHT} viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}>
        {data.edges.map((e, ei) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={ei}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--mantine-color-gray-5)"
              strokeWidth={1.5}
            />
          );
        })}
        {data.nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={NODE_R} fill="var(--mantine-color-blue-6)" />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={10}
              >
                {n.label.length > 7 ? `${n.label.slice(0, 6)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
