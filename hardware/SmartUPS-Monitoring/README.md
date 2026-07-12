# Panduan Wiring & Skema Kabel: ESP32 Smart UPS Monitoring (3S Li-ion)

Dokumen ini berisi panduan perkabelan (wiring guide) lengkap untuk proyek pemantauan Smart UPS berbasis ESP32 dengan baterai 3S Li-ion, sensor tegangan analog, dua buah sensor INA219, dan sensor suhu DS18B20.

---

## 1. Konsep Penting: Pembacaan Baterai 3S (Metode Kumulatif)

> [!CAUTION]
> **PENTING: JANGAN MENGHUBUNGKAN GND INDIVIDUAL CELL KE GND ESP32 SECARA TERPISAH!**
> Jika Anda menghubungkan GND Sensor 2 ke terminal positif Cell 1 (B1), maka Anda akan membuat **korsleting (short circuit)** langsung pada Cell 1 karena semua GND sensor terhubung bersama di board ESP32.

Untuk menghindari korsleting, kita menggunakan **Metode Kumulatif**:
* Semua pin Ground (GND atau `-`) dari ketiga Modul Voltage Sensor digabungkan ke **Ground Utama Baterai (B-)** dan **GND ESP32**.
* Kita mengukur tegangan dari titik referensi Ground utama (B-) yang sama:
  1. **Sensor 1** membaca tegangan pada terminal **B1 (Cell 1)** -> Rentang: 0V s.d. 4.2V (Maks)
  2. **Sensor 2** membaca tegangan pada terminal **B2 (Cell 1 + Cell 2)** -> Rentang: 0V s.d. 8.4V (Maks)
  3. **Sensor 3** membaca tegangan pada terminal **B3/B+ (Cell 1 + Cell 2 + Cell 3 / Total Battery)** -> Rentang: 0V s.d. 12.6V (Maks)
* Di dalam kode program, tegangan masing-masing cell dihitung dengan pengurangan:
  * $\text{V\_Cell1} = \text{V\_Sensor1}$
  * $\text{V\_Cell2} = \text{V\_Sensor2} - \text{V\_Sensor1}$
  * $\text{V\_Cell3} = \text{V\_Sensor3} - \text{V\_Sensor2}$

---

## 2. Tabel Pinout Lengkap

Berikut adalah tabel koneksi pin dari sensor ke ESP32 DevKit:

| Nama Sensor | Pin Sensor | Pin ESP32 DevKit | Keterangan |
| :--- | :--- | :--- | :--- |
| **Voltage Sensor 1** | GND (`-`) <br> VCC (`+`) <br> S (Signal) | GND (Common) <br> B1 (Positif Cell 1) <br> **GPIO 34 (ADC1_CH6)** | Membaca Cell 1 (Max 4.2V). Sisi input sensor dihubungkan ke B- dan B1. |
| **Voltage Sensor 2** | GND (`-`) <br> VCC (`+`) <br> S (Signal) | GND (Common) <br> B2 (Positif Cell 2) <br> **GPIO 35 (ADC1_CH7)** | Membaca Cell 1+2 (Max 8.4V). Sisi input sensor dihubungkan ke B- dan B2. |
| **Voltage Sensor 3** | GND (`-`) <br> VCC (`+`) <br> S (Signal) | GND (Common) <br> B3 (Positif Cell 3) <br> **GPIO 32 (ADC1_CH4)** | Membaca Total Battery (Max 12.6V). Sisi input sensor dihubungkan ke B- dan B3. |
| **INA219 (Jalur 12V)** <br> *(Alamat: 0x40)* | VCC <br> GND <br> SDA <br> SCL <br> Vin+ <br> Vin- | 3V3 (atau 5V) <br> GND <br> **GPIO 21 (SDA)** <br> **GPIO 22 (SCL)** <br> Sumber Tegangan 12V Out <br> Beban 12V (Load +) | Mengukur tegangan dan arus output jalur 12V. Alamat I2C default (0x40). |
| **INA219 (Jalur 5V)** <br> *(Alamat: 0x41)* | VCC <br> GND <br> SDA <br> SCL <br> Vin+ <br> Vin- | 3V3 (atau 5V) <br> GND <br> **GPIO 21 (SDA)** <br> **GPIO 22 (SCL)** <br> Sumber Tegangan 5V Out <br> Beban 5V (Load +) | Mengukur tegangan dan arus output jalur 5V. Solder pin/pad A0 ke VCC untuk mengubah alamat ke (0x41). |
| **Suhu DS18B20** | VCC <br> GND <br> DQ (Data) | 3V3 (atau 5V) <br> GND <br> **GPIO 4** | Sensor Suhu. Memerlukan Resistor Pull-up 4.7k $\Omega$ antara pin DQ dan VCC. |

---

## 3. Diagram Skema Wiring

### 3.1. Pembacaan Baterai 3S (Voltage Sensors)

```text
       [ Battery Pack 3S ]
       +---------------+
       | [Cell 3] (B3) |--------+--------> (+) Input Sensor 3 (Membaca 0 - 12.6V)
       +---------------+        |
       | [Cell 2] (B2) |------+ |  +-----> (+) Input Sensor 2 (Membaca 0 - 8.4V)
       +---------------+      | |  |
       | [Cell 1] (B1) |----+ | |  |  +--> (+) Input Sensor 1 (Membaca 0 - 4.2V)
       +---------------+    | | |  |  |
       |  GND     (B-) |----+ | |  |  |  
       +---------------+    | | |  |  |  
                            | | |  |  |  
            +---------------+ | |  |  |  
            |                 | |  |  |  
            v                 v v  v  v  
       [Common GND]         [ V_Sensors Input ]
       (GND Baterai,        - Sensor 1 (+ dan -) -> (-) ke B-, (+) ke B1
        GND ESP32, &        - Sensor 2 (+ dan -) -> (-) ke B-, (+) ke B2
        GND Sensor)         - Sensor 3 (+ dan -) -> (-) ke B-, (+) ke B3
```

* **Output Sisi Sensor (Koneksi ke ESP32):**
  * Sensor 1 Pin `S` --------> ESP32 **GPIO 34**
  * Sensor 2 Pin `S` --------> ESP32 **GPIO 35**
  * Sensor 3 Pin `S` --------> ESP32 **GPIO 32**
  * Semua Sensor Pin `-` ------> ESP32 **GND** (Common Ground)

---

### 3.2. Sensor INA219 (Dual Bus I2C)

Kedua sensor INA219 dipasang secara paralel pada jalur I2C (SDA/SCL) ESP32.

```text
 ESP32 DevKit                  INA219 #1 (12V) [Addr: 0x40]
+------------+                +-----------------+
|    GPIO 21 |---(SDA Bus)--->| SDA             |
|    GPIO 22 |---(SCL Bus)--->| SCL             |
|        3V3 |---(VCC)------->| VCC             |
|        GND |---(GND)------->| GND             |
+------------+                |                 |
                              | Vin+ ---> Ke Source 12V Out
                              | Vin- ---> Ke Beban 12V (+)
                              +-----------------+
                                       |
                                       +----------------+
                                                        v
                                               INA219 #2 (5V) [Addr: 0x41]
                                              +-----------------+
                                              | SDA             |
                                              | SCL             |
                                              | VCC             |
                                              | GND             |
                                              |                 |
                                              | Vin+ ---> Ke Source 5V Out
                                              | Vin- ---> Ke Beban 5V (+)
                                              +-----------------+
                                              *(Catatan: Pad A0 pada board 
                                                ini harus disolder ke VCC)*
```

* **Penting untuk Arus:** Hubungkan beban secara seri. Arus mengalir masuk ke pin `Vin+` dan keluar dari pin `Vin-` menuju terminal positif dari beban (load). Ground beban harus digabung ke Common GND.

---

### 3.3. Sensor Suhu DS18B20

```text
           ESP32 DevKit 3V3
                |
                +----------[ Resistor 4.7k Ohm ]
                |                    |
 ESP32 GPIO 4 --+--------------------+-----------> Pin DQ (Data) DS18B20
                                                 Pin VCC -------> ESP32 3V3
                                                 Pin GND -------> ESP32 GND
```

---

## 4. Langkah-Langkah Kalibrasi Sensor Tegangan

Karena ADC ESP32 tidak sepenuhnya linier (khususnya di dekat 0V dan di atas 3.1V), gunakan variabel kalibrasi yang disediakan di kode program:

1. **Ukur dengan Multitester:**
   * Ukur tegangan asli pada titik B1, B2, dan B3 terhadap Ground (B-) menggunakan multitester presisi saat UPS menyala.
2. **Bandingkan dengan Serial Monitor:**
   * Lihat output pembacaan `V_Sensor1` (Cell 1), `V_Sensor2` (Cell 1+2), dan `V_Sensor3` (Cell 1+2+3) di Serial Monitor.
3. **Lakukan Tuning Nilai Kalibrasi:**
   * Ubah nilai multiplier (`CAL_MULT_CELL1`, `CAL_MULT_CELL2`, `CAL_MULT_CELL3`) dan offset (`CAL_OFF_CELL1`, `CAL_OFF_CELL2`, `CAL_OFF_CELL3`) pada deklarasi global kode program.
   * Rumus dasar kalibrasi: 
     $$\text{Multiplier Baru} = \text{Multiplier Lama} \times \frac{\text{Tegangan Multitester}}{\text{Tegangan Serial Monitor}}$$
4. **Flash Ulang ESP32:**
   * Lakukan flash ulang sampai pembacaan di Serial Monitor sama persis dengan multitester Anda.

---

## 5. File Uji Coba (Testing Sketches)

Sebelum menjalankan kode monitoring lengkap, Anda sangat disarankan untuk menguji masing-masing sensor satu per satu untuk mendiagnosis masalah perkabelan. Berikut adalah file sketsa pengujian yang telah disediakan:

1. **Uji Sensor Tegangan Analog (ADC):**
   * **File:** [test_voltage_sensors.ino](file:///g:/PROJECT_AKTI/Smart%20Watering/SmartWateringDIY/NewWebsite/BE-TopsGarden/hardware/SmartUPS-Monitoring/tests/test_voltage_sensors/test_voltage_sensors.ino)
   * **Deskripsi:** Menampilkan data raw ADC dan perhitungan tegangan kasar dari Sensor 1, 2, dan 3. Sangat berguna untuk memastikan pin ADC menerima sinyal yang benar dari modul sensor tegangan.
2. **Uji Dual Sensor INA219 (I2C):**
   * **File:** [test_ina219.ino](file:///g:/PROJECT_AKTI/Smart%20Watering/SmartWateringDIY/NewWebsite/BE-TopsGarden/hardware/SmartUPS-Monitoring/tests/test_ina219/test_ina219.ino)
   * **Deskripsi:** Memiliki fitur I2C Scanner terintegrasi untuk mendeteksi apakah alamat `0x40` dan `0x41` terbaca pada bus I2C. Setelah terdeteksi, program akan menampilkan parameter kelistrikan (Bus, Shunt, Load voltage, dan Arus mA) secara berulang.
3. **Uji Sensor Suhu DS18B20 (One-Wire):**
   * **File:** [test_ds18b20.ino](file:///g:/PROJECT_AKTI/Smart%20Watering/SmartWateringDIY/NewWebsite/BE-TopsGarden/hardware/SmartUPS-Monitoring/tests/test_ds18b20/test_ds18b20.ino)
   * **Deskripsi:** Memastikan sensor suhu terdeteksi pada pin data GPIO 4 dan mencetak suhu dalam Celcius (*C).

