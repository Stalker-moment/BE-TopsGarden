import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

// Mendapatkan __dirname pada modul ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readExcelFile() {
  try {
    // Path ke file Excel lokal
    const excelFilePath = path.join(__dirname, 'test.xlsx');

    // Membaca workbook dari file Excel dengan opsi cellDates agar sel tanggal di-convert menjadi objek Date
    const workbook = XLSX.readFile(excelFilePath, { cellDates: true });

    // Ambil sheet pertama
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Konversi worksheet ke JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    // Format kolom Birthday menjadi format YYYY-MM-DD dengan menambahkan 1 hari
    const formattedData = jsonData.map(row => {
      if (row.Birthday instanceof Date) {
        // Tambahkan 1 hari (86.400.000 milidetik)
        const adjustedDate = new Date(row.Birthday.getTime() + 86400000);
        const year  = adjustedDate.getFullYear();
        const month = String(adjustedDate.getMonth() + 1).padStart(2, '0'); // getMonth() menghasilkan nilai 0-11
        const day   = String(adjustedDate.getDate()).padStart(2, '0');
        row.Birthday = `${year}-${month}-${day}`;
      }
      return row;
    });

    // Inisialisasi validasi
    const allowedRoles = new Set(["ADMIN", "MAHASISWA", "DOSEN", "USER", "MAGANG"]);
    // Menggunakan Map untuk menyimpan email dan nomor baris pertamanya
    const seenEmails = new Map();
    const errorMessages = [];
    const requiredColumns = ["FistName", "LastName", "Role", "Email", "Password", "Phone", "NoReg", "Birthday"];

    // Regular expression sederhana untuk validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Validasi tiap baris data
    formattedData.forEach((row, index) => {
      const excelRowNumber = index + 2; // Baris 1 adalah header

      // Validasi bahwa semua kolom wajib diisi
      requiredColumns.forEach(field => {
        if (row[field] === undefined || row[field].toString().trim() === '') {
          errorMessages.push(`Baris ${excelRowNumber}: ${field} wajib diisi.`);
        }
      });

      // Validasi Role: harus sesuai dengan salah satu nilai yang diijinkan
      if (row.Role && row.Role.toString().trim() !== '') {
        const roleValue = row.Role.toString().toUpperCase();
        if (!allowedRoles.has(roleValue)) {
          errorMessages.push(
            `Baris ${excelRowNumber}: Role "${row.Role}" tidak valid. Harus salah satu: ${Array.from(allowedRoles).join(', ')}.`
          );
        } else {
          row.Role = roleValue; // update ke uppercase
        }
      }

      // Validasi Email: cek format dan duplikat (pembandingan case-insensitive)
      if (row.Email && row.Email.toString().trim() !== '') {
        const emailValue = row.Email.toString().toLowerCase();

        // Validasi format email
        if (!emailRegex.test(emailValue)) {
          errorMessages.push(`Baris ${excelRowNumber}: Email "${row.Email}" format tidak valid.`);
        }

        // Cek duplikat email
        if (seenEmails.has(emailValue)) {
          errorMessages.push(
            `Baris ${excelRowNumber}: Email "${row.Email}" duplikat dengan Baris ke ${seenEmails.get(emailValue)}.`
          );
        } else {
          // Simpan nomor baris ketika email pertama kali muncul
          seenEmails.set(emailValue, excelRowNumber);
        }
      }
    });

    // Jika terdapat error validasi, kembalikan error beserta pesan-pesan errornya
    if (errorMessages.length > 0) {
      return {
        status: 'error',
        message: errorMessages
      };
    }

    // Jika validasi lolos, kembalikan data yang sudah diformat
    return {
      status: 'success',
      data: formattedData
    };

  } catch (error) {
    console.error('Error saat membaca file Excel:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

// Contoh penggunaan fungsi
const result = readExcelFile();
console.log(result);