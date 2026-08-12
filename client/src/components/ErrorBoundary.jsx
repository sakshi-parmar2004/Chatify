import { Component } from "react";
import { reportError } from "../lib/errorReporter";

// Without this, any render-time throw unmounts the whole app and leaves a blank
// page with no way back.
class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // OBS-03. This used to console.error and stop there, which is how a
    // temporal-dead-zone crash shipped and was found by a person opening the
    // app rather than by anything automated.
    reportError({
      message: error?.message ?? String(error),
      stack: error?.stack,
      componentStack: info?.componentStack,
      kind: "render",
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
        <p className="max-w-md text-muted">
          The app hit an unexpected error. Reloading usually clears it, and a report has
          been sent so it can be fixed.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="btn-ghost text-sm">
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
