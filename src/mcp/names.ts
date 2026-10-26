// de tools die Claude kan gebruiken; gedeeld door de MCP-server, de app en de tests (geen zware imports)
export const READ_TOOLS = ['get_context', 'list_events', 'search_events', 'get_event', 'find_free_time'] as const;
export const WRITE_TOOLS = ['create_events', 'update_event', 'delete_event'] as const;
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS];

export type ToolName = (typeof READ_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

export const isWriteTool = (name: string) => (WRITE_TOOLS as readonly string[]).includes(name);
