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
  const forms =
    frontend.forms === 'none' ? 'none' : 'react-hook-form-zod';
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

  if (forms === 'none') {
    skipPaths.push(
      path.join('src', 'modules', 'category', 'schemas'),
    );
  }

  if (httpClient === 'fetch') {
    skipPaths.push(
      path.join('src', 'lib', 'api', 'api-client.ts'),
      path.join('src', 'shared', 'utils', 'get-error-message.ts'),
    );
  }

  return {
    language,
    httpClient,
    state,
    forms,
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

  if (profile.state === 'zustand') {
    await writeZustandOverlay(options.clientDir, profile);
  } else if (profile.state === 'none') {
    await writeNoneStateOverlay(options.clientDir, profile);
  }

  if (profile.forms === 'none') {
    await writeNoneFormsOverlay(options.clientDir, profile);
  }

  if (frontend.realtime === 'signalr') {
    await writeSignalRClient(options.clientDir, profile);
  }

  if (profile.language === 'javascript') {
    await convertOverlayToJavaScript(options.clientDir);
  }
}

async function writeNoneFormsOverlay(clientDir, profile) {
  const isJs = profile.language === 'javascript';
  const createPageFile = path.join(clientDir, 'src', 'modules', 'category', 'pages', `CreateCategoryPage.${profile.jsxExt}`);
  const editPageFile = path.join(clientDir, 'src', 'modules', 'category', 'pages', `EditCategoryPage.${profile.jsxExt}`);

  const createContent = `"use client";

import { useState } from "react";
import { useCategoriesController } from "../hooks/useCategoriesController";
import { PageHeader } from "@/shared/components/common/PageHeader";
import { ErrorState } from "@/shared/components/empty-state/ErrorState";

export default function CreateCategoryPage() {
  const { status, error, create } = useCategoriesController();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = (e${isJs ? '' : ': React.FormEvent'}) => {
    e.preventDefault();
    if (!name.trim()) return;
    create({ name, description });
  };

  return (
    <main className="ui-container ui-page" style={{ paddingTop: "2.5rem", paddingBottom: "3.5rem" }}>
      <PageHeader
        title="Create category"
        description="Add a category name and optional description."
        actions={
          <a href="/dashboard/category" className="ui-btn ui-btn-ghost">
            Back to list
          </a>
        }
      />

      {status === "failed" && error ? <ErrorState description={error} /> : null}

      <form
        className="ui-card"
        style={{ margin: "1.2rem 0" }}
        onSubmit={handleSubmit}
      >
        <label className="ui-field">
          Name
          <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="ui-field">
          Description
          <textarea className="ui-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={status === "loading"}>
          Save category
        </button>
      </form>
    </main>
  );
}
`;

  const editContent = `"use client";

import { useEffect, useState } from "react";
import { useCategoriesController } from "../hooks/useCategoriesController";
import { PageHeader } from "@/shared/components/common/PageHeader";
import { EmptyState } from "@/shared/components/empty-state/EmptyState";
import { ErrorState } from "@/shared/components/empty-state/ErrorState";
import { LoadingState } from "@/shared/components/loaders/LoadingState";

export default function EditCategoryPage({ id }${isJs ? '' : ': { id: string }'}) {
  const { selected, status, error, loadById, update } = useCategoriesController();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (id) {
      loadById(id);
    }
  }, [id, loadById]);

  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setDescription(selected.description ?? "");
    }
  }, [selected]);

  const handleSubmit = (e${isJs ? '' : ': React.FormEvent'}) => {
    e.preventDefault();
    if (!name.trim()) return;
    update({ id, name, description });
  };

  return (
    <main className="ui-container ui-page" style={{ paddingTop: "2.5rem", paddingBottom: "3.5rem" }}>
      <PageHeader
        title="Edit category"
        description="Update the category name or description."
        actions={
          <a href="/dashboard/category" className="ui-btn ui-btn-ghost">
            Back to list
          </a>
        }
      />

      {status === "failed" && error ? <ErrorState description={error} /> : null}
      {status === "loading" && !selected ? <LoadingState description="Loading category…" /> : null}

      {!selected && status !== "loading" ? (
        <EmptyState title="Category not loaded" description="Open a category from the list to edit it." />
      ) : (
        <form
          className="ui-card"
          style={{ margin: "1.2rem 0" }}
          onSubmit={handleSubmit}
        >
          <label className="ui-field">
            Name
            <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="ui-field">
            Description
            <textarea className="ui-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="submit" className="ui-btn ui-btn-primary" disabled={status === "loading"}>
            Save changes
          </button>
        </form>
      )}
    </main>
  );
}
`;

  await writeFile(createPageFile, createContent);
  await writeFile(editPageFile, editContent);

  if (isJs) {
    const tsxCreate = path.join(clientDir, 'src', 'modules', 'category', 'pages', 'CreateCategoryPage.tsx');
    const tsxEdit = path.join(clientDir, 'src', 'modules', 'category', 'pages', 'EditCategoryPage.tsx');
    if (await pathExists(tsxCreate)) await fs.unlink(tsxCreate);
    if (await pathExists(tsxEdit)) await fs.unlink(tsxEdit);
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
  if (isJs) {
    return `import { publicEnv } from "@/lib/config/env";

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
  if (!params) return target;
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

  async function send(config) {
    let next = { ...config, headers: { ...(config.headers || {}) } };
    for (const handler of request.handlers) {
      if (handler?.onFulfilled) next = await handler.onFulfilled(next);
    }

    const url = buildUrl(options.baseURL, next.url ?? "", next.params);
    const isFormData = typeof FormData !== "undefined" && next.data instanceof FormData;
    const headers = { ...next.headers };
    if (!isFormData && next.data !== undefined && !headers["Content-Type"]) {
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

      let httpResponse = {
        data,
        status: fetched.status,
        statusText: fetched.statusText,
        config: next,
        headers: fetched.headers,
      };

      if (!fetched.ok) {
        const error = { message: fetched.statusText, response: httpResponse, config: next };
        for (const handler of response.handlers) {
          if (handler?.onRejected) return handler.onRejected(error);
        }
        throw error;
      }

      for (const handler of response.handlers) {
        if (handler?.onFulfilled) httpResponse = await handler.onFulfilled(httpResponse);
      }
      return httpResponse;
    } catch (error) {
      for (const handler of response.handlers) {
        if (handler?.onRejected) return handler.onRejected(error);
      }
      throw error;
    }
  }

  return Object.assign(send, {
    interceptors: { request, response },
    get: (url, config = {}) => send({ ...config, method: "GET", url }),
    post: (url, data, config = {}) => send({ ...config, method: "POST", url, data }),
    put: (url, data, config = {}) => send({ ...config, method: "PUT", url, data }),
    delete: (url, config = {}) => send({ ...config, method: "DELETE", url }),
  });
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
      config.headers = config.headers || {};
      config.headers["Accept-Language"] = locale;
    }
  }

  return config;
});
`;
  }

  return `import { publicEnv } from "@/lib/config/env";

type InterceptorHandler<T> = {
  onFulfilled?: (value: T) => T | Promise<T>;
  onRejected?: (error: any) => any;
};

function createInterceptor<T>() {
  const handlers: (InterceptorHandler<T> | null)[] = [];
  return {
    use(onFulfilled?: (value: T) => T | Promise<T>, onRejected?: (error: any) => any) {
      handlers.push({ onFulfilled, onRejected });
      return handlers.length - 1;
    },
    eject(id: number) {
      handlers[id] = null;
    },
    handlers,
  };
}

function buildUrl(baseURL: string, url: string, params?: Record<string, any>) {
  const target = url.startsWith("http") ? url : \`\${baseURL.replace(/\\/$/, "")}/\${url.replace(/^\\//, "")}\`;
  if (!params) return target;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? \`\${target}?\${query}\` : target;
}

export type FetchClientRequestConfig = {
  url?: string;
  method?: string;
  params?: Record<string, any>;
  data?: any;
  headers?: Record<string, string>;
  [key: string]: any;
};

export type FetchClientResponse<T = any> = {
  data: T;
  status: number;
  statusText: string;
  config: FetchClientRequestConfig;
  headers: Headers;
};

export function createFetchClient(options: { baseURL: string }) {
  const request = createInterceptor<FetchClientRequestConfig>();
  const response = createInterceptor<FetchClientResponse>();

  async function send<T = any>(config: FetchClientRequestConfig): Promise<FetchClientResponse<T>> {
    let next: FetchClientRequestConfig = { ...config, headers: { ...(config.headers || {}) } };
    for (const handler of request.handlers) {
      if (handler?.onFulfilled) next = await handler.onFulfilled(next);
    }

    const url = buildUrl(options.baseURL, next.url ?? "", next.params);
    const isFormData = typeof FormData !== "undefined" && next.data instanceof FormData;
    const headers: Record<string, string> = { ...next.headers };
    if (!isFormData && next.data !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const init: RequestInit = {
      method: next.method ?? "GET",
      credentials: "include" as RequestCredentials,
      headers,
      body: next.data === undefined ? undefined : isFormData ? next.data : JSON.stringify(next.data),
    };

    try {
      const fetched = await fetch(url, init);
      const text = await fetched.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      let httpResponse: FetchClientResponse<T> = {
        data,
        status: fetched.status,
        statusText: fetched.statusText,
        config: next,
        headers: fetched.headers,
      };

      if (!fetched.ok) {
        const error = { message: fetched.statusText, response: httpResponse, config: next };
        for (const handler of response.handlers) {
          if (handler?.onRejected) return handler.onRejected(error);
        }
        throw error;
      }

      for (const handler of response.handlers) {
        if (handler?.onFulfilled) httpResponse = (await handler.onFulfilled(httpResponse)) as FetchClientResponse<T>;
      }
      return httpResponse;
    } catch (error) {
      for (const handler of response.handlers) {
        if (handler?.onRejected) return handler.onRejected(error);
      }
      throw error;
    }
  }

  return Object.assign(send, {
    interceptors: { request, response },
    get<T = any>(url: string, config: FetchClientRequestConfig = {}) {
      return send<T>({ ...config, method: "GET", url });
    },
    post<T = any>(url: string, data?: any, config: FetchClientRequestConfig = {}) {
      return send<T>({ ...config, method: "POST", url, data });
    },
    put<T = any>(url: string, data?: any, config: FetchClientRequestConfig = {}) {
      return send<T>({ ...config, method: "PUT", url, data });
    },
    delete<T = any>(url: string, config: FetchClientRequestConfig = {}) {
      return send<T>({ ...config, method: "DELETE", url });
    },
  });
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
      if (typeof Headers !== "undefined" && config.headers instanceof Headers) {
        config.headers.set("Accept-Language", locale);
      } else {
        config.headers = config.headers || {};
        config.headers["Accept-Language"] = locale;
      }
    }
  }

  return config;
});
`;
}

function renderGetErrorMessage(httpClient, isJs) {
  if (httpClient === 'fetch') {
    if (isJs) {
      return `export function getErrorMessage(error) {
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

    return `export function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const data = (error as { response?: { data?: unknown }; message?: string }).response?.data;

    if (typeof data === "string" && data.length > 0) {
      return data;
    }

    if (
      data &&
      typeof data === "object" &&
      "title" in data &&
      typeof (data as { title?: unknown }).title === "string" &&
      (data as { title: string }).title.length > 0
    ) {
      return (data as { title: string }).title;
    }

    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
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

async function writeProfileFile(filePath, contents) {
  await writeFile(filePath, contents);
  if (filePath.endsWith('.js')) {
    const ts = filePath.slice(0, -3) + '.ts';
    if (await pathExists(ts)) await fs.unlink(ts);
  } else if (filePath.endsWith('.jsx')) {
    const tsx = filePath.slice(0, -4) + '.tsx';
    if (await pathExists(tsx)) await fs.unlink(tsx);
  }
}

async function writeNoneStateOverlay(clientDir, profile) {
  await writeProfileFile(
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

  await writeProfileFile(
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
