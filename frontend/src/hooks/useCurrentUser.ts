import { useEffect, useState } from "react";
import { apiGet } from "../api/client";

export type UserRole = "owner" | "admin" | "user";

export interface CurrentUser {
  username: string;
  role: UserRole;
}

export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ username: string; role: string }>("/api/me")
      .then((res) => {
        if (!cancelled && res?.username) {
          setUser({
            username: res.username,
            role: (res.role === "owner" || res.role === "admin" || res.role === "user" ? res.role : "user") as UserRole,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}
