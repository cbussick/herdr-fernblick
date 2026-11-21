import "react";

declare module "react" {
  interface CSSProperties {
    "--tab-count"?: number;
    "--conversation-width"?: string;
    "--conversation-height"?: string;
  }
}
