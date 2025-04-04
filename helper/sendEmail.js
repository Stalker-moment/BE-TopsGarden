import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

// Load environment variables safely
const {
  EMAIL_HOST = "smtp.example.com",
  EMAIL_PORT = "587",
  EMAIL_SECURE = "false",
  EMAIL_AUTH_USER = "no-reply@example.com",
  EMAIL_AUTH_PASS = "yourpassword",
  FRONTEND_URL = "https://yourfrontend.com",
} = process.env;

/**
 * Fungsi untuk mengirim email.
 * @param {string} to - Email penerima.
 * @param {string} subject - Judul email.
 * @param {string} html - Konten HTML dari email.
 * @returns {Promise<boolean>} - Mengembalikan `true` jika email berhasil dikirim, `false` jika gagal.
 */

const sendEmail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: parseInt(EMAIL_PORT),
      secure: EMAIL_SECURE === "true", // Convert string ke boolean
      auth: {
        user: EMAIL_AUTH_USER,
        pass: EMAIL_AUTH_PASS,
      },
    });

    const mailOptions = {
      from: `"TEFA AKTI Support" <${EMAIL_AUTH_USER}>`,
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: " + info.response);
    return true; // Email berhasil dikirim
  } catch (error) {
    console.error("Error sending email:", error);
    return false; // Email gagal dikirim
  }
};

/**
 * Fungsi untuk mengirim email reset password.
 * @param {string} to - Email penerima.
 * @param {string} token - Token reset password.
 * @returns {Promise<object>} - Mengembalikan object success atau error message.
 */
const sendEmailResetPassword = async (to, token) => {
  const url = `${FRONTEND_URL}/reset-password?token=${token}`;
  console.log("Reset password URL:", url);
  const subject = "Reset Your Password - TEFA AKTI";

  const html = `
  <head>
    <title>Reset Password</title>
    <meta content="text/html; charset=utf-8" http-equiv="Content-Type">
    <meta content="width=device-width" name="viewport">
    <style>
      @font-face { font-family: 'Poppins'; font-weight: 700; src: url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap'); }
      @font-face { font-family: 'Poppins'; font-weight: 500; src: url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap'); }
      body { background-color: #f4f4f5; font-family: 'Poppins', sans-serif; }
      .primary-text { color: #000000; font-size: 16px; line-height: 24px; font-weight: 500; }
      .button { background-color: #800000; border-radius: 28px; padding: 14px 28px; display: inline-block; font-size: 14px; font-weight: bold; color: white; text-decoration: none; }
      .footer { background-color: #333; color: #ffffff; text-align: center; padding: 20px; font-size: 14px; }
    </style>
  </head>
  <body>
    <table style="width: 100%; height: 100%; text-align: center;">
      <tbody>
        <tr>
          <td>
            <table align="center" style="background-color: #fff; width: 100%; max-width: 680px;">
              <tbody>
                <tr>
                  <td style="padding: 72px 120px;">
                    <h1 style="font-size: 48px; font-weight: 700;">Reset Your Password</h1>
                    <p class="primary-text">You're receiving this email because you requested a password reset for your TEFA AKTI account.</p>
                    <p style="margin-top: 24px;">
                      <a href="${url}" class="button">Reset Password</a>
                    </p>
                    <p class="primary-text" style="font-size: 12px;">* This link will expire in 1 hour.</p>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="footer">© 2025 TEFA AKTI. All rights reserved.</div>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
  `;

  const emailSent = await sendEmail(to, subject, html);

  if (emailSent) {
    return { success: true, message: "Email sent successfully" };
  } else {
    return { success: false, message: "Failed to send email" };
  }
};

export default sendEmailResetPassword;
