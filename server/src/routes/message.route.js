import express from "express";

const messageRouter = express.Router();

messageRouter.get("/send", (req, res) => {
  res.send("Message route");
});

export default messageRouter;