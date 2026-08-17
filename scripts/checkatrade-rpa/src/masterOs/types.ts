export type CreateJobPayload = {
  account_id: string;
  date: string;
  arrival_time: string;
  client_name: string;
  property_address: string;
  /** Specific Checkatrade job title (e.g. "Large Window Reseal (Gen-250)") — display only, separate from service_type which drives partner matching. */
  title?: string;
  service_type: string;
  postcode?: string;
  client_email?: string;
  client_phone?: string;
  description?: string;
  client_price?: number;
  /**
   * false → the job lands as `unassigned` and waits for the office to take
   * action. true would dispatch push + Zendesk invites to matched partners at
   * insert time, which we deliberately don't want for Checkatrade jobs.
   */
  auto_assign: boolean;
  report_link?: string;
  /** Master OS opens + links a fresh Zendesk ticket itself at insert time — the RPA never touches Zendesk. */
  create_zendesk_ticket?: true;
  /** Parking, booked duration and exact earnings: no dedicated column yet. */
  internal_notes?: string;
};

export type CreateLeadPayload = {
  /** Checkatrade's own id, stamped into the contact's notes so coverage is provable. */
  external_id?: string;
  name: string;
  address: string;
  email?: string;
  phone?: string;
  city?: string;
  postcode?: string;
  scope?: string;
  service_type: string;
};

export type MasterOsCreateResponse = {
  id: string;
  reference: string;
  status: string;
  /** Present when create_zendesk_ticket was sent and the OS opened one. */
  zendesk_ticket_id?: number;
};
