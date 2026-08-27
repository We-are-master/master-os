// Gera o HTML real do email de reschedule do parceiro, com dados de exemplo.
import { writeFileSync } from "node:fs";
import("../../src/lib/emails/partner-job-confirmation").then(({ buildJobRescheduledEmail }) => {
  const email = buildJobRescheduledEmail({
    recipientFirstName: "Victor",
    jobReference: "JOB-9523",
    jobTitle: "Asbestos Management Survey",
    propertyAddress: "128 City Road, London EC1V 2NX",
    oldDateLine: "Wed, 26 Aug · Arrival time 9:00 AM – 12:00 PM",
    newDateLine: "Thu, 27 Aug · Arrival time 1:00 PM – 4:00 PM",
  });
  const out = "/private/tmp/claude-501/-Users-victorsouza-master-os/b7112ea9-d321-4dab-879d-e048bc955190/scratchpad/email-reschedule-partner.html";
  writeFileSync(out, email.html);
  console.log("subject:", email.subject);
  console.log("html salvo em", out);
});
