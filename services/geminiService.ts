
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
    // Spatial queries require 2.5-flash for Maps grounding.
    const isSpatialQuery = query.toLowerCase().match(/(where|location|find|near|restaurant|food|hotel|address|street|map|sf|nyc|london|tenderloin)/);
    
    // Choose model based on query complexity and capability requirements
    // For spatial, we MUST use 2.5-flash. For others, 3-flash is faster than 3-pro.
    let activeModel = options.autonomous ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
    if (isSpatialQuery || options.useMaps) {
      activeModel = 'gemini-2.5-flash';
    }

    // Thinking budget optimization: Zero for spatial/fast lookups to avoid "forever" loading.
    const thinkingBudget = (isSpatialQuery || !options.autonomous) ? 0 : 8000;

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

    const tools: any[] = [
      { googleSearch: {} },
      { codeExecution: {} },
      { functionDeclarations: [manageTasksDeclaration] }
    ];

    if (isSpatialQuery || options.useMaps) {
      tools.push({ googleMaps: {} });
    }

    const systemInstruction = `SYSTEM: NEXUS-ORCHESTRATOR v14.1 [PERFORMANCE_OPTIMIZED]
    
    MISSION: Deliver absolute data-density with MINIMAL LATENCY. 
    ADAPTIVE UI INSTRUCTIONS:
    1. IMMEDIATELY output [LAYOUT: MODE] based on the query type.
       - Spatial/Local/Maps needed: [LAYOUT: SPATIAL_SPLIT]
       - Heavy Data/Specs: [LAYOUT: DATA_FOCUS]
       - Text/Insight: [LAYOUT: REPORT_ONLY]
    2. SWARM LOGGING: Prefix reasoning with [SWARM_LOG]. Log every tool use, e.g., "[SWARM_LOG] > Accessing Google Maps indices for ${query}"
    3. DATA DENSITY: Use tables and lists. No conversational filler.
    4. TASKING: Call 'manageTasks' to show your plan, but start the report stream concurrently.
    5. API EXIT: End with [DATA_BOUNDARY] then the high-fidelity JSON payload.
    
    PRIORITY: SPEED AND FACTUAL DENSITY.`;

    const config: any = {
      tools,
      thinkingConfig: activeModel.includes('gemini-3') ? { thinkingBudget } : undefined,
      maxOutputTokens: activeModel.includes('gemini-3') ? 25000 : undefined,
      systemInstruction,
    };

    try {
      const resultStream = await this.ai.models.generateContentStream({
        model: activeModel,
        contents: contents,
        config: config
      });

      let fullText = "";
      let groundingChunks: GroundingChunk[] = [];
      let suggestedLayout: LayoutMode = 'AUTO';

      for await (const chunk of resultStream) {
        const textChunk = chunk.text || "";
        fullText += textChunk;
        
        // Instant Layout Detection
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
