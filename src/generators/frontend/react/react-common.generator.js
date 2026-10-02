import path from 'node:path';
import { promises as fs } from 'node:fs';
import { add } from '../../../utils/package-manager.js';
import { copyTemplate, pathExists, templatesRoot, writeFile } from '../../../utils/filesystem.js';
import { convertTypeScriptToJavaScript, toJavaScriptFileName } from './javascript.js';

/**
 * @param {object} frontend
 * @returns {string[]}
 */
export function resolveReactPackages(frontend = {}) {
  const packages = ['lucide-react', 'sonner', 'framer-motion'];

  if (frontend.state === 'redux' || !frontend.state) {
    packages.push('@reduxjs/toolkit', 'react-redux');
  } else if (frontend.state === 'zustand') {
    packages.push('zustand');
  }

  if (frontend.httpClient === 'axios' || !frontend.httpClient) {
    packages.push('axios');
  }

  if (frontend.forms === 'react-hook-form-zod' || !frontend.forms) {
    packages.push('react-hook-form', '@hookform/resolvers', 'zod');
  }

  if (frontend.styling === 'bootstrap') {
    packages.push('bootstrap', 'react-bootstrap');
  }

  if (frontend.componentSystem === 'mui') {
    packages.push('@mui/material', '@emotion/react', '@emotion/styled');
  } else if (frontend.componentSystem === 'antd') {
    packages.push('antd');
  }

  if (frontend.realtime === 'signalr') {
    packages.push('@microsoft/signalr');
  }

  return [...new Set(packages)];
}

/**
 * Resolves which overlay files to skip/write for the selected React profile.
 * @param {object} [frontend]
 */
export function resolveReactOverlayProfile(frontend = {}) {
  const language = frontend.language === 'javascript' ? 'javascript' : 'typescript';
  const httpClient = frontend.httpClient === 'fetch' ? 'fetch' : 'axios';
  const state =
    frontend.state === 'zustand' ? 'zustand' : frontend.state === 'none' ? 'none' : 'redux';
  const ext = language === 'javascript' ? 'js' : 'ts';
  const jsxExt = language === 'javascript' ? 'jsx' : 'tsx';

  /** @type {string[]} */
  const skipPaths = [];

  if (state === 'zustand' || state === 'none') {
    skipPaths.push(
      path.join('src', 'store', 'store.ts'),
      path.join('src', 'store', 'hooks.ts'),
      path.join('src', 'store', 'provider.tsx'),
      path.join('src', 'store', 'generated-reducers.ts'),
      path.join('src', 'modules', 'category', 'slices'),
    );
  }

  if (state === 'none') {
    skipPaths.push(path.join('src', 'store'));
  }

  return {
    language,
    httpClient,
    state,
    ext,
    jsxExt,
    skipPaths,
  };
}

/**
 * Source text for the selected HTTP client. Used by overlay and regression tests.
 * @param {object} frontend
 */
export function renderApiClientSource(frontend = {}) {
  const profile = resolveReactOverlayProfile(frontend);
  if (profile.httpClient === 'fetch') {
    return renderFetchApiClient(profile.language === 'javascript');
  }
  return renderAxiosApiClient(profile.language === 'javascript');
}

/**
 * @param {{ clientDir: string, packageManager: 'npm' | 'yarn' | 'pnpm', replacements: Record<string, string>, frontend?: object }} options
 */
export async function overlayReactCommon(options) {
  const frontend = options.frontend ?? {};
  const profile = resolveReactOverlayProfile(frontend);

  await copyTemplate(
    path.join(templatesRoot(), 'frontend', 'react', 'common'),
    options.clientDir,
    options.replacements,
  );

  await removeSkipPaths(options.clientDir, profile.skipPaths);

  await writeFile(
    path.join(options.clientDir, 'src', 'lib', 'api', `api-client.${profile.ext}`),
    renderApiClientSource(frontend),
  );
  await writeFile(
    path.join(options.clientDir, 'src', 'shared', 'utils', `get-error-message.${profile.ext}`),
    renderGetErrorMessage(profile.httpClient, profile.language === 'javascript'),
  );

  if (profile.httpClient === 'fetch') {
    const axiosClient = path.join(options.clientDir, 'src', 'lib', 'api', 'api-client.ts');
    if (await pathExists(axiosClient)) {
      await fs.unlink(axiosClient);
    }
  }

  if (profile.state === 'zustand') {
    await writeZustandOverlay(options.clientDir, profile);
  } else if (profile.state === 'none') {
    await writeNoneStateOverlay(options.clientDir, profile);
  }

  if (frontend.realtime === 'signalr') {
    await writeSignalRClient(options.clientDir, profile);
  }

  if (profile.language === 'javascript') {
    await convertOverlayToJavaScript(options.clientDir);
  }
}

/**
 * Convert remaining overlay TypeScript files after framework templates are copied.
 * @param {string} clientDir
 * @param {object} [frontend]
 */
export async function finalizeReactLanguage(clientDir, frontend = {}) {
  const profile = resolveReactOverlayProfile(frontend);
  if (profile.language === 'javascript') {
    await convertOverlayToJavaScript(clientDir);
  }
}

/**
 * Overwrite Next/Vite Providers after framework templates are copied.
 * @param {string} clientDir
 * @param {object} frontend
 */
export async function writeReactProviders(clientDir, frontend = {}) {
  const profile = resolveReactOverlayProfile(frontend);
  const candidates = [
    path.join(clientDir, 'src', 'app', 'providers.tsx'),
    path.join(clientDir, 'src', 'app', 'providers.jsx'),
  ];
  let target = candidates[0];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      target = candidate;
      break;
    }
  }
  const contents = renderProviders(profile);
  const dest = profile.language === 'javascript'
    ? toJavaScriptFileName(target)
    : target;

  await writeFile(dest, contents);
  if (dest !== target && (await pathExists(target))) {
    await fs.unlink(target);
  }
}

/**
 * @param {{ clientDir: string, packageManager: 'npm' | 'yarn' | 'pnpm', frontend?: object }} options
 */
export function installReactCommonPackages(options) {
  const packages = resolveReactPackages(options.frontend);
  add(options.packageManager, packages, {
    cwd: options.clientDir,
    step: 'Install React architecture packages',
  });
}

/**
 * @param {string} clientDir
 * @param {string[]} skipPaths
 */
async function removeSkipPaths(clientDir, skipPaths) {
  for (const relative of skipPaths) {
    const absolute = path.join(clientDir, relative);
    if (!(await pathExists(absolute))) continue;
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      await fs.rm(absolute, { recursive: true, force: true });
    } else {
      await fs.unlink(absolute);
    }
  }
}

/**
 * @param {object} profile
 */
function renderProviders(profile) {
  const useStore = profile.state === 'redux';
  if (profile.language === 'javascript') {
    if (useStore) {
      return `"use client";

import { Toaster } from "sonner";
import { StoreProvider } from "@/store/provider";

export function Providers({ children }) {
  return (
    <StoreProvider>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </StoreProvider>
  );
}
`;
    }

    return `"use client";

import { Toaster } from "sonner";

export function Providers({ children }) {
  return (
    <>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
`;
  }

  if (useStore) {
    return `"use client";

import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { StoreProvider } from "@/store/provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </StoreProvider>
  );
}
`;
  }

  return `"use client";

import { Toaster } from "sonner";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
`;
}

function renderAxiosApiClient(isJs) {
  if (isJs) {
    return `import axios from "axios";
import { publicEnv } from "@/lib/config/env";

export const apiClient = axios.create({
  baseURL: publicEnv.apiUrl,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (typeof document !== "undefined") {
    const locale = document.cookie
      .split("; ")
      .find((row) => row.startsWith("locale="))
      ?.split("=")[1];

    if (locale) {
      config.headers["Accept-Language"] = locale;
    }
  }

  return config;
});
`;
  }

  return `import axios from "axios";
import { publicEnv } from "@/lib/config/env";

export const apiClient = axios.create({
  baseURL: publicEnv.apiUrl,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (typeof document !== "undefined") {
    const locale = document.cookie
      .split("; ")
      .find((row) => row.startsWith("locale="))
      ?.split("=")[1];

    if (locale) {
      config.headers["Accept-Language"] = locale;
    }
  }

  return config;
});
`;
}

function renderFetchApiClient(isJs) {
  return `import { publicEnv } from "@/lib/config/env";

function createHeaders(init${isJs ? '' : ': Record<string, string> | { entries(): Iterable<readonly [string, string]> } | undefined'} = {}) {
  const map${isJs ? '' : ': Record<string, string>'} = {};
  if (init && typeof init.entries === "function") {
    for (const [key, value] of init.entries()) {
      if (value != null) {
        map[key] = String(value);
      }
    }
  } else {
    Object.assign(map, init ?? {});
  }
  return {
    set(key${isJs ? '' : ': string'}, value${isJs ? '' : ': string'}) {
      map[key] = value;
    },
    get(key${isJs ? '' : ': string'}) {
      return map[key];
    },
    entries() {
      return Object.entries(map);
    },
  };
}

function createInterceptor() {
  const handlers = [];
  return {
    use(onFulfilled, onRejected) {
      handlers.push({ onFulfilled, onRejected });
      return handlers.length - 1;
    },
    eject(id) {
      handlers[id] = null;
    },
    handlers,
  };
}

function buildUrl(baseURL, url, params) {
  const target = url.startsWith("http") ? url : \`\${baseURL.replace(/\\/$/, "")}/\${url.replace(/^\\//, "")}\`;
  if (!params) {
    return target;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? \`\${target}?\${query}\` : target;
}

export function createFetchClient(options) {
  const request = createInterceptor();
  const response = createInterceptor();

  async function send${isJs ? '' : '<T = unknown>'}(config) {
    let next = {
      ...config,
      headers: createHeaders(config.headers),
    };

    for (const handler of request.handlers) {
      if (!handler?.onFulfilled) continue;
      next = await handler.onFulfilled(next);
    }

    const url = buildUrl(options.baseURL, next.url ?? "", next.params);
    const isFormData = typeof FormData !== "undefined" && next.data instanceof FormData;
    const headers = Object.fromEntries(next.headers.entries());
    if (isFormData) {
      delete headers["Content-Type"];
      delete headers["content-type"];
    } else if (
      next.data !== undefined &&
      !headers["Content-Type"] &&
      !headers["content-type"]
    ) {
      headers["Content-Type"] = "application/json";
    }

    const init = {
      method: next.method ?? "GET",
      credentials: "include",
      headers,
      body: next.data === undefined ? undefined : isFormData ? next.data : JSON.stringify(next.data),
    };

    try {
      const fetched = await fetch(url, init);
      const text = await fetched.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      const httpResponse = {
        data,
        status: fetched.status,
        statusText: fetched.statusText,
        config: next,
        headers: fetched.headers,
      };

      if (!fetched.ok) {
        const error = {
          message: fetched.statusText,
          response: httpResponse,
          config: next,
        };
        for (const handler of response.handlers) {
          if (!handler?.onRejected) continue;
          return handler.onRejected(error);
        }
        throw error;
      }

      let result = httpResponse;
      for (const handler of response.handlers) {
        if (!handler?.onFulfilled) continue;
        result = await handler.onFulfilled(result);
      }
      return result;
    } catch (error) {
      for (const handler of response.handlers) {
        if (!handler?.onRejected) continue;
        return handler.onRejected(error);
      }
      throw error;
    }
  }

  const client = Object.assign(send, {
    interceptors: { request, response },
    get${isJs ? '' : ': <T = unknown>'}(url${isJs ? '' : ': string'}, config = {}) {
      return send${isJs ? '' : '<T>'}({ ...config, method: "GET", url });
    },
    post${isJs ? '' : ': <T = unknown>'}(url${isJs ? '' : ': string'}, data${isJs ? '' : ': unknown'}, config = {}) {
      return send${isJs ? '' : '<T>'}({ ...config, method: "POST", url, data });
    },
    put${isJs ? '' : ': <T = unknown>'}(url${isJs ? '' : ': string'}, data${isJs ? '' : ': unknown'}, config = {}) {
      return send${isJs ? '' : '<T>'}({ ...config, method: "PUT", url, data });
    },
    delete${isJs ? '' : ': <T = unknown>'}(url${isJs ? '' : ': string'}, config = {}) {
      return send${isJs ? '' : '<T>'}({ ...config, method: "DELETE", url });
    },
  });

  return client;
}

export const apiClient = createFetchClient({
  baseURL: publicEnv.apiUrl,
});

apiClient.interceptors.request.use((config) => {
  if (typeof document !== "undefined") {
    const locale = document.cookie
      .split("; ")
      .find((row) => row.startsWith("locale="))
      ?.split("=")[1];

    if (locale) {
      config.headers.set("Accept-Language", locale);
    }
  }

  return config;
});
`;
}

function renderGetErrorMessage(httpClient, isJs) {
  if (httpClient === 'fetch') {
    return `export function getErrorMessage(error${isJs ? '' : ': unknown'})${isJs ? '' : ': string'} {
  if (error && typeof error === "object" && "response" in error) {
    const data = error.response?.data;

    if (typeof data === "string" && data.length > 0) {
      return data;
    }

    if (
      data &&
      typeof data === "object" &&
      "title" in data &&
      typeof data.title === "string" &&
      data.title.length > 0
    ) {
      return data.title;
    }

    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "Unexpected error";
}
`;
  }

  return `import axios from "axios";

export function getErrorMessage(error${isJs ? '' : ': unknown'})${isJs ? '' : ': string'} {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;

    if (typeof data === "string" && data.length > 0) {
      return data;
    }

    if (
      data &&
      typeof data === "object" &&
      "title" in data &&
      typeof data.title === "string" &&
      data.title.length > 0
    ) {
      return data.title;
    }

    if (error.message) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "Unexpected error";
}
`;
}

async function writeZustandOverlay(clientDir, profile) {
  const storeFile = path.join(clientDir, 'src', 'store', `use-app-store.${profile.ext}`);
  await writeFile(
    storeFile,
    profile.language === 'javascript'
      ? `import { create } from "zustand";

export const useAppStore = create((set) => ({
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
`
      : `import { create } from "zustand";
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
`,
  );

  await writeFile(
    path.join(clientDir, 'src', 'modules', 'category', 'hooks', `useCategoriesController.${profile.ext === 'js' ? 'js' : 'ts'}`),
    renderZustandCategoryController(profile.language === 'javascript'),
  );

  await writeFile(
    path.join(clientDir, 'src', 'modules', 'category', `index.${profile.ext}`),
    `export { default as CategoriesPage } from "./pages/CategoriesPage";
export { default as CreateCategoryPage } from "./pages/CreateCategoryPage";
export { default as EditCategoryPage } from "./pages/EditCategoryPage";
export { default as CategoryDetailsPage } from "./pages/CategoryDetailsPage";
export { useCategoriesController } from "./hooks/useCategoriesController";
export { categoryService } from "./services/category.service";
`,
  );
}

function renderZustandCategoryController(isJs) {
  return `"use client";

import { useCallback } from "react";
import { useAppStore } from "@/store/use-app-store";
import { categoryService } from "../services/category.service";
${isJs ? '' : `import type { CreateCategoryInput, CategoryQuery, UpdateCategoryInput } from "../types/category.types";
`}
export function useCategoriesController() {
  const items = useAppStore((state) => state.category.items);
  const selected = useAppStore((state) => state.category.selected);
  const status = useAppStore((state) => state.category.status);
  const error = useAppStore((state) => state.category.error);
  const setCategoryItems = useAppStore((state) => state.setCategoryItems);
  const setCategorySelected = useAppStore((state) => state.setCategorySelected);
  const setCategoryError = useAppStore((state) => state.setCategoryError);
  const setCategoryStatus = useAppStore((state) => state.setCategoryStatus);

  const load = useCallback(${isJs ? '(query)' : '(query: CategoryQuery)'} => {
    setCategoryStatus("loading");
    void categoryService
      .search(query)
      .then((result) => setCategoryItems(result.data ?? []))
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to load categories"));
  }, [setCategoryError, setCategoryItems, setCategoryStatus]);

  const loadById = useCallback(${isJs ? '(id)' : '(id: string)'} => {
    setCategoryStatus("loading");
    void categoryService
      .getById(id)
      .then((item) => setCategorySelected(item))
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to load category"));
  }, [setCategoryError, setCategorySelected, setCategoryStatus]);

  const create = useCallback(${isJs ? '(input)' : '(input: CreateCategoryInput)'} => {
    void categoryService
      .create(input)
      .then((item) => setCategoryItems([item, ...useAppStore.getState().category.items]))
      .catch((err) => setCategoryError(err instanceof Error ? err.message : "Unable to create category"));
  }, [setCategoryError, setCategoryItems]);

  const update = useCallback(${isJs ? '(input)' : '(input: UpdateCategoryInput)'} => {
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
`;
}

async function writeNoneStateOverlay(clientDir, profile) {
  await writeFile(
    path.join(clientDir, 'src', 'modules', 'category', 'hooks', `useCategoriesController.${profile.ext}`),
    `"use client";

import { useCallback, useState } from "react";
import { categoryService } from "../services/category.service";

export function useCategoriesController() {
  const [items, setItems] = useState${profile.language === 'javascript' ? '' : '<{ id: string; name: string; description: string; createdAtUtc: string }[]>'}([]);
  const [selected, setSelected] = useState${profile.language === 'javascript' ? '' : '<{ id: string; name: string; description: string; createdAtUtc: string } | null>'}(null);
  const [status, setStatus] = useState${profile.language === 'javascript' ? '' : '<"idle" | "loading" | "succeeded" | "failed">'}("idle");
  const [error, setError] = useState${profile.language === 'javascript' ? '' : '<string | null>'}(null);

  const load = useCallback((query${profile.language === 'javascript' ? '' : ': { page: number; pageSize: number }'}) => {
    setStatus("loading");
    void categoryService
      .search(query)
      .then((result) => {
        setItems(result.data ?? []);
        setStatus("succeeded");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load categories");
        setStatus("failed");
      });
  }, []);

  const loadById = useCallback((id${profile.language === 'javascript' ? '' : ': string'}) => {
    setStatus("loading");
    void categoryService
      .getById(id)
      .then((item) => {
        setSelected(item);
        setStatus("succeeded");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load category");
        setStatus("failed");
      });
  }, []);

  const create = useCallback((input${profile.language === 'javascript' ? '' : ': { name: string; description: string }'}) => {
    void categoryService.create(input).then((item) => setItems((current) => [item, ...current]));
  }, []);

  const update = useCallback((input${profile.language === 'javascript' ? '' : ': { id: string; name: string; description: string }'}) => {
    void categoryService.update(input).then((item) => {
      setSelected(item);
      setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
    });
  }, []);

  return { items, selected, pagination: null, status, error, load, loadById, create, update };
}
`,
  );

  await writeFile(
    path.join(clientDir, 'src', 'modules', 'category', `index.${profile.ext}`),
    `export { default as CategoriesPage } from "./pages/CategoriesPage";
export { default as CreateCategoryPage } from "./pages/CreateCategoryPage";
export { default as EditCategoryPage } from "./pages/EditCategoryPage";
export { default as CategoryDetailsPage } from "./pages/CategoryDetailsPage";
export { useCategoriesController } from "./hooks/useCategoriesController";
export { categoryService } from "./services/category.service";
`,
  );
}

async function writeSignalRClient(clientDir, profile) {
  const content = `import { useEffect, useState } from "react";
import * as signalR from "@microsoft/signalr";

export function useSignalR(hubUrl${profile.language === 'javascript' ? '' : ': string'} = "/hubs/app") {
  const [connection, setConnection] = useState${profile.language === 'javascript' ? '' : '<signalR.HubConnection | null>'}(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => {
          return "";
        },
      })
      .withAutomaticReconnect()
      .build();

    conn
      .start()
      .then(() => {
        setIsConnected(true);
        setConnection(conn);
      })
      .catch((err) => {
        console.warn("SignalR connection error:", err);
      });

    return () => {
      void conn.stop();
    };
  }, [hubUrl]);

  return { connection, isConnected };
}
`;
  await writeFile(
    path.join(clientDir, 'src', 'shared', 'services', `useSignalR.${profile.ext}`),
    content,
  );
}

async function convertOverlayToJavaScript(clientDir) {
  const srcDir = path.join(clientDir, 'src');
  if (!(await pathExists(srcDir))) {
    return;
  }
  await convertDirectory(srcDir);
}

async function convertDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      await convertDirectory(full);
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    const source = await fs.readFile(full, 'utf8');
    const converted = convertTypeScriptToJavaScript(source);
    const dest = toJavaScriptFileName(full);
    await writeFile(dest, converted);
    await fs.unlink(full);
  }
}
