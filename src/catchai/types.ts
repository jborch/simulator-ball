// CATCH.AI REST contracts (subset), as in the server's swagger (CIM.IoT.Contracts.*).

/** ItemResult as the server stores it. */
export const ItemResult = { Failed: 0, Passed: 1, Inconclusive: 2 } as const;

/** Event severity. */
export const Severity = { Debug: 0, Info: 2, Warning: 4, Error: 6, Critical: 8, Fatal: 10 } as const;

export interface Device {
  DeviceId: string;
  Name: string;
  Description?: string;
  ParentDeviceId?: string;
}

export interface Process {
  Scope: string;
  DeviceId: string;
  HasResult: boolean;
  HasCarrier: boolean;
  CarrierType?: string | null;
  ItemType: string;
  SourceItemType?: string | null;
}

export type PropertyType = 'Float' | 'Integer' | 'Boolean' | 'String';

export interface PropertyDefinition {
  /** "p<number>"; the server only accepts that format. */
  Key: string;
  Name: string;
  Type: PropertyType;
  Unit?: string;
  Description?: string;
  NumberOfDecimals?: number;
  /** Source system → name. We tag our definitions with the line id so we can find them again. */
  Mappings?: Record<string, string>;
  StoreInDatabase?: boolean;
}

export interface EventDefinition {
  /** "e<number>". */
  Key: string;
  Name: string;
  Description?: string;
  Severity: number;
  Mappings?: Record<string, string>;
}

export interface PeriodType {
  Id: number;
  Name: string;
  DeviceIds?: string[];
  AllowOverlappingPeriods?: boolean;
}

export interface NamedPeriod {
  Id?: number;
  TypeId: number;
  DeviceId: string;
  Name: string;
  From: string;
  To?: string | null;
  Metadata?: Record<string, unknown>;
}

export interface Scope {
  Identifier: string;
  DeviceId?: string;
  PeriodTypeId?: number | null;
}

export interface ItemProcessed {
  Scope: string;
  ScopedId: number;
  Process: string;
  From: string;
  To: string;
  ItemType: string;
  ItemIdentifier?: string;
  ItemResult?: number;
  CarrierIdentifier?: string;
  SourceItemScopedId?: number;
  SourceItemPosition?: number;
  SourceItemType?: string;
}

export interface ItemsMerged {
  Scope: string;
  TargetItemScopedId: number;
  SourceItemScopedId: number;
  SourceItemPosition?: number;
  Process: string;
  TargetItemType: string;
  SourceItemType: string;
  Logged: string;
}

export interface DeviceData {
  DeviceId: string;
  Logged: string;
  /** Property key → value. */
  Properties?: Record<string, number | string | boolean>;
  /** Event key → value. */
  Events?: Record<string, string>;
}

/** Response of the v2 bulk endpoints (200 all ok, 207 partial, 422 none). */
export interface BulkResult {
  Total: number;
  Succeeded: number;
  Failed: number;
  InvalidEntries: { Index: number; Errors: { Code: number; Message: string }[] }[];
}

export interface Item {
  ScopedId: number;
  Identifier?: string;
  Scope: string;
  Type: string;
}

/** How CATCH.AI walks the genealogy: which item type goes into which, at which process. */
export interface ItemView {
  Id?: number;
  Name: string;
  /** One per (source, target) type pair; without a process it applies wherever the merge happens. */
  Relations: { SourceItemType: string; TargetItemType: string; ProcessDeviceId?: string }[];
}
