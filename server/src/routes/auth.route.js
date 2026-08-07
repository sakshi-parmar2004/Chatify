import express from "express";
import { loginUser , registerUser } from "../controller/auth.controller.js";

const authRouter = express.Router();

authRouter.post("/login",loginUser); 

authRouter.post("/register", registerUser); 

authRouter.get("/logout", (req, res) => {
  res.send("Logout route");
})

export default authRouter;