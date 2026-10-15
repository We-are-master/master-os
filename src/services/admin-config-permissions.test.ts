import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERMISSIONS,
  resolveEffectivePermissions,
  resolvePermission,
} from "./admin-config";
import { PERMISSION_KEYS, sanitizePermissionOverrides } from "@/types/admin-config";

test("finance_overview: só admin nasce com ele", () => {
  assert.equal(DEFAULT_PERMISSIONS.admin.finance_overview, true);
  assert.equal(DEFAULT_PERMISSIONS.manager.finance_overview, false);
  // Conta de parceiro também é operator: nunca pode nascer ligado.
  assert.equal(DEFAULT_PERMISSIONS.operator.finance_overview, false);
  assert.ok(PERMISSION_KEYS.includes("finance_overview"));
});

test("toda chave tem padrão nos três papéis", () => {
  for (const role of ["admin", "manager", "operator"] as const) {
    for (const key of PERMISSION_KEYS) {
      assert.equal(typeof DEFAULT_PERMISSIONS[role][key], "boolean", `${role}.${key}`);
    }
  }
});

test("operator com finance mas sem finance_overview (caso do Leo)", () => {
  const overrides = { finance: true, finance_overview: false };
  const perms = DEFAULT_PERMISSIONS.operator;
  assert.equal(resolvePermission("finance", "operator", perms, overrides), true);
  assert.equal(resolvePermission("finance_overview", "operator", perms, overrides), false);
  // Sem override explícito herda o padrão do papel (false).
  assert.equal(resolvePermission("finance_overview", "operator", perms, { finance: true }), false);
});

test("override true libera para operator e manager; admin passa sempre", () => {
  assert.equal(
    resolvePermission("finance_overview", "operator", DEFAULT_PERMISSIONS.operator, { finance_overview: true }),
    true,
  );
  assert.equal(
    resolvePermission("finance_overview", "manager", DEFAULT_PERMISSIONS.manager, { finance_overview: true }),
    true,
  );
  assert.equal(
    resolvePermission("finance_overview", "admin", DEFAULT_PERMISSIONS.admin, { finance_overview: false }),
    true,
  );
  const eff = resolveEffectivePermissions("operator", DEFAULT_PERMISSIONS.operator, { finance: true });
  assert.equal(eff.finance, true);
  assert.equal(eff.finance_overview, false);
});

test("sanitizePermissionOverrides aceita finance_overview", () => {
  assert.deepEqual(sanitizePermissionOverrides({ finance: true, finance_overview: false, lixo: 1 }), {
    finance: true,
    finance_overview: false,
  });
});
