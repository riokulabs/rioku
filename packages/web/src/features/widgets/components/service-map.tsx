/**
 * <ServiceMapWidget> — simple SVG node-link diagram.
 *
 * Expected data shape: { nodes: { id: string; label: string; status?: string }[];
 *                         edges: { from: string; to: string; label?: string }[] }.
 *
 * Stage 1 uses a hub-and-spoke + ring layout for realism.
 * Real graph layout arrives with the traffic-topology plugin in a later phase.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import { useState } from 'react';
import type { WidgetRenderProps } from '../types';

interface ServiceNode {
  id: string;
  label: string;
  status?: string;
}

interface ServiceEdge {
  from: string;
  to: string;
  label?: string;
}

interface ServiceMapData {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
}

function isServiceMapData(data: unknown): data is ServiceMapData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { nodes?: unknown; edges?: unknown };
  return Array.isArray(d.nodes) && Array.isArray(d.edges);
}

const WIDTH = 320;
const HEIGHT = 220;
const NODE_R = 22;

function statusFill(status?: string): string {
  if (status === 'healthy' || status === 'ok') return 'var(--mantine-color-teal-6)';
  if (status === 'degraded' || status === 'warn') return 'var(--mantine-color-yellow-6)';
  if (status === 'error' || status === 'down') return 'var(--mantine-color-red-6)';
  return 'var(--mantine-color-blue-6)';
}

function statusRing(status?: string): string {
  if (status === 'healthy' || status === 'ok') return 'var(--mantine-color-teal-4)';
  if (status === 'degraded' || status === 'warn') return 'var(--mantine-color-yellow-4)';
  if (status === 'error' || status === 'down') return 'var(--mantine-color-red-4)';
  return 'var(--mantine-color-blue-4)';
}

function abbreviate(label: string): string {
  // Try to fit into NODE_R*2 chars; shorten by taking first letters of words
  if (label.length <= 7) return label;
  const words = label.split(/[-_\s/]+/);
  if (words.length >= 2) return words.map((w) => w[0]?.toUpperCase() ?? '').join('');
  return label.slice(0, 5);
}

export function ServiceMapWidget({ widget, data, loading, error }: WidgetRenderProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

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

  const nodes = data.nodes;
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  // If first node is a "gateway" / "api" node, place it in centre; rest on ring
  const firstLabel = nodes[0]?.label.toLowerCase() ?? '';
  const hasCentreNode = nodes.length > 1 && (firstLabel.includes('api') || firstLabel.includes('gateway') || firstLabel.includes('proxy'));

  const positions = new Map<string, { x: number; y: number }>();
  if (hasCentreNode && nodes[0]) {
    positions.set(nodes[0].id, { x: cx, y: cy });
    const outerNodes = nodes.slice(1);
    const radius = Math.min(WIDTH, HEIGHT) / 2 - NODE_R - 12;
    outerNodes.forEach((n, i) => {
      const angle = (i / Math.max(1, outerNodes.length)) * Math.PI * 2 - Math.PI / 2;
      positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  } else {
    const radius = Math.min(WIDTH, HEIGHT) / 2 - NODE_R - 12;
    nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
      positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  }

  // Compute highlighted edges when a node is hovered
  const highlightedEdges = hoveredNode
    ? new Set(data.edges.filter((e) => e.from === hoveredNode || e.to === hoveredNode).map((e) => `${e.from}-${e.to}`))
    : null;

  return (
    <Box role="img" aria-label={`Service map for ${widget.title}`}>
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Edges */}
        {data.edges.map((e, ei) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          const isHighlighted = highlightedEdges?.has(`${e.from}-${e.to}`) ?? false;
          const isActive = hoveredNode !== null ? isHighlighted : true;
          // Draw arrowhead at midpoint
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <g key={ei} opacity={isActive ? 1 : 0.2} style={{ transition: 'opacity 0.15s' }}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isHighlighted ? 'var(--mantine-color-blue-4)' : 'var(--mantine-color-dark-3)'}
                strokeWidth={isHighlighted ? 2 : 1.5}
                strokeDasharray={isHighlighted ? undefined : '4 3'}
              />
              {/* Midpoint dot */}
              <circle cx={mx} cy={my} r={2.5} fill={isHighlighted ? 'var(--mantine-color-blue-4)' : 'var(--mantine-color-dark-3)'} />
            </g>
          );
        })}
        {/* Nodes */}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const isHovered = hoveredNode === n.id;
          const label = abbreviate(n.label);
          const fullLabel = n.label;
          const dim = hoveredNode !== null && !isHovered;
          return (
            <g
              key={n.id}
              onMouseEnter={() => { setHoveredNode(n.id); }}
              onMouseLeave={() => { setHoveredNode(null); }}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
              opacity={dim ? 0.35 : 1}
            >
              {/* Outer glow ring */}
              {isHovered && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R + 5}
                  fill="none"
                  stroke={statusRing(n.status)}
                  strokeWidth={2}
                  opacity={0.5}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={NODE_R}
                fill={statusFill(n.status)}
                stroke={isHovered ? statusRing(n.status) : 'var(--mantine-color-dark-7)'}
                strokeWidth={isHovered ? 2 : 1}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={label.length > 4 ? 8 : 10}
                fontWeight={600}
                fontFamily="var(--mantine-font-family)"
              >
                {label}
              </text>
              {/* Full label below node */}
              <text
                x={p.x}
                y={p.y + NODE_R + 10}
                textAnchor="middle"
                fill="var(--mantine-color-gray-4)"
                fontSize={9}
                fontFamily="var(--mantine-font-family)"
              >
                {isHovered ? fullLabel : fullLabel.slice(0, 10)}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
