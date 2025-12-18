
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
    description: 'Create, update, or delete mission objectives/tasks for the current research swarm.',
    properties: {
      action: {
        type: Type.STRING,
        description: 'The action to perform.',
        enum: ['create', 'update', 'delete'],
      },
      taskId: {
        type: Type.STRING,
        description: 'A unique identifier for the task (e.g., task_1).',
      },
      description: {
        type: Type.STRING,
        description: 'Detailed description of the mission objective.',
      },
      status: {
        type: Type.STRING,
        description: 'Current state of the objective.',
        enum: ['pending', 'in_progress', 'completed'],
      },
    },
    required: ['action', 'taskId'],
  },
};

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async *searchStream(query: string, options: SearchOptions, history: ChatMessage[] = []) {
    const thinkingBudget = options.deepSearch ? (options.model === 'gemini-3-pro-preview' ? 16000 : 8000) : 0;
    // Maps grounding is only supported in Gemini 2.5 series models.
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

    const tools: any[] = [
      { googleSearch: {} },
      { codeExecution: {} },
      { functionDeclarations: [manageTasksDeclaration] }
    ];
    if (options.useMaps) tools.push({ googleMaps: {} });

    const personas = {
      general: "OMNI-RESEARCHER: Balanced, comprehensive, and clear.",
      financial: "QUANT-ANALYST: Focus on metrics, trends, market caps, and fiscal cycles.",
      technical: "SYSTEM-ARCHITECT: Focus on specs, documentation, benchmarks, and performance data.",
      market: "MARKET-INTELLIGENCE: Focus on competitors and consumer sentiment."
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
      systemInstruction: `SYSTEM: OMNISEARCH COLLABORATIVE ORCHESTRATOR v6.0
      PERSONA: ${personas[options.persona]}

      TASK MANAGEMENT DIRECTIVE:
      You have access to a Mission Control Task Board. You MUST use 'manageTasks' to:
      1. Create a checklist of mission objectives at the start of any new research node.
      2. Update tasks to 'in_progress' when you start searching for them.
      3. Mark tasks as 'completed' once synthesized.
      4. Use tasks to stay focused on the user's ultimate goal.

      OPERATING MODES:
      1. [ARCHITECT]: Decompose query into parallel data-acquisition threads. Create tasks here.
      2. [RESEARCHER]: Grounded extraction. Update tasks to in_progress.
      3. [ANALYST]: Synthesis & Sentiment. Finalize tasks here.
      4. [AUDITOR]: API JSON generation.

      STRICT OUTPUT PROTOCOL:
      - Phase markers are mandatory.
      - Synthesis Report (Markdown).
      - [DATA_BOUNDARY] followed by structured JSON.`,
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
        // Access chunk.text directly (not a method call) as per SDK guidelines.
        const textChunk = chunk.text || "";
        fullText += textChunk;
        
        const metadata = chunk.candidates?.[0]?.groundingMetadata;
        if (metadata?.groundingChunks) {
          groundingChunks = metadata.groundingChunks as any;
        }

        // Use the functionCalls getter available on the GenerateContentResponse object.
        const functionCalls = chunk.functionCalls;

        yield {
          text: fullText,
          chunks: groundingChunks,
          functionCalls,
          isComplete: false
        };
      }

      yield {
        text: fullText,
        chunks: groundingChunks,
        isComplete: true
      };
    } catch (error: any) {
      console.error("Agentic Failure:", error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
