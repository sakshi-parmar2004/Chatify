import { create } from "zustand";
import { axiosInstance } from "../lib/axios";
import toast from 'react-hot-toast'
import { io } from "socket.io-client";

// Same-origin in both modes: the Vite dev server proxies /api and /socket.io
// to the API, and in production the server serves the built SPA itself.
const SOCKET_URL = "/";

// error.response is undefined for network failures, timeouts and CORS
// rejections, so reading .data.message directly throws and swallows the toast.
const errorMessage = (error, fallback = "Something went wrong") =>
  error?.response?.data?.message || fallback;

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isCheckingAuth: true,
  isSigningUp: false,
  isLoggingIn: false,
  socket: null,
  onlineUsers: [],

  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/get-user");
      set({ authUser: res.data.user });
      get().connectSocket();
    } catch {
      // an unauthenticated visitor is the expected case here, not an error
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/register", data);

      set({ authUser: res.data.user });

      toast.success("Account created successfully!");
      get().connectSocket();
    } catch (error) {
      toast.error(errorMessage(error, "Could not create account"));
    } finally {
      set({ isSigningUp: false });
    }
  },

  login: async (data) => {
    set({ isLoggingIn: true });

    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data.user });
      toast.success("Logged in successfully");

      get().connectSocket();
    } catch (error) {
      toast.error(errorMessage(error, "Could not log in"));
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
      get().disconnectSocket();
      set({ authUser: null });
      toast.success("Logged out successfully");
    } catch (error) {
      toast.error(errorMessage(error, "Error logging out"));
    }
  },

  updateProfile: async (data) => {
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data.updatedUser });
      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error(errorMessage(error, "Could not update profile"));
    }
  },


  connectSocket: () => {
    const { authUser } = get();
    if (!authUser || get().socket?.connected) return;

    const socket = io(SOCKET_URL, {
      withCredentials: true, // this ensures cookies are sent with the connection
    });

    set({ socket });
    get().subscribeToPresence();
  },

  /**
   * PLT-05 — the server no longer broadcasts the whole roster. On connect it
   * sends the subset of our own contacts who are online; after that we get one
   * delta per contact, rather than a full list to everyone every time anyone
   * anywhere connects or disconnects.
   *
   * Separate from connectSocket so it can be exercised without opening a real
   * connection.
   */
  subscribeToPresence: () => {
    const { socket } = get();
    if (!socket) return;

    socket.on("getOnlineUsers", (userIds) => set({ onlineUsers: userIds }));

    socket.on("presence", ({ userId, online }) => {
      set((state) => ({
        onlineUsers: online
          ? [...new Set([...state.onlineUsers, userId])]
          : state.onlineUsers.filter((id) => id !== userId),
      }));
    });
  },

  disconnectSocket: () => {
    const { socket } = get();
    if (!socket) return;

    // drop the listeners too, or every logout/login cycle leaves another
    // subscribed socket behind
    socket.off();
    socket.disconnect();
    set({ socket: null, onlineUsers: [] });
  },
  }));
