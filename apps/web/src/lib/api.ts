export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: "user" | "admin";
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface ListUsersParams {
  q?: string;
  role?: "user" | "admin" | "";
  banned?: "true" | "false" | "";
  page?: number;
  pageSize?: number;
  sort?: "createdAt" | "name" | "email";
  order?: "asc" | "desc";
}

export const api = {
  listUsers(params: ListUsersParams) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    return request<{ data: ManagedUser[]; pagination: Pagination }>(`/api/users?${qs}`);
  },
  getUser(id: string) {
    return request<{ data: ManagedUser }>(`/api/users/${id}`);
  },
  updateUser(id: string, data: { name?: string; email?: string }) {
    return request<{ data: ManagedUser }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  setRole(id: string, role: "user" | "admin") {
    return request<{ data: ManagedUser }>(`/api/users/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
  },
  banUser(id: string, data: { reason?: string; expiresIn?: number }) {
    return request<{ data: ManagedUser }>(`/api/users/${id}/ban`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  unbanUser(id: string) {
    return request<{ data: ManagedUser }>(`/api/users/${id}/unban`, { method: "POST" });
  },
  revokeSessions(id: string) {
    return request<{ data: { success: boolean } }>(`/api/users/${id}/revoke-sessions`, {
      method: "POST",
    });
  },
  deleteUser(id: string) {
    return request<{ data: { success: boolean } }>(`/api/users/${id}`, { method: "DELETE" });
  },
  updateMe(data: { name?: string; image?: string | null }) {
    return request<{ data: { status: boolean } }>(`/api/me`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
};
