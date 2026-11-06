import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (kind: Toast['kind'], title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (kind, title, detail) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, title, detail }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6500 : 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (title: string, detail?: string) => useToastStore.getState().push('success', title, detail),
  error: (title: string, detail?: string) => useToastStore.getState().push('error', title, detail),
  info: (title: string, detail?: string) => useToastStore.getState().push('info', title, detail),
};
