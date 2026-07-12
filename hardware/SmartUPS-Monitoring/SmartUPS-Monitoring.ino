/**
 * Proyek: ESP32 Smart UPS Monitoring (3S Li-ion Battery)
 * Target Board: ESP32 DevKit
 * Deskripsi: Memantau kondisi baterai 3S Li-ion menggunakan metode kumulatif,
 *            mengukur tegangan & arus output 12V dan 5V menggunakan dual INA219,
 *            dan membaca suhu sistem menggunakan sensor DS18B20.
 * 
 * Library yang Dibutuhkan (Install melalui Arduino Library Manager):
 * 1. Adafruit INA219
 * 2. OneWire
 * 3. DallasTemperature
 */

#include <Wire.h>
#include <Adafruit_INA219.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// --- KONFIGURASI PIN ESP32 ---
// Sensor Tegangan Analog (Rasio 1:5, 0-25V) - Menggunakan ADC1 agar aman dari gangguan Wi-Fi
#define PIN_V_SENS1 34   // Membaca tegangan Cell 1 (Maks ~4.2V)
#define PIN_V_SENS2 35   // Membaca tegangan Cell 1 + Cell 2 (Maks ~8.4V)
#define PIN_V_SENS3 32   // Membaca tegangan Cell 1 + Cell 2 + Cell 3 / DC Input (Maks ~12.6V)

// Pin Bus I2C untuk Sensor INA219
#define PIN_I2C_SDA 21
#define PIN_I2C_SCL 22

// Pin One-Wire untuk Sensor Suhu DS18B20
#define PIN_ONE_WIRE 4

// --- KALIBRASI ADC ESP32 ---
// Catatan: ESP32 memiliki resolusi ADC 12-bit (0-4095).
// Dengan attenuation 11dB (default), tegangan pembacaan berkisar hingga ~3.3V.
// Karena rasio pembagi tegangan adalah 1:5, maka V_maks input adalah 3.3V * 5 = 16.5V.
// Multiplier Teoretis = 16.5 / 4095 = 0.0040293
// Gunakan multitester Anda untuk mengkalibrasi faktor pengali (multiplier) & offset di bawah ini.
float cal_multiplier_cell1 = 0.0040293f;
float cal_offset_cell1     = 0.0f;

float cal_multiplier_cell2 = 0.0040293f;
float cal_offset_cell2     = 0.0f;

float cal_multiplier_cell3 = 0.0040293f;
float cal_offset_cell3     = 0.0f;

// --- INSTANSIASI DEKLARASI SENSOR ---
// Inisialisasi INA219 dengan alamat I2C masing-masing
Adafruit_INA219 ina12V(0x40); // Alamat default 0x40 (Jalur 12V)
Adafruit_INA219 ina5V(0x41);  // Alamat solder A0 0x41 (Jalur 5V)

// Inisialisasi Sensor Suhu DS18B20
OneWire oneWire(PIN_ONE_WIRE);
DallasTemperature tempSensor(&oneWire);

// Variabel Penahan Waktu untuk Non-Blocking Delay
unsigned long lastReadTime = 0;
const unsigned long readInterval = 2000; // Pembacaan setiap 2 detik (2000 ms)

// --- PROTOTIPE FUNGSI ---
float readAnalogVoltage(int pin, float multiplier, float offset);
void readAndDisplaySensors();

void setup() {
  // Inisialisasi Serial Monitor
  Serial.begin(115200);
  while (!Serial) {
    delay(10); // Menunggu Serial Monitor terbuka (khusus board tertentu)
  }
  Serial.println("\n=============================================");
  Serial.println("      ESP32 Smart UPS Monitoring System      ");
  Serial.println("=============================================");

  // Konfigurasi pin input analog
  pinMode(PIN_V_SENS1, INPUT);
  pinMode(PIN_V_SENS2, INPUT);
  pinMode(PIN_V_SENS3, INPUT);

  // Inisialisasi Bus I2C Kustom
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  // Inisialisasi INA219 #1 (Jalur 12V)
  if (!ina12V.begin()) {
    Serial.println("[ERROR] INA219 Jalur 12V (0x40) tidak terdeteksi!");
  } else {
    Serial.println("[ OK  ] INA219 Jalur 12V (0x40) terhubung.");
    // Secara default, library menggunakan range 32V, 2A.
    // Jika Anda ingin mengatur calibration khusus, gunakan fungsi berikut:
    // ina12V.setCalibration_32V_2A();
  }

  // Inisialisasi INA219 #2 (Jalur 5V)
  if (!ina5V.begin()) {
    Serial.println("[ERROR] INA219 Jalur 5V (0x41) tidak terdeteksi!");
  } else {
    Serial.println("[ OK  ] INA219 Jalur 5V (0x41) terhubung.");
    // ina5V.setCalibration_32V_2A();
  }

  // Inisialisasi Sensor Suhu OneWire
  tempSensor.begin();
  Serial.println("[ OK  ] Sensor DS18B20 diinisialisasi.");
  Serial.println("Sistem siap. Mulai membaca data...\n");
}

void loop() {
  // Menggunakan non-blocking delay agar mikrokontroler tetap responsif
  unsigned long currentMillis = millis();
  if (currentMillis - lastReadTime >= readInterval) {
    lastReadTime = currentMillis;
    readAndDisplaySensors();
  }
}

/**
 * Fungsi untuk membaca tegangan dari sensor analog dengan teknik pemfilteran (oversampling).
 * ESP32 ADC memiliki noise yang cukup tinggi, sehingga dilakukan pembacaan berulang
 * kemudian diambil nilai rata-ratanya untuk hasil yang lebih stabil.
 */
float readAnalogVoltage(int pin, float multiplier, float offset) {
  const int totalSamples = 30; // Jumlah sampel untuk rata-rata
  long adcSum = 0;
  
  for (int i = 0; i < totalSamples; i++) {
    adcSum += analogRead(pin);
    delayMicroseconds(150); // Delay singkat antar pembacaan
  }
  
  float avgAdc = (float)adcSum / totalSamples;
  float voltage = (avgAdc * multiplier) + offset;
  
  // Mencegah nilai tegangan negatif kecil akibat offset kalibrasi
  if (voltage < 0.0f) {
    voltage = 0.0f;
  }
  
  return voltage;
}

/**
 * Fungsi utama untuk membaca seluruh data sensor dan menampilkannya ke Serial Monitor.
 */
void readAndDisplaySensors() {
  // 1. Pembacaan Tegangan Kumulatif dari 3S Battery Pack
  float V_Sensor1 = readAnalogVoltage(PIN_V_SENS1, cal_multiplier_cell1, cal_offset_cell1);
  float V_Sensor2 = readAnalogVoltage(PIN_V_SENS2, cal_multiplier_cell2, cal_offset_cell2);
  float V_Sensor3 = readAnalogVoltage(PIN_V_SENS3, cal_multiplier_cell3, cal_offset_cell3);

  // 2. Logika Perhitungan Tegangan Tiap Cell Murni
  float V_Cell1 = V_Sensor1;
  float V_Cell2 = V_Sensor2 - V_Sensor1;
  float V_Cell3 = V_Sensor3 - V_Sensor2;
  float V_Total_In = V_Sensor3; // Total DC Input dari baterai 3S

  // Pengkondisian agar nilai cell tidak negatif jika pembacaan sedikit tidak akurat (sebelum dikalibrasi)
  if (V_Cell2 < 0.0f) V_Cell2 = 0.0f;
  if (V_Cell3 < 0.0f) V_Cell3 = 0.0f;

  // 3. Pembacaan Sensor INA219 Jalur 12V
  float shuntVoltage_12V_mV = ina12V.getShuntVoltage_mV();
  float busVoltage_12V_V = ina12V.getBusVoltage_V();
  float V_Out12 = busVoltage_12V_V + (shuntVoltage_12V_mV / 1000.0);
  float I_Out12 = ina12V.getCurrent_mA(); // Arus dalam mA

  // 4. Pembacaan Sensor INA219 Jalur 5V
  float shuntVoltage_5V_mV = ina5V.getShuntVoltage_mV();
  float busVoltage_5V_V = ina5V.getBusVoltage_V();
  float V_Out5 = busVoltage_5V_V + (shuntVoltage_5V_mV / 1000.0);
  float I_Out5 = ina5V.getCurrent_mA(); // Arus dalam mA

  // 5. Pembacaan Sensor Suhu DS18B20
  tempSensor.requestTemperatures();
  float tempSystem = tempSensor.getTempCByIndex(0);

  // 6. Cetak Pembacaan ke Serial Monitor secara Rapi
  Serial.println("-------------------------------------------------------------");
  Serial.print("Timestamp: "); Serial.print(millis() / 1000); Serial.println(" s");
  
  // Tampilkan Informasi Baterai 3S
  Serial.println("[ Baterai 3S Li-ion ]");
  Serial.print("  - Cell 1 Voltage   : "); Serial.print(V_Cell1, 3); Serial.println(" V");
  Serial.print("  - Cell 2 Voltage   : "); Serial.print(V_Cell2, 3); Serial.println(" V");
  Serial.print("  - Cell 3 Voltage   : "); Serial.print(V_Cell3, 3); Serial.println(" V");
  Serial.print("  - Total Voltage In : "); Serial.print(V_Total_In, 3); Serial.println(" V");

  // Tampilkan Jalur Output 12V
  Serial.println("[ Output Jalur 12V ]");
  Serial.print("  - Voltage Out      : "); Serial.print(V_Out12, 3); Serial.println(" V");
  Serial.print("  - Current Out      : "); Serial.print(I_Out12, 1); Serial.println(" mA");

  // Tampilkan Jalur Output 5V
  Serial.println("[ Output Jalur 5V ]");
  Serial.print("  - Voltage Out      : "); Serial.print(V_Out5, 3); Serial.println(" V");
  Serial.print("  - Current Out      : "); Serial.print(I_Out5, 1); Serial.println(" mA");

  // Tampilkan Suhu Sistem
  Serial.println("[ Parameter Suhu ]");
  Serial.print("  - System Temp      : "); 
  if (tempSystem == DEVICE_DISCONNECTED_C) {
    Serial.println("ERR (Sensor Terputus)");
  } else {
    Serial.print(tempSystem, 2); Serial.println(" *C");
  }
  Serial.println("-------------------------------------------------------------");
}
