import { asyncHandler } from "../lib/asyncHandler.js";
import mongoose from "mongoose";
import cloudinary from "../lib/cloudinary.js";
import Message, { MESSAGE_STATUS, UNREAD_STATUSES } from "../models/message.model.js";
import User from "../models/user.model.js";
import { io, getReceiverSocketIds } from "../lib/socket.js";
import { validateImageDataUri } from "../lib/validateImage.js";
import Conversation from "../models/conversation.model.js";
import { findOrCreateDirectConversation } from "../lib/conversations.js";

export const getAllContacts = asyncHandler(async (req, res) => {
    const loggedInUserId = req.user._id;
    const filteredUsers = await User.find({ _id: { $ne: loggedInUserId } }).select("-password");

    res.status(200).json(filteredUsers);
});


export const getMessagesByUserId = asyncHandler(async (req, res) => {
    const myId = req.user._id;
    const { id: userToChatId } = req.params;

    // an invalid id would otherwise throw a CastError and surface as a 500
    if (!mongoose.Types.ObjectId.isValid(userToChatId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    }).sort({ createdAt: 1 }); // MongoDB gives no ordering guarantee without this

    res.status(200).json(messages);
});


export const sendMessage = asyncHandler(async (req, res) => {
    const { text, image } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }
    if (!text && !image) {
      return res.status(400).json({ message: "Text or image is required." });
    }
    if (senderId.equals(receiverId)) {
      return res.status(400).json({ message: "Cannot send messages to yourself." });
    }
    if (image) {
      const validation = validateImageDataUri(image);
      if (!validation.ok) {
        return res.status(400).json({ message: validation.message });
      }
    }
    const receiverExists = await User.exists({ _id: receiverId });
    if (!receiverExists) {
      return res.status(404).json({ message: "Receiver not found." });
    }

    let imageUrl;
    if (image) {
      // upload base64 image to cloudinary
      const uploadResponse = await cloudinary.uploader.upload(image, { folder: "messages" });
      imageUrl = uploadResponse.secure_url;
    }

    // Resolved after the Cloudinary upload rather than before it: a slow upload
    // would otherwise widen the window in which the recipient comes online
    // between the check and the save, leaving the message stuck on "sent".
    const receiverSocketIds = getReceiverSocketIds(receiverId);

    // Dual-write for PLT-01. Reads still go through senderId/receiverId; this
    // is here so that by the time the contract step lands, every message
    // written since the expand already carries its conversation.
    const conversation = await findOrCreateDirectConversation(senderId, receiverId);

    const newMessage = new Message({
      senderId,
      receiverId,
      conversationId: conversation._id,
      text,
      image: imageUrl,
      // if they have a socket open, the emit below is the delivery
      status: receiverSocketIds.length ? MESSAGE_STATUS.DELIVERED : MESSAGE_STATUS.SENT,
    });

    await newMessage.save();

    // keeps the conversation list sortable without reaching into messages
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessageAt: newMessage.createdAt } }
    );

    // push to every socket the recipient has open (they may have several tabs)
    for (const socketId of receiverSocketIds) {
      io.to(socketId).emit("newMessage", newMessage);
    }

    // Echo to the sender's own sockets so their other tabs see the message too.
    // The tab that made this request dedupes on _id against the 201 below.
    for (const socketId of getReceiverSocketIds(senderId)) {
      io.to(socketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
});

export const markConversationAsRead = asyncHandler(async (req, res) => {
    const myId = req.user._id;
    const { id: partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    // Authorization is the filter itself: receiverId is pinned to the caller, so
    // there is no way to mark messages that were not addressed to them.
    const result = await Message.updateMany(
      { receiverId: myId, senderId: partnerId, status: { $in: UNREAD_STATUSES } },
      { $set: { status: MESSAGE_STATUS.READ } }
    );

    // The client calls this every time a conversation is opened and most of
    // those change nothing, so only spend a socket emit when something moved.
    if (result.modifiedCount > 0) {
      const readAt = new Date().toISOString();

      // tell the sender their messages were read
      for (const socketId of getReceiverSocketIds(partnerId)) {
        io.to(socketId).emit("messagesRead", { partnerId: String(myId), readAt });
      }
      // and tell the reader's own other tabs to drop the unread badge
      for (const socketId of getReceiverSocketIds(myId)) {
        io.to(socketId).emit("conversationRead", { partnerId, readAt });
      }
    }

    res.status(200).json({ modifiedCount: result.modifiedCount });
});

export const getChatPartners = asyncHandler(async (req, res) => {
    const loggedInUserId = req.user._id;

    // One pass over the user's messages resolves the partner, their last
    // message and the unread count together, then joins the user document — so
    // this is a single round trip rather than an aggregation plus a User.find.
    const chatPartners = await Message.aggregate([
      { $match: { $or: [{ senderId: loggedInUserId }, { receiverId: loggedInUserId }] } },
      // newest first, so $first below picks up the latest message per partner
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ["$senderId", loggedInUserId] }, "$receiverId", "$senderId"],
          },
          lastMessage: {
            $first: {
              text: "$text",
              image: "$image",
              createdAt: "$createdAt",
              senderId: "$senderId",
              status: "$status",
            },
          },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiverId", loggedInUserId] },
                    { $in: ["$status", UNREAD_STATUSES] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      // the sidebar was previously unordered; most recent conversation first
      { $sort: { "lastMessage.createdAt": -1 } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      // the user document stays spread at the top level so existing callers
      // reading chat._id / chat.name / chat.profilePic keep working unchanged
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$user",
              { unreadCount: "$unreadCount", lastMessage: "$lastMessage" },
            ],
          },
        },
      },
      { $project: { password: 0 } },
    ]);

    res.status(200).json(chatPartners);
});
