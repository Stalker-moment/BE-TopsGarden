/**
 * Fungsi helper untuk mengirim response JSON dengan format terstandar.
 * @param {object} res - Objek response dari Express.
 * @param {number} status - Status code HTTP (200, 400, 404, 500, dll).
 * @param {string} message - Pesan singkat terkait response.
 * @param {object} [data] - Data yang ingin dikirimkan (opsional).
 */
export function sendJsonResponse(res, status, message, data) {
  const success = status >= 200 && status < 300;
  return res.status(status).json({
    success,
    status,
    message,
    data: data || null,
  });
}