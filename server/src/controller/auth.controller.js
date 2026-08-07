import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import { generateToken } from "../lib/generateToken.js";
import { sendWelcomeEmail } from "../lib/email.js";

export const registerUser = async (req, res) => {
  const { name, email, password } = req.body;
  if(!name || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }
    try {
if(password.length < 6) {
  return res.status(400).json({ message: "Password must be at least 6 characters long" });
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if(!emailRegex.test(email)) {
  return res.status(400).json({ message: "Invalid email format" });
}
const alreadyExists = await User.findOne({ email });
if(alreadyExists) {
  return res.status(400).json({ message: "User already exists" });
}
const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = await User.create({ name, email,  password: hashedPassword });

  if(!newUser) {
    return res.status(400).json({ message: "User registration failed" });
  }
  generateToken(newUser, res);
  try {
  await sendWelcomeEmail(name, email);
  }
  catch (error) {
    console.error(`Error sending welcome email: ${error.message}`);
  }
  res.status(201).json({ message: "User registered successfully", user: newUser });

    }

    catch (error) {
        console.error(`Error: ${error.message}`);
        res.status(500).json({ message: "Server error" });
    }
}

export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  if(!email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }
  
  try {
    const user = await User.findOne({ email });
    if(!user) {
      return res.status(400).json({ message: "Invalid email" });
    }
     const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch) {
      return res.status(400).json({ message: "Wrong  Password" });
    }
    generateToken(user, res);
    res.status(200).json({ message: "Login successful", user });

}
catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).json({ message: "Server error" });
}
}
