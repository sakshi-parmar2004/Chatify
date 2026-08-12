import express from "express";
import { loginUser , logoutUser, registerUser, update_profile } from "../controller/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { arcjetProtection, strictArcjetProtection } from "../middleware/arcjet.middleware.js";

const authRouter = express.Router();

// Registration writes to the database, runs bcrypt, and sends an email, so it
// is the most expensive endpoint here and must not be left unthrottled.
authRouter.post("/register", strictArcjetProtection, registerUser);

authRouter.post("/login", strictArcjetProtection, loginUser);

authRouter.post("/logout", arcjetProtection, logoutUser);

authRouter.put("/update-profile", arcjetProtection, protectRoute, update_profile);

authRouter.get("/get-user", arcjetProtection, protectRoute, (req, res) => {
  res.status(200).json({ message: "You have accessed the user ", user: req.user });
});

export default authRouter;
