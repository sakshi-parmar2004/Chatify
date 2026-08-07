import express from "express";
import dotenv from "dotenv";
import authRouter from "./routes/auth.route.js";
import messageRouter from "./routes/message.route.js";
import path from "path";
import connectDB from "./lib/db.js";

const PORT = process.env.PORT || 8000;
const app = express();
app.use(express.json())

const __dirname = path.resolve();

dotenv.config();


app.get("/", (req, res) => {
  res.send("Server is running");
}
);
app.use("/api/messages", messageRouter);
app.use("/api/auth", authRouter);

// 
//this is for production build of react app
if(process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/dist")));
  app.get("*", (_ , res) => {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  }
  )
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  connectDB();
}
)
