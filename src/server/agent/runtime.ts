/**
 * Agent runtime: orchestrates the provider (mock or real LLM) with the tool
 * registry and the human-approval gate, streaming AgentEvents to the SSE chat.
 */
import type { AgentEvent, ChatTurn } from '../../shared/types.js';
import { uid } from '../../shared/util.js';
import { errorMessage } from '../../shared/util.js';
import { createPendingApproval } from './approvals.js';
import { approvalRationale } from './drafts.js';
import { getTool, validateArgs, type ToolContext, type ToolResult } from './tools.js';

export type EmitFn = (event: AgentEvent) => void;

export type ToolOutcome =
  | { status: 'ok'; result: ToolResult }
  | { status: 'deferred'; approvalId: string; rationale: string }
  | { status: 'error'; message: string };

export interface AgentDeps {
  emit: EmitFn;
  /** Runs a tool: emits tool_call, executes (or gates behind an approval), emits tool_result. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  /** Streaming delay between tokens (ms) — 0 in tests. */
  streamDelayMs: number;
  /** Yield helper so SSE writers can flush between tokens. */
  sleep(ms: number): Promise<void>;
}

export function makeDeps(ctx: ToolContext, emit: EmitFn, streamDelayMs: number): AgentDeps {
  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    const tool = getTool(name);
    if (!tool) return { status: 'error', message: `Unknown tool "${name}"` };
    const validation = validateArgs(tool, args);
    if (!validation.ok) return { status: 'error', message: `Invalid arguments for ${name}: ${validation.errors.join('; ')}` };
    const callId = uid('call');
    emit({ type: 'tool_call', callId, tool: name, args });
    if (tool.mutates) {
      const approval = createPendingApproval(ctx.store, name, args, approvalRationale(name, args));
      emit({ type: 'approval_request', approvalId: approval.id, tool: name, args, rationale: approval.rationale });
      return { status: 'deferred', approvalId: approval.id, rationale: approval.rationale };
    }
    try {
      const result = await tool.execute(args, ctx);
      emit({ type: 'tool_result', callId, tool: name, ok: true, result: result.data, summary: result.summary });
      return { status: 'ok', result };
    } catch (e) {
      const message = errorMessage(e);
      emit({ type: 'tool_result', callId, tool: name, ok: false, result: { error: message } });
      return { status: 'error', message };
    }
  };
  return {
    emit,
    callTool,
    streamDelayMs,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export interface AgentRequest {
  message: string;
  history: ChatTurn[];
}

export interface AgentConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** Execute a tool with the approval gate lifted (used when a human approves). */
export async function executeApprovedTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown tool "${name}"`);
  const validation = validateArgs(tool, args);
  if (!validation.ok) throw new Error(`Invalid arguments: ${validation.errors.join('; ')}`);
  return tool.execute(args, ctx);
}

export function doneEvent(): AgentEvent {
  return { type: 'done', messageId: uid('msg') };
}
