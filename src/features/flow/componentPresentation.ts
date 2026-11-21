import { createContext } from "react";
import type { CSSProperties } from "react";
import {
  Box,
  Cloud,
  Code,
  Database,
  FileText,
  Globe,
  Heart,
  Image,
  Layout,
  List,
  Lock,
  Mail,
  MessageSquare,
  Server,
  Settings,
  Table,
  User,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ComponentData } from "./model";

type AccentStyle = CSSProperties & { "--accent": string };
export const icons = {
  user: { label: "User", component: User },
  users: { label: "Users", component: Users },
  server: { label: "Server", component: Server },
  database: { label: "Database", component: Database },
  cloud: { label: "Cloud", component: Cloud },
  globe: { label: "Globe", component: Globe },
  lock: { label: "Lock", component: Lock },
  code: { label: "Code", component: Code },
  settings: { label: "Settings", component: Settings },
  zap: { label: "Activity", component: Zap },
  mail: { label: "Mail", component: Mail },
  heart: { label: "Heart", component: Heart },
  box: { label: "Boundary", component: Box },
  layout: { label: "Card", component: Layout },
  list: { label: "Detail", component: List },
  table: { label: "Table", component: Table },
  message: { label: "Comment", component: MessageSquare },
  file: { label: "Document", component: FileText },
  image: { label: "Image", component: Image },
} satisfies Record<string, { label: string; component: LucideIcon }>;

export const EditContext = createContext<(id: string) => void>(() => {});
export function componentStyle(data: ComponentData): AccentStyle {
  return { "--accent": data.color };
}
