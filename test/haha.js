// Import library Google Cloud Translate versi 2
const { Translate } = require('@google-cloud/translate').v2;

// Membuat instance client untuk Google Translate API
const translate = new Translate();

/**
 * Fungsi untuk menerjemahkan teks.
 *
 * @param {string} text - Teks yang ingin diterjemahkan.
 * @param {string} targetLanguage - Kode bahasa target (contoh: "en" untuk Inggris, "id" untuk Indonesia).
 */
async function translateText(text, targetLanguage) {
  try {
    // Menerjemahkan teks
    const [translation] = await translate.translate(text, targetLanguage);
    
    console.log(`Teks asli     : ${text}`);
    console.log(`Teks terjemah : ${translation}`);
  } catch (error) {
    console.error('Terjadi error saat menerjemahkan:', error);
  }
}

// Contoh penggunaan
const text = 'Halo, dunia!';
const targetLanguage = 'en'; // Misal, kita ingin menerjemahkan ke bahasa Inggris

translateText(text, targetLanguage);