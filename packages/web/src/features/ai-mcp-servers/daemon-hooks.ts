/**
 * AI MCP Servers — daemon-backed hooks (T8 wiring).
 *
 * Re-exports Orval-generated hooks for `/api/v1/t/{tenant}/ai/mcp-servers/...`.
 */
export {
  useListMCPServers as useMcpServerList,
  useGetMCPServer as useMcpServerDetail,
  useCreateMCPServer as useCreateMcpServer,
  useUpdateMCPServer as useUpdateMcpServer,
  usePatchMCPServer as usePatchMcpServer,
  useDeleteMCPServer as useDeleteMcpServer,
  useTestMCPServer as useTestMcpServer,
  useListMCPServerTools as useMcpServerTools,
  // Imperative variants
  listMCPServers,
  getMCPServer,
  createMCPServer,
  updateMCPServer,
  patchMCPServer,
  deleteMCPServer,
  testMCPServer,
  listMCPServerTools,
} from '@/api/generated/ai-mcp-servers/ai-mcp-servers';

export type {
  MCPServer,
  MCPServerCreateRequest,
  MCPServerUpdateRequest,
} from '@/api/generated/schemas';
