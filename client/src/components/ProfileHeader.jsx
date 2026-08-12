import { useState, useRef } from "react";
import toast from "react-hot-toast";
import { LogOutIcon, VolumeOffIcon, Volume2Icon, BellIcon, PaletteIcon } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import NotificationSettings from "./NotificationSettings";
import AppearanceSettings from "./AppearanceSettings";

const mouseClickSound = new Audio("/sounds/mouse-click.mp3");

function ProfileHeader() {
  const { logout, authUser, updateProfile } = useAuthStore();
  const { isSoundEnabled, toggleSound } = useChatStore();
  const [selectedImg, setSelectedImg] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);

  const fileInputRef = useRef(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      e.target.value = "";
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Image must be smaller than 3MB");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onloadend = async () => {
      const base64Image = reader.result;
      setSelectedImg(base64Image);
      await updateProfile({ profilePic: base64Image });
    };
  };

  return (
    <div className="border-b border-line/10 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* AVATAR */}
          <div className="relative">
            <button
              type="button"
              aria-label="Change profile picture"
              className="size-14 rounded-full overflow-hidden relative group"
              onClick={() => fileInputRef.current.click()}
            >
              <img
                src={selectedImg || authUser.profilePic || "/avatar.png"}
                alt=""
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-bg/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="text-ink text-xs">Change</span>
              </div>
            </button>

            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleImageUpload}
              className="hidden"
            />
            {/* own presence is always "online" by definition — it is a label,
                not a lookup */}
            <span className="absolute bottom-0 right-0 block size-3.5 rounded-full bg-success ring-2 ring-surface" />
          </div>

          {/* USERNAME & ONLINE TEXT */}
          <div>
            <h3 className="text-ink font-medium text-base max-w-[180px] truncate">
              {authUser.name}
            </h3>

            <p className="text-muted text-xs">Online</p>
          </div>
        </div>

        {/* BUTTONS */}
        <div className="flex gap-4 items-center">
          {/* LOGOUT BTN */}
          <button
            type="button"
            aria-label="Log out"
            className="text-muted hover:text-ink transition-colors"
            onClick={logout}
          >
            <LogOutIcon className="size-5" />
          </button>

          {/* SOUND TOGGLE BTN */}
          <button
            type="button"
            aria-label={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
            aria-pressed={isSoundEnabled}
            className="text-muted hover:text-ink transition-colors"
            onClick={() => {
              // play click sound before toggling
              mouseClickSound.currentTime = 0; // reset to start
              mouseClickSound.play().catch(() => {});
              toggleSound();
            }}
          >
            {isSoundEnabled ? (
              <Volume2Icon className="size-5" />
            ) : (
              <VolumeOffIcon className="size-5" />
            )}
          </button>

          {/* APPEARANCE — theme and transparency */}
          <button
            type="button"
            aria-label="Appearance settings"
            className="text-muted hover:text-ink transition-colors"
            onClick={() => setShowAppearance(true)}
          >
            <PaletteIcon className="size-5" />
          </button>

          {/* NOTIFICATION SETTINGS — push and quiet hours */}
          <button
            type="button"
            aria-label="Notification settings"
            className="text-muted hover:text-ink transition-colors"
            onClick={() => setShowNotifications(true)}
          >
            <BellIcon className="size-5" />
          </button>
        </div>
      </div>

      {showNotifications && (
        <NotificationSettings onClose={() => setShowNotifications(false)} />
      )}
      {showAppearance && <AppearanceSettings onClose={() => setShowAppearance(false)} />}
    </div>
  );
}
export default ProfileHeader;