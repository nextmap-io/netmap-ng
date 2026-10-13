import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { AppMark, ThemeToggle } from "./Header";

interface PublicMap {
  id: string;
  name: string;
  description: string;
  public_token: string;
}

export function PublicIndex() {
  const [maps, setMaps] = useState<PublicMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    api.getPublicConfig()
      .then((config) => {
        setEnabled(config.public_index);
        if (config.public_index) {
          return api.listPublicMaps();
        }
        return [];
      })
      .then(setMaps)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // No public index: send the visitor to the login page (a side effect, so it
  // belongs in an effect rather than in render).
  useEffect(() => {
    if (!loading && !enabled) window.location.assign("/auth/login");
  }, [loading, enabled]);

  if (!loading && !enabled) return null;

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-50 h-12 border-b border-border bg-background flex items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2 text-foreground">
          <AppMark />
          <span className="text-base font-semibold" style={{ fontStretch: "112%" }}>Netmap</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a
            href="/auth/login"
            className="h-7 inline-flex items-center px-2.5 rounded border border-border text-sm text-foreground hover:bg-muted transition-colors"
          >
            Log in
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-semibold text-foreground">Network maps</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Public views of the network topology and live traffic. Log in to see and edit internal maps.
        </p>

        {loading ? (
          <div className="h-32 rounded bg-muted" role="status" aria-label="Loading public maps" />
        ) : maps.length === 0 ? (
          <p className="border-t border-border pt-4 text-base text-foreground-secondary">
            No map is published publicly yet. Log in to see the maps shared within your organisation.
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-base">
            <thead>
              <tr className="border-b border-border text-left text-sm text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-normal sm:w-1/3">Name</th>
                <th scope="col" className="py-2 font-normal hidden sm:table-cell">Description</th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id} className="border-b border-border-soft align-top hover:bg-muted transition-colors">
                  <td className="py-2.5 pr-3">
                    <Link
                      to={`/public/${encodeURIComponent(m.public_token)}`}
                      className="block truncate font-medium text-foreground hover:underline"
                    >
                      {m.name}
                    </Link>
                    {m.description && (
                      <p className="sm:hidden mt-0.5 text-sm text-foreground-secondary line-clamp-2">{m.description}</p>
                    )}
                  </td>
                  <td className="py-2.5 hidden sm:table-cell text-sm text-foreground-secondary">
                    <span className="line-clamp-2">{m.description || <span className="text-muted-foreground">—</span>}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
