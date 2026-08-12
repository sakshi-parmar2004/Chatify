import mongoose from "mongoose";
import {env_variable} from "./env.js";

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(env_variable.MONGO_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    }
    catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

// The initial connect exits on failure, but a later outage would otherwise be
// invisible — requests just hang until Mongoose's buffer timeout.
mongoose.connection.on("disconnected", () => {
    console.error("MongoDB disconnected");
});

mongoose.connection.on("error", (error) => {
    console.error(`MongoDB connection error: ${error.message}`);
});

export const isDbConnected = () => mongoose.connection.readyState === 1;

export default connectDB;
