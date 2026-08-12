/**
 * PLT-01 step 2 — backfill.
 *
 * Groups every existing message by its participant pair, creates the matching
 * direct conversation, and stamps conversationId onto the messages.
 *
 * Safe to run more than once: it only ever looks at messages whose
 * conversationId is still null, and conversation creation is an atomic upsert
 * on the unique participantKey. Running it twice does nothing the second time.
 *
 *   node src/scripts/backfillConversations.js --dry-run
 *   node src/scripts/backfillConversations.js
 *
 * --dry-run reports exactly what would change and writes nothing.
 */
import mongoose from "mongoose";
import connectDB from "../lib/db.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { findOrCreateDirectConversation, directParticipantKey } from "../lib/conversations.js";

const isDryRun = process.argv.includes("--dry-run");

const log = (...args) => console.log(isDryRun ? "[dry-run]" : "[backfill]", ...args);

export const backfillConversations = async ({ dryRun = false } = {}) => {
  const before = {
    total: await Message.countDocuments({}),
    unlinked: await Message.countDocuments({ conversationId: null }),
    conversations: await Conversation.countDocuments({}),
  };

  log(`${before.total} messages, ${before.unlinked} without a conversation`);

  if (before.unlinked === 0) {
    log("nothing to do");
    return { ...before, pairs: 0, conversationsCreated: 0, messagesLinked: 0, orphaned: 0 };
  }

  // Resolve the distinct participant pairs in the database rather than paging
  // every message into memory to group them here.
  const pairs = await Message.aggregate([
    { $match: { conversationId: null } },
    {
      $group: {
        _id: { senderId: "$senderId", receiverId: "$receiverId" },
        count: { $sum: 1 },
        lastMessageAt: { $max: "$createdAt" },
      },
    },
  ]);

  // (a,b) and (b,a) are the same thread, so fold the two directions together
  // before creating anything.
  const byKey = new Map();
  for (const pair of pairs) {
    const { senderId, receiverId } = pair._id;
    const key = directParticipantKey(senderId, receiverId);
    const existing = byKey.get(key);

    if (existing) {
      existing.count += pair.count;
      if (pair.lastMessageAt > existing.lastMessageAt) existing.lastMessageAt = pair.lastMessageAt;
    } else {
      byKey.set(key, { senderId, receiverId, count: pair.count, lastMessageAt: pair.lastMessageAt });
    }
  }

  log(`${byKey.size} distinct conversations across ${pairs.length} directed pairs`);

  if (dryRun) {
    for (const [key, pair] of byKey) {
      log(`  would link ${pair.count} message(s) to ${key}`);
    }
    return { ...before, pairs: byKey.size, conversationsCreated: 0, messagesLinked: 0, orphaned: before.unlinked };
  }

  let conversationsCreated = 0;
  let messagesLinked = 0;

  for (const [, pair] of byKey) {
    const existed = await Conversation.exists({
      participantKey: directParticipantKey(pair.senderId, pair.receiverId),
    });

    const conversation = await findOrCreateDirectConversation(pair.senderId, pair.receiverId);
    if (!existed) conversationsCreated += 1;

    const result = await Message.updateMany(
      {
        conversationId: null,
        $or: [
          { senderId: pair.senderId, receiverId: pair.receiverId },
          { senderId: pair.receiverId, receiverId: pair.senderId },
        ],
      },
      { $set: { conversationId: conversation._id } }
    );
    messagesLinked += result.modifiedCount;

    // only advance it; a conversation created by live traffic mid-backfill may
    // already be newer than anything this pass saw
    await Conversation.updateOne(
      { _id: conversation._id, $or: [{ lastMessageAt: null }, { lastMessageAt: { $lt: pair.lastMessageAt } }] },
      { $set: { lastMessageAt: pair.lastMessageAt } }
    );
  }

  const orphaned = await Message.countDocuments({ conversationId: null });
  const after = {
    total: await Message.countDocuments({}),
    conversations: await Conversation.countDocuments({}),
  };

  log(`linked ${messagesLinked} message(s), created ${conversationsCreated} conversation(s)`);
  log(`messages before ${before.total}, after ${after.total}`);

  // The check that matters: nothing may be created, destroyed or left behind.
  if (after.total !== before.total) {
    throw new Error(`Message count changed: ${before.total} -> ${after.total}`);
  }
  if (orphaned > 0) {
    throw new Error(`${orphaned} message(s) still have no conversation`);
  }

  log("verified: every message is linked and the count is unchanged");

  return {
    ...before,
    pairs: byKey.size,
    conversationsCreated,
    messagesLinked,
    orphaned,
  };
};

// only self-execute when run directly, so tests can import the function
if (process.argv[1]?.endsWith("backfillConversations.js")) {
  await connectDB();
  try {
    await backfillConversations({ dryRun: isDryRun });
  } catch (error) {
    console.error("[backfill] FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
