import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import toast from "react-hot-toast";
import { BellIcon } from "lucide-react";
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
    <Modal title="Notifications" icon={BellIcon} onClose={onClose} maxWidth="max-w-md">

        {isPushSupported() ? (
          <label className="flex items-center gap-3 mb-5 cursor-pointer">
            <input
              type="checkbox"
              checked={pushEnabled}
              disabled={isBusy}
              onChange={togglePush}
              className="accent-[rgb(var(--accent))]"
            />
            <span className="text-sm text-ink">
              Notify me when the app is closed
              <span className="block text-xs text-faint">
                Your browser will ask for permission.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-faint mb-5">
            This browser does not support push notifications.
          </p>
        )}

        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dnd.enabled}
            onChange={(event) => saveDnd({ ...dnd, enabled: event.target.checked })}
            className="accent-[rgb(var(--accent))]"
          />
          <span className="text-sm text-ink">Quiet hours</span>
        </label>

        {dnd.enabled && (
          <div className="flex items-center gap-3 pl-7">
            <label className="text-xs text-muted">
              From
              <input
                type="time"
                value={toTimeValue(dnd.startMinute)}
                onChange={(event) =>
                  saveDnd({ ...dnd, startMinute: toMinutes(event.target.value) })
                }
                className="ml-2 bg-raised/50 border border-line/10 rounded px-2 py-1 text-ink"
              />
            </label>
            <label className="text-xs text-muted">
              to
              <input
                type="time"
                value={toTimeValue(dnd.endMinute)}
                onChange={(event) => saveDnd({ ...dnd, endMinute: toMinutes(event.target.value) })}
                className="ml-2 bg-raised/50 border border-line/10 rounded px-2 py-1 text-ink"
              />
            </label>
          </div>
        )}

        <p className="text-xs text-faint mt-4">
          A direct mention still reaches you in a muted conversation, but never during quiet
          hours.
        </p>
    </Modal>
  );
}

export default NotificationSettings;
