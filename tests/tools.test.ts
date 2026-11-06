import { describe, expect, it } from 'vitest';
import { MUTATING_TOOLS, TOOLS, getTool, validateArgs } from '../src/server/agent/tools.js';

const EXPECTED_TOOLS = [
  'search_transactions',
  'get_cashflow_summary',
  'forecast_cashflow',
  'detect_anomalies',
  'list_disputes',
  'draft_dispute_response',
  'create_invoice',
  'send_invoice',
  'explain_transaction',
];

describe('agent tool registry — JSON schemas', () => {
  it('exposes exactly the nine speced tools', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('every tool has a valid object schema with typed properties and required ⊆ properties', () => {
    for (const tool of TOOLS) {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toBeTypeOf('object');
      expect(Array.isArray(tool.parameters.required)).toBe(true);
      for (const req of tool.parameters.required) {
        expect(tool.parameters.properties[req]).toBeDefined();
      }
      expect(tool.description.length).toBeGreaterThan(20);
      for (const prop of Object.values(tool.parameters.properties)) {
        expect(['string', 'number', 'integer', 'boolean']).toContain(prop.type);
        if (prop.enum) {
          expect(prop.enum.length).toBeGreaterThan(1);
          expect(prop.enum.every((v) => typeof v === 'string' || typeof v === 'number')).toBe(true);
        }
      }
      // tools with required params must also declare them as properties (non-empty schema)
      if (tool.parameters.required.length > 0) {
        expect(Object.keys(tool.parameters.properties).length).toBeGreaterThan(0);
      }
    }
    // and most tools take arguments
    expect(TOOLS.filter((t) => Object.keys(t.parameters.properties).length > 0).length).toBeGreaterThanOrEqual(8);
  });

  it('exactly create_invoice and send_invoice are mutating (approval-gated)', () => {
    expect([...MUTATING_TOOLS].sort()).toEqual(['create_invoice', 'send_invoice']);
    for (const tool of TOOLS) {
      const shouldMutate = tool.name === 'create_invoice' || tool.name === 'send_invoice';
      expect(tool.mutates).toBe(shouldMutate);
    }
  });

  it('validateArgs enforces required fields, types, enums and bounds', () => {
    const create = getTool('create_invoice');
    expect(create).toBeDefined();

    expect(validateArgs(create!, {}).ok).toBe(false);
    expect(validateArgs(create!, { amount: 100 }).ok).toBe(false); // missing recipient
    expect(validateArgs(create!, { recipient: 'Acme', amount: 0 }).ok).toBe(false); // minimum 0.01
    expect(validateArgs(create!, { recipient: 'Acme', amount: -5 }).ok).toBe(false);
    expect(validateArgs(create!, { recipient: 'Acme', amount: '420' }).ok).toBe(false); // string not number
    expect(validateArgs(create!, { recipient: 'Acme', amount: 420, dueDays: 14, memo: 'consulting' }).ok).toBe(true);

    const search = getTool('search_transactions')!;
    expect(validateArgs(search, { type: 'NOT_A_TYPE' }).ok).toBe(false); // enum
    expect(validateArgs(search, { lastDays: 0 }).ok).toBe(false); // minimum 1
    expect(validateArgs(search, { unknownParam: true }).ok).toBe(false); // additional property
    expect(validateArgs(search, { query: 'northwind', lastDays: 30, limit: 5 }).ok).toBe(true);

    const send = getTool('send_invoice')!;
    expect(validateArgs(send, {}).ok).toBe(false);
    expect(validateArgs(send, { invoice_id: 12345 }).ok).toBe(false); // wrong type
    expect(validateArgs(send, { invoice_id: 'INV-1' }).ok).toBe(true);

    expect(getTool('nope')).toBeUndefined();
  });

  it('forecast tool clamps its horizon via schema bounds (7..60)', () => {
    const forecast = getTool('forecast_cashflow')!;
    expect(forecast.parameters.properties.days.minimum).toBe(7);
    expect(forecast.parameters.properties.days.maximum).toBe(60);
    expect(validateArgs(forecast, { days: 3 }).ok).toBe(false);
    expect(validateArgs(forecast, { days: 30 }).ok).toBe(true);
  });
});
