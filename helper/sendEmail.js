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

  const currentYear = new Date().getFullYear();
  const html = `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="id">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset Password - TOPS Smart Garden</title>
  <style type="text/css">
    /* Font Import (Dukungan Terbatas di Email) */
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

    /* Resets Umum */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse !important; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #fdfaf6; /* Krem lembut */ }

    /* Gaya Dasar & Fallbacks Font */
    body {
        font-family: 'Poppins', Helvetica, Arial, sans-serif; /* Prioritaskan Poppins */
    }

    /* Sembunyikan Teks Preheader */
    .preheader { display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; }

    /* Gaya Link Default */
    a { color: #4CAF50; /* Hijau daun */ text-decoration: underline; }

    /* Efek Hover untuk Tombol (Progressive Enhancement) */
    .button-link:hover {
        background-color: #388E3C !important; /* Hijau lebih gelap */
        border-color: #388E3C !important;
    }

     /* Gaya untuk ikon unicode */
    .unicode-icon {
        color: #4CAF50; /* Warna ikon hijau */
        font-size: 18px; /* Sesuaikan ukuran jika perlu */
        display: inline-block;
        line-height: 1;
    }

  </style>
  </head>
<body style="margin: 0 !important; padding: 0 !important; background-color: #fdfaf6;">
  <div class="preheader" style="display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
    Reset password akun TOPS Smart Garden Anda.
  </div>

  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fdfaf6;">
    <tr>
      <td align="center" valign="top" style="padding: 40px 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 6px; border-top: 5px solid #4CAF50; /* Aksen garis hijau */ overflow: hidden;">

          <tr>
            <td align="center" style="padding: 40px 0 20px 0;">
              <img src="https://garden.tierkun.com/images/logo/sw-removebg-preview.png" alt="TOPS Smart Garden Logo" width="140" style="display: block; font-family: sans-serif; font-size: 16px; color: #999999;">
              </td>
          </tr>

          <tr>
            <td align="left" style="padding: 10px 40px 40px 40px;">
              <h1 style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 24px; font-weight: 600; color: #3E2723; /* Coklat Tua */ margin: 0 0 25px 0; line-height: 1.3; text-align: center;">
                <span class="unicode-icon" style="margin-right: 8px; vertical-align: baseline;">🌿</span>
                Atur Ulang Password Anda
              </h1>
              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 26px; font-weight: 400; color: #5D4037; /* Coklat Sedang */ margin: 0 0 25px 0; text-align: left;">
                Halo, kami menerima permintaan untuk mengatur ulang password akun TOPS Smart Garden Anda. Silakan klik tombol hijau di bawah ini untuk membuat password baru.
              </p>

              <hr style="border: none; border-top: 2px solid #DCEDC8; /* Garis hijau muda */ margin: 30px 0;">

              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 26px; font-weight: 400; color: #5D4037; margin: 0 0 25px 0; text-align: center;">
                Klik tombol ini untuk melanjutkan:
              </p>

              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td align="center"> <table border="0" cellspacing="0" cellpadding="0" role="presentation" align="center" style="margin: 0;"> <tr>
                        <td align="center" bgcolor="#4CAF50" style="border-radius: 25px;">
                          <a href="${url}" target="_blank" class="button-link" style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 25px; display: inline-block; border: 1px solid #4CAF50;">
                            Buat Password Baru
                          </a>
                        </td>
                      </tr>
                    </table>
                    </td>
                </tr>
              </table>
              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 20px; font-weight: 400; color: #8D6E63; /* Coklat Muda */ margin: 30px 0 15px 0; text-align: center;">
                Link ini akan kedaluwarsa dalam 1 jam. Abaikan email ini jika Anda tidak merasa meminta reset password.
              </p>
              <p style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; font-weight: 400; color: #9E9E9E; /* Abu-abu netral */ margin: 0; text-align: center;">
                Tombol tidak berfungsi? Salin URL ini:<br/>
                <a href="${url}" target="_blank" style="color: #4CAF50; text-decoration: underline; word-break: break-all;">${url}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td bgcolor="#F1F8E9" align="center" style="padding: 25px 40px; border-top: 1px solid #DCEDC8;"> <table border="0" cellpadding="0" cellspacing="0" width="100%">
                 <tr>
                   <td align="center" style="font-family: 'Poppins', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; color: #558B2F; /* Hijau tua teks footer */">
                     <span class="unicode-icon" style="font-size: 14px; margin-right: 5px; vertical-align: baseline;">🌱</span>
                     &copy; ${currentYear} TOPS Smart Garden. All rights reserved. <br/>
                     {/* */}
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
