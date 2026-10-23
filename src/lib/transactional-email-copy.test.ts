import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingPaymentEmailHTML, buildBookingPaymentSubject } from './booking-payment-email';
import { buildSelfBillEmailHtml, selfBillEmailSubject } from './emails/self-bill-statement';
import { buildNewQuoteEmail } from './portal-email-templates';
import type { SelfBill } from '@/types/database';

const bill = { reference: 'SB-TEST', net_payout: 125, partner_name: 'A & B', week_start: '2026-10-01', week_end: '2026-10-14' } as SelfBill;
for (const payoutStatement of [null, { commissionInvoiceRef: 'COM-1', hasClientWork: true }]) {
  test(`statement distinguishes pending, scheduled and sent (${payoutStatement ? 'agent' : 'self-bill'})`, () => {
    const doc = payoutStatement ? 'Payout statement' : 'Self-bill';
    const pending = buildSelfBillEmailHtml(bill, null, { payoutStatement });
    assert.match(pending, />Payout pending</);
    assert.match(pending, /A &amp; B/);
    const scheduled = buildSelfBillEmailHtml(bill, '2026-10-20', { payoutStatement });
    assert.match(scheduled, />Payout scheduled</);
    assert.match(scheduled, />Tue 20 Oct 26</);
    assert.match(scheduled, new RegExp(`>${doc} issued<`));
    const paid = buildSelfBillEmailHtml({ ...bill, paid_at: '2026-10-20' }, '2026-10-20', { payoutStatement });
    assert.match(paid, />Payout sent</);
    assert.match(paid, />Approved</);
    assert.match(paid, /#22C55E/);
    assert.equal(selfBillEmailSubject(bill, null, { payoutStatement }), `${doc} SB-TEST · Thu 1 Oct 26 to Wed 14 Oct 26`);
    assert.equal(selfBillEmailSubject(bill, '2026-10-20', { payoutStatement }), `${doc} SB-TEST · Thu 1 Oct 26 to Wed 14 Oct 26`);
    assert.equal(selfBillEmailSubject({ ...bill, paid_at: '2026-10-20' }, '2026-10-20', { payoutStatement }), `${doc} SB-TEST · Thu 1 Oct 26 to Wed 14 Oct 26`);
  });
}
test('booking copy preserves deposit, balance and safe personalised content', () => {
  const input = { clientName: '<Alex>', jobReference: 'J-1', invoiceReference: 'INV-1', serviceTitle: 'Repair & paint', total: 200, amountDueNow: 50, percent: 25, payLink: 'https://example.com/pay' };
  const html = buildBookingPaymentEmailHTML(input);
  assert.match(html, /£50\.00/);
  assert.match(html, /£150\.00/);
  assert.match(html, /deposit/);
  assert.match(html, /&lt;Alex&gt;/);
  assert.match(html, /href="https:\/\/example.com\/pay"/);
  assert.doesNotMatch(buildBookingPaymentSubject(input), /undefined|null/);
  const full = buildBookingPaymentEmailHTML({ ...input, amountDueNow: 200, percent: 100, payLink: null });
  assert.doesNotMatch(full, /remaining £|href="null"/);
});
test('quote notification retains reference, CTA destination and escaped customer content', () => {
  const result = buildNewQuoteEmail({ accountName: '<Client>', quoteRef: 'Q-123', quoteTitle: 'Paint & repair', portalUrl: 'https://example.com/quote' });
  assert.match(result.subject, /Q-123/);
  assert.match(result.html, /&lt;Client&gt;/);
  assert.match(result.html, /href="https:\/\/example.com\/quote"/);
});
