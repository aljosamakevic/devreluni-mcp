export interface ToolSource {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;
  contribution: string;
}

export interface ToolResult<T> {
  data: T;
  sources: ToolSource[];
  confidence_note: string;
  fallbacks_used: string[];
}
