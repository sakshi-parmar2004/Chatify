import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.route.js";
import messageRouter from "./routes/message.route.js";
import path from "path";
import connectDB from "./lib/db.js";
import {env_variable} from "./lib/env.js";
const PORT = env_variable.PORT || 8000;
const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(cookieParser()); // Parse cookies from incoming requests so req.cookies works

const __dirname = path.resolve();




app.get("/", (req, res) => {
  res.send("Server is running");
}
);
app.use("/api/messages", messageRouter);
app.use("/api/auth", authRouter);

// 
//this is for production build of react app
if(env_variable.NODE_ENV === "production") {
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
