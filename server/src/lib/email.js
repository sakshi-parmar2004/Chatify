import { resendEmail } from "../emails/emailHandler.js";


export const sendWelcomeEmail = async (name, email) => {

    try{

        await resendEmail(name, email);
    }
    catch (error) {
        
    }
 
}