import express from "express";
import { loginUser , logoutUser, registerUser } from "../controller/auth.controller.js";

const authRouter = express.Router();

authRouter.post("/login",loginUser); 

authRouter.post("/register", registerUser); 

authRouter.post("/logout", logoutUser);

export default authRouter;