/**
 * Test Sketch: Dual INA219 Sensors (I2C)
 * Memindai bus I2C untuk memastikan modul terhubung pada alamat 0x40 dan 0x41,
 * lalu membaca Tegangan Bus, Tegangan Shunt, Tegangan Load, dan Arus (mA) dari kedua sensor.
 */

#include <Wire.h>
#include <Adafruit_INA219.h>

#define PIN_I2C_SDA 21
#define PIN_I2C_SCL 22

Adafruit_INA219 ina12V(0x40);
Adafruit_INA219 ina5V(0x41);

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  Serial.println("=========================================");
  Serial.println("         Test: Dual INA219 I2C           ");
  Serial.println("=========================================");

  // Inisialisasi Bus I2C kustom
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  // 1. Scan alamat I2C
  Serial.println("Memulai Pemindaian Alamat I2C...");
  byte error, address;
  int nDevices = 0;
  for (address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf(" - Perangkat I2C ditemukan pada alamat: 0x%02X\n", address);
      nDevices++;
    }
  }
  if (nDevices == 0) {
    Serial.println(" - [PENTING] Tidak ada perangkat I2C yang ditemukan!");
  }
  Serial.println("Pemindaian I2C selesai.\n");

  // 2. Inisialisasi Sensor INA219
  if (!ina12V.begin()) {
    Serial.println("[ERROR] Gagal menemukan INA219 Jalur 12V (0x40)");
  } else {
    Serial.println("[ OK  ] INA219 Jalur 12V (0x40) terdeteksi.");
  }

  if (!ina5V.begin()) {
    Serial.println("[ERROR] Gagal menemukan INA219 Jalur 5V (0x41)");
  } else {
    Serial.println("[ OK  ] INA219 Jalur 5V (0x41) terdeteksi.");
  }
}

void loop() {
  Serial.println("\n--- [ PEMBACAAN DATA INA219 ] ---");

  // Pembacaan INA219 12V
  float busVoltage_12V = ina12V.getBusVoltage_V();
  float shuntVoltage_12V = ina12V.getShuntVoltage_mV();
  float current_12V = ina12V.getCurrent_mA();
  float loadVoltage_12V = busVoltage_12V + (shuntVoltage_12V / 1000.0);

  Serial.println("[ Jalur 12V (0x40) ]");
  Serial.print("  - Bus Voltage   : "); Serial.print(busVoltage_12V, 2); Serial.println(" V");
  Serial.print("  - Shunt Voltage : "); Serial.print(shuntVoltage_12V, 2); Serial.println(" mV");
  Serial.print("  - Load Voltage  : "); Serial.print(loadVoltage_12V, 2); Serial.println(" V");
  Serial.print("  - Current       : "); Serial.print(current_12V, 1); Serial.println(" mA");

  // Pembacaan INA219 5V
  float busVoltage_5V = ina5V.getBusVoltage_V();
  float shuntVoltage_5V = ina5V.getShuntVoltage_mV();
  float current_5V = ina5V.getCurrent_mA();
  float loadVoltage_5V = busVoltage_5V + (shuntVoltage_5V / 1000.0);

  Serial.println("[ Jalur 5V (0x41) ]");
  Serial.print("  - Bus Voltage   : "); Serial.print(busVoltage_5V, 2); Serial.println(" V");
  Serial.print("  - Shunt Voltage : "); Serial.print(shuntVoltage_5V, 2); Serial.println(" mV");
  Serial.print("  - Load Voltage  : "); Serial.print(loadVoltage_5V, 2); Serial.println(" V");
  Serial.print("  - Current       : "); Serial.print(current_5V, 1); Serial.println(" mA");

  delay(2000);
}
