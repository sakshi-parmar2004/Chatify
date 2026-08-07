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

export default connectDB;