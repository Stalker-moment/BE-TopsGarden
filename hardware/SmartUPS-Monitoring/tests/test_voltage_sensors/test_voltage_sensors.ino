/**
 * Test Sketch: Voltage Sensors (Analog ADC)
 * Menampilkan data ADC mentah (raw ADC) dan tegangan terhitung dari ketiga sensor analog.
 */

#define PIN_V_SENS1 34   // Cell 1
#define PIN_V_SENS2 35   // Cell 2
#define PIN_V_SENS3 32   // Cell 3 / Total

void setup() {
  Serial.begin(115200);
  pinMode(PIN_V_SENS1, INPUT);
  pinMode(PIN_V_SENS2, INPUT);
  pinMode(PIN_V_SENS3, INPUT);
  
  Serial.println("=========================================");
  Serial.println("       Test: ADC Voltage Sensors         ");
  Serial.println("=========================================");
}

void loop() {
  // Membaca ADC mentah (0 - 4095)
  int raw1 = analogRead(PIN_V_SENS1);
  int raw2 = analogRead(PIN_V_SENS2);
  int raw3 = analogRead(PIN_V_SENS3);

  // Kalkulasi tegangan kasar (Multiplier teoretis: 16.5 / 4095 = 0.0040293)
  float v_sensor1 = raw1 * 0.0040293f;
  float v_sensor2 = raw2 * 0.0040293f;
  float v_sensor3 = raw3 * 0.0040293f;

  // Cetak hasil pembacaan
  Serial.print("Sensor 1 (Cell 1)   -> Raw: "); Serial.print(raw1); 
  Serial.print("\t Tegangan: "); Serial.print(v_sensor1, 3); Serial.println(" V");

  Serial.print("Sensor 2 (Cell 1+2) -> Raw: "); Serial.print(raw2); 
  Serial.print("\t Tegangan: "); Serial.print(v_sensor2, 3); Serial.println(" V");

  Serial.print("Sensor 3 (Total In) -> Raw: "); Serial.print(raw3); 
  Serial.print("\t Tegangan: "); Serial.print(v_sensor3, 3); Serial.println(" V");
  
  Serial.println("-----------------------------------------");
  
  delay(1000); // Update setiap 1 detik
}
