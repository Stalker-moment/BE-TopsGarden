Tentu, Sinyo. Ini adalah format **Markdown** untuk mapping wiring lengkap sistem monitoring daya kamu. Format ini bisa kamu simpan di `README.md` atau dokumentasi proyek kamu agar tidak lupa di kemudian hari.

## 🔌 Wiring Diagram: ESP32 Energy Monitoring System

Berikut adalah tabel koneksi pin antara **ESP32** dengan semua modul eksternal.

| Komponen | Pin Modul | Pin GPIO ESP32 | Protokol / Tipe | Keterangan |
| --- | --- | --- | --- | --- |
| **PZEM-004T V3** | TX | **GPIO 16 (RX2)** | Hardware Serial 2 | Monitoring Tegangan & Arus |
|  | RX | **GPIO 17 (TX2)** | Hardware Serial 2 | Komunikasi Dua Arah |
| **LCD 20x4 I2C** | SDA | **GPIO 21** | I2C | Jalur Data Display |
|  | SCL | **GPIO 22** | I2C | Jalur Clock Display |
| **Keypad 3x4** | Row 1, 2, 3 | **13, 12, 14** | Digital I/O | Baris Atas ke Bawah |
|  | Row 4 | **27** | Digital I/O | Baris Simbol (*, 0, #) |
|  | Col 1, 2, 3 | **26, 25, 33** | Digital I/O | Kolom Kiri ke Kanan |
| **RFID RC522** | SDA (SS) | **GPIO 5** | SPI (VSPI) | Chip Select |
|  | SCK | **GPIO 18** | SPI (VSPI) | Serial Clock |
|  | MOSI | **GPIO 23** | SPI (VSPI) | Data Out |
|  | MISO | **GPIO 19** | SPI (VSPI) | Data In |
|  | RST | **GPIO 4** | Digital Out | Reset Pin |
| **Relay 2 Channel** | IN 1 | **GPIO 2** | Digital Out | Kontrol Beban 1 |
|  | IN 2 | **GPIO 15** | Digital Out | Kontrol Beban 2 |
| **Sensor LDR** | Analog Out | **GPIO 34** | Analog Input | Pin Khusus Input Saja |

---

### 📌 Catatan Teknis Penting:

* **VCC & GND**:
* **PZEM-004T**: Hubungkan ke **5V**.
* **LCD, Relay, RFID**: Hubungkan ke **VIN (5V)** untuk performa maksimal.
* **LDR**: Hubungkan ke **3.3V** dengan resistor 10k ohm sebagai *voltage divider* ke GPIO 34.


* **Pin Strapping**: GPIO 2 dan 15 adalah *strapping pins*. Jika relay menyala otomatis saat ESP32 dinyalakan, itu adalah perilaku normal saat proses *booting*.
* **Input Only**: GPIO 34 adalah pin *input-only*, sangat cocok untuk LDR karena tidak memerlukan fungsi *output*.