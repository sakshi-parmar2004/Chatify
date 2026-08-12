import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { markPendingAsDelivered } from "../lib/receipts.js";
import Message, { MESSAGE_STATUS } from "../models/message.model.js";
import { connectTestDb, disconnectTestDb, clearCollections } from "./helpers.js";

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearCollections);

const id = () => new mongoose.Types.ObjectId();

describe("markPendingAsDelivered", () => {
  it("promotes only the messages addressed to the reconnecting user", async () => {
    const [alice, bob, carol] = [id(), id(), id()];

    await Message.create([
      { senderId: bob, receiverId: alice, text: "for alice", status: MESSAGE_STATUS.SENT },
      { senderId: bob, receiverId: carol, text: "for carol", status: MESSAGE_STATUS.SENT },
    ]);

    await markPendingAsDelivered(alice);

    expect((await Message.findOne({ text: "for alice" })).status).toBe(MESSAGE_STATUS.DELIVERED);
    expect((await Message.findOne({ text: "for carol" })).status).toBe(MESSAGE_STATUS.SENT);
  });

  it("returns the distinct senders to notify", async () => {
    const [alice, bob, carol] = [id(), id(), id()];

    await Message.create([
      { senderId: bob, receiverId: alice, text: "1", status: MESSAGE_STATUS.SENT },
      { senderId: bob, receiverId: alice, text: "2", status: MESSAGE_STATUS.SENT },
      { senderId: carol, receiverId: alice, text: "3", status: MESSAGE_STATUS.SENT },
    ]);

    const senderIds = await markPendingAsDelivered(alice);

    expect(senderIds).toHaveLength(2);
    expect(new Set(senderIds)).toEqual(new Set([String(bob), String(carol)]));
  });

  it("never downgrades a message that was already read", async () => {
    const [alice, bob] = [id(), id()];
    await Message.create({ senderId: bob, receiverId: alice, text: "seen", status: MESSAGE_STATUS.READ });

    await markPendingAsDelivered(alice);

    expect((await Message.findOne({ text: "seen" })).status).toBe(MESSAGE_STATUS.READ);
  });

  it("is a no-op for a second tab, so no duplicate receipt is emitted", async () => {
    const [alice, bob] = [id(), id()];
    await Message.create({ senderId: bob, receiverId: alice, text: "1", status: MESSAGE_STATUS.SENT });

    expect(await markPendingAsDelivered(alice)).toHaveLength(1);
    // the second connection finds nothing left to promote
    expect(await markPendingAsDelivered(alice)).toEqual([]);
  });

  it("returns nothing when there is nothing pending", async () => {
    expect(await markPendingAsDelivered(id())).toEqual([]);
  });

  it("leaves messages written before the status field existed alone", async () => {
    const [alice, bob] = [id(), id()];
    await Message.collection.insertOne({
      senderId: bob,
      receiverId: alice,
      text: "legacy",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(await markPendingAsDelivered(alice)).toEqual([]);
    expect((await Message.collection.findOne({ text: "legacy" })).status).toBeUndefined();
  });
});

describe("message status field", () => {
  it("defaults to sent", async () => {
    const message = await Message.create({ senderId: id(), receiverId: id(), text: "hi" });
    expect(message.status).toBe(MESSAGE_STATUS.SENT);
  });

  it("rejects a status outside the enum", async () => {
    await expect(
      Message.create({ senderId: id(), receiverId: id(), text: "hi", status: "invented" })
    ).rejects.toThrow();
  });

  it("serves the unread query from an index rather than a collection scan", async () => {
    await Message.syncIndexes();
    const alice = id();

    const plan = await Message.collection
      .find({ receiverId: alice, status: { $in: ["sent", "delivered"] }, senderId: id() })
      .explain("queryPlanner");

    const winning = plan.queryPlanner.winningPlan;
    const stage = winning.inputStage ?? winning;
    expect(stage.stage).toBe("IXSCAN");
  });
});
