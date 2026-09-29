import type { Actor, Role, ScopeLevel } from "@usermanagement/shared";

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: Role;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  clientId: string | null;
  companyId: string | null;
  clientName: string | null;
  companyName: string | null;
  /** Office memberships (office-level roles only). */
  offices: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  companyCount?: number;
}
export interface Company {
  id: string;
  clientId: string;
  clientName?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  officeCount?: number;
}
export interface Office {
  id: string;
  companyId: string;
  companyName?: string;
  clientId?: string;
  clientName?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  userCount?: number;
}

export interface Me {
  user: { id: string; name: string; email: string; role: Role; createdAt: string };
  actor: Actor;
  scope: { level: ScopeLevel; clientName: string | null; companyName: string | null; offices: { id: string; name: string }[] };
  permissions: {
    assignableRoles: Role[];
    canManageUsers: boolean;
    canCreateOffices: boolean;
    canCreateCompanies: boolean;
    canCreateClients: boolean;
  };
}

export interface Overview {
  totals: { users: number; banned: number; clients: number; companies: number; offices: number };
  series: { date: string; newUsers: number; signIns: number }[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body;
}

function qs(params: Record<string, string | number | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface ListUsersParams {
  q?: string;
  role?: Role | "";
  banned?: "true" | "false" | "";
  clientId?: string;
  companyId?: string;
  officeId?: string;
  page?: number;
  pageSize?: number;
  sort?: "createdAt" | "name" | "email" | "role";
  order?: "asc" | "desc";
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  clientId?: string;
  companyId?: string;
  officeIds?: string[];
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

export const api = {
  me: () => request<Me>("/api/me"),
  overview: () => request<Overview>("/api/stats/overview"),
  updateMe: (data: { name?: string; image?: string | null }) => request<{ data: unknown }>("/api/me", json("PATCH", data)),

  // organization tree
  listClients: () => request<{ data: Client[] }>("/api/clients"),
  getClient: (id: string) => request<{ data: Client }>(`/api/clients/${id}`),
  createClient: (name: string) => request<{ data: Client }>("/api/clients", json("POST", { name })),
  renameClient: (id: string, name: string) => request<{ data: Client }>(`/api/clients/${id}`, json("PATCH", { name })),
  deleteClient: (id: string) => request<{ data: { success: boolean } }>(`/api/clients/${id}`, json("DELETE")),

  listCompanies: (clientId?: string) => request<{ data: Company[] }>(`/api/companies${qs({ clientId })}`),
  getCompany: (id: string) => request<{ data: Company }>(`/api/companies/${id}`),
  createCompany: (clientId: string, name: string) =>
    request<{ data: Company }>("/api/companies", json("POST", { clientId, name })),
  renameCompany: (id: string, name: string) => request<{ data: Company }>(`/api/companies/${id}`, json("PATCH", { name })),
  deleteCompany: (id: string) => request<{ data: { success: boolean } }>(`/api/companies/${id}`, json("DELETE")),

  listOffices: (params: { companyId?: string; clientId?: string }) => request<{ data: Office[] }>(`/api/offices${qs(params)}`),
  getOffice: (id: string) => request<{ data: Office }>(`/api/offices/${id}`),
  createOffice: (companyId: string, name: string) =>
    request<{ data: Office }>("/api/offices", json("POST", { companyId, name })),
  renameOffice: (id: string, name: string) => request<{ data: Office }>(`/api/offices/${id}`, json("PATCH", { name })),
  deleteOffice: (id: string) => request<{ data: { success: boolean } }>(`/api/offices/${id}`, json("DELETE")),

  // users
  listUsers: (params: ListUsersParams) =>
    request<{ data: ManagedUser[]; pagination: Pagination }>(`/api/users${qs({ ...params })}`),
  getUser: (id: string) => request<{ data: ManagedUser }>(`/api/users/${id}`),
  createUser: (data: CreateUserInput) => request<{ data: ManagedUser }>("/api/users", json("POST", data)),
  updateUser: (id: string, data: { name?: string; email?: string }) =>
    request<{ data: ManagedUser }>(`/api/users/${id}`, json("PATCH", data)),
  setRole: (id: string, data: { role: Role; clientId?: string; companyId?: string; officeIds?: string[] }) =>
    request<{ data: ManagedUser }>(`/api/users/${id}/role`, json("PUT", data)),
  setOffices: (id: string, officeIds: string[]) =>
    request<{ data: ManagedUser }>(`/api/users/${id}/offices`, json("PUT", { officeIds })),
  setPassword: (id: string, password: string) =>
    request<{ data: { success: boolean } }>(`/api/users/${id}/password`, json("PUT", { password })),
  banUser: (id: string, data: { reason?: string; expiresIn?: number }) =>
    request<{ data: ManagedUser }>(`/api/users/${id}/ban`, json("POST", data)),
  unbanUser: (id: string) => request<{ data: ManagedUser }>(`/api/users/${id}/unban`, json("POST")),
  revokeSessions: (id: string) => request<{ data: { success: boolean } }>(`/api/users/${id}/revoke-sessions`, json("POST")),
  deleteUser: (id: string) => request<{ data: { success: boolean } }>(`/api/users/${id}`, json("DELETE")),
};
