import nodemailer from "nodemailer";

const name = "Muhammad Tier Sinyo Cahyo Utomo Suharjo";

const transporter = nodemailer.createTransport({
    host: "mx3.mailspace.id",
    port: 465,
    secure: true, // true for port 465, false for other ports
    auth: {
        user: "noreply@natslock.site",
        pass: "LockerAman",
    },
});

// Fungsi untuk membuat kode OTP acak
function generateOTP() {
    let otp = "";
    for (let i = 0; i < 6; i++) {
        otp += Math.floor(Math.random() * 10);
    }
    return otp;
}

const otp = generateOTP(); // Menghasilkan kode OTP
const url = `http://localhost:3000/reset-password?token=${otp}`; // URL untuk reset password

const mailOptions = {
    from: "noreply@natslock.site",
    to: "masadnugroho@gmail.com",
    subject: "Reset your password",
    html: `
<head>
    <title>Reset Password</title>
    <meta content="text/html; charset=utf-8" http-equiv="Content-Type">
    <meta content="width=device-width" name="viewport">
    <style type="text/css">
        @font-face {
            font-family: 'Poppins';
            font-weight: 700;
            font-style: normal;
            src: url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
        }

        @font-face {
            font-family: 'Poppins';
            font-weight: 500;
            font-style: normal;
            src: url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap');
        }

        body {
            background-color: #f4f4f5;
            font-family: 'Poppins', sans-serif;
        }

        .secondary-text {
            color: #800000; /* Merah Maroon untuk teks sekunder */
        }

        .primary-text {
            color: #000000; /* Hitam untuk teks utama */
        }

        .button {
            background-color: #800000 !important; /* Merah Maroon hanya untuk tombol */
            border-radius: 28px;
            padding: 14px 28px;
            display: inline-block;
            font-size: 14px;
            font-weight: bold;
            font-family: 'Poppins', sans-serif;
        }

        .footer {
            background-color: #333;
            color: #ffffff;
            text-align: center;
            padding: 20px;
            font-size: 14px;
            font-family: 'Poppins', sans-serif;
        }
    </style>
</head>

<body>
    <table cellpadding="0" cellspacing="0" style="width: 100%; height: 100%; text-align: center;">
        <tbody>
            <tr>
                <td style="text-align: center;">
                    <table align="center" cellpadding="0" cellspacing="0" id="body" style="background-color: #fff; width: 100%; max-width: 680px; height: 100%;">
                        <tbody>
                            <tr>
                                <td>
                                    <table align="center" cellpadding="0" cellspacing="0" class="page-center" style="text-align: left; padding-bottom: 88px; width: 100%; padding-left: 120px; padding-right: 120px;">
                                        <tr>
                                            <td colspan="2" class="primary-text" style="padding-top: 72px; font-size: 48px; font-weight: 700; line-height: 52px;">
                                                Reset your password
                                            </td>
                                        </tr>
                                        <tr>
                                            <td class="primary-text" style="padding-top: 24px; font-size: 16px; line-height: 24px; font-weight: 500;">
                                                You're receiving this email because you requested a password reset for your TEFA AKTI account.
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style="padding-top: 24px;">
                                                <a href="${url}" class="button" style="color: #ffffff; text-decoration: none;">
                                                    Reset Password
                                                </a>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td class="secondary-text" style="padding-top: 16px; font-size: 12px; line-height: 24px; font-weight: 500;">
                                                *Url expired in 1 hour.
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="footer">
                        &copy; 2025 TEFA AKTI. All rights reserved.
                    </div>
                </td>
            </tr>
        </tbody>
    </table>
</body>
    `,
};

transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
        console.log(error);
    } else {
        console.log("Email sent: " + info.response);
    }
});
