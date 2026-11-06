/**
 * PayPal Invoicing API v2 — real REST calls used in sandbox mode.
 */
import type { Invoice } from '../../../shared/types.js';
import type { InvoiceDraftInput } from '../provider.js';
import type { PayPalClient } from '../client.js';

interface PayPalAmount {
  currency_code: string;
  value: string;
}

interface PayPalInvoiceResponse {
  id: string;
  status: string;
  detail?: {
    invoice_number?: string;
    currency_code?: string;
    memo?: string;
    terms?: string;
  };
  invoicer?: { email_address?: string };
  primary_recipients?: { billing_info?: { name?: { given_name?: string; surname?: string }; email_address?: string } }[];
  line_items?: { name: string; quantity: string; unit_amount: PayPalAmount }[];
  amount?: { total?: PayPalAmount; breakdown?: { item_total?: PayPalAmount } };
  due_date?: string;
}

export function toInvoicePayload(input: InvoiceDraftInput, invoicerEmail: string, now = new Date()): Record<string, unknown> {
  const dueDate = new Date(now.getTime() + (input.dueDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
  const [givenName, ...rest] = input.recipientName.split(' ');
  return {
    detail: {
      currency_code: 'USD',
      memo: input.memo ?? input.item,
      note: 'Thank you for your business.',
      terms_and_conditions: 'Payable via PayPal. Late payments accrue 1.5% monthly interest.',
    },
    invoicer: { email_address: invoicerEmail },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: givenName || input.recipientName, surname: rest.join(' ') || undefined },
          email_address: input.recipientEmail ?? `billing@${(input.recipientName || 'customer').toLowerCase().replace(/\s+/g, '')}.com`,
        },
      },
    ],
    line_items: [
      {
        name: input.item,
        quantity: String(input.quantity ?? 1),
        unit_amount: { currency_code: 'USD', value: input.amount.toFixed(2) },
        tax: { name: 'Sales Tax', percent: '0' },
      },
    ],
    configuration: {
      partial_payment: { allow_partial_payment: false },
      allow_tip: false,
      tax_calculated_after_discount: true,
    },
    due_date: dueDate,
  };
}

export function fromPayPalInvoice(res: PayPalInvoiceResponse, createdAtFallback = new Date().toISOString()): Invoice {
  const recipientInfo = res.primary_recipients?.[0]?.billing_info;
  const given = recipientInfo?.name?.given_name ?? '';
  const surname = recipientInfo?.name?.surname ?? '';
  const items =
    res.line_items?.map((li) => ({
      name: li.name,
      quantity: Number(li.quantity),
      unitAmount: Number(li.unit_amount.value),
    })) ?? [];
  const total = Number(res.amount?.breakdown?.item_total?.value ?? res.amount?.total?.value ?? '0');
  return {
    id: res.id,
    number: res.detail?.invoice_number ?? res.id,
    status: normalizeStatus(res.status),
    recipient: {
      name: `${given} ${surname}`.trim() || recipientInfo?.email_address || 'Customer',
      email: recipientInfo?.email_address ?? 'unknown@example.com',
    },
    items,
    total,
    currency: 'USD',
    dueDate: res.due_date ?? createdAtFallback.slice(0, 10),
    memo: res.detail?.memo,
    createdAt: createdAtFallback,
    createdBy: 'human',
  };
}

function normalizeStatus(status: string): Invoice['status'] {
  const map: Record<string, Invoice['status']> = {
    DRAFT: 'DRAFT',
    UNPAID: 'SENT',
    SENT: 'SENT',
    SCHEDULED: 'SENT',
    PAID: 'PAID',
    MARKED_AS_PAID: 'MARKED_AS_PAID',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
    PARTIALLY_PAID: 'SENT',
    PARTIALLY_REFUNDED: 'SENT',
    PAYMENT_PENDING: 'SENT',
  };
  return map[status] ?? 'DRAFT';
}

export async function createInvoiceRemote(client: PayPalClient, payload: Record<string, unknown>): Promise<PayPalInvoiceResponse> {
  const draft = await client.request<PayPalInvoiceResponse>('POST', '/v2/invoicing/invoices', payload);
  // PayPal v2 drafts require a separate "send" action; generation returns 201 with the draft invoice.
  return draft;
}

export async function sendInvoiceRemote(client: PayPalClient, id: string): Promise<void> {
  await client.request<unknown>('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    send_to_recipient: true,
    send_to_invoicer: false,
  });
}

export async function listInvoicesRemote(client: PayPalClient, pages = 4): Promise<PayPalInvoiceResponse[]> {
  const out: PayPalInvoiceResponse[] = [];
  for (let page = 1; page <= pages; page++) {
    const json = await client.request<{ items?: PayPalInvoiceResponse[]; total_pages: number }>(
      'GET',
      `/v2/invoicing/invoices?page=${page}&page_size=100&total_required=true`,
    );
    out.push(...(json.items ?? []));
    if (page >= (json.total_pages ?? 1)) break;
  }
  return out;
}

export async function getInvoiceRemote(client: PayPalClient, id: string): Promise<PayPalInvoiceResponse> {
  return client.request<PayPalInvoiceResponse>('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}
