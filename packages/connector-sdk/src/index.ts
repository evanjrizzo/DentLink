import type { ConnectorKind } from "@dentlink/item-model";

export type ConnectorAuthType = "none" | "oauth2" | "api_key";
export type ConnectorCapability =
  "poll" | "webhook" | "normalize_notifications" | "normalize_notes" | "normalize_calendar";
export type ConnectorSettingType = "string" | "boolean" | "number" | "select";

export type ConnectorSettingField = {
  key: string;
  label: string;
  type: ConnectorSettingType;
  required: boolean;
  options?: string[];
};

export type ConnectorDefinition = {
  key: string;
  name: string;
  kind: ConnectorKind;
  authType: ConnectorAuthType;
  capabilities: ConnectorCapability[];
  settings: ConnectorSettingField[];
  version: number;
};

export const connectorCatalog = [
  {
    key: "generic-email",
    name: "Generic Email Connector",
    kind: "email",
    authType: "oauth2",
    capabilities: ["poll", "normalize_notifications"],
    settings: [
      {
        key: "label",
        label: "Display label",
        type: "string",
        required: false
      }
    ],
    version: 1
  },
  {
    key: "generic-calendar",
    name: "Generic Calendar Connector",
    kind: "calendar",
    authType: "oauth2",
    capabilities: ["poll", "normalize_calendar"],
    settings: [
      {
        key: "includeDeclined",
        label: "Include declined events",
        type: "boolean",
        required: false
      }
    ],
    version: 1
  }
] as const satisfies ConnectorDefinition[];

export function connectorByKey(key: string): ConnectorDefinition | null {
  return connectorCatalog.find((definition) => definition.key === key) ?? null;
}

export const connectorSdkPackage = {
  name: "@dentlink/connector-sdk",
  responsibility: "Connector contract boundary",
  catalogSize: connectorCatalog.length
} as const;
