/**
 * Human-in-the-loop approvals for mutating agent actions.
 * Pending approvals are persisted; approving EXECUTES the real tool against
 * the provider (mock or sandbox PayPal) and every step is audit-logged.
 */
import type { Approval } from '../../shared/types.js';
import { uid } from '../../shared/util.js';
import type { Store } from '../store/store.js';
import { approvalRationale } from './drafts.js';
import { getTool, validateArgs, type ToolResult } from './tools.js';

export function createPendingApproval(
  store: Store,
  tool: string,
  args: Record<string, unknown>,
  rationale?: string,
): Approval {
  const approval: Approval = {
    id: uid('appr'),
    createdAt: new Date().toISOString(),
    tool,
    args,
    rationale: rationale ?? approvalRationale(tool, args),
    status: 'pending',
  };
  store.update((s) => {
    s.approvals.unshift(approval);
  });
  store.logAudit({
    actor: 'agent',
    action: tool,
    args,
    result: 'pending',
    detail: `Requested approval: ${approval.rationale}`,
    approved: false,
    relatedId: approval.id,
  });
  return approval;
}

export type DecideOutcome =
  | { status: 'approved'; approval: Approval; summary: string; data: unknown }
  | { status: 'rejected'; approval: Approval }
  | { status: 'error'; message: string };

/**
 * Decide a pending approval. `executeAsync` should run the tool's executor
 * with the approval gate already lifted (the human IS the gate here).
 */
export async function decideApproval(
  store: Store,
  approvalId: string,
  decision: 'approve' | 'reject',
  decidedBy: string,
  executeAsync: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>,
): Promise<DecideOutcome> {
  const approval = store.snapshot.approvals.find((a) => a.id === approvalId);
  if (!approval) return { status: 'error', message: `Approval ${approvalId} not found` };
  if (approval.status !== 'pending') return { status: 'error', message: `Approval ${approvalId} is already ${approval.status}` };

  if (decision === 'reject') {
    const rejected: Approval = { ...approval, status: 'rejected', decidedAt: new Date().toISOString(), decidedBy };
    store.update((s) => {
      const idx = s.approvals.findIndex((a) => a.id === approvalId);
      if (idx >= 0) s.approvals[idx] = rejected;
    });
    store.logAudit({
      actor: 'human',
      action: 'approval_rejected',
      args: { approvalId, tool: approval.tool },
      result: 'ok',
      detail: `Rejected ${approval.tool}: ${approval.rationale}`,
      approved: true,
      approver: decidedBy,
      relatedId: approvalId,
    });
    return { status: 'rejected', approval: rejected };
  }

  const tool = getTool(approval.tool);
  if (!tool) return { status: 'error', message: `Unknown tool ${approval.tool}` };
  const validation = validateArgs(tool, approval.args);
  if (!validation.ok) return { status: 'error', message: `Invalid args: ${validation.errors.join('; ')}` };

  try {
    const result = await executeAsync(approval.tool, approval.args);
    const approved: Approval = { ...approval, status: 'approved', decidedAt: new Date().toISOString(), decidedBy, result };
    store.update((s) => {
      const idx = s.approvals.findIndex((a) => a.id === approvalId);
      if (idx >= 0) s.approvals[idx] = approved;
    });
    store.logAudit({
      actor: 'agent',
      action: approval.tool,
      args: approval.args,
      result: 'ok',
      detail: result.summary,
      approved: true,
      approver: decidedBy,
      relatedId: approvalId,
    });
    return { status: 'approved', approval: approved, summary: result.summary, data: result.data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    store.update((s) => {
      const idx = s.approvals.findIndex((a) => a.id === approvalId);
      if (idx >= 0) s.approvals[idx] = { ...s.approvals[idx], status: 'approved', error: message };
    });
    store.logAudit({
      actor: 'agent',
      action: approval.tool,
      args: approval.args,
      result: 'error',
      detail: message,
      approved: true,
      approver: decidedBy,
      relatedId: approvalId,
    });
    return { status: 'error', message };
  }
}
