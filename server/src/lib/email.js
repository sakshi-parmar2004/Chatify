import { resendEmail } from "../emails/emailHandler.js";


export const sendWelcomeEmail = async (name, email) => {

    try{

        await resendEmail(name, email);
    }
    catch (error) {
        console.error(`Error sending welcome email: ${error.message}`);
    }
 
}