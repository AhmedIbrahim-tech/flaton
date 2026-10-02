"use client";

import { useCallback } from "react";
import { useAppStore } from "@/store/use-app-store";
import { categoryService } from "../services/category.service";
import type { CreateCategoryInput, CategoryQuery, UpdateCategoryInput } from "../types/category.types";

export function useCategoriesController() {
  const items = useAppStore((state) => state.category.items);
  const selected = useAppStore((state) => state.category.selected);
  const status = useAppStore((state) => state.category.status);
  const error = useAppStore((state) => state.category.error);
  const setCategoryItems = useAppStore((state) => state.setCategoryItems);
  const setCategorySelected = useAppStore((state) => state.setCategorySelected);
  const setCategoryError = useAppStore((state) => state.setCategoryError);
  const setCategoryStatus = useAppStore((state) => state.setCategoryStatus);

  const load = useCallback((query: CategoryQuery) => {
    setCategoryStatus("loading");
    void categoryService
      .search(query)
      .then((result) => setCategoryItems(result.data ?? []))
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to load categories"));
  }, [setCategoryError, setCategoryItems, setCategoryStatus]);

  const loadById = useCallback((id: string) => {
    setCategoryStatus("loading");
    void categoryService
      .getById(id)
      .then((item) => setCategorySelected(item))
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to load category"));
  }, [setCategoryError, setCategorySelected, setCategoryStatus]);

  const create = useCallback((input: CreateCategoryInput) => {
    void categoryService
      .create(input)
      .then((item) => setCategoryItems([item, ...useAppStore.getState().category.items]))
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to create category"));
  }, [setCategoryError, setCategoryItems]);

  const update = useCallback((input: UpdateCategoryInput) => {
    void categoryService
      .update(input)
      .then((item) => {
        const current = useAppStore.getState().category.items;
        setCategoryItems(current.map((entry) => (entry.id === item.id ? item : entry)));
        setCategorySelected(item);
      })
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to update category"));
  }, [setCategoryError, setCategoryItems, setCategorySelected]);

  return { items, selected, status, error, load, loadById, create, update };
}
