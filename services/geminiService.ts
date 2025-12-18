
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { GroundingChunk, FileContext, ChatMessage } from "../types";

export interface SearchOptions {
  model: 'gemini-3-flash-preview' | 'gemini-3-pro-preview';
  deepSearch: boolean;
  useMaps: boolean;
  persona: 'general' | 'financial' | 'technical' | 'market';
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
    const thinkingBudget = options.deepSearch ? (options.model === 'gemini-3-pro-preview' ? 16000 : 8000) : 0;
    
    // Maps grounding is strictly supported in Gemini 2.5 series.
    const activeModel = options.useMaps ? 'gemini-2.5-flash' : options.model;

    const contents: any[] = history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    const currentParts: Part[] = [{ text: query }];
    if (options.fileContext) {
      currentParts.push({
        inlineData: {
          data: options.fileContext.data,
          mimeType: options.fileContext.mimeType
        }
      });
    }

    contents.push({ role: 'user', parts: currentParts });

    const tools: any[] = [{ googleSearch: {} }];
    if (options.useMaps) {
      tools.push({ googleMaps: {} });
    } else {
      tools.push({ codeExecution: {} });
      tools.push({ functionDeclarations: [manageTasksDeclaration] });
    }

    const personas = {
      general: "OMNI-ANALYST: Generalist with deep focus on clarity and synthesis.",
      financial: "FISCAL-QUANT: Market analyst focused on ROI, trends, and risk assessment.",
      technical: "SYSTEM-ARCHITECT: Deep technical documentation, specs, and engineering logic.",
      market: "MARKET-INTELLIGENCE: Competitor analysis and consumer sentiment specialist."
    };

    const config: any = {
      tools,
      thinkingConfig: activeModel.includes('gemini-3') ? { thinkingBudget } : undefined,
      maxOutputTokens: (activeModel.includes('gemini-3') && thinkingBudget > 0) ? 30000 : undefined,
      toolConfig: (options.useMaps && options.location) ? {
        retrievalConfig: {
          latLng: {
            latitude: options.location.latitude,
            longitude: options.location.longitude
          }
        }
      } : undefined,
      systemInstruction: `SYSTEM: OMNISEARCH v8.5 OPERATING KERNEL
      
      CORE MISSION: Execute a high-fidelity research mission for the user.
      PERSONA: ${personas[options.persona]}

      ORCHESTRATION RULES:
      1. LOGGING: Every internal step must be logged with [SWARM_LOG] prefix.
         Example: [SWARM_LOG] [ARCHITECT] > Querying global restaurant indices.
      2. REPORTING: Start the synthesis report immediately. Do not wait for tools to finish.
      3. COMPLETION: When data acquisition is 100% finished, output the [DATA_BOUNDARY] marker.
      4. JSON PAYLOAD: After [DATA_BOUNDARY], output ONLY valid JSON for API ingestion:
         { "sentiment": "positive|negative|neutral|mixed", "summary": "brief summary", "confidence": 0.95 }

      ${options.useMaps ? 'SPATIAL MODE: Use Maps for live status, coordinates, and local context.' : 'ANALYTIC MODE: Use code for complex logic and manageTasks for multi-step missions.'}`,
    };

    try {
      const resultStream = await this.ai.models.generateContentStream({
        model: activeModel,
        contents: contents,
        config: config
      });

      let fullText = "";
      let groundingChunks: GroundingChunk[] = [];

      for await (const chunk of resultStream) {
        fullText += chunk.text || "";
        
        const metadata = chunk.candidates?.[0]?.groundingMetadata;
        if (metadata?.groundingChunks) {
          groundingChunks = metadata.groundingChunks as any;
        }

        yield {
          text: fullText,
          chunks: groundingChunks,
          functionCalls: chunk.functionCalls,
          isComplete: false
        };
      }

      yield {
        text: fullText,
        chunks: groundingChunks,
        isComplete: true
      };
    } catch (error: any) {
      console.error("Critical Swarm Failure:", error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
