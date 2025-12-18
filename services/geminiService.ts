
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { GroundingChunk, FileContext, ChatMessage, LayoutMode } from "../types";

export interface SearchOptions {
  model: 'gemini-3-pro-preview' | 'gemini-3-flash-preview';
  autonomous: boolean;
  persona?: string;
  useMaps?: boolean;
  location?: { latitude: number; longitude: number };
  fileContext?: FileContext;
}

const manageTasksDeclaration: FunctionDeclaration = {
  name: 'manageTasks',
  parameters: {
    type: Type.OBJECT,
    description: 'Update the mission control board with current sub-tasks and their statuses.',
    properties: {
      tasks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            description: { type: Type.STRING },
            status: { type: Type.STRING, enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['id', 'description', 'status'],
        },
      },
    },
    required: ['tasks'],
  },
};

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async *searchStream(query: string, options: SearchOptions, history: ChatMessage[] = []) {
    const activeModel = options.autonomous ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
    const thinkingBudget = options.autonomous ? 12000 : 0;

    const contents: any[] = history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    const currentParts: Part[] = [{ text: query }];
    if (options.fileContext) {
      currentParts.push({
        inlineData: { data: options.fileContext.data, mimeType: options.fileContext.mimeType }
      });
    }

    contents.push({ role: 'user', parts: currentParts });

    const isSpatialQuery = query.toLowerCase().match(/(where|location|find|near|restaurant|food|hotel|address|street|map|sf|nyc|london)/);
    const internalModel = (isSpatialQuery || options.useMaps) ? 'gemini-2.5-flash' : activeModel;
    
    const tools: any[] = [
      { googleSearch: {} },
      { codeExecution: {} },
      { functionDeclarations: [manageTasksDeclaration] }
    ];

    if (isSpatialQuery || options.useMaps) {
      tools.push({ googleMaps: {} });
    }

    const systemInstruction = `SYSTEM: NEXUS-ORCHESTRATOR v14.0 [ADAPTIVE_SYNERGY]
    
    MISSION: Deliver absolute data-density. 
    ADAPTIVE UI INSTRUCTIONS:
    1. At the very start, output [LAYOUT: MODE] based on the query.
       - If spatial/local: [LAYOUT: SPATIAL_SPLIT]
       - If complex/analytic: [LAYOUT: DATA_FOCUS]
       - If general: [LAYOUT: REPORT_ONLY]
    2. SWARM LOGGING: Prefix reasoning with [SWARM_LOG].
    3. DATA DENSITY: No conversational filler. Use tables for metrics.
    4. MISSION CONTROL: Call 'manageTasks' immediately but continue writing the report without pausing.
    5. API EXIT: End with [DATA_BOUNDARY] then the high-fidelity JSON payload.
    
    DATA_TARGET: EXHAUSTIVE_GROUNDED_FACTS.`;

    const config: any = {
      tools,
      thinkingConfig: internalModel.includes('gemini-3') ? { thinkingBudget } : undefined,
      maxOutputTokens: internalModel.includes('gemini-3') ? 35000 : undefined,
      systemInstruction,
    };

    try {
      const resultStream = await this.ai.models.generateContentStream({
        model: internalModel,
        contents: contents,
        config: config
      });

      let fullText = "";
      let groundingChunks: GroundingChunk[] = [];
      let suggestedLayout: LayoutMode = 'AUTO';

      for await (const chunk of resultStream) {
        const textChunk = chunk.text || "";
        fullText += textChunk;
        
        // Dynamic Layout Detection
        if (fullText.includes('[LAYOUT: SPATIAL_SPLIT]')) suggestedLayout = 'SPATIAL_SPLIT';
        else if (fullText.includes('[LAYOUT: DATA_FOCUS]')) suggestedLayout = 'DATA_FOCUS';
        else if (fullText.includes('[LAYOUT: REPORT_ONLY]')) suggestedLayout = 'REPORT_ONLY';

        const metadata = chunk.candidates?.[0]?.groundingMetadata;
        if (metadata?.groundingChunks) {
          groundingChunks = metadata.groundingChunks as any;
        }

        yield {
          text: fullText,
          chunks: groundingChunks,
          functionCalls: chunk.functionCalls,
          isComplete: false,
          suggestedLayout
        };
      }

      yield { text: fullText, chunks: groundingChunks, isComplete: true, suggestedLayout };
    } catch (error: any) {
      console.error("Core Engine Fault:", error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
