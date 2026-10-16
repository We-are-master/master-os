import assert from "node:assert/strict";
import test from "node:test";
import { mergeNewNavItems } from "./nav-merge";
import type { NavGroup } from "./constants";

const canonical: NavGroup[] = [{ label: "Overview", items: [
  { label: "Overview", href: "/", icon: "grid-2x2", permission: "dashboard" },
  { label: "Live operations", href: "/schedule", icon: "calendar", permission: "jobs" },
]}];

test("updates legacy saved labels without mutating stored navigation", () => {
  const stored: NavGroup[] = [{ label: "Overview", items: [
    { label: "Pulse", href: "/", icon: "grid-2x2" },
    { label: "Live view", href: "/schedule", icon: "calendar" },
  ] }];
  const result = mergeNewNavItems(stored, canonical);
  assert.deepEqual(result[0].items.map((i) => i.label), ["Overview", "Live operations"]);
  assert.equal(stored[0].items[0].label, "Pulse");
  assert.equal(result[0].items[1].permission, "jobs");
});

test("preserves custom names, existing permissions and custom destinations", () => {
  const stored: NavGroup[] = [{ label: "Overview", items: [
    { label: "My dashboard", href: "/", icon: "grid-2x2", permission: "custom" },
    { label: "Pulse", href: "/custom", icon: "calendar" },
  ] }];
  const result = mergeNewNavItems(stored, canonical);
  assert.equal(result[0].items[0].label, "My dashboard");
  assert.equal(result[0].items[0].permission, "custom");
  assert.equal(result[0].items.find((i) => i.href === "/custom")?.label, "Pulse");
});

test("normalisation is idempotent and does not duplicate items", () => {
  const stored: NavGroup[] = [{ label: "Overview", items: [{ label: "Pulse", href: "/", icon: "grid-2x2" }] }];
  const once = mergeNewNavItems(stored, canonical);
  assert.deepEqual(mergeNewNavItems(once, canonical), once);
  assert.equal(new Set(once[0].items.map((i) => i.href)).size, 2);
});

test("retains the permission keys consumed by the role filter", () => {
  const result = mergeNewNavItems([{ label: "Overview", items: [{ label: "Pulse", href: "/", icon: "grid-2x2" }] }], canonical);
  const allowed = result.flatMap((g) => g.items).filter((i) => i.permission === "dashboard");
  assert.deepEqual(allowed.map((i) => i.href), ["/"]);
});
