/**
 * OpenAI-compatible provider (covers OpenAI, DeepSeek, Groq, OpenRouter, Ollama
 * via AI_BASE_URL). Streaming chat completions with native tool calls, wired
 * into the PayPilot approval gate through the shared AgentDeps.
 */
import type { AgentDeps, AgentRequest } from '../runtime.js';
import { SYSTEM_PROMPT } from '../prompt.js';
import { TOOLS } from '../tools.js';

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface StreamDelta {
  choices?: {
    delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
  }[];
}

export interface ProviderRuntimeConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export async function openaiRespond(req: AgentRequest, config: ProviderRuntimeConfig, deps: AgentDeps): Promise<void> {
  const base = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = config.model ?? 'gpt-4o-mini';
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...req.history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: req.message },
  ];
  const toolsPayload = TOOLS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let iteration = 0; iteration < 6; iteration++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: toolsPayload, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`OpenAI-compatible API error ${res.status}: ${await res.text().catch(() => 'no body')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        let delta: StreamDelta;
        try {
          delta = JSON.parse(payload) as StreamDelta;
        } catch {
          continue;
        }
        const choice = delta.choices?.[0];
        if (choice?.delta?.content) deps.emit({ type: 'token', text: choice.delta.content });
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const slot = pendingCalls.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          pendingCalls.set(tc.index, slot);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
    }

    const calls = [...pendingCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    if (calls.length === 0 || finishReason !== 'tool_calls') return;

    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
    });
    let deferred = false;
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.args || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      const outcome = await deps.callTool(call.name, args);
      if (outcome.status === 'deferred') {
        deferred = true;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ deferred: 'awaiting human approval', rationale: outcome.rationale }) });
      } else if (outcome.status === 'ok') {
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result.data).slice(0, 4000) });
      } else {
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: outcome.message }) });
      }
    }
    if (deferred) {
      deps.emit({
        type: 'token',
        text: ' That action needs your approval — see the card above. I will continue once you decide.',
      });
      return;
    }
  }
  deps.emit({ type: 'token', text: ' (Stopped after too many tool rounds.)' });
}
