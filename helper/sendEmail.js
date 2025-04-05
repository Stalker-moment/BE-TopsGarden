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
      from: `"TOPS Smart Garden Support" <${EMAIL_AUTH_USER}>`,
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
  const subject = "Reset Your Password - TOPS Smart Garden";

  const html = `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="id">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset Password</title>
  <style type="text/css">
    /* Fallback font declaration (dukungan terbatas di email) */
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

    /* Client-specific resets */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f4f4f5; }

    /* Gaya dasar untuk body, bisa ditimpa oleh inline styles */
    body {
        font-family: 'Poppins', Helvetica, Arial, sans-serif; /* Tambahkan fallback web-safe fonts */
    }

    /* Sembunyikan preheader text */
    .preheader {
        display: none !important;
        visibility: hidden;
        opacity: 0;
        color: transparent;
        height: 0;
        width: 0;
    }

    /* Pastikan link tidak berwarna biru default di beberapa klien */
    a { color: #800000; text-decoration: underline;} /* Default link color, bisa ditimpa */

  </style>
  </head>
<body style="margin: 0 !important; padding: 0 !important; background-color: #f4f4f5;">

  <div class="preheader" style="display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
    Anda meminta reset password untuk akun TOPS Smart Garden Anda.
  </div>

  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" valign="top" style="padding: 20px 0;"> <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 680px; background-color: #ffffff; border-radius: 8px; overflow: hidden;"> <tr>
            <td align="left" style="padding: 40px 50px;"> <h1 style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 700; color: #000000; margin: 0 0 20px 0;">
                Reset Password Anda
              </h1>
              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 24px; font-weight: 500; color: #333333; margin: 0 0 24px 0;">
                Anda menerima email ini karena Anda (atau seseorang) meminta reset password untuk akun TOPS Smart Garden Anda. Jika ini bukan Anda, abaikan saja email ini.
              </p>

              <table border="0" cellspacing="0" cellpadding="0" role="presentation" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#800000" style="border-radius: 28px;">
                    <a href="${url}" target="_blank" style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 28px; display: inline-block; border: 1px solid #800000;"> Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; font-weight: 400; color: #555555; margin: 24px 0 0 0;">
                * Link ini akan kedaluwarsa dalam 1 jam.
              </p>
              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; font-weight: 400; color: #555555; margin: 10px 0 0 0;">
                Jika tombol di atas tidak berfungsi, salin dan tempel URL berikut ke browser Anda: <br/> <a href="${url}" target="_blank" style="color: #800000; text-decoration: underline; word-break: break-all;">${url}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td bgcolor="#f4f4f5" align="center" style="padding: 30px 50px;"> <table border="0" cellpadding="0" cellspacing="0" width="100%">
                 <tr>
                   <td align="center" style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; color: #666666;">
                     &copy; 2025 TOPS Smart Garden. Semua hak dilindungi undang-undang.
                     <br/><br/>
                     </td>
                 </tr>
              </table>
            </td>
          </tr>
        </table>
        </td>
    </tr>
  </table>
  </body>
</html>
  `;

  const emailSent = await sendEmail(to, subject, html);

  if (emailSent) {
    return { success: true, message: "Email sent successfully" };
  } else {
    return { success: false, message: "Failed to send email" };
  }
};

export default sendEmailResetPassword;
