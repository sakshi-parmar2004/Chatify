import mongoose from "mongoose";

//created a schema for the user model
const UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true  , minlength: 6 },
        profilePic: { type: String, default: "" },
    },
    { timestamps: true }
);  
// Create a model from the schema which will be used to interact with the database
const User = mongoose.model("User", UserSchema);
export default User;