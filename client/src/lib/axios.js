import axios from "axios";

// Relative in both modes: Vite proxies /api to the API server in development,
// and in production the API is served from the same origin as the SPA.
export const axiosInstance = axios.create({
  baseURL: "/api",
  withCredentials: true,
});
