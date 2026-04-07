import { Link } from "react-router-dom";

interface NotFoundProps {
  title?: string;
  message?: string;
  backHref?: string;
  backLabel?: string;
  fullScreen?: boolean;
}

export function NotFound({
  title = "404",
  message = "The page you're looking for doesn't exist or has been removed.",
  backHref = "/",
  backLabel = "Back to home",
  fullScreen = false,
}: NotFoundProps) {
  const wrapperClass = fullScreen
    ? "min-h-screen bg-noc-bg flex items-center justify-center px-4"
    : "h-[calc(100vh-48px)] bg-noc-bg flex items-center justify-center px-4";

  return (
    <div className={wrapperClass}>
      <div className="noc-card p-8 max-w-sm w-full text-center animate-fade-in">
        <div className="text-5xl font-bold text-accent mb-2 tabular-nums tracking-tight">
          {title}
        </div>
        <div className="noc-label mb-4">Not found</div>
        <p className="text-2xs text-noc-text-muted mb-6 leading-relaxed">
          {message}
        </p>
        <Link
          to={backHref}
          className="inline-block px-4 py-2 bg-accent/10 text-accent border border-accent/20 rounded text-2xs font-medium tracking-wider uppercase hover:bg-accent/20 transition-colors"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
