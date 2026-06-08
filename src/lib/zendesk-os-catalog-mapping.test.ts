import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalogIdFromZendeskOptionValue,
  fromZendeskBandTag,
  fromZendeskServiceTag,
  getBandFieldForService,
  toZendeskBandTag,
  toZendeskServiceTag,
  ZENDESK_FIELD_IDS,
} from "./zendesk-os-catalog-mapping";

const EICR_ID = "e0cbd852-c10c-4aac-b52c-dfd274b65848";
const BAND_ID = "e6597dbc-9f10-4b9f-827c-51f939410ddd";

describe("zendesk service tags", () => {
  it("adds os_ prefix", () => {
    assert.equal(toZendeskServiceTag(EICR_ID), `os_${EICR_ID}`);
  });
  it("strips os_ prefix", () => {
    assert.equal(fromZendeskServiceTag(`os_${EICR_ID}`), EICR_ID);
  });
  it("accepts legacy bare uuid in catalogIdFromZendeskOptionValue", () => {
    assert.equal(catalogIdFromZendeskOptionValue(EICR_ID), EICR_ID);
    assert.equal(catalogIdFromZendeskOptionValue(`os_${EICR_ID}`), EICR_ID);
  });
});

describe("zendesk band tags", () => {
  it("round-trips band_ prefix", () => {
    assert.equal(toZendeskBandTag(BAND_ID), `band_${BAND_ID}`);
    assert.equal(fromZendeskBandTag(`band_${BAND_ID}`), BAND_ID);
  });
});

describe("band field mapping", () => {
  it("maps EICR and FAC", () => {
    assert.equal(getBandFieldForService(EICR_ID), ZENDESK_FIELD_IDS.EICR_BAND);
    assert.equal(
      getBandFieldForService("ea6d7f17-1a9b-44ea-87d8-0e9ebf857431"),
      ZENDESK_FIELD_IDS.FAC_BAND,
    );
  });
  it("returns null for services without bands", () => {
    assert.equal(getBandFieldForService("f31ba2ac-fd22-4961-9081-98e64e4b5c95"), null);
  });
});
