import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPartnerCoverageSummary } from "@/lib/partner-coverage";
import { defaultLondonIncludedPostcodes } from "@/lib/coverage-cities";

describe("formatPartnerCoverageSummary", () => {
  it("shows London + districts for legacy postcode rows without coverage_cities", () => {
    const postcodes = defaultLondonIncludedPostcodes();
    const summary = formatPartnerCoverageSummary({
      coverage_mode: "postcodes",
      included_postcodes: postcodes,
      coverage_cities: null,
      location: "London Safety Certificate",
      service_radius_miles: null,
      coverage_latitude: null,
      coverage_longitude: null,
      coverage_base_postcode: null,
      excluded_postcodes: null,
      uk_coverage_regions: null,
    });

    assert.match(summary, /^London · \d+ districts$/);
    assert.notEqual(summary, `${postcodes.length} postcode districts`);
  });
});
