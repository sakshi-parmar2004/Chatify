import express from "express";
import dotenv from "dotenv";
import authRouter from "./routes/auth.route.js";
import messageRouter from "./routes/message.route.js";

const PORT = process.env.PORT || 8000;
const app = express();
app.use(express.json())


dotenv.config();

app.get("/", (req, res) => {
  res.send("Hello from server");
}
)
app.use("/api/messages", messageRouter);
app.use("/api/auth", authRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}
)
