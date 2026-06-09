/* Hand-crafted cinematic workflow lessons — overrides generated content */
window.FX_SCHOOL_FLOWS = (function () {
  function opt(k, label) {
    return (
      '<button class="sc-opt" data-opt><span class="sc-opt__key">' +
      k +
      '</span><span>' +
      label +
      '</span><span class="sc-opt__mark"><i data-lucide="check-circle-2"></i></span></button>'
    );
  }
  function cover(phase, order, title, desc, min, xp, scenes, icon) {
    return (
      '<div class="sc-scene__inner">' +
      '<div class="sc-cover__badge sc-anim"><i data-lucide="' +
      icon +
      '"></i></div>' +
      '<div class="sc-scene__eyebrow sc-anim d1">' +
      phase +
      ' · Lesson ' +
      order +
      '</div>' +
      '<h2 class="sc-anim d1">' +
      title +
      '</h2>' +
      '<p class="sc-lead sc-anim d2" style="margin-left:auto;margin-right:auto;text-align:center">' +
      desc +
      '</p>' +
      '<div class="sc-cover__meta sc-anim d3">' +
      '<span class="fx-pill fx-pill--coral"><i data-lucide="clock" style="width:12px;height:12px"></i>' +
      min +
      ' min</span>' +
      '<span class="fx-pill"><i data-lucide="zap" style="width:12px;height:12px"></i>+' +
      xp +
      ' XP</span>' +
      '<span class="fx-pill">' +
      scenes +
      ' scenes</span>' +
      '</div></div>' +
      '<div class="sc-scrollhint"><span>Scroll to begin</span><i data-lucide="chevrons-down"></i></div>'
    );
  }
  function read(num, eyebrow, title, body) {
    return (
      '<div class="sc-scene__inner">' +
      '<div class="sc-scene__num sc-anim">' +
      num +
      '</div>' +
      '<div class="sc-scene__eyebrow sc-anim">' +
      eyebrow +
      '</div>' +
      '<h2 class="sc-anim d1">' +
      title +
      '</h2>' +
      body +
      '</div>'
    );
  }
  function check(q, opts, correct, fb) {
    return (
      '<div class="sc-check sc-check--light">' +
      '<div class="sc-check__k"><i data-lucide="help-circle"></i>Checkpoint</div>' +
      '<div class="sc-check__q">' +
      q +
      '</div>' +
      '<div class="sc-check__opts">' +
      opts +
      '</div>' +
      '<div class="sc-check__fb">' +
      fb +
      '</div></div>'
    );
  }

  var flowJob = {
    id: 'zendesk-flow-job',
    phaseId: 'zendesk',
    title: 'Workflow — Create Job',
    phase: 'Phase 1 · Zendesk Complete',
    xp: 80,
    scenes: [
      {
        type: 'cover',
        xp: 0,
        html: cover(
          'Phase 1 · Zendesk Complete',
          6,
          'Workflow — Create Job',
          'Fill every required field, apply Move to Job, click Submit — then verify the job in Fixfy OS.',
          14,
          80,
          8,
          'briefcase'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '01',
          'Before the macro',
          'Required Job form fields',
          '<p class="sc-lead sc-anim d2">Every field marked <b>*</b> must be filled before you apply <span class="fx-mono">Job :: Move to Job</span>. Empty fields = macro rolls back.</p>' +
            '<div class="sc-content sc-anim d3"><ul><li>Client Name, Email, Phone</li><li>Address + UK postcode</li><li>Type of Work, Job Date, Arrival Time</li><li>Rate Type: Hourly or Fixed (+ Client Price if Fixed)</li><li>Scope (detailed)</li><li>Auto-Assign: True or False</li></ul></div>'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '02',
          'The decisive step',
          'Macro + Submit',
          '<p class="sc-lead sc-anim d2">Selecting the macro only <b>proposes</b> changes. Nothing syncs until you click <span class="fx-mono">Submit</span>.</p>' +
            '<div class="sc-callout sc-anim d3"><div class="sc-callout__k">Sequence</div><div class="sc-callout__t">1. Confirm Form = Job → 2. Apply macro → 3. Submit → 4. Webhook fires → 5. OS creates job</div></div>'
        ),
      },
      {
        type: 'check',
        xp: 15,
        dark: true,
        correct: 1,
        html: check(
          'Auto-Assign is True but no partner matches trade/postcode/slot. What status appears in the OS?',
          opt('A', 'Schedule — partner auto-confirmed') + opt('B', 'Unassigned — assign manually or fix data') + opt('C', 'Completed'),
          1,
          '<b>Correct.</b> No match = <span class="fx-mono">Unassigned</span>. Fix postcode or trade on the ticket, or assign a partner manually in OS.'
        ),
      },
      {
        type: 'read',
        xp: 10,
        dark: true,
        html: read(
          '03',
          'After Submit',
          'What you see in Fixfy OS',
          '<div class="sc-content sc-anim d2"><table class="sc-table"><thead><tr><th>OS field</th><th>What to check</th></tr></thead><tbody>' +
            '<tr><td>Job ID on ticket</td><td>Custom field links to <span class="fx-mono">/jobs/{id}</span></td></tr>' +
            '<tr><td>Status</td><td>Auto Assigning, Unassigned, or Schedule after partner accepts</td></tr>' +
            '<tr><td>Scope &amp; address</td><td>Must mirror ticket exactly</td></tr></tbody></table></div>'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '04',
          'Ticket routing',
          'Leaves Action Required',
          '<p class="sc-lead sc-anim d2">Successful job creation moves the ticket to the <b>Operations</b> track. Monitor in Customer Support :: Jobs view.</p>'
        ),
      },
    ],
  };

  var flowQuote = {
    id: 'zendesk-flow-quote',
    phaseId: 'zendesk',
    title: 'Workflow — Create Quote',
    phase: 'Phase 1 · Zendesk Complete',
    xp: 70,
    scenes: [
      {
        type: 'cover',
        xp: 0,
        html: cover(
          'Phase 1 · Zendesk Complete',
          7,
          'Workflow — Create Quote',
          'Bid vs Manual, side conversations, bidding SLA and customer proposal on the same ticket.',
          12,
          70,
          7,
          'file-text'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '01',
          'Choose mode',
          'Bid vs Manual',
          '<p class="sc-lead sc-anim d2"><b>Bid</b> — you need partner prices. <b>Manual</b> — you already know the price (e.g. standard GSC £80).</p>'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '02',
          'Bid workflow',
          'Partners, SLA &amp; side conversations',
          '<div class="sc-content sc-anim d2"><ul><li>OS creates quote in <b>Bidding</b> — auto-invites Active partners</li><li>Monitor Customer Support :: Quoting view</li><li>Chase bids via <b>Side conversation</b> (partner email, invisible to customer)</li><li>Compare margin in OS before customer send</li></ul></div>'
        ),
      },
      {
        type: 'check',
        xp: 15,
        dark: true,
        correct: 2,
        html: check(
          'Customer proposal for a Bid quote should be sent:',
          opt('A', 'On a new ticket thread') + opt('B', 'Only by phone') + opt('C', 'Public Reply on the same Zendesk ticket'),
          2,
          '<b>Correct.</b> Same ticket, full history. Customer sees one thread from enquiry to proposal.'
        ),
      },
      {
        type: 'read',
        xp: 10,
        dark: true,
        html: read(
          '03',
          'OS mirror',
          'Quote status in Fixfy OS',
          '<div class="sc-content sc-anim d2"><table class="sc-table"><thead><tr><th>Mode</th><th>OS status</th></tr></thead><tbody>' +
            '<tr><td>Bid</td><td>Bidding — watch invites and incoming bids</td></tr>' +
            '<tr><td>Manual</td><td>Fixed price ready — send to customer when approved</td></tr></tbody></table></div>'
        ),
      },
    ],
  };

  var flowComplaint = {
    id: 'zendesk-flow-complaint',
    phaseId: 'zendesk',
    title: 'Workflow — Complaint & On Hold',
    phase: 'Phase 1 · Zendesk Complete',
    xp: 70,
    scenes: [
      {
        type: 'cover',
        xp: 0,
        html: cover(
          'Phase 1 · Zendesk Complete',
          8,
          'Workflow — Complaint &amp; On Hold',
          'When to open, 24h SLA, 14 On Hold reasons and keeping OS in sync.',
          12,
          70,
          7,
          'alert-triangle'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '01',
          'When / when not',
          'Complaint vs status update',
          '<div class="sc-content sc-anim d2"><p><b>Use Complaint:</b> quality issue, no-show, incorrect billing.</p><p><b>Do NOT:</b> simple status ask (reply in Job form) or rebook request (use Job).</p></div>'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '02',
          'Steps',
          '24h SLA workflow',
          '<div class="sc-content sc-anim d2"><ol><li>Read complaint twice</li><li>Public Reply: received, investigating, back within 24h</li><li>Apply <span class="fx-mono">Move to Complaint</span> + Submit</li><li>Pick On Hold reason (1 of 14) + description</li></ol></div>'
        ),
      },
      {
        type: 'check',
        xp: 15,
        dark: true,
        correct: 0,
        html: check(
          'Ticket in Complaint status. Linked job in OS should be:',
          opt('A', 'Complaint or On Hold — not Completed') + opt('B', 'Completed immediately') + opt('C', 'Unassigned'),
          0,
          '<b>Correct.</b> Never mark job Completed while complaint is open. Sync reason and notes in both systems.'
        ),
      },
      {
        type: 'read',
        xp: 10,
        dark: true,
        html: read(
          '03',
          'On Hold reasons',
          'Pick exactly one of 14',
          '<p class="sc-lead sc-anim d2">Parts on order, access issue, awaiting customer, emergency, etc. — same reason on OS job with next action date.</p>'
        ),
      },
    ],
  };

  var flowFinance = {
    id: 'zendesk-flow-finance',
    phaseId: 'zendesk',
    title: 'Workflow — Finance, Cancel & Partner',
    phase: 'Phase 1 · Zendesk Complete',
    xp: 60,
    scenes: [
      {
        type: 'cover',
        xp: 0,
        html: cover(
          'Phase 1 · Zendesk Complete',
          9,
          'Workflow — Finance, Cancel &amp; Partner',
          'Finance routing, cancellation reasons, Partner Support view and Solved gates.',
          10,
          60,
          6,
          'wallet'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '01',
          'Finance',
          'Move to Finance macro',
          '<p class="sc-lead sc-anim d2">Refunds, disputes, duplicate charges → <span class="fx-mono">Move to Finance</span> + Submit. Auto-routes to Finance operator. Check job billing panel in OS.</p>'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '02',
          'Cancel',
          '7 required reasons',
          '<p class="sc-lead sc-anim d2">After <span class="fx-mono">Mark as Cancelled</span> + Submit, pick ONE cancellation reason. If Other, add notes. OS job → Cancelled.</p>'
        ),
      },
      {
        type: 'read',
        xp: 10,
        html: read(
          '03',
          'Partner Support',
          'Partner Support :: Inquiries',
          '<p class="sc-lead sc-anim d2">Onboarding, documents, app issues, payout disputes. Check partner compliance in OS. Escalate money matters to Finance.</p>'
        ),
      },
      {
        type: 'check',
        xp: 15,
        dark: true,
        correct: 1,
        html: check(
          'Before Mark as Solved, confirm:',
          opt('A', 'Partner still on site') + opt('B', 'No pending customer issues, partner finished, customer informed'),
          1,
          '<b>Correct.</b> Solved closes the loop — only when everything is truly resolved.'
        ),
      },
    ],
  };

  var osLifecycle = {
    id: 'fixfy-os-jobs',
    phaseId: 'fixfy-os',
    title: 'Jobs',
    phase: 'Phase 2 · Fixfy Operating System',
    xp: 100,
    scenes: [
      {
        type: 'cover',
        xp: 0,
        html: cover(
          'Phase 2 · Fixfy Operating System',
          7,
          'Jobs — lifecycle gates',
          'Unassigned → Schedule → In Progress → Final Checks → Awaiting Payment → Completed. Know what blocks each step.',
          18,
          100,
          8,
          'hard-hat'
        ),
      },
      {
        type: 'read',
        xp: 12,
        html: read(
          '01',
          'Stage gates',
          'What MUST be done',
          '<div class="sc-content sc-anim d2"><table class="sc-table"><thead><tr><th>Stage</th><th>Gate</th></tr></thead><tbody>' +
            '<tr><td>Unassigned</td><td>Address, schedule window, partner OR auto-assign</td></tr>' +
            '<tr><td>Schedule</td><td>Partner confirmed, date/time locked</td></tr>' +
            '<tr><td>Final Checks</td><td>Reports uploaded, extras approved</td></tr>' +
            '<tr><td>Awaiting Payment</td><td>Invoice sent / payment recorded</td></tr></tbody></table></div>'
        ),
      },
      {
        type: 'read',
        xp: 12,
        html: read(
          '02',
          'Zendesk link',
          'Complaint = job hold',
          '<p class="sc-lead sc-anim d2">Zendesk Complaint or On Hold → same status/reason on OS job. Document investigation in both places.</p>'
        ),
      },
      {
        type: 'check',
        xp: 15,
        dark: true,
        correct: 2,
        html: check(
          'Can you mark a job Completed while Zendesk ticket is in open Complaint?',
          opt('A', 'Yes, if partner finished') + opt('B', 'Yes, after 24h') + opt('C', 'No — resolve complaint first'),
          2,
          '<b>Correct.</b> Billing and customer satisfaction must align across Zendesk and OS.'
        ),
      },
      {
        type: 'read',
        xp: 12,
        html: read(
          '03',
          'Billing panel',
          'Client invoice vs partner self-bill',
          '<p class="sc-lead sc-anim d2">Client Invoice (emerald) vs Partner Self-Bill (rose). Request payment only when amount due. Hide self-bill send when not applicable.</p>'
        ),
      },
    ],
  };

  return {
    'zendesk-flow-job': flowJob,
    'zendesk-flow-quote': flowQuote,
    'zendesk-flow-complaint': flowComplaint,
    'zendesk-flow-finance': flowFinance,
    'fixfy-os-jobs': osLifecycle,
  };
})();
