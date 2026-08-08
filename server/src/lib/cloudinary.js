import {v2 as cloudinary} from "cloudinary";
import { env_variable } from "./env.js";


cloudinary.config({  
    cloud_name: env_variable.CLOUDINARY_CLOUD_NAME,
    api_key: env_variable.CLOUDINARY_API_KEY,
    api_secret: env_variable.CLOUDINARY_API_SECRET
})

export default cloudinary;
