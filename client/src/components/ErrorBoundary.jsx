import { Component } from "react";

// Without this, any render-time throw unmounts the whole app and leaves a blank
// page with no way back.
class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[100dvh] bg-bg flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
        <p className="text-muted max-w-md">
          The app hit an unexpected error. Reloading usually clears it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm text-accent-soft bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
