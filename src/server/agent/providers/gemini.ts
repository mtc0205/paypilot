/**
 * Google Gemini provider (generateContent with function declarations,
 * streamed via :streamGenerateContent?alt=sse).
 */
import type { AgentDeps, AgentRequest } from '../runtime.js';
import { SYSTEM_PROMPT } from '../prompt.js';
import { TOOLS } from '../tools.js';
import type { ProviderRuntimeConfig } from './openai.js';

interface Part {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

/** Convert our JSON-schema subset to Gemini's schema dialect. */
function toGeminiSchema(schema: { properties: Record<string, { type: string; enum?: (string | number)[]; description?: string }>; required: string[] }): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    properties[key] = {
      type: prop.type === 'integer' ? 'INTEGER' : prop.type === 'number' ? 'NUMBER' : prop.type === 'boolean' ? 'BOOLEAN' : 'STRING',
      description: prop.description ?? '',
      ...(prop.enum ? { enum: prop.enum.map(String) } : {}),
    };
  }
  return { type: 'OBJECT', properties, required: schema.required };
}

export async function geminiRespond(req: AgentRequest, config: ProviderRuntimeConfig, deps: AgentDeps): Promise<void> {
  const model = config.model ?? 'gemini-2.0-flash';
  const base = (config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const url = `${base}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`;
  const contents: Content[] = [
    ...req.history.slice(-6).map((h): Content => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: req.message }] },
  ];
  const toolDeclarations = TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) }));

  for (let iteration = 0; iteration < 6; iteration++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{ functionDeclarations: toolDeclarations }],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Gemini API error ${res.status}: ${await res.text().catch(() => 'no body')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const functionCalls: Part['functionCall'][] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as { candidates?: { content?: { parts?: Part[] } }[] };
          for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
            if (part.text) deps.emit({ type: 'token', text: part.text });
            if (part.functionCall) functionCalls.push(part.functionCall);
          }
        } catch {
          continue;
        }
      }
    }

    if (functionCalls.length === 0) return;
    contents.push({ role: 'model', parts: functionCalls.map((fc) => ({ functionCall: fc })) });
    let deferred = false;
    const responseParts: Part[] = [];
    for (const fc of functionCalls) {
      if (!fc) continue;
      const outcome = await deps.callTool(fc.name, fc.args ?? {});
      if (outcome.status === 'deferred') {
        deferred = true;
        responseParts.push({ functionResponse: { name: fc.name, response: { deferred: 'awaiting human approval', rationale: outcome.rationale } } });
      } else if (outcome.status === 'ok') {
        responseParts.push({ functionResponse: { name: fc.name, response: { summary: outcome.result.summary, data: outcome.result.data } } });
      } else {
        responseParts.push({ functionResponse: { name: fc.name, response: { error: outcome.message } } });
      }
    }
    contents.push({ role: 'user', parts: responseParts });
    if (deferred) {
      deps.emit({ type: 'token', text: ' That action needs your approval — see the card above.' });
      return;
    }
  }
}
