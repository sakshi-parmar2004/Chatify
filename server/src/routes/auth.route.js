import express from "express";

const authRouter = express.Router();

authRouter.get("/login", (req, res) => {
  res.send("Login route");
}); 

authRouter.get("/register", (req, res) => {
  res.send("Register route");
}
);

authRouter.get("/logout", (req, res) => {
  res.send("Logout route");
})

export default authRouter;