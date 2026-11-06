/**
 * First Mate chat state: SSE streaming, tool cards, approval cards, and the
 * approval decision flow (which executes the real action server-side).
 */
import { create } from 'zustand';
import type { AgentEvent } from '@shared/types';
import { announceRefresh, decideApprovalRequest, streamChat } from '../lib/api';
import { toast } from './toast';

export interface ToolCard {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'ok' | 'error';
  summary?: string;
  data?: unknown;
}

export interface ApprovalCard {
  approvalId: string;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
  resultSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: ToolCard[];
  approval?: ApprovalCard;
  streaming: boolean;
  error?: string;
  ts: number;
}

interface ChatStore {
  open: boolean;
  messages: ChatMessage[];
  sending: boolean;
  setOpen: (open: boolean) => void;
  send: (text: string) => Promise<void>;
  decide: (approvalId: string, decision: 'approve' | 'reject') => Promise<void>;
}

let msgSeq = 1;
const uid = (): string => `m${msgSeq++}`;

export const useChatStore = create<ChatStore>((set, get) => ({
  open: false,
  messages: [],
  sending: false,

  setOpen: (open) => set({ open }),

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;
    const userMsg: ChatMessage = { id: uid(), role: 'user', text: trimmed, tools: [], streaming: false, ts: Date.now() };
    const aiMsg: ChatMessage = { id: uid(), role: 'assistant', text: '', tools: [], streaming: true, ts: Date.now() };
    const history = get()
      .messages.filter((m) => !m.streaming && m.text)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.text }));

    set({ messages: [...get().messages, userMsg, aiMsg], sending: true, open: true });

    const patch = (fn: (m: ChatMessage) => ChatMessage) => {
      set({ messages: get().messages.map((m) => (m.id === aiMsg.id ? fn(m) : m)) });
    };

    const onEvent = (e: AgentEvent) => {
      switch (e.type) {
        case 'token':
          patch((m) => ({ ...m, text: m.text + e.text }));
          break;
        case 'tool_call':
          patch((m) => ({ ...m, tools: [...m.tools, { callId: e.callId, tool: e.tool, args: e.args, status: 'running' }] }));
          break;
        case 'tool_result':
          patch((m) => ({
            ...m,
            tools: m.tools.map((t) =>
              t.callId === e.callId ? { ...t, status: e.ok ? 'ok' : 'error', summary: e.summary, data: e.result } : t,
            ),
          }));
          break;
        case 'approval_request':
          patch((m) => ({
            ...m,
            approval: { approvalId: e.approvalId, tool: e.tool, args: e.args, rationale: e.rationale, status: 'pending' },
          }));
          break;
        case 'error':
          patch((m) => ({ ...m, error: e.message }));
          break;
        default:
          break;
      }
    };

    try {
      await streamChat(trimmed, history, onEvent);
    } catch (err) {
      patch((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      set({ sending: false });
    }
  },

  decide: async (approvalId, decision) => {
    // Update every message carrying this approval (usually one)
    set({
      messages: get().messages.map((m) =>
        m.approval?.approvalId === approvalId && m.approval.status === 'pending'
          ? { ...m, approval: { ...m.approval, status: decision === 'approve' ? 'approved' : 'rejected' } }
          : m,
      ),
    });
    try {
      const res = await decideApprovalRequest(approvalId, decision);
      if (decision === 'approve') {
        if (res.status === 'approved') {
          const summary = res.summary ?? 'Action executed.';
          set({
            messages: [
              ...get().messages,
              { id: uid(), role: 'assistant', text: `Approved and executed — ${summary}`, tools: [], streaming: false, ts: Date.now() },
            ],
            open: true,
          });
          set({
            messages: get().messages.map((m) =>
              m.approval?.approvalId === approvalId ? { ...m, approval: { ...m.approval, status: 'approved', resultSummary: summary } } : m,
            ),
          });
          toast.success('Approved', summary);
          announceRefresh();
        } else {
          toast.error('Execution failed', res.error);
        }
      } else {
        toast.info('Rejected', 'The action was not executed.');
      }
    } catch (err) {
      toast.error('Decision failed', err instanceof Error ? err.message : String(err));
      set({
        messages: get().messages.map((m) =>
          m.approval?.approvalId === approvalId ? { ...m, approval: { ...m.approval, status: 'pending' } } : m,
        ),
      });
    }
  },
}));
