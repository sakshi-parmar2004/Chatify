import { MongoMemoryServer } from "mongodb-memory-server";

// One throwaway MongoDB for the whole run. It exists only in memory and is torn
// down afterwards, so a test can never reach the real database — which for this
// project is a shared cluster.
let mongod;

export async function setup({ provide }) {
  mongod = await MongoMemoryServer.create();
  provide("mongoUri", mongod.getUri());
}

export async function teardown() {
  await mongod?.stop();
}
