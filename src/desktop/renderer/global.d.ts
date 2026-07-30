import type { UltrastarApi } from "../shared/ipcContract.ts";

declare global {
  interface Window {
    ultrastar: UltrastarApi;
  }
}
