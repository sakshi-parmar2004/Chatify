import { LoaderIcon } from "lucide-react";

/**
 * Rendered before the app shell exists, during the auth check — so it owns its
 * own page chrome. Previously it had no background and no colour at all, which
 * meant a flash of unstyled white on every cold load.
 */
function PageLoader() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-bg">
      <LoaderIcon className="size-10 animate-spin text-accent-soft" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
export default PageLoader;
