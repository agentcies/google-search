
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { SearchResult, GroundingChunk, FileContext } from "../types";

export interface SearchOptions {
  model: 'gemini-3-flash-preview' | 'gemini-3-pro-preview';
  deepSearch: boolean;
  useMaps: boolean;
  location?: { latitude: number; longitude: number };
  fileContext?: FileContext;
}

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async *searchStream(query: string, options: SearchOptions) {
    const thinkingBudget = options.deepSearch ? (options.model === 'gemini-3-pro-preview' ? 16000 : 8000) : 0;
    
    // Maps grounding is only supported in Gemini 2.5 series models.
    const activeModel = options.useMaps ? 'gemini-2.5-flash-latest' : options.model;

    const parts: Part[] = [{ text: query }];
    if (options.fileContext) {
      parts.push({
        inlineData: {
          data: options.fileContext.data,
          mimeType: options.fileContext.mimeType
        }
      });
    }

    const tools: any[] = [{ googleSearch: {} }];
    if (options.useMaps) {
      tools.push({ googleMaps: {} });
    }

    const config: any = {
      tools,
      // Gemini 2.5 models don't support thinkingBudget, but Gemini 3 does.
      // We only apply thinking if we are using a Gemini 3 model.
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
      systemInstruction: `YOU ARE THE OMNISEARCH MULTI-AGENT ORCHESTRATOR WITH ADVANCED MULTIMODAL INTELLIGENCE.
      
      OPERATING MODES:
      1. [ARCHITECT]: Strategy & Context Analysis. If an image OR document (PDF, Text, etc.) is provided, identify ALL entities, technical specs, OCR text, and structural data.
      2. [RESEARCHER]: Neural Grounding via Web Search ${options.useMaps ? 'and Google Maps' : ''}. Use the provided file context to verify claims, find pricing, or deeper documentation.
      3. [ANALYST]: Cross-synthesis of file content and real-time textual grounding.
      4. [AUDITOR]: Verify and format high-density API-ready JSON.

      STRICT OUTPUT PROTOCOL:
      - Start major phases with markers (e.g., [ARCHITECT] Analyzing Document Structure...).
      - Provide a "Human-Readable Report" followed by a [DATA_BOUNDARY] marker.
      - After the boundary, provide a minified JSON API object.
      
      LETHAL DIRECTIVE: No conversational filler. Extract EVERY possible metric from the provided file and the web.`,
    };

    try {
      const resultStream = await this.ai.models.generateContentStream({
        model: activeModel,
        contents: { parts },
        config: config
      });

      let fullText = "";
      let groundingChunks: GroundingChunk[] = [];

      for await (const chunk of resultStream) {
        const textChunk = chunk.text || "";
        fullText += textChunk;
        
        const metadata = chunk.candidates?.[0]?.groundingMetadata;
        if (metadata?.groundingChunks) {
          groundingChunks = metadata.groundingChunks as any;
        }

        yield {
          text: fullText,
          chunks: groundingChunks,
          isComplete: false
        };
      }

      yield {
        text: fullText,
        chunks: groundingChunks,
        isComplete: true
      };
    } catch (error: any) {
      console.error("Agent Orchestration Error:", error);
      
      let message = "Neural swarm disconnected.";
      let code = "UNKNOWN_ERROR";

      if (error.message?.includes("429")) {
        message = "Engine rate-limited. The swarm is cooling down.";
        code = "RATE_LIMIT_EXCEEDED";
      } else if (error.message?.includes("400")) {
        message = "Invalid parameters. Check query or file format.";
        code = "BAD_REQUEST";
      } else if (error.message?.includes("500") || error.message?.includes("503")) {
        message = "Global intelligence node offline.";
        code = "SERVICE_UNAVAILABLE";
      } else if (error.message?.includes("apiKey")) {
        message = "Core authorization failed.";
        code = "AUTH_FAILURE";
      }

      throw { message, code, originalError: error.message };
    }
  }
}

export const geminiService = new GeminiService();
