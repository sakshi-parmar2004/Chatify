import { log } from "./logger.js";
import mongoose from "mongoose";
import {env_variable} from "./env.js";

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(env_variable.MONGO_URI);
        log.info({ host: conn.connection.host }, "mongodb connected");
    }
    catch (error) {
        log.error({ err: error }, "mongodb error");
        process.exit(1);
    }
};

// The initial connect exits on failure, but a later outage would otherwise be
// invisible — requests just hang until Mongoose's buffer timeout.
mongoose.connection.on("disconnected", () => {
    log.error({ err: error }, "mongodb error");
});

mongoose.connection.on("error", (error) => {
    log.error({ err: error }, "mongodb error");
});

export const isDbConnected = () => mongoose.connection.readyState === 1;

export default connectDB;
