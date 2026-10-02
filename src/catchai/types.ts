export type PropertyType = 'Float' | 'Integer' | 'Boolean';

export interface Device {
  DeviceId: string;
  Name: string;
}

export interface PropertyDefinition {
  Key: string;
  Name: string;
  Type: PropertyType;
  Unit?: string;
  Description?: string;
}

export interface EventDefinition {
  Key: string;
  Name: string;
  Description?: string;
  Severity?: number;
  IsDisabled?: boolean;
  PredefinedFeedbacks?: string[];
}

export interface DeviceData {
  DeviceId: string;
  /** UTC ISO-8601 timestamp. */
  Logged: string;
  Properties?: Record<string, number>;
  Events?: Record<string, number | string | null>;
}
