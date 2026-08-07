import { Resend } from 'resend';
import {env_variable} from '../lib/env.js';
import {createWelcomeEmailTemplate} from './emailTemplate.js';



const resend = new Resend(env_variable.RESEND_API_KEY);


export const resendEmail = async (name,email) => {
    console.log(`Sending welcome email to ${name} at ${email}`);
  const { data, error } = await resend.emails.send({
    from: `${env_variable.EMAIL_FROM_NAME} <${env_variable.EMAIL_FROM}>`,
    to: email,
    subject: 'Welcome to Chatify!',
    html: createWelcomeEmailTemplate(name, 'https://chatify-km3zy.sevalla.app/'),
  });

  if (error) {
    console.error(`Error sending welcome email: ${error.message}`);
    return console.error({ error });
  }
 console.log(`Welcome email sent to ${name} at ${email}`);
  console.log({ data });
};
