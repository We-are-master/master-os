import type { NavGroup, NavItem } from "@/lib/constants";

function markItemHrefsDeep(item: NavItem, sink: Set<string>) {
  sink.add(item.href);
  item.children?.forEach((c) => markItemHrefsDeep(c, sink));
}

/**
 * Merge new items from the canonical NAVIGATION into a nav list loaded from
 * the DB (including nested `children`), so freshly shipped pages appear even
 * when the stored nav predates them.
 *
 * IMPORTANT: merge runs BEFORE permission filtering (see use-admin-config).
 * Running it after the filter used to re-inject every item the filter had
 * removed, which silently disabled per-role/per-user visibility.
 */
export function mergeNewNavItems(
  stored: NavGroup[],
  canonical: NavGroup[],
): NavGroup[] {
  const storedHrefs = new Set<string>();
  stored.forEach((g) => g.items.forEach((i) => markItemHrefsDeep(i, storedHrefs)));

  const result = stored.map((g) => ({
    ...g,
    items: g.items.map((item) => ({
      ...item,
      children: item.children?.length ? item.children.map((c) => ({ ...c })) : undefined,
    })),
  }));

  const findGroup = (label: string) => result.find((g) => g.label === label);

  for (const cGroup of canonical) {
    let match = findGroup(cGroup.label);
    if (!match) {
      match = { label: cGroup.label, items: [] };
      result.push(match);
    }
    for (const cItem of cGroup.items) {
      const local = match!.items.find((i) => i.href === cItem.href);
      if (!local) {
        match!.items.push({
          ...cItem,
          children: cItem.children?.map((ch) => ({ ...ch })),
        });
        markItemHrefsDeep(cItem, storedHrefs);
        continue;
      }

      storedHrefs.add(cItem.href);
      // Stored navs saved before a permission key was added to the canonical
      // item won't carry it — backfill so the filter can act on them.
      if (!local.permission && cItem.permission) local.permission = cItem.permission;
      if (cItem.children?.length) {
        const kids = [...(local.children ?? [])];
        for (const ch of cItem.children) {
          if (!kids.some((k) => k.href === ch.href)) kids.push({ ...ch });
          storedHrefs.add(ch.href);
        }
        local.children = kids.length > 0 ? kids : undefined;
      }
    }
  }

  const order = new Map(canonical.map((g, i) => [g.label, i]));
  result.sort((a, b) => (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999));
  return result;
}
