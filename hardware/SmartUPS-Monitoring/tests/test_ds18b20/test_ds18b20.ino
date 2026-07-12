/**
 * Test Sketch: DS18B20 Temperature Sensor (One-Wire)
 * Memeriksa apakah sensor DS18B20 terhubung pada pin data digital
 * dan menampilkan suhu sistem saat ini dalam Celcius.
 */

#include <OneWire.h>
#include <DallasTemperature.h>

#define PIN_ONE_WIRE 4

OneWire oneWire(PIN_ONE_WIRE);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  Serial.println("=========================================");
  Serial.println("         Test: DS18B20 Temp Sensor       ");
  Serial.println("=========================================");

  // Memulai library DallasTemperature
  sensors.begin();
  
  // Mencari sensor
  int deviceCount = sensors.getDeviceCount();
  Serial.print("Menghitung sensor One-Wire... ");
  Serial.print("Ditemukan "); Serial.print(deviceCount); Serial.println(" sensor DS18B20.");
  
  if (deviceCount == 0) {
    Serial.println("[PENTING] Hubungkan pin DQ sensor ke GPIO 4 dengan resistor pull-up 4.7k Ohm ke 3.3V!");
  }
}

void loop() {
  // Mengambil data suhu dari sensor
  sensors.requestTemperatures();
  
  // Membaca suhu dari sensor indeks ke-0 (sensor pertama yang ditemukan di bus)
  float tempC = sensors.getTempCByIndex(0);

  // Menampilkan hasil
  Serial.print("Suhu Sensor: ");
  if (tempC == DEVICE_DISCONNECTED_C) {
    Serial.println("ERR - Sensor terputus (DEVICE_DISCONNECTED)");
  } else {
    Serial.print(tempC, 2);
    Serial.println(" *C");
  }

  delay(2000);
}
