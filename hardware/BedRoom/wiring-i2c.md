Siap, Sinyo. Karena sensor **LDR** kamu adalah tipe **Digital** (menggunakan modul yang memiliki 3 atau 4 pin dengan output `DO`), maka kita tidak bisa menggunakan `analogRead()` untuk mendapatkan nilai gradasi. Sensor ini akan bekerja seperti saklar (0 atau 1) berdasarkan *threshold* yang kamu putar di trimpot modulnya.

Berikut adalah update **Master Wiring Markdown** dengan penyesuaian LDR Digital dan fitur PWM Brightness untuk LCD 20x4:

## 🔌 Master Wiring Diagram: Energy Monitoring (LCD 20x4 + Digital LDR)

| Komponen | Pin Modul | Pin GPIO ESP32 | Tipe | Keterangan |
| --- | --- | --- | --- | --- |
| **LCD I2C 20x4** | SDA | **GPIO 21** | I2C | Komunikasi Data |
|  | SCL | **GPIO 22** | I2C | Komunikasi Data |
|  | **V0 / LED+** | **GPIO 2** | **PWM Out** | **Set Brightness** (Jumper dilepas) |
| **PZEM-004T** | TX | **GPIO 16** | Serial 2 | Monitoring Daya (RX2) |
|  | RX | **GPIO 17** | Serial 2 | Monitoring Daya (TX2) |
| **Keypad 3x4** | R1, R2, R3, R4 | **13, 12, 14, 27** | Digital | Baris Keypad |
|  | C1, C2, C3 | **26, 25, 33** | Digital | Kolom Keypad |
| **LDR Digital** | **DO (Digital Out)** | **GPIO 34** | **Digital In** | **Input 0/1 (Gelap/Terang)** |
| **Relay 2 Ch** | IN 1 | **GPIO 0** | Digital Out | Kontrol Beban 1 |
|  | IN 2 | **GPIO 32** | Digital Out | Kontrol Beban 2 |

---

### 📌 Catatan Teknis Terbaru:

1. **LDR Digital (GPIO 34):** Meskipun GPIO 34 adalah pin *Input Only*, ia tetap bisa membaca sinyal digital (HIGH/LOW) dari modul LDR kamu. Kamu hanya perlu mengatur `pinMode(34, INPUT)` tanpa perlu resistor pull-up tambahan karena modul LDR digital biasanya sudah memilikinya.
2. **PWM Brightness (GPIO 2):** Pastikan kabel dari pin **LED+** pada I2C backpack LCD terhubung ke GPIO 2. Nilai PWM `0` akan mematikan lampu latar, dan `255` akan memberikan kecerahan penuh.
3. **Relay (GPIO 0 & 32):** Mengingat kamu menggunakan relay, pastikan supply daya ke relay diambil dari **VIN (5V)** agar tidak membebani regulator 3.3V ESP32 saat WiFi **TierKun_IoT** sedang aktif mentransfer data ke API.

### Cuplikan Kode untuk LDR Digital:

```cpp
void checkLDR() {
  // LDR Digital: LOW biasanya berarti Terang, HIGH berarti Gelap (tergantung modul)
  bool isDark = digitalRead(34); 

  if (isDark) {
    setLcdBrightness(50); // Redupkan jika gelap
    if (autoMode) controlLampu(daftarLampu[currentIndex].id, true);
  } else {
    setLcdBrightness(255); // Terangkan jika ada cahaya
    if (autoMode) controlLampu(daftarLampu[currentIndex].id, false);
  }
}

```
