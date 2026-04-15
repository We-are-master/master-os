"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";
import {
  UkAddressReviewFields,
  addressPartsToFormState,
  formStateToAddressParts,
  type UkAddressFormState,
} from "@/components/ui/uk-address-review-fields";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserPlus, MapPin, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { Client, ClientAddress } from "@/types/database";
import { listClients, createClient, getClient } from "@/services/clients";
import { listAddressesByClient, createClientAddress } from "@/services/client-addresses";
import { listClientSourceAccounts, createClientSourceAccount } from "@/services/client-source-accounts";
import type { ClientSourceAccount } from "@/types/database";
import { CREATE_LINKED_ACCOUNT_OPTION } from "@/lib/client-linked-account";
import { cn, isUuid } from "@/lib/utils";
import {
  findDuplicateAccountHints,
  findDuplicateClients,
  formatAccountDuplicateLines,
  formatClientDuplicateLines,
} from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";

export interface ClientAndAddressValue {
  client_id?: string;
  client_address_id?: string;
  client_name: string;
  client_email?: string;
  property_address: string;
}

/** Minimal client row when getClient fails (e.g. RLS) but parent still has client_id */
function clientPlaceholderFromValue(v: ClientAndAddressValue): Client {
  return {
    id: v.client_id!,
    full_name: v.client_name || "Client",
    email: v.client_email,
    client_type: "residential",
    source: "direct",
    status: "active",
    total_spent: 0,
    jobs_count: 0,
    tags: [],
    created_at: "",
    updated_at: "",
  };
}

interface ClientAddressPickerProps {
  value: ClientAndAddressValue;
  onChange: (value: ClientAndAddressValue) => void;
  labelClient?: string;
  labelAddress?: string;
  required?: boolean;
  /** Prefill client search when value has client_name */
  className?: string;
  /** When true and `value.client_id` is set, client cannot be changed (only property address). */
  lockClient?: boolean;
  /** When true, opening the client dropdown with an empty search loads the first page of all clients (browse). */
  loadAllClientsOnOpen?: boolean;
  /**
   * Job detail: show only this job’s current property address (one card). Use “Choose another address”
   * to open the full client address list + add new. Create flows should leave this off.
   */
  jobCurrentAddressOnly?: boolean;
  /** Optional classes merged onto the client name search input. */
  clientNameInputClassName?: string;
}

export function ClientAddressPicker({
  value,
  onChange,
  labelClient = "Client *",
  labelAddress = "Property address *",
  required = true,
  className = "",
  lockClient = false,
  loadAllClientsOnOpen = false,
  jobCurrentAddressOnly = false,
  clientNameInputClassName,
}: ClientAddressPickerProps) {
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const clientSectionLocked = lockClient && !!value.client_id;
  const valueRef = useRef(value);
  valueRef.current = value;

  const emit = useCallback(
    (patch: Partial<ClientAndAddressValue>) => {
      onChange({ ...valueRef.current, ...patch });
    },
    [onChange]
  );

  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [addresses, setAddresses] = useState<ClientAddress[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addingNewAddress, setAddingNewAddress] = useState(false);
  const [newAddressRaw, setNewAddressRaw] = useState("");
  /** After Mapbox pick: user confirms flat / street / city / PC before `createClientAddress`. */
  const [newAddressPending, setNewAddressPending] = useState<{ parts: AddressParts; form: UkAddressFormState } | null>(null);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createClientForm, setCreateClientForm] = useState({ full_name: "", email: "", phone: "", source_account_id: "" });
  const [newSourceForm, setNewSourceForm] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    industry: "Residential Services",
    payment_terms: "Net 30",
  });
  const [createAddressPending, setCreateAddressPending] = useState<{ parts: AddressParts; form: UkAddressFormState } | null>(null);
  const [createClientAddressRaw, setCreateClientAddressRaw] = useState("");
  const [sourceAccounts, setSourceAccounts] = useState<ClientSourceAccount[]>([]);
  const [creating, setCreating] = useState(false);
  const clientSearchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Synchronous “who is selected” for the same event-loop tick as selectClient → selectAddress (React state lags). */
  const selectedClientRef = useRef<Client | null>(null);
  /** Job card: collapsed = single address; expanded = full list (same client). */
  const [jobAddressListExpanded, setJobAddressListExpanded] = useState(false);

  useEffect(() => {
    if (jobCurrentAddressOnly) setJobAddressListExpanded(false);
  }, [value.client_id, jobCurrentAddressOnly]);

  useEffect(() => {
    if (!createClientOpen) return;
    listClientSourceAccounts().then(setSourceAccounts).catch(() => setSourceAccounts([]));
  }, [createClientOpen]);

  const loadClientResults = useCallback(
    async (search: string) => {
      if (!search.trim()) {
        if (loadAllClientsOnOpen) return;
        setClientResults([]);
        return;
      }
      setClientLoading(true);
      try {
        const res = await listClients({ search: search.trim(), pageSize: 15 });
        setClientResults(res.data ?? []);
      } catch {
        setClientResults([]);
      } finally {
        setClientLoading(false);
      }
    },
    [loadAllClientsOnOpen]
  );

  useEffect(() => {
    if (!loadAllClientsOnOpen || !clientDropdownOpen || selectedClient || clientSearch.trim()) return;
    let cancelled = false;
    setClientLoading(true);
    listClients({ page: 1, pageSize: 200 })
      .then((res) => {
        if (!cancelled) setClientResults(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setClientResults([]);
      })
      .finally(() => {
        if (!cancelled) setClientLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAllClientsOnOpen, clientDropdownOpen, selectedClient, clientSearch]);

  useEffect(() => {
    if (clientSearchDebounce.current) clearTimeout(clientSearchDebounce.current);
    clientSearchDebounce.current = setTimeout(() => loadClientResults(clientSearch), 300);
    return () => { if (clientSearchDebounce.current) clearTimeout(clientSearchDebounce.current); };
  }, [clientSearch, loadClientResults]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current?.contains(e.target as Node)) return;
      setClientDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectClient = useCallback(
    (client: Client) => {
      selectedClientRef.current = client;
      setSelectedClient(client);
      setClientSearch(client.full_name);
      setClientDropdownOpen(false);
      setClientResults([]);
      const keepAddr = valueRef.current.property_address || "";
      onChange({
        client_id: client.id,
        client_address_id: undefined,
        client_name: client.full_name,
        client_email: client.email ?? undefined,
        property_address: keepAddr,
      });
    },
    [onChange]
  );

  useEffect(() => {
    selectedClientRef.current = selectedClient;
  }, [selectedClient]);

  useEffect(() => {
    if (!value.client_id) {
      selectedClientRef.current = null;
      setSelectedClient(null);
      setAddresses([]);
      if (value.client_name) {
        setClientSearch(value.client_name);
        setClientDropdownOpen(true);
        loadClientResults(value.client_name);
      }
      return;
    }
    const requestedId = value.client_id;
    getClient(requestedId)
      .then((c) => {
        const v = valueRef.current;
        if (v.client_id !== requestedId) return;
        if (c) {
          setSelectedClient(c);
          setClientSearch(c.full_name);
        } else {
          setSelectedClient(clientPlaceholderFromValue(v));
          setClientSearch(v.client_name || "");
        }
      })
      .catch(() => {
        const v = valueRef.current;
        if (v.client_id !== requestedId) return;
        setSelectedClient(clientPlaceholderFromValue(v));
        setClientSearch(v.client_name || "");
      });
  }, [value.client_id, value.client_name, loadClientResults]);

  /** Load addresses as soon as we have a linked client id (not only when `selectedClient` is hydrated). */
  const clientIdForAddresses = value.client_id ?? selectedClient?.id ?? null;

  useEffect(() => {
    if (!clientIdForAddresses) {
      setAddresses([]);
      return;
    }
    setAddressLoading(true);
    listAddressesByClient(clientIdForAddresses)
      .then(setAddresses)
      .catch(() => setAddresses([]))
      .finally(() => setAddressLoading(false));
  }, [clientIdForAddresses]);

  useEffect(() => {
    if (selectedClient && !addressLoading && addresses.length === 0 && value.property_address?.trim()) {
      setAddingNewAddress(true);
      setNewAddressRaw(value.property_address.trim());
    }
  }, [selectedClient, addressLoading, addresses.length, value.property_address]);

  /** When the client has no saved addresses, open the new-address field so the user always sees where to type (modals, create flows). */
  const autoOpenedNewAddressForClientRef = useRef<string | null>(null);
  useEffect(() => {
    if (!value.client_id || !selectedClient) {
      if (!value.client_id) autoOpenedNewAddressForClientRef.current = null;
      return;
    }
    if (addressLoading) return;
    if (addresses.length > 0) {
      autoOpenedNewAddressForClientRef.current = null;
      return;
    }
    if (addingNewAddress) return;
    if (autoOpenedNewAddressForClientRef.current === value.client_id) return;
    autoOpenedNewAddressForClientRef.current = value.client_id;
    setAddingNewAddress(true);
  }, [value.client_id, selectedClient, addressLoading, addresses.length, addingNewAddress]);

  const selectAddress = useCallback(
    (addr: ClientAddress) => {
      const full = [addr.address, addr.city, addr.postcode].filter(Boolean).join(", ");
      const c = selectedClientRef.current;
      const base = valueRef.current;
      onChange({
        ...base,
        client_id: c?.id ?? base.client_id,
        client_name: c?.full_name ?? base.client_name ?? "",
        client_email: c?.email !== undefined && c?.email !== null ? c.email : base.client_email,
        client_address_id: addr.id,
        property_address: full || addr.address,
      });
      setAddingNewAddress(false);
      setNewAddressRaw("");
      if (jobCurrentAddressOnly) setJobAddressListExpanded(false);
    },
    [onChange, jobCurrentAddressOnly]
  );

  const handleNewAddressSelect = useCallback(
    async (parts: AddressParts) => {
      const cid = selectedClient?.id ?? valueRef.current.client_id;
      if (!cid) return;
      setCreating(true);
      try {
        const full = parts.full_address;
        const addr = await createClientAddress({
          client_id: cid,
          address: parts.address || full,
          city: parts.city,
          postcode: parts.postcode,
          country: parts.country || "gb",
          is_default: addresses.length === 0,
        });
        setAddresses((prev) => [...prev, addr]);
        selectAddress(addr);
        toast.success("Address added");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add address");
      } finally {
        setCreating(false);
      }
    },
    [selectedClient, addresses.length, selectAddress]
  );

  const showAddressSection = !!value.client_id || !!selectedClient;

  const currentPropertyDisplayLine = (() => {
    const raw = value.property_address?.trim();
    if (value.client_address_id && addresses.length) {
      const a = addresses.find((x) => x.id === value.client_address_id);
      if (a) return [a.address, a.city, a.postcode].filter(Boolean).join(", ");
    }
    if (raw && addresses.length) {
      const byLine = addresses.find(
        (a) => [a.address, a.city, a.postcode].filter(Boolean).join(", ") === raw,
      );
      if (byLine) return raw;
    }
    return raw || "";
  })();

  const showJobAddressCollapsed =
    jobCurrentAddressOnly &&
    !jobAddressListExpanded &&
    !addingNewAddress &&
    !!selectedClient &&
    !addressLoading &&
    addresses.length > 0 &&
    Boolean(currentPropertyDisplayLine.trim());

  const handleCreateClient = useCallback(async () => {
    if (!createClientForm.full_name.trim()) {
      toast.error("Full name is required");
      return;
    }
    if (!createClientForm.source_account_id) {
      toast.error("Please select the linked account");
      return;
    }
    let sourceAccountId = createClientForm.source_account_id;
    if (sourceAccountId === CREATE_LINKED_ACCOUNT_OPTION) {
      if (!newSourceForm.company_name.trim() || !newSourceForm.contact_name.trim() || !newSourceForm.email.trim()) {
        toast.error("Fill company name, contact and email to create the linked account");
        return;
      }
      const accHints = await findDuplicateAccountHints({
        companyName: newSourceForm.company_name.trim(),
        email: newSourceForm.email.trim(),
      });
      if (!(await confirmDespiteDuplicates(formatAccountDuplicateLines(accHints)))) return;
    }
    const dupClients = await findDuplicateClients({
      email: createClientForm.email,
      phone: createClientForm.phone,
    });
    if (!(await confirmDespiteDuplicates(formatClientDuplicateLines(dupClients)))) return;

    setCreating(true);
    try {
      if (sourceAccountId === CREATE_LINKED_ACCOUNT_OPTION) {
        const createdAccount = await createClientSourceAccount({
          name: newSourceForm.company_name.trim(),
          contact_name: newSourceForm.contact_name.trim(),
          email: newSourceForm.email.trim(),
          industry: newSourceForm.industry,
          payment_terms: newSourceForm.payment_terms,
        });
        sourceAccountId = createdAccount.id;
        setSourceAccounts((prev) => {
          if (prev.some((p) => p.id === createdAccount.id)) return prev;
          return [...prev, { id: createdAccount.id, name: createdAccount.name, created_at: createdAccount.created_at }];
        });
      }
      if (sourceAccountId === CREATE_LINKED_ACCOUNT_OPTION || !isUuid(sourceAccountId)) {
        toast.error("Resolve the linked account first (fill new-account fields or pick an existing one).");
        return;
      }
      const client = await createClient({
        source_account_id: sourceAccountId,
        full_name: createClientForm.full_name.trim(),
        email: createClientForm.email.trim() || undefined,
        phone: createClientForm.phone.trim() || undefined,
        client_type: "residential",
        source: "direct",
        status: "active",
        tags: [],
      });
      let addressToSelect: ClientAddress | null = null;
      if (createAddressPending) {
        const merged = formStateToAddressParts(createAddressPending.form, createAddressPending.parts.full_address);
        const addr = await createClientAddress({
          client_id: client.id,
          address: merged.address || merged.full_address,
          city: merged.city,
          postcode: merged.postcode,
          country: merged.country || "gb",
          is_default: true,
        });
        addressToSelect = addr;
      } else if (createClientAddressRaw.trim()) {
        const raw = createClientAddressRaw.trim();
        const addr = await createClientAddress({
          client_id: client.id,
          address: raw,
          city: undefined,
          postcode: undefined,
          country: "gb",
          is_default: true,
        });
        addressToSelect = addr;
      }
      setCreateClientOpen(false);
      setCreateClientForm({ full_name: "", email: "", phone: "", source_account_id: "" });
      setNewSourceForm({
        company_name: "",
        contact_name: "",
        email: "",
        industry: "Residential Services",
        payment_terms: "Net 30",
      });
      setCreateAddressPending(null);
      setCreateClientAddressRaw("");
      selectClient(client);
      if (addressToSelect) {
        setAddresses((prev) => (prev.some((a) => a.id === addressToSelect!.id) ? prev : [...prev, addressToSelect!]));
        selectAddress(addressToSelect);
        toast.success("Client and address created.");
      } else {
        setAddingNewAddress(true);
        toast.success("Client created. Now select or add a property address.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setCreating(false);
    }
  }, [createClientForm, createAddressPending, newSourceForm, selectClient, selectAddress, confirmDespiteDuplicates]);

  const clearClient = useCallback(() => {
    selectedClientRef.current = null;
    setSelectedClient(null);
    setClientSearch("");
    setAddresses([]);
    setAddingNewAddress(false);
    setNewAddressPending(null);
    onChange({
      client_id: undefined,
      client_address_id: undefined,
      client_name: "",
      client_email: undefined,
      property_address: "",
    });
  }, [onChange]);

  /**
   * When the user types a name but doesn’t click a row, `client_id` stays empty.
   * Resolve a real client: single search result, or exact name/email match (fresh fetch avoids debounce races).
   */
  const resolveSearchToClient = useCallback(async () => {
    if (selectedClient) return;
    const q = clientSearch.trim();
    if (!q) return;
    try {
      const res = await listClients({ search: q, pageSize: 25 });
      const rows = res.data ?? [];
      if (rows.length === 1) {
        selectClient(rows[0]);
        return;
      }
      const lower = q.toLowerCase();
      const exact = rows.find(
        (c) => c.full_name.toLowerCase() === lower || (c.email && c.email.toLowerCase() === lower)
      );
      if (exact) selectClient(exact);
    } catch {
      /* ignore */
    }
  }, [selectedClient, clientSearch, selectClient]);

  return (
    <div className={className} ref={containerRef}>
      {!clientSectionLocked ? (
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">{labelClient}</label>
          <div className="relative">
            <input
              type="text"
              value={selectedClient ? selectedClient.full_name : clientSearch}
              onChange={(e) => {
                setClientSearch(e.target.value);
                if (!selectedClient) setClientDropdownOpen(true);
              }}
              onFocus={() => !selectedClient && setClientDropdownOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void resolveSearchToClient();
                }
              }}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && containerRef.current?.contains(next)) return;
                window.setTimeout(() => void resolveSearchToClient(), 0);
              }}
              placeholder={loadAllClientsOnOpen ? "Search or pick from the list…" : "Search by name or email..."}
              className={cn(
                "w-full h-9 rounded-lg border border-border bg-card px-3 pr-9 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30",
                clientNameInputClassName,
              )}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={clientDropdownOpen}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {selectedClient ? (
                <button
                  type="button"
                  onClick={clearClient}
                  className="text-text-tertiary hover:text-red-500 text-xs"
                >
                  Clear
                </button>
              ) : (
                <ChevronDown className="h-4 w-4 text-text-tertiary" />
              )}
            </div>
            {clientDropdownOpen && !selectedClient && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg z-50 max-h-56 overflow-y-auto"
                onMouseDown={(e) => e.preventDefault()}
              >
                {clientLoading ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-text-tertiary text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setClientDropdownOpen(false);
                        setCreateClientOpen(true);
                      }}
                      className="sticky top-0 z-[1] w-full text-left px-3 py-2.5 hover:bg-primary/10 text-primary text-sm font-medium flex items-center gap-2 border-b border-border bg-card"
                    >
                      <UserPlus className="h-4 w-4 shrink-0" /> Create new client
                    </button>
                    {clientResults.map((c) => {
                      const addrLine = [c.address?.trim(), c.city?.trim(), c.postcode?.trim()]
                        .filter(Boolean)
                        .join(", ");
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectClient(c)}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface-hover border-b border-border last:border-0 text-sm"
                        >
                          <span className="font-medium text-text-primary">{c.full_name}</span>
                          {c.email ? <span className="text-text-tertiary text-xs block truncate">{c.email}</span> : null}
                          {addrLine ? (
                            <span className="text-text-secondary text-[11px] block truncate mt-0.5">{addrLine}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
            {!selectedClient && clientSearch.trim() && !clientLoading && (
              <p className="text-[10px] text-text-tertiary mt-1.5 leading-snug">
                Click a client in the list, press <kbd className="px-1 rounded bg-surface-hover text-[10px]">Enter</kbd> to confirm, or
                finish typing the exact name and tab away — only then the client is linked.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">{labelClient}</label>
          <div className="rounded-lg border border-border bg-surface-hover/80 px-3 py-2.5">
            <p className="text-sm font-semibold text-text-primary">{value.client_name || selectedClient?.full_name}</p>
            {(value.client_email || selectedClient?.email) && (
              <p className="text-xs text-text-tertiary mt-0.5">{value.client_email || selectedClient?.email}</p>
            )}
            <p className="text-[10px] text-text-tertiary mt-1.5 leading-snug">
              Linked client — change only the property address below.
            </p>
          </div>
        </div>
      )}

      {showAddressSection && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-text-secondary mb-1.5">{labelAddress}</label>
          {!selectedClient && value.client_id ? (
            <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading client…
            </div>
          ) : null}
          {selectedClient && addressLoading ? (
            <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading addresses...
            </div>
          ) : selectedClient && !addressLoading ? (
            showJobAddressCollapsed ? (
              <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
                <p className="text-sm text-text-primary leading-snug break-words">{currentPropertyDisplayLine}</p>
                <button
                  type="button"
                  onClick={() => setJobAddressListExpanded(true)}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  Choose another address
                </button>
              </div>
            ) : (
            <div className="space-y-2">
              {jobCurrentAddressOnly && currentPropertyDisplayLine.trim() ? (
                <button
                  type="button"
                  onClick={() => setJobAddressListExpanded(false)}
                  className="text-xs font-medium text-text-tertiary hover:text-primary mb-1"
                >
                  ← Back to current address only
                </button>
              ) : null}
              {addresses.map((addr) => {
                const full = [addr.address, addr.city, addr.postcode].filter(Boolean).join(", ");
                const isSelected = value.client_address_id === addr.id;
                return (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => selectAddress(addr)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${isSelected ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}
                  >
                    <span className="font-medium">{addr.label || "Address"}</span>
                    <span className="text-text-secondary block truncate">{full || addr.address}</span>
                  </button>
                );
              })}
              {addingNewAddress ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-text-secondary mb-2">New address</p>
              <AddressAutocomplete
                value={newAddressRaw}
                onChange={(val) => {
                  setNewAddressRaw(val);
                  setNewAddressPending(null);
                  if (val.trim()) emit({ client_address_id: undefined, property_address: val.trim() });
                  else emit({ client_address_id: undefined, property_address: "" });
                }}
                onSelect={(parts) => {
                  setNewAddressRaw(parts.full_address);
                  setNewAddressPending({ parts, form: addressPartsToFormState(parts) });
                }}
                placeholder="Type address or postcode..."
              />
                  {newAddressPending ? (
                    <>
                      <UkAddressReviewFields
                        value={newAddressPending.form}
                        onChange={(form) => setNewAddressPending((p) => (p ? { ...p, form } : null))}
                        disabled={creating}
                      />
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={creating || !newAddressPending.form.street.trim()}
                          onClick={() => {
                            const merged = formStateToAddressParts(
                              newAddressPending.form,
                              newAddressPending.parts.full_address,
                            );
                            setNewAddressPending(null);
                            void handleNewAddressSelect(merged);
                          }}
                        >
                          Save address
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={creating}
                          onClick={() => {
                            setNewAddressPending(null);
                            setNewAddressRaw("");
                            emit({ client_address_id: undefined, property_address: "" });
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </>
                  ) : null}
                  {creating && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-text-tertiary">
                      <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setAddingNewAddress(false);
                      setNewAddressRaw("");
                      setNewAddressPending(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAddingNewAddress(true);
                    emit({ client_address_id: undefined });
                    if (valueRef.current.property_address) setNewAddressRaw(valueRef.current.property_address);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-sm text-text-tertiary hover:text-primary"
                >
                  <MapPin className="h-4 w-4" /> Add new address
                </button>
              )}
            </div>
            )
          ) : null}
          {selectedClient && addresses.length === 0 && !addressLoading && !addingNewAddress && (
            <p className="text-xs text-text-tertiary mb-2">No addresses. Add one below.</p>
          )}
        </div>
      )}

      <Modal
        open={createClientOpen}
        onClose={() => {
          setCreateClientOpen(false);
          setCreateClientForm({ full_name: "", email: "", phone: "", source_account_id: "" });
          setNewSourceForm({
            company_name: "",
            contact_name: "",
            email: "",
            industry: "Residential Services",
            payment_terms: "Net 30",
          });
          setCreateAddressPending(null);
          setCreateClientAddressRaw("");
        }}
        title="New client"
        subtitle="Link the client to an account from Accounts (or create one)"
        size="md"
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Linked account (Accounts) *</label>
            <select
              value={createClientForm.source_account_id}
              onChange={(e) => {
                const value = e.target.value;
                setCreateClientForm((p) => ({ ...p, source_account_id: value }));
                if (value === CREATE_LINKED_ACCOUNT_OPTION) {
                  setNewSourceForm((prev) => ({
                    ...prev,
                    contact_name: prev.contact_name || createClientForm.full_name || "Client Team",
                    email: prev.email || createClientForm.email || "",
                  }));
                }
              }}
              className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="">— Where did the client come from? —</option>
              {sourceAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              <option value={CREATE_LINKED_ACCOUNT_OPTION}>+ Create new account</option>
            </select>
            <p className="text-[10px] text-text-tertiary mt-1">Pulled from Accounts — the client row stores this account&apos;s ID.</p>
          </div>
          {createClientForm.source_account_id === CREATE_LINKED_ACCOUNT_OPTION && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
              <p className="text-[11px] font-medium text-text-secondary">Create account (saved in Accounts)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Company name *</label>
                  <Input
                    value={newSourceForm.company_name}
                    onChange={(e) => setNewSourceForm((p) => ({ ...p, company_name: e.target.value }))}
                    placeholder="Lead source company"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Contact name *</label>
                  <Input
                    value={newSourceForm.contact_name}
                    onChange={(e) => setNewSourceForm((p) => ({ ...p, contact_name: e.target.value }))}
                    placeholder="Source owner"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Email *</label>
                  <Input
                    type="email"
                    value={newSourceForm.email}
                    onChange={(e) => setNewSourceForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="source@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Industry</label>
                  <Input
                    value={newSourceForm.industry}
                    onChange={(e) => setNewSourceForm((p) => ({ ...p, industry: e.target.value }))}
                    placeholder="Residential Services"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Payment terms</label>
                <Input
                  value={newSourceForm.payment_terms}
                  onChange={(e) => setNewSourceForm((p) => ({ ...p, payment_terms: e.target.value }))}
                  placeholder="Net 30"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Full name *</label>
            <Input
              value={createClientForm.full_name}
              onChange={(e) => setCreateClientForm((p) => ({ ...p, full_name: e.target.value }))}
              placeholder="Client name"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
            <Input
              type="email"
              value={createClientForm.email}
              onChange={(e) => setCreateClientForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
            <Input
              value={createClientForm.phone}
              onChange={(e) => setCreateClientForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder="+44 7700 900000"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Property address (optional)</label>
            <p className="text-[10px] text-text-tertiary mb-2">Select an existing address or add a new one. For a new client there are no addresses yet.</p>
            <select
              disabled
              className="w-full h-9 rounded-lg border border-border bg-surface-hover px-3 text-sm text-text-tertiary cursor-not-allowed"
              title="No addresses yet for new client"
            >
              <option>— No addresses yet —</option>
            </select>
            <div className="mt-2">
              <p className="text-[10px] font-medium text-text-secondary mb-1.5">Add new address</p>
              <AddressAutocomplete
                value={createClientAddressRaw}
                onChange={(v) => {
                  setCreateClientAddressRaw(v);
                  setCreateAddressPending(null);
                }}
                onSelect={(parts) => {
                  setCreateAddressPending({ parts, form: addressPartsToFormState(parts) });
                  setCreateClientAddressRaw(parts.full_address);
                }}
                placeholder="Type address or postcode..."
              />
              {createAddressPending ? (
                <UkAddressReviewFields
                  value={createAddressPending.form}
                  onChange={(form) => setCreateAddressPending((p) => (p ? { ...p, form } : null))}
                  disabled={creating}
                />
              ) : null}
              {(createAddressPending || createClientAddressRaw.trim()) && (
                <p className="text-[10px] text-primary mt-1">
                  {createAddressPending
                    ? "Adjust lines above if needed, then create the client to save this address."
                    : "Typed text will be saved as one line when you create the client (no postcode split)."}
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateClientOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateClient}
              loading={creating}
              disabled={
                creating ||
                !createClientForm.full_name.trim() ||
                !createClientForm.source_account_id.trim()
              }
            >
              Create client
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
