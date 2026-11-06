/**
 * Anthropic Messages API provider with streaming + tool use.
 */
import type { AgentDeps, AgentRequest } from '../runtime.js';
import { SYSTEM_PROMPT } from '../prompt.js';
import { TOOLS } from '../tools.js';
import type { ProviderRuntimeConfig } from './openai.js';

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export async function anthropicRespond(req: AgentRequest, config: ProviderRuntimeConfig, deps: AgentDeps): Promise<void> {
  const base = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const model = config.model ?? 'claude-sonnet-4-20250514';
  const history: ContentBlock[][] = req.history.slice(-6).map((h) => [{ type: h.role === 'user' ? 'text' : 'text', text: h.content } as ContentBlock]);

  let assistantBlocks: ContentBlock[] = [];
  const userTurn: ContentBlock[] = [{ type: 'text', text: req.message }];

  for (let iteration = 0; iteration < 6; iteration++) {
    const body = {
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        ...history.flatMap((blocks, i) => [{ role: i % 2 === 0 ? 'user' : 'assistant', content: blocks }]),
        { role: 'user', content: userTurn },
      ],
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    };

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text().catch(() => 'no body')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: ContentBlock[] = [];
    let sawStop = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as {
            type: string;
            delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
            content_block?: ContentBlock;
          };
          if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
            toolCalls.push({ type: 'tool_use', id: evt.content_block.id, name: evt.content_block.name, input: {} });
          } else if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta' && evt.delta.text) deps.emit({ type: 'token', text: evt.delta.text });
            if (evt.delta?.type === 'input_json_delta' && evt.delta.partial_json) {
              const last = toolCalls[toolCalls.length - 1];
              if (last) last.input = { ...(last.input ?? {}), __raw: ((last.input?.__raw as string | undefined) ?? '') + evt.delta.partial_json };
            }
          } else if (evt.type === 'message_delta') {
            if (evt.delta?.stop_reason === 'tool_use') sawStop = true;
          }
        } catch {
          continue;
        }
      }
    }

    const textBlocks: ContentBlock[] = [];
    if (toolCalls.length === 0 || !sawStop) return;

    assistantBlocks = [...textBlocks, ...toolCalls];
    const results: ContentBlock[] = [];
    let deferred = false;
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(call.input?.__raw ?? '{}')) as Record<string, unknown>;
      } catch {
        args = {};
      }
      const outcome = await deps.callTool(call.name ?? '', args);
      if (outcome.status === 'deferred') {
        deferred = true;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ deferred: 'awaiting human approval' }), is_error: false });
      } else if (outcome.status === 'ok') {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(outcome.result.data).slice(0, 4000) });
      } else {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ error: outcome.message }), is_error: true });
      }
    }
    history.push(userTurn, assistantBlocks);
    userTurn.splice(0, userTurn.length, ...results);
    if (deferred) {
      deps.emit({ type: 'token', text: ' That action needs your approval — see the card above.' });
      return;
    }
  }
}
