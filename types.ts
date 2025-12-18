
export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri: string;
    title: string;
  };
}

export interface FileContext {
  data: string;
  mimeType: string;
  name?: string;
}

export interface SearchResult {
  id: string;
  query: string;
  answer: string;
  chunks: GroundingChunk[];
  timestamp: number;
  imageContext?: string; // base64 (legacy support)
  fileContext?: FileContext;
  rawJson?: any;
}

export interface SearchState {
  isSearching: boolean;
  currentResult: SearchResult | null;
  history: SearchResult[];
  error: string | null;
}
