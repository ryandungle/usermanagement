import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const BUNDLE_RE = /assets\/index-[\w-]+\.js/;

function currentBundle(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el?.src.match(BUNDLE_RE)?.[0] ?? null;
}

async function deployedBundle(): Promise<string | null> {
  try {
    const res = await fetch("/index.html", { cache: "no-store", credentials: "omit" });
    if (!res.ok) return null;
    return (await res.text()).match(BUNDLE_RE)?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The SPA keeps running the bundle it loaded even after a new deploy. This
 * compares the running bundle with what the server now serves, on tab focus and
 * every few minutes, and offers a reload when they differ.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const running = currentBundle();
    if (!running) return;
    let cancelled = false;

    const check = async () => {
      const live = await deployedBundle();
      if (!cancelled && live && live !== running) setStale(true);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, 3 * 60 * 1000);
    void check();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (!stale) return null;

  return (
    <div role="status" className="bg-card text-card-foreground fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border p-3 shadow-lg">
      <span className="text-sm">A new version is available.</span>
      <Button size="sm" onClick={() => window.location.reload()}>
        <RefreshCwIcon />
        Reload
      </Button>
    </div>
  );
}
