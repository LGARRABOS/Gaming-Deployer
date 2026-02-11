import { useEffect, useState } from "react";
import { apiGet } from "../api/client";

interface StatusResponse {
  initialized: boolean;
}

export function useAppStatus() {
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<StatusResponse>("/api/status")
      .then((res) => {
        if (!cancelled) {
          setInitialized(res.initialized);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInitialized(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { initialized, loading };
}

