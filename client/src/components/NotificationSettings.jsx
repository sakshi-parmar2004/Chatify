import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BellIcon, XIcon } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { enablePush, disablePush, isPushSupported, pushPermission } from "../lib/push";

const toMinutes = (value) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

const toTimeValue = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** NTF-01, NTF-05 — the one place notification behaviour is configured. */
function NotificationSettings({ onClose }) {
  const [pushEnabled, setPushEnabled] = useState(pushPermission() === "granted");
  const [isBusy, setIsBusy] = useState(false);
  const [dnd, setDnd] = useState({
    enabled: false,
    startMinute: 22 * 60,
    endMinute: 7 * 60,
    // default to wherever the browser actually is, not UTC
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });

  useEffect(() => {
    axiosInstance
      .get("/notifications/do-not-disturb")
      .then(({ data }) => data.doNotDisturb?.enabled && setDnd(data.doNotDisturb))
      .catch(() => {});
  }, []);

  const togglePush = async () => {
    setIsBusy(true);
    try {
      if (pushEnabled) {
        await disablePush();
        setPushEnabled(false);
      } else {
        const granted = await enablePush();
        setPushEnabled(granted);
        if (!granted) toast.error("Notifications were not enabled.");
      }
    } catch {
      toast.error("Could not change notification settings.");
    } finally {
      setIsBusy(false);
    }
  };

  const saveDnd = async (next) => {
    setDnd(next);
    try {
      await axiosInstance.put("/notifications/do-not-disturb", next);
    } catch {
      toast.error("Could not save quiet hours.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <BellIcon className="w-5 h-5 text-cyan-400" />
          <h2 className="text-slate-100 font-medium flex-1">Notifications</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <XIcon className="w-5 h-5 text-slate-400 hover:text-slate-200" />
          </button>
        </div>

        {isPushSupported() ? (
          <label className="flex items-center gap-3 mb-5 cursor-pointer">
            <input
              type="checkbox"
              checked={pushEnabled}
              disabled={isBusy}
              onChange={togglePush}
              className="accent-cyan-500"
            />
            <span className="text-sm text-slate-200">
              Notify me when the app is closed
              <span className="block text-xs text-slate-500">
                Your browser will ask for permission.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-slate-500 mb-5">
            This browser does not support push notifications.
          </p>
        )}

        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dnd.enabled}
            onChange={(event) => saveDnd({ ...dnd, enabled: event.target.checked })}
            className="accent-cyan-500"
          />
          <span className="text-sm text-slate-200">Quiet hours</span>
        </label>

        {dnd.enabled && (
          <div className="flex items-center gap-3 pl-7">
            <label className="text-xs text-slate-400">
              From
              <input
                type="time"
                value={toTimeValue(dnd.startMinute)}
                onChange={(event) =>
                  saveDnd({ ...dnd, startMinute: toMinutes(event.target.value) })
                }
                className="ml-2 bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1 text-slate-200"
              />
            </label>
            <label className="text-xs text-slate-400">
              to
              <input
                type="time"
                value={toTimeValue(dnd.endMinute)}
                onChange={(event) => saveDnd({ ...dnd, endMinute: toMinutes(event.target.value) })}
                className="ml-2 bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1 text-slate-200"
              />
            </label>
          </div>
        )}

        <p className="text-xs text-slate-500 mt-4">
          A direct mention still reaches you in a muted conversation, but never during quiet
          hours.
        </p>
      </div>
    </div>
  );
}

export default NotificationSettings;
