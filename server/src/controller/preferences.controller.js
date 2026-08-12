import { asyncHandler } from "../lib/asyncHandler.js";
import User from "../models/user.model.js";
import Conversation from "../models/conversation.model.js";
import { THEME_IDS, DEFAULT_THEME, validateWallpaper } from "../lib/appearance.js";
import { emitToUser } from "../lib/socket.js";

/**
 * GET /api/preferences — UIX-03.
 *
 * Follows the do-not-disturb pattern: the response is a single named envelope
 * so a future preference can be added without changing the shape.
 */
export const getPreferences = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select("preferences").lean();
    res.status(200).json({
      preferences: user?.preferences ?? { theme: DEFAULT_THEME, reduceTransparency: false },
    });
});

/**
 * PUT /api/preferences
 *
 * A partial update: the client sends only what changed, because the theme
 * picker and the transparency toggle save independently.
 */
export const updatePreferences = asyncHandler(async (req, res) => {
    const { theme, reduceTransparency, wallpaper } = req.body ?? {};
    const update = {};

    if (theme !== undefined) {
      // an unknown theme would persist and then silently fall back forever,
      // which looks like the setting simply not working
      if (!THEME_IDS.includes(theme)) {
        return res.status(400).json({ message: "Unknown theme." });
      }
      update["preferences.theme"] = theme;
    }

    if (reduceTransparency !== undefined) {
      if (typeof reduceTransparency !== "boolean") {
        return res.status(400).json({ message: "reduceTransparency must be true or false." });
      }
      update["preferences.reduceTransparency"] = reduceTransparency;
    }

    if (wallpaper !== undefined) {
      const validation = validateWallpaper(wallpaper);
      if (!validation.ok) return res.status(400).json({ message: validation.message });
      update["preferences.wallpaper"] = validation.value;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    await User.updateOne({ _id: req.user._id }, { $set: update });

    const user = await User.findById(req.user._id).select("preferences").lean();
    res.status(200).json({ preferences: user.preferences });
});

/**
 * PUT /api/conversations/:id/wallpaper — UIX-04.
 *
 * Written into the caller's own participantState, so setting a wallpaper is
 * invisible to everyone else in the conversation.
 */
export const setConversationWallpaper = asyncHandler(async (req, res) => {
    const validation = validateWallpaper(req.body?.wallpaper);
    if (!validation.ok) return res.status(400).json({ message: validation.message });

    await Conversation.updateOne(
      { _id: req.conversation._id, "participantState.userId": req.user._id },
      { $set: { "participantState.$.wallpaper": validation.value } }
    );

    // the user's other tabs, not the conversation room — nobody else's view changes
    emitToUser(req.user._id, "conversationWallpaper", {
      conversationId: String(req.conversation._id),
      wallpaper: validation.value,
    });

    res.status(200).json({ wallpaper: validation.value });
});
