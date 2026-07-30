import { useEffect, useState } from "react";
import type { EventChannel, EventPayloads } from "../shared/ipcContract.ts";

/** Subscribes to a main-process event channel; initialValue until the first event. */
export const useIpcEvent = <C extends EventChannel>(
  channel: C,
  initialValue: EventPayloads[C],
): EventPayloads[C] => {
  const [value, setValue] = useState<EventPayloads[C]>(initialValue);
  useEffect(() => window.ultrastar.on(channel, setValue), [channel]);
  return value;
};
