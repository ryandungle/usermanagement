import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "./auth-client";
import { api, type Me } from "./api";

interface MeContextValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const MeContext = createContext<MeContextValue>({ me: null, loading: true, refresh: async () => {} });

/** Loads /api/me (scope + permissions) whenever the Better Auth session changes. */
export function MeProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    if (!isPending) void refresh();
  }, [isPending, refresh]);

  return <MeContext.Provider value={{ me, loading, refresh }}>{children}</MeContext.Provider>;
}

export function useMe() {
  return useContext(MeContext);
}
