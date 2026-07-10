import { create } from "zustand";

const TOAST_DURATION_MS = 4500;

export type ToastPayload = {
  emoji?: string;
  title: string;
  body: string;
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

type ToastState = {
  toast: ToastPayload | null;
  show: (toast: ToastPayload) => void;
  hide: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (toast) => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ toast });
    hideTimer = setTimeout(() => {
      set({ toast: null });
      hideTimer = null;
    }, TOAST_DURATION_MS);
  },
  hide: () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    set({ toast: null });
  },
}));
