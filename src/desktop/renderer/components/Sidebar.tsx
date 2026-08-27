import {
  Check,
  ListMusic,
  type LucideIcon,
  Mic,
  Search,
  Settings,
  Wand2,
  Wrench,
} from "lucide-react";
import type { FC } from "react";
import type { AppStatus } from "../../shared/ipcContract.ts";
import { type Katalog, useT } from "../i18n/index.tsx";
import StatusDots from "./StatusDots.tsx";

export type ViewId =
  | "search"
  | "create"
  | "queue"
  | "downloaded"
  | "repair"
  | "settings";

/** The id doubles as the catalog key - nav has exactly these entries. */
const ITEMS: Array<{ id: ViewId; icon: LucideIcon }> = [
  { id: "search", icon: Search },
  { id: "create", icon: Wand2 },
  { id: "queue", icon: ListMusic },
  { id: "downloaded", icon: Check },
  { id: "repair", icon: Wrench },
  { id: "settings", icon: Settings },
];

const navLabel = (t: Katalog, id: ViewId): string => t.nav[id];

export const Sidebar: FC<{
  active: ViewId;
  onSelect: (view: ViewId) => void;
  queueCount: number;
  /** Waiting creations. The badge sits on the queue item - both live there. */
  creationCount: number;
  status: AppStatus;
}> = ({ active, onSelect, queueCount, creationCount, status }) => {
  const t = useT();
  return (
  <nav className="sidebar">
    <div className="brand">
      <Mic size={18} aria-hidden />
      <span>
        UltraStar
        <span className="brand-sub">Dirty Little Helper</span>
      </span>
    </div>
    {ITEMS.map((item) => (
      <button
        key={item.id}
        type="button"
        className={`nav-item${active === item.id ? " active" : ""}`}
        onClick={() => onSelect(item.id)}
      >
        <item.icon size={16} aria-hidden />
        <span>{navLabel(t, item.id)}</span>
        {item.id === "queue" && queueCount + creationCount > 0 && (
          <span className="badge">{queueCount + creationCount}</span>
        )}
      </button>
    ))}
    <div className="spacer" />
    <StatusDots status={status} />
  </nav>
  );
};

export default Sidebar;
