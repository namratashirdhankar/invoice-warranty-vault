import { ServiceUnavailableException } from '@nestjs/common';

export interface AiProvider {
  generate(prompt: string, options?: { document?: { bytes: Buffer; mimeType: string }; documents?: { bytes: Buffer; mimeType: string }[]; json?: boolean; googleSearch?: boolean }): Promise<string>;
}

class GeminiProvider implements AiProvider {
  constructor(private readonly key: string, private readonly model: string) {}

  async generate(prompt: string, options?: { document?: { bytes: Buffer; mimeType: string }; documents?: { bytes: Buffer; mimeType: string }[]; json?: boolean; googleSearch?: boolean }): Promise<string> {
    const parts: object[] = [{ text: prompt }];
    const documents = [...(options?.document ? [options.document] : []), ...(options?.documents || [])];
    for (const document of documents) parts.push({ inline_data: { mime_type: document.mimeType, data: document.bytes.toString('base64') } });
    const requestBody = JSON.stringify({ contents: [{ parts }], ...(options?.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}), ...(options?.googleSearch ? { tools: [{ google_search: {} }] } : {}) });
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
          body: requestBody,
        });
      } catch (error) {
        if (attempt === 2) throw new ServiceUnavailableException('Could not connect to Google AI. Check the server connection and try again.');
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
    }
    if (!response?.ok) {
      const status = response?.status;
      if (status === 429) throw new ServiceUnavailableException('Google AI usage limit reached. Check your API quota and try again later.');
      if (status === 503 || status === 502 || status === 504) throw new ServiceUnavailableException('Google AI is temporarily busy. Please try again in a moment.');
      if (status === 401 || status === 403) throw new ServiceUnavailableException('Google AI rejected the API key or project permissions. Check the API key configuration.');
      throw new ServiceUnavailableException('AI provider request failed: ' + status);
    }
    const body: any = await response.json();
    const output = body.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('');
    if (!output) throw new ServiceUnavailableException('No response returned by AI provider');
    const sources = (body.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map((chunk: any) => chunk.web?.uri && chunk.web?.title ? { uri: chunk.web.uri, title: chunk.web.title } : null).filter(Boolean);
    if (!sources.length) return output;
    return output + '\n\nSources:\n' + sources.map((source: any) => `- ${source.title}: ${source.uri}`).join('\n');
  }
}

export function getAiProvider(): AiProvider | null {
  const provider = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  if (provider !== 'gemini') throw new ServiceUnavailableException(`Unsupported AI provider: ${provider}`);
  const key = process.env.API_KEY?.trim();
  if (!key) return null;
  return new GeminiProvider(key, process.env.AI_MODEL?.trim() || 'gemini-flash-lite-latest');
}
