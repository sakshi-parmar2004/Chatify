import express from "express";
import { loginUser , logoutUser, registerUser, update_profile } from "../controller/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";

const authRouter = express.Router();

authRouter.get("/test",arcjetProtection, (req,res)=>
{
  res.status(200).json({message:"hello"})
}
);
authRouter.post("/login",arcjetProtection,loginUser); 

authRouter.post("/register", registerUser); 

authRouter.post("/logout", logoutUser);

authRouter.put("/update-profile",protectRoute, update_profile);

authRouter.get("/get-user", protectRoute, (req, res) => {
  res.status(200).json({ message: "You have accessed the user ", user: req.user });
});

export default authRouter;