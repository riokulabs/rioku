/**
 * Cluster feature — local types and guards.
 */
import type { ClusterNode, ClusterEnrollmentToken } from '@/api/resources';

export type { ClusterNode, ClusterEnrollmentToken };

/** Subset of ClusterNode columns rendered in the table */
export type NodeRow = ClusterNode;

/** Derive a display-friendly region label from the node address / name. */
export function deriveRegion(node: ClusterNode): string {
  const name = node.name.toLowerCase();
  if (name.includes('east')) return 'us-east';
  if (name.includes('west')) return 'us-west';
  if (name.includes('eu') || name.includes('europe')) return 'eu';
  if (name.includes('ap') || name.includes('asia')) return 'ap';
  if (name.includes('witness')) return 'N/A';
  return 'unknown';
}
