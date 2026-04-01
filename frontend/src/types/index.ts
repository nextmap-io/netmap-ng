export type NodeType =
  | "router"
  | "switch_l2"
  | "switch_l3"
  | "server"
  | "firewall"
  | "cloud"
  | "internet"
  | "ix"
  | "transit"
  | "pni"
  | "provider"
  | "group"
  | "custom";

export type LinkType =
  | "internal"
  | "transit"
  | "peering_ix"
  | "peering_pni"
  | "customer"
  | "trunk"
  | "lag"
  | "custom";

export interface MapNode {
  id: string;
  name: string;
  label: string;
  node_type: NodeType;
  x: number;
  y: number;
  z_order: number;
  parent_id: string | null;
  width: number | null;
  height: number | null;
  observium_device_id: number | null;
  icon: string | null;
  style: Record<string, unknown>;
  locked: boolean;
  info_url: string | null;
  extra: Record<string, unknown>;
}

export interface MapLink {
  id: string;
  name: string;
  link_type: LinkType;
  source_id: string;
  target_id: string;
  source_anchor: string | null;
  target_anchor: string | null;
  bandwidth: number;
  bandwidth_label: string;
  via_points: Array<{ x: number; y: number }>;
  via_style: "curved" | "angled";
  width: number;
  arrow_style: string;
  duplex: "full" | "half";
  datasource: Record<string, unknown>;
  observium_port_id_a: number | null;
  observium_port_id_b: number | null;
  info_url_in: string | null;
  info_url_out: string | null;
  extra: Record<string, unknown>;
  z_order: number;
}

export interface NetmapData {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  scales: Record<string, ScaleBand[]>;
  settings: MapSettings;
  nodes: MapNode[];
  links: MapLink[];
}

export interface ScaleBand {
  min: number;
  max: number;
  color: string;
  label: string;
}

export interface MapSettings {
  kilo: number;
  refresh_interval: number;
  default_link_width: number;
  scale_mode?: "steps" | "gradient";
}

export interface TrafficData {
  [linkId: string]: {
    in_bps: number;
    out_bps: number;
    in_pct: number;
    out_pct: number;
  };
}

export interface TrafficHistory {
  timestamps: number[];
  in_bps: number[];
  out_bps: number[];
}

export interface MapSummary {
  id: string;
  name: string;
  description: string;
  updated_at: string;
}

export type AlignDirection = "left" | "center" | "right" | "top" | "middle" | "bottom";

export interface ObserviumDevice {
  device_id: number;
  hostname: string;
  sysName: string;
  os: string;
  hardware: string;
  location: string;
  status: number;
  type: string;
}

export interface ObserviumPort {
  port_id: number;
  ifIndex: number;
  ifName: string;
  ifDescr: string;
  ifAlias: string;
  ifSpeed: number;
  ifOperStatus: string;
  port_label_short: string;
}
