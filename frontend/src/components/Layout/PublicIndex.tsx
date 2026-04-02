import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useTheme } from "@/hooks/useTheme";

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
  const { theme, cycle } = useTheme();

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

  if (loading) {
    return (
      <div className="min-h-screen bg-noc-bg flex items-center justify-center">
        <div className="w-6 h-6 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
      </div>
    );
  }

  if (!enabled) {
    // Redirect to login
    window.location.href = "/auth/login";
    return null;
  }

  return (
    <div className="min-h-screen bg-noc-bg text-noc-text">
      {/* Header */}
      <header className="h-12 border-b border-noc-border bg-noc-bg/80 backdrop-blur-md flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-accent" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="12" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <circle cx="19" cy="19" r="2" />
            <path d="M12 7v4M10.5 12.5l-4 5M13.5 12.5l4 5" />
            <rect x="9" y="11" width="6" height="3" rx="1" />
          </svg>
          <span className="text-xs font-semibold tracking-wider text-accent">NETMAP</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={cycle}
            className="p-1.5 rounded text-noc-text-muted hover:text-noc-text hover:bg-noc-surface transition-colors"
            title={`Theme: ${theme}`}
          >
            {theme === "dark" && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            {theme === "light" && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            )}
            {(theme === "system" || theme === "scada") && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
              </svg>
            )}
          </button>
          <a
            href="/auth/login"
            className="px-3 py-1 rounded text-2xs font-medium tracking-wider uppercase bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
          >
            Login
          </a>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10 animate-fade-in">
          <h1 className="text-2xl font-bold text-noc-text mb-2">Network Maps</h1>
          <p className="text-xs text-noc-text-muted">Public network topology views</p>
        </div>

        {maps.length === 0 ? (
          <div className="text-center py-16 text-noc-text-dim animate-fade-in">
            <p className="text-xs">No public maps available</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {maps.map((m, i) => (
              <Link
                key={m.id}
                to={`/public/${m.public_token}`}
                className={`group noc-card p-5 hover:border-accent/30 transition-all duration-200 animate-fade-in opacity-0`}
                style={{ animationDelay: `${i * 0.05}s`, animationFillMode: "forwards" }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-8 h-8 rounded bg-accent/10 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-noc-text-dim group-hover:text-accent transition-colors" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
                <h2 className="text-sm font-medium text-noc-text mb-1">{m.name}</h2>
                {m.description && (
                  <p className="text-2xs text-noc-text-muted line-clamp-2">{m.description}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
