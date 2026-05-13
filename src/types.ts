// Shared output envelope — every tool returns this shape so Claude knows
// the provenance and freshness of every data point it reasons over.
export interface SignalResult<T> {
  signal_type: string;
  source: string;
  query: string;
  timestamp: string;
  stubbed: boolean; // true = mock data; false = live API response
  data: T;
}

// --- Tool-specific data shapes ---

export interface Competitor {
  name: string;
  url: string;
  description: string;
  launch_date?: string;
  funding?: string;
  user_count?: string;
  app_stores?: string[];
}

export interface ChangelogEntry {
  version?: string;
  date?: string;
  summary: string;
  raw: string;
  failure_signals: string[]; // e.g. ["setup creep", "privacy gap"]
}

export interface WeaknessSignal {
  source: 'reddit' | 'hn' | 'press' | 'app_store';
  quote: string;
  url?: string;
  upvotes?: number;
  is_structural: boolean; // structural weakness vs fixable feature gap
}

export interface ProductHuntLaunch {
  name: string;
  tagline: string;
  url: string;
  votes: number;
  comments: number;
  launched_at: string;
  topics: string[];
  top_comment?: string;
}

export interface CategoryFailureMode {
  pattern: string;
  evidence: string[];
  products_affected: string[];
  is_structural: boolean;
}

export interface YCRFSCategory {
  name: string;
  description: string;
  alignment_score: number; // 0-10
  alignment_reasoning: string;
  fit: 'strong' | 'moderate' | 'weak' | 'none';
}
