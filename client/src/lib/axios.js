import axios from "axios";


console.log(import.meta.env.MODE)
export const axiosInstance = axios.create({
  baseURL: import.meta.env.MODE === "development" ? "http://localhost:8000/api" : "/api",
  withCredentials: true,
});