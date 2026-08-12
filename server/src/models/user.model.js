import mongoose from "mongoose";

//created a schema for the user model
const UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        // lowercase + trim keep "Alice@Example.com " and "alice@example.com"
        // from becoming two accounts that can't log into each other
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true  , minlength: 6 },
        profilePic: { type: String, default: "" },
    },
    { timestamps: true }
);

// Defence in depth: even if a route forgets .select("-password"), the hash can
// never be serialised into a response.
UserSchema.set("toJSON", {
    transform: (_doc, ret) => {
        delete ret.password;
        return ret;
    },
});

// Create a model from the schema which will be used to interact with the database
const User = mongoose.model("User", UserSchema);
export default User;
