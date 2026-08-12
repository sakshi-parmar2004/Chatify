import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import Conversation, { CONVERSATION_TYPE } from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import {
  directParticipantKey,
  findOrCreateDirectConversation,
  partnerOf,
  stateFor,
} from "../lib/conversations.js";
import { backfillConversations } from "../scripts/backfillConversations.js";
import { connectTestDb, disconnectTestDb, clearCollections } from "./helpers.js";

beforeAll(async () => {
  await connectTestDb();
  // the partial unique index is the whole point of the race test below
  await Conversation.syncIndexes();
});
afterAll(disconnectTestDb);
beforeEach(clearCollections);

const id = () => new mongoose.Types.ObjectId();

describe("directParticipantKey", () => {
  it("is the same whichever way round the pair is given", () => {
    const [a, b] = [id(), id()];
    expect(directParticipantKey(a, b)).toBe(directParticipantKey(b, a));
  });

  it("differs for a different pair", () => {
    const [a, b, c] = [id(), id(), id()];
    expect(directParticipantKey(a, b)).not.toBe(directParticipantKey(a, c));
  });
});

describe("findOrCreateDirectConversation", () => {
  it("creates a direct conversation with both participants and empty cursors", async () => {
    const [alice, bob] = [id(), id()];
    const conversation = await findOrCreateDirectConversation(alice, bob);

    expect(conversation.type).toBe(CONVERSATION_TYPE.DIRECT);
    expect(conversation.participants.map(String).sort()).toEqual(
      [String(alice), String(bob)].sort()
    );
    expect(conversation.participantState).toHaveLength(2);
    expect(stateFor(conversation, alice).lastReadAt).toBeNull();
    expect(stateFor(conversation, bob).lastDeliveredAt).toBeNull();
  });

  it("returns the same conversation whichever participant asks", async () => {
    const [alice, bob] = [id(), id()];

    const first = await findOrCreateDirectConversation(alice, bob);
    const second = await findOrCreateDirectConversation(bob, alice);

    expect(String(second._id)).toBe(String(first._id));
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it("survives both users messaging each other in the same instant", async () => {
    const [alice, bob] = [id(), id()];

    // the trap DEC-01 names: a find-then-insert would produce two conversations
    const results = await Promise.all([
      findOrCreateDirectConversation(alice, bob),
      findOrCreateDirectConversation(bob, alice),
      findOrCreateDirectConversation(alice, bob),
      findOrCreateDirectConversation(bob, alice),
    ]);

    expect(await Conversation.countDocuments({})).toBe(1);
    const ids = new Set(results.map((c) => String(c._id)));
    expect(ids.size).toBe(1);
  });

  it("keeps separate pairs separate", async () => {
    const [alice, bob, carol] = [id(), id(), id()];

    await findOrCreateDirectConversation(alice, bob);
    await findOrCreateDirectConversation(alice, carol);

    expect(await Conversation.countDocuments({})).toBe(2);
  });

  it("lets two groups share membership, unlike two direct threads", async () => {
    const participants = [id(), id(), id()];

    await Conversation.create([
      { type: CONVERSATION_TYPE.GROUP, participants, participantKey: null },
      { type: CONVERSATION_TYPE.GROUP, participants, participantKey: null },
    ]);

    // the unique index is partial on type: "direct", so this is allowed
    expect(await Conversation.countDocuments({ type: CONVERSATION_TYPE.GROUP })).toBe(2);
  });
});

describe("partnerOf / stateFor", () => {
  it("resolves the other participant", async () => {
    const [alice, bob] = [id(), id()];
    const conversation = await findOrCreateDirectConversation(alice, bob);

    expect(String(partnerOf(conversation, alice))).toBe(String(bob));
    expect(String(partnerOf(conversation, bob))).toBe(String(alice));
  });

  it("returns null cursors for someone with no state recorded", async () => {
    const [alice, bob] = [id(), id()];
    const conversation = await findOrCreateDirectConversation(alice, bob);

    expect(stateFor(conversation, id())).toEqual({ lastReadAt: null, lastDeliveredAt: null });
  });
});

describe("backfill", () => {
  const seedLegacy = async (senderId, receiverId, text, when) =>
    // insert through the driver so no schema default sets conversationId
    Message.collection.insertOne({
      senderId,
      receiverId,
      text,
      status: "read",
      conversationId: null,
      createdAt: when,
      updatedAt: when,
    });

  it("links every message and creates one conversation per pair", async () => {
    const [alice, bob, carol] = [id(), id(), id()];
    const t = (n) => new Date(2026, 0, 1, 12, n);

    await seedLegacy(alice, bob, "a1", t(1));
    await seedLegacy(bob, alice, "b1", t(2)); // the other direction, same thread
    await seedLegacy(alice, bob, "a2", t(3));
    await seedLegacy(alice, carol, "c1", t(4));

    const result = await backfillConversations();

    expect(result.pairs).toBe(2);
    expect(result.conversationsCreated).toBe(2);
    expect(result.messagesLinked).toBe(4);
    expect(result.orphaned).toBe(0);
    expect(await Message.countDocuments({ conversationId: null })).toBe(0);
  });

  it("puts both directions of a thread in one conversation", async () => {
    const [alice, bob] = [id(), id()];
    await seedLegacy(alice, bob, "a1", new Date(2026, 0, 1, 12, 1));
    await seedLegacy(bob, alice, "b1", new Date(2026, 0, 1, 12, 2));

    await backfillConversations();

    const ids = await Message.distinct("conversationId");
    expect(ids).toHaveLength(1);
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it("sets lastMessageAt to the newest message in the thread", async () => {
    const [alice, bob] = [id(), id()];
    const newest = new Date(2026, 0, 1, 12, 30);

    await seedLegacy(alice, bob, "old", new Date(2026, 0, 1, 12, 1));
    await seedLegacy(bob, alice, "new", newest);

    await backfillConversations();

    const conversation = await Conversation.findOne({});
    expect(conversation.lastMessageAt.toISOString()).toBe(newest.toISOString());
  });

  it("is idempotent — a second run changes nothing", async () => {
    const [alice, bob] = [id(), id()];
    await seedLegacy(alice, bob, "a1", new Date(2026, 0, 1, 12, 1));

    const first = await backfillConversations();
    const second = await backfillConversations();

    expect(first.messagesLinked).toBe(1);
    expect(second.messagesLinked).toBe(0);
    expect(second.conversationsCreated).toBe(0);
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it("never creates or destroys a message", async () => {
    const [alice, bob] = [id(), id()];
    for (let i = 0; i < 10; i += 1) {
      await seedLegacy(alice, bob, `m${i}`, new Date(2026, 0, 1, 12, i));
    }

    const before = await Message.countDocuments({});
    await backfillConversations();

    expect(await Message.countDocuments({})).toBe(before);
  });

  it("leaves messages that already have a conversation alone", async () => {
    const [alice, bob] = [id(), id()];
    const existing = await findOrCreateDirectConversation(alice, bob);

    await Message.create({
      senderId: alice,
      receiverId: bob,
      text: "already linked",
      conversationId: existing._id,
    });

    const result = await backfillConversations();

    expect(result.messagesLinked).toBe(0);
    expect(String((await Message.findOne({})).conversationId)).toBe(String(existing._id));
  });

  it("reuses a conversation that live traffic already created", async () => {
    const [alice, bob] = [id(), id()];
    const live = await findOrCreateDirectConversation(alice, bob);
    await seedLegacy(alice, bob, "older", new Date(2026, 0, 1, 12, 1));

    const result = await backfillConversations();

    expect(result.conversationsCreated).toBe(0);
    expect(await Conversation.countDocuments({})).toBe(1);
    expect(String((await Message.findOne({ text: "older" })).conversationId)).toBe(
      String(live._id)
    );
  });

  it("writes nothing on a dry run", async () => {
    const [alice, bob] = [id(), id()];
    await seedLegacy(alice, bob, "a1", new Date(2026, 0, 1, 12, 1));

    const result = await backfillConversations({ dryRun: true });

    expect(result.pairs).toBe(1);
    expect(result.messagesLinked).toBe(0);
    expect(await Conversation.countDocuments({})).toBe(0);
    expect(await Message.countDocuments({ conversationId: null })).toBe(1);
  });

  it("does nothing at all on an empty database", async () => {
    const result = await backfillConversations();
    expect(result.messagesLinked).toBe(0);
    expect(await Conversation.countDocuments({})).toBe(0);
  });
});
