/**
 * PayPal Orders API v2 (checkout) — the code path proven by the Demo Checkout
 * screen. In mock mode the same flow is simulated by the mock provider.
 */
import type { DemoOrder } from '../../../shared/types.js';
import type { PayPalClient } from '../client.js';
import type { OrderInput } from '../provider.js';

interface PayPalOrderResponse {
  id: string;
  status: string;
  purchase_units?: { amount?: { value: string; currency_code: string }; description?: string }[];
  payer?: { name?: { given_name?: string; surname?: string } };
  create_time?: string;
}

export async function createOrderRemote(client: PayPalClient, input: OrderInput): Promise<DemoOrder> {
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: input.amount.toFixed(2) },
        description: input.item,
      },
    ],
  };
  const res = await client.request<PayPalOrderResponse>('POST', '/v2/checkout/orders', payload);
  return {
    id: res.id,
    status: 'CREATED',
    amount: input.amount,
    currency: 'USD',
    item: input.item,
    createdAt: res.create_time ?? new Date().toISOString(),
  };
}

export async function captureOrderRemote(client: PayPalClient, orderId: string, buyer = 'Sandbox Buyer'): Promise<DemoOrder> {
  const res = await client.request<PayPalOrderResponse>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
  const unit = res.purchase_units?.[0];
  const payerName = res.payer?.name ? `${res.payer.name.given_name ?? ''} ${res.payer.name.surname ?? ''}`.trim() : buyer;
  return {
    id: res.id,
    status: res.status === 'COMPLETED' ? 'COMPLETED' : 'CREATED',
    amount: Number(unit?.amount?.value ?? '0'),
    currency: 'USD',
    item: unit?.description ?? 'Purchase',
    buyer: payerName || buyer,
    createdAt: res.create_time ?? new Date().toISOString(),
    capturedAt: new Date().toISOString(),
  };
}
