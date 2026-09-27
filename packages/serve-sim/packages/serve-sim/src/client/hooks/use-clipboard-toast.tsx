import { useCallback, useMemo } from "react";
import { toast as sonnerToast } from "sonner";
import { ClipboardToastContent } from "../components/app-toasts";
import { readTextFromBrowserClipboard } from "../utils/sim-clipboard";

export type ClipboardToast = {
  status: "pending" | "copied" | "paste" | "error";
  message: string;
};

const PASTE_TOAST_ID = "sim-clipboard-paste";

function renderToast(status: ClipboardToast["status"], message: string, onPaste?: (text: string) => void): void {
  const toast: ClipboardToast = { status, message };
  sonnerToast.custom(
    () => <ClipboardToastContent toast={toast} onPaste={onPaste} />,
    { id: PASTE_TOAST_ID, duration: status === "pending" || status === "paste" ? Infinity : 3000 },
  );
}

export function useClipboardToast(sendTextToSim: (text: string) => Promise<boolean>) {
  const pasteText = useCallback(async (text: string) => {
    renderToast("pending", "Pasting into the simulator…");
    try {
      const ok = await sendTextToSim(text);
      renderToast(
        ok ? "copied" : "error",
        ok ? "Pasted into simulator" : "Could not write to the simulator clipboard",
      );
    } catch (error) {
      renderToast("error", error instanceof Error ? error.message : "Could not write to the simulator clipboard");
    }
  }, [sendTextToSim]);

  const pasteFromDevice = useCallback(async () => {
    let text: string;
    try {
      text = await readTextFromBrowserClipboard();
    } catch {
      renderToast("paste", "Paste here to send it to the simulator", (pasted) => void pasteText(pasted));
      return;
    }
    if (!text) {
      renderToast("copied", "Device clipboard is empty");
      return;
    }
    await pasteText(text);
  }, [pasteText]);

  return useMemo(() => ({ pasteFromDevice, pasteText }), [pasteFromDevice, pasteText]);
}
