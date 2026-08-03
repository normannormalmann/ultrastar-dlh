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
import StatusDots from "./StatusDots.tsx";

export type ViewId =
  | "search"
  | "create"
  | "queue"
  | "downloaded"
  | "repair"
  | "settings";

const ITEMS: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: "search", label: "Suche", icon: Search },
  { id: "create", label: "Erstellen", icon: Wand2 },
  { id: "queue", label: "Queue", icon: ListMusic },
  { id: "downloaded", label: "Heruntergeladen", icon: Check },
  { id: "repair", label: "Reparatur", icon: Wrench },
  { id: "settings", label: "Einstellungen", icon: Settings },
];

export const Sidebar: FC<{
  active: ViewId;
  onSelect: (view: ViewId) => void;
  queueCount: number;
  /** Waiting creations. The badge sits on the queue item - both live there. */
  creationCount: number;
  status: AppStatus;
}> = ({ active, onSelect, queueCount, creationCount, status }) => (
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
        <span>{item.label}</span>
        {item.id === "queue" && queueCount + creationCount > 0 && (
          <span className="badge">{queueCount + creationCount}</span>
        )}
      </button>
    ))}
    <div className="spacer" />
    <StatusDots status={status} />
  </nav>
);

export default Sidebar;
