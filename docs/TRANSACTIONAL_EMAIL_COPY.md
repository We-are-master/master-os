# System and payment email copy

British English. Subjects identify the event or required action first, followed
by a reference/date where useful. Keep a human tone without promotional jokes,
false urgency or unverified payment promises. Preserve custom messages, amounts,
links, attachments, recipients, triggers and reminder intervals.

## Subject map

| Email | Subject |
| --- | --- |
| Booking payment | Confirm your Fixfy booking · {date} (date omitted when unknown) |
| Invoice ready | Your invoice {reference} is ready (retained, also used on PDF) |
| Verified receipt | Payment receipt · {reference} (retained) |
| Instalment | Instalment due today · {reference} · £{amount} |
| First overdue reminder | Payment reminder · {reference} · due {date} |
| Subsequent reminder | Payment outstanding · {reference} |
| Final reminder | Final reminder: invoice {reference} is overdue (retained) |
| Partner statement | Payout statement {reference} \| {period} (retained) |
| Self-bill | Self-bill {reference} \| {period} |
| Partner profile | Complete your Fixfy Trade profile |
| Account activation | Your Fixfy Trade account is active |
| Team invitation | Your invitation to Fixfy OS |
| Client quote | Review your Fixfy quote · {reference} |
| Job offer | Job offer · {service} · {date} · {postcode} |
| Assigned job | Job confirmed · {service} · {date} · {postcode} |
| Cancellation | Job cancelled · {service} · {date} |
| Complaint | Action required · Complaint for {reference} |
| Job on hold | Job on hold · {reference} |
| Quote invitation | Quote request · {service} · {postcode} |
| Missing report | Submit your job report · {reference} |
| Multiple missing reports | {count} job reports awaiting submission |
| Client support reply | New reply · {ticket}: {subject} |
| Internal support reply | Ticket reply · {ticket} · {account} |

## Body and CTA changes

- Booking: lead with the payment needed to confirm; retain deposit and remaining
  balance. Keep the amount on the payment button. For transfers, confirmation
  follows checking receipt, rather than promising immediate confirmation.
- Invoice: identify the statement and balance without assuming the job is complete.
  CTA: “Pay outstanding balance”. Paid and partially paid messages retain their
  separate branches. Existing agent/principal and VAT terminology is preserved.
- Instalments: state sequence, amount and due date; request date/reference when
  the customer has already paid and invite questions by reply.
- Overdue: state the balance shown in records and ask for payment evidence when
  already paid. Retain the existing final-reminder stage and escalation schedule.
- Statements: ask recipients to review the attached documents. A payment without
  a due date is “Payout pending”; a dated unpaid payment is “Payout scheduled”;
  the existing paid-at condition produces “Payout sent”. No new payment logic.
- Profile: ask for profile, documents and bank details to be reviewed in the portal;
  remove promises that updating a profile guarantees work or on-time payment.
- Activation: confirm approval and explain the next step; remove celebratory emoji.
- Quote: review scope, itemised prices and total, then accept or decline.
- Job confirmation: ask the professional to review the schedule, address and scope.
- Support: use “View ticket” and “View and reply” buttons.

## Trade Portal companion change

The portal's separate repository updates the sign-in code body and the internal
new-registration notification. OTP subject stays “{code} is your Fixfy sign-in
code”. Code expiry is not changed. The admin subject becomes “New trade
registration — {company}”; copy asks staff to review details before activation.

## Scope and verification

This change covers the transactional templates above. Marketing campaigns,
abandoned-booking promotions, system alert payloads and authored ticket content
are not rewritten. No live emails were sent, no Resend settings changed.

31 focused tests passed, including pending/scheduled/sent payout variants,
deposit/full-payment copy, preserved payment links and escaped personalisation.
A pre-existing job schedule test expects a four-digit year while its formatter
returns two digits; reproduced against the unchanged HEAD implementation.
Full TypeScript checking has a pre-existing account-insights.test.ts fixture
error (optional report_3_uploaded); application-only checking is run separately.
