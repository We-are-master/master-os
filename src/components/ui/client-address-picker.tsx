"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserPlus, MapPin, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { Client, ClientAddress } from "@/types/database";
import { listClients, createClient, getClient } from "@/services/clients";
import { listAddressesByClient, createClientAddress } from "@/services/client-addresses";
import { listClientSourceAccounts } from "@/services/client-source-accounts";
import type { ClientSourceAccount } from "@/types/database";

export interface ClientAndAddressValue {
  client_id?: string;
  client_address_id?: string;
  client_name: string;
  client_email?: string;
  property_address: string;
}

interface ClientAddressPickerProps {
  value: ClientAndAddressValue;
  onChange: (value: ClientAndAddressValue) => void;
  labelClient?: string;
  labelAddress?: string;
  required?: boolean;
  /** Prefill client search when value has client_name */
  className?: string;
}

export function ClientAddressPicker({
  value,
  onChange,
  labelClient = "Client *",
  labelAddress = "Property address *",
  required = true,
  className = "",
}: ClientAddressPickerProps) {
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [addresses, setAddresses] = useState<ClientAddress[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addingNewAddress, setAddingNewAddress] = useState(false);
  const [newAddressRaw, setNewAddressRaw] = useState("");
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createClientForm, setCreateClientForm] = useState({ full_name: "", email: "", phone: "", source_account_id: "" });
  const [createClientAddressParts, setCreateClientAddressParts] = useState<AddressParts | null>(null);
  const [createClientAddressRaw, setCreateClientAddressRaw] = useState("");
  const [sourceAccounts, setSourceAccounts] = useState<ClientSourceAccount[]>([]);
  const [creating, setCreating] = useState(false);
  const clientSearchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listClientSourceAccounts().then(setSourceAccounts).catch(() => []);
  }, []);

  const loadClientResults = useCallback(async (search: string) => {
    if (!search.trim()) {
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
  }, []);

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
      setSelectedClient(client);
      setClientSearch(client.full_name);
      setClientDropdownOpen(false);
      setClientResults([]);
      onChange({
        client_id: client.id,
        client_address_id: undefined,
        client_name: client.full_name,
        client_email: client.email ?? undefined,
        property_address: value.property_address || "",
      });
    },
    [onChange, value.property_address]
  );

  useEffect(() => {
    if (!value.client_id) {
      setSelectedClient(null);
      setAddresses([]);
      if (value.client_name) {
        setClientSearch(value.client_name);
        setClientDropdownOpen(true);
        loadClientResults(value.client_name);
      }
      return;
    }
    getClient(value.client_id).then((c) => {
      setSelectedClient(c ?? null);
      if (c) setClientSearch(c.full_name);
    });
  }, [value.client_id, value.client_name, loadClientResults]);

  useEffect(() => {
    if (!selectedClient?.id) {
      setAddresses([]);
      return;
    }
    setAddressLoading(true);
    listAddressesByClient(selectedClient.id)
      .then(setAddresses)
      .catch(() => setAddresses([]))
      .finally(() => setAddressLoading(false));
  }, [selectedClient?.id]);

  useEffect(() => {
    if (selectedClient && !addressLoading && addresses.length === 0 && value.property_address?.trim()) {
      setAddingNewAddress(true);
      setNewAddressRaw(value.property_address.trim());
    }
  }, [selectedClient, addressLoading, addresses.length, value.property_address]);

  const selectAddress = useCallback(
    (addr: ClientAddress) => {
      const full = [addr.address, addr.city, addr.postcode].filter(Boolean).join(", ");
      onChange({
        ...value,
        client_address_id: addr.id,
        property_address: full || addr.address,
      });
      setAddingNewAddress(false);
      setNewAddressRaw("");
    },
    [onChange, value]
  );

  const handleNewAddressSelect = useCallback(
    async (parts: AddressParts) => {
      if (!selectedClient) return;
      setCreating(true);
      try {
        const full = parts.full_address;
        const addr = await createClientAddress({
          client_id: selectedClient.id,
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

  const handleCreateClient = useCallback(async () => {
    if (!createClientForm.full_name.trim()) {
      toast.error("Full name is required");
      return;
    }
    if (!createClientForm.source_account_id) {
      toast.error("Please select the client's source account");
      return;
    }
    setCreating(true);
    try {
      const client = await createClient({
        source_account_id: createClientForm.source_account_id,
        full_name: createClientForm.full_name.trim(),
        email: createClientForm.email.trim() || undefined,
        phone: createClientForm.phone.trim() || undefined,
        client_type: "residential",
        source: "direct",
        status: "active",
        tags: [],
      });
      let addressToSelect: ClientAddress | null = null;
      if (createClientAddressParts) {
        const addr = await createClientAddress({
          client_id: client.id,
          address: createClientAddressParts.address || createClientAddressParts.full_address,
          city: createClientAddressParts.city,
          postcode: createClientAddressParts.postcode,
          country: createClientAddressParts.country || "gb",
          is_default: true,
        });
        addressToSelect = addr;
      }
      setCreateClientOpen(false);
      setCreateClientForm({ full_name: "", email: "", phone: "", source_account_id: "" });
      setCreateClientAddressParts(null);
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
  }, [createClientForm, createClientAddressParts, selectClient, selectAddress]);

  const clearClient = useCallback(() => {
    setSelectedClient(null);
    setClientSearch("");
    setAddresses([]);
    setAddingNewAddress(false);
    onChange({
      client_id: undefined,
      client_address_id: undefined,
      client_name: "",
      client_email: undefined,
      property_address: "",
    });
  }, [onChange]);

  return (
    <div className={className} ref={containerRef}>
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
            placeholder="Search by name or email..."
            className="w-full h-9 rounded-lg border border-border bg-card px-3 pr-9 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30"
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
            <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg z-50 max-h-56 overflow-y-auto">
              {clientLoading ? (
                <div className="p-4 flex items-center justify-center gap-2 text-text-tertiary text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                </div>
              ) : (
                <>
                  {clientResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectClient(c)}
                      className="w-full text-left px-3 py-2.5 hover:bg-surface-hover border-b border-border last:border-0 text-sm"
                    >
                      <span className="font-medium text-text-primary">{c.full_name}</span>
                      {c.email && <span className="text-text-tertiary text-xs block">{c.email}</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setClientDropdownOpen(false); setCreateClientOpen(true); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-primary/10 text-primary text-sm font-medium flex items-center gap-2 border-t border-border"
                  >
                    <UserPlus className="h-4 w-4" /> Create new client
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedClient && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-text-secondary mb-1.5">{labelAddress}</label>
          {addressLoading ? (
            <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading addresses...
            </div>
          ) : (
            <div className="space-y-2">
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
                      if (val.trim()) onChange({ ...value, property_address: val.trim() });
                    }}
                    onSelect={(parts) => {
                      setNewAddressRaw(parts.full_address);
                      handleNewAddressSelect(parts);
                    }}
                    placeholder="Type address or postcode..."
                  />
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
                    onClick={() => { setAddingNewAddress(false); setNewAddressRaw(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAddingNewAddress(true);
                    if (value.property_address) setNewAddressRaw(value.property_address);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-sm text-text-tertiary hover:text-primary"
                >
                  <MapPin className="h-4 w-4" /> Add new address
                </button>
              )}
            </div>
          )}
          {addresses.length === 0 && !addressLoading && !addingNewAddress && (
            <p className="text-xs text-text-tertiary mb-2">No addresses. Add one below.</p>
          )}
        </div>
      )}

      <Modal
        open={createClientOpen}
        onClose={() => {
          setCreateClientOpen(false);
          setCreateClientForm({ full_name: "", email: "", phone: "", source_account_id: "" });
          setCreateClientAddressParts(null);
          setCreateClientAddressRaw("");
        }}
        title="New client"
        subtitle="Enter details and select where the client came from (source account)"
        size="md"
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Source account *</label>
            <select
              value={createClientForm.source_account_id}
              onChange={(e) => setCreateClientForm((p) => ({ ...p, source_account_id: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="">— Where did the client come from? —</option>
              {sourceAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <p className="text-[10px] text-text-tertiary mt-1">Client is linked to this source (e.g. Facebook, Website, Referral).</p>
          </div>
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
                onSelect={(parts) => {
                  setCreateClientAddressParts(parts);
                  setCreateClientAddressRaw(parts.full_address);
                }}
                placeholder="Type address or postcode..."
              />
              {createClientAddressParts && (
                <p className="text-[10px] text-primary mt-1">Address will be saved when you create the client.</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateClientOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateClient} loading={creating} disabled={!createClientForm.full_name.trim()}>
              Create client
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
