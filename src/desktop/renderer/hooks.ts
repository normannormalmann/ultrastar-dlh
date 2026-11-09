import { useEffect, useState } from "react";
import type { EventChannel, EventPayloads } from "../shared/ipcContract.ts";

/** Subscribes to a main-process event channel; initialValue until the first event. */
export const useIpcEvent = <C extends EventChannel>(
  channel: C,
  initialValue: EventPayloads[C],
): EventPayloads[C] => {
  const [value, setValue] = useState<EventPayloads[C]>(initialValue);
  useEffect(() => {
    let active = true;
    let received = false;
    const off = window.ultrastar.on(channel, (value) => {
      received = true;
      setValue(value);
    });
    void window.ultrastar
      .getEventState(channel)
      .then((snapshot) => {
        if (
          active &&
          !received &&
          channel !== "event:error" &&
          snapshot !== undefined
        )
          setValue(snapshot);
      })
      .catch(() => {});
    return () => {
      active = false;
      off();
    };
  }, [channel]);
  return value;
};
