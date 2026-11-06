/**
 * JSON file store with atomic writes (tmp file + rename). No native modules.
 * Falls back to in-memory when no file path is given (tests).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Approval, AuditEntry, DemoOrder, Dispute, Invoice, Transaction } from '../../shared/types.js';
import { uid } from '../../shared/util.js';

export interface MerchantInfo {
  name: string;
  email: string;
  business: string;
}

export interface AppState {
  version: 1;
  merchant: MerchantInfo;
  seededAt: string;
  transactions: Transaction[];
  invoices: Invoice[];
  disputes: Dispute[];
  orders: DemoOrder[];
  approvals: Approval[];
  audit: AuditEntry[];
}

export function emptyState(): AppState {
  return {
    version: 1,
    merchant: {
      name: 'Harbor & Pine Studio',
      email: 'billing@harborandpine.test',
      business: 'Design & consulting studio',
    },
    seededAt: new Date(0).toISOString(),
    transactions: [],
    invoices: [],
    disputes: [],
    orders: [],
    approvals: [],
    audit: [],
  };
}

export class Store {
  private state: AppState;
  private readonly file: string | null;

  constructor(file?: string | null) {
    this.file = file ?? null;
    if (this.file) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        this.state = JSON.parse(raw) as AppState;
      } catch {
        this.state = emptyState();
      }
    } else {
      this.state = emptyState();
    }
  }

  /** Read-only view of the state. Mutate only through `update`. */
  get snapshot(): AppState {
    return this.state;
  }

  get isSeeded(): boolean {
    return this.state.transactions.length > 0;
  }

  update(mutator: (draft: AppState) => void): void {
    const draft = structuredClone(this.state);
    mutator(draft);
    this.state = draft;
    this.persist();
  }

  reset(next: AppState): void {
    this.state = next;
    this.persist();
  }

  /** Append an audit entry (convenience — audit is append-only). */
  logAudit(entry: Omit<AuditEntry, 'id' | 'ts'> & { ts?: string }): AuditEntry {
    const full: AuditEntry = {
      id: uid('aud'),
      ts: entry.ts ?? new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      args: entry.args,
      result: entry.result,
      detail: entry.detail,
      approved: entry.approved,
      approver: entry.approver,
      relatedId: entry.relatedId,
    };
    this.update((s) => {
      s.audit.unshift(full);
      if (s.audit.length > 5000) s.audit.length = 5000;
    });
    return full;
  }

  private persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}
