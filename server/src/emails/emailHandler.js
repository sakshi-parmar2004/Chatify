import { Resend } from 'resend';
import {env_variable} from '../lib/env.js';
import {createWelcomeEmailTemplate} from './emailTemplate.js';



const resend = new Resend(env_variable.RESEND_API_KEY);


export const resendEmail = async (name,email) => {
  const { error } = await resend.emails.send({
    from: `${env_variable.EMAIL_FROM_NAME} <${env_variable.EMAIL_FROM}>`,
    to: email,
    subject: 'Welcome to Chatify!',
    // point at this deployment rather than a hardcoded one
    html: createWelcomeEmailTemplate(name, env_variable.CLIENT_URL),
  });

  if (error) {
    console.error(`Error sending welcome email: ${error.message}`);
  }
};
