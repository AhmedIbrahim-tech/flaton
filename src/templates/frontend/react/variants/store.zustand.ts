import { create } from "zustand";
import type { Category } from "@/modules/category/types/category.types";

type CategoryItem = Category;

type AppState = {
  category: {
    items: CategoryItem[];
    selected: CategoryItem | null;
    status: "idle" | "loading" | "succeeded" | "failed";
    error: string | null;
  };
  setCategoryItems: (items: CategoryItem[]) => void;
  setCategorySelected: (selected: CategoryItem | null) => void;
  setCategoryError: (error: string | null) => void;
  setCategoryStatus: (status: AppState["category"]["status"]) => void;
};

export const useAppStore = create<AppState>((set) => ({
  category: {
    items: [],
    selected: null,
    status: "idle",
    error: null,
  },
  setCategoryItems: (items) =>
    set((state) => ({ category: { ...state.category, items, status: "succeeded", error: null } })),
  setCategorySelected: (selected) =>
    set((state) => ({ category: { ...state.category, selected, status: "succeeded", error: null } })),
  setCategoryError: (error) =>
    set((state) => ({ category: { ...state.category, status: "failed", error } })),
  setCategoryStatus: (status) =>
    set((state) => ({ category: { ...state.category, status } })),
}));
