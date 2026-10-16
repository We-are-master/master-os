import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvToCrmRows, parseCsv } from "./crm-csv";

describe("parseCsv", () => {
  it("lê aspas, vírgula e quebra de linha dentro de aspas", () => {
    const t = 'a,b\n"x, y","linha 1\nlinha 2"\r\n"diz ""oi""",z\n';
    assert.deepEqual(parseCsv(t), [["a", "b"], ["x, y", "linha 1\nlinha 2"], ['diz "oi"', "z"]]);
  });
  it("ignora BOM e linhas vazias", () => {
    assert.deepEqual(parseCsv("﻿a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
  });
});

describe("csvToCrmRows", () => {
  it("acha as colunas da lista de moradia estudantil e manda o resto para as notas", () => {
    const csv = [
      "operator,london_properties_or_beds,example_buildings,supplier_route_url,contact_route",
      'Unite Students,"32 properties, 13,500+ rooms",Stratford One,https://www.unitegroup.com/suppliers,procurement mailbox',
    ].join("\n");
    const { rows } = csvToCrmRows(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_name, "Unite Students");
    assert.equal(rows[0].website, null);
    assert.match(rows[0].notes ?? "", /london_properties_or_beds: 32 properties, 13,500\+ rooms/);
    assert.match(rows[0].notes ?? "", /supplier_route_url: https:\/\/www\.unitegroup\.com\/suppliers/);
  });
  it("lê e-mail, telefone, site, segmento e valor", () => {
    const csv = 'Company,Email,Phone,Website,Sector,Monthly value\nAcme Lettings,ops@acme.co.uk,020 1234,acme.co.uk,Letting agent,"£1,200"\n';
    const { rows } = csvToCrmRows(csv);
    assert.deepEqual(rows[0], {
      company_name: "Acme Lettings",
      contact_name: null,
      contact_email: "ops@acme.co.uk",
      contact_phone: "020 1234",
      website: "acme.co.uk",
      segment: "Letting agent",
      monthly_value: 1200,
      notes: null,
    });
  });
  it("pula linha sem nome de empresa", () => {
    const { rows } = csvToCrmRows("company,email\n,a@b.com\nX Ltd,\n");
    assert.deepEqual(rows.map((r) => r.company_name), ["X Ltd"]);
  });
});
