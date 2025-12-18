
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { GroundingChunk, FileContext, ChatMessage } from "../types";

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
    description: 'Update the mission control board with sub-tasks and their statuses.',
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
    // Autonomous mode uses the highest possible intelligence and thinking budget
    const activeModel = options.autonomous ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
    const thinkingBudget = options.autonomous ? 32000 : 8000;

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

    // In Uber-Smart mode, we provide EVERYTHING. The model decides.
    const tools: any[] = [
      { googleSearch: {} },
      { codeExecution: {} },
      { functionDeclarations: [manageTasksDeclaration] }
    ];

    // Note: Maps grounding has specific model requirements (2.5 series).
    // If autonomous mode detects map needs, we may route through 2.5-flash internally.
    const internalModel = (options.useMaps || (options.autonomous && query.toLowerCase().match(/(nearby|where|location|restaurant|find)/))) 
      ? 'gemini-2.5-flash' 
      : activeModel;

    if (internalModel === 'gemini-2.5-flash') {
      tools.push({ googleMaps: {} });
    }

    const systemInstruction = options.autonomous 
      ? `SYSTEM: OMNI-ORCHESTRATOR v11.0 [NEURAL AUTONOMY ENABLED]
      
      YOUR MISSION: 
      1. SELF-CONFIGURE: Analyze the user's prompt. Decide which persona (Generalist, Fiscal, Architect, or Market Analyst) is best.
      2. META-LOGGING: Use [SWARM_LOG] [META-PLANNER] to report your configuration decisions to the user.
         Example: "[SWARM_LOG] [META-PLANNER] > Technical intent detected. Activating System-Architect kernel and Code Execution."
      3. TOOL SELECTION: Use Google Search, Google Maps, and Code Execution as needed. 
      4. MISSION BOARD: Use 'manageTasks' to break down the query into logical sub-objectives.
      5. DATA SYNTHESIS: Produce a high-density Markdown report.
      
      CRITICAL: After the report, output [DATA_BOUNDARY] and a JSON object for API ingestion:
      { "sentiment": "string", "entities": [], "metrics": {}, "confidence_score": 0.0-1.0 }`
      : `SYSTEM: OMNISEARCH CORE [MANUAL MODE]
      PERSONA: ${options.persona || 'Generalist'}
      RULES: Log steps with [SWARM_LOG]. Start report immediately. Use 'manageTasks'. Output [DATA_BOUNDARY] + JSON.`;

    const config: any = {
      tools,
      thinkingConfig: internalModel.includes('gemini-3') ? { thinkingBudget } : undefined,
      maxOutputTokens: (internalModel.includes('gemini-3')) ? 40000 : undefined,
      toolConfig: (options.location) ? {
        retrievalConfig: {
          latLng: {
            latitude: options.location.latitude,
            longitude: options.location.longitude
          }
        }
      } : undefined,
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
      console.error("Autonomy Failure:", error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
