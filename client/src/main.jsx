import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { BrowserRouter } from 'react-router'
import { installGlobalErrorHandlers } from "./lib/errorReporter.js";

// OBS-03 — catches what React's boundary cannot: errors outside render and
// promises that reject with nobody listening.
installGlobalErrorHandlers();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
      <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
