
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

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface MissionTask {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  searchId: string;
}

export interface SearchResult {
  id: string;
  query: string;
  answer: string;
  messages: ChatMessage[];
  chunks: GroundingChunk[];
  timestamp: number;
  fileContext?: FileContext;
  rawJson?: any;
  sentiment?: 'positive' | 'negative' | 'neutral' | 'mixed';
  status: 'initializing' | 'streaming' | 'completed' | 'failed';
  subTasks?: string[];
}

export interface SearchState {
  activeNodeIds: string[];
  history: SearchResult[];
  tasks: MissionTask[];
  error: string | null;
}
