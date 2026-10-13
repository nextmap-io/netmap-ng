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
    ? "min-h-screen bg-background text-foreground px-4"
    : "h-[calc(100vh-48px)] bg-background text-foreground px-4";

  return (
    <div className={wrapperClass}>
      <div className="max-w-xl mx-auto pt-16 sm:pt-24">
        <h1 className="text-2xl font-semibold text-foreground">Not found</h1>
        <p className="mt-2 text-base text-foreground-secondary">{message}</p>
        <p className="mt-1 text-sm text-muted-foreground">Error {title}</p>
        <Link to={backHref} className="inline-block mt-6 text-base text-link hover:underline">
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
