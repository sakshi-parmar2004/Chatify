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
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold text-slate-200">Something went wrong</h1>
        <p className="text-slate-400 max-w-md">
          The app hit an unexpected error. Reloading usually clears it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm text-cyan-400 bg-cyan-500/10 rounded-lg hover:bg-cyan-500/20 transition-colors"
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
