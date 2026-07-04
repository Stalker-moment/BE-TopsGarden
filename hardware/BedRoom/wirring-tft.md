Siap, Sinyo! Ini adalah **Master Wiring Markdown** terbaru yang sudah dioptimalkan untuk penggabungan **TFT ILI9488 Capacitive Touch**, **RFID**, **PZEM**, dan **Keypad 3x4**.

Karena kamu menggunakan layar **Capacitive Touch**, kita akan memanfaatkan jalur I2C (yang sebelumnya digunakan oleh LCD 20x4) untuk kontrol sentuhannya. Strategi **SPI Sharing** digunakan agar RFID dan TFT bisa bekerja bersamaan tanpa menghabiskan pin ESP32.

## 🔌 Master Wiring Diagram: Smart Energy Home (TFT Edition)

| Komponen | Pin Modul | Pin GPIO ESP32 | Protokol | Keterangan |
| --- | --- | --- | --- | --- |
| **TFT ILI9488** | VCC | **5V / VIN** | Power | Layar 3.5" butuh arus stabil. |
|  | GND | **GND** | Power | Ground bersama. |
|  | CS | **GPIO 15** | SPI | Chip Select TFT. |
|  | RST | **GPIO 4** | Digital Out | Reset (Bisa sharing dengan RFID). |
|  | DC / RS | **GPIO 2** | Digital Out | Data/Command. |
|  | SDI (MOSI) | **GPIO 23** | SPI | **Shared** dengan RFID. |
|  | SCK | **GPIO 18** | SPI | **Shared** dengan RFID. |
| **Touch (Cap.)** | T_SDA | **GPIO 21** | I2C | Jalur data sentuh. |
|  | T_SCL | **GPIO 22** | I2C | Jalur clock sentuh. |
| **RFID RC522** | SDA (SS) | **GPIO 5** | SPI | Chip Select RFID. |
|  | SCK / MOSI | **18 / 23** | SPI | **Shared** dengan TFT. |
|  | MISO | **GPIO 19** | SPI | Jalur data masuk. |
|  | RST | **GPIO 4** | Digital Out | Reset (Shared dengan TFT). |
| **PZEM-004T** | TX / RX | **16 / 17** | Serial 2 | Monitoring Daya (Hardware Serial 2). |
| **Keypad 3x4** | Rows (4) | **13, 12, 14, 27** | Digital | Baris keypad. |
|  | Cols (3) | **26, 25, 33** | Digital | Kolom keypad. |
| **Relay 2 Ch** | IN 1 / IN 2 | **GPIO 0 / 32** | Digital Out | Pindah untuk menghindari bentrok TFT. |
| **Sensor LDR** | Analog Out | **GPIO 34** | Analog In | Sensor cahaya otomatis. |

---

### ⚠️ Catatan Penting untuk Implementasi:

1. **SPI Chip Select (CS):** Ini adalah kunci dari **SPI Sharing**. Saat program ingin menggambar di TFT, pin 15 akan ditarik ke `LOW`. Saat ingin membaca kartu RFID, pin 5 yang ditarik ke `LOW`. Pastikan kedua library (TFT_eSPI dan MFRC522) dikonfigurasi dengan pin CS yang benar agar tidak "bertabrakan" saat berkomunikasi.
2. **Power Management:**
Layar 3.5 inch dan modul WiFi **TierKun_IoT** memakan daya yang cukup besar. Sangat disarankan menggunakan adaptor minimal **5V 2A** melalui pin **VIN** agar layar tidak berkedip atau ESP32 mengalami *brownout* (reboot mendadak).
3. **Relay Pins:**
Karena GPIO 2 dan 15 sekarang digunakan oleh TFT, Relay dipindahkan ke **GPIO 0** dan **32**. Hati-hati dengan GPIO 0 karena merupakan *boot pin*; pastikan relay tidak menarik arus besar saat baru dinyalakan agar ESP32 tetap bisa masuk ke mode program.

### 🛠️ Langkah Selanjutnya:

Wiring ini sudah siap. Apakah kamu ingin saya buatkan **Template Sketch Arduino** menggunakan library **TFT_eSPI**? Library ini paling direkomendasikan untuk ILI9488 karena performanya yang sangat cepat untuk menampilkan UI berwarna.

---