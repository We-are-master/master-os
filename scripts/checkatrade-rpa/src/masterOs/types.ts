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
  auto_assign: true;
  report_link?: string;
};

export type CreateLeadPayload = {
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
};
