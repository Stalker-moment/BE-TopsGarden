/*
 # This sample code is used to test the pH meter V1.0 and DHT22 sensor on Arduino Mega 2560.
 # Editor : YouYou
 # Modified for Arduino Mega 2560
 # Ver    : 2.1
 # Product: analog pH meter, DHT22 sensor
 # SKU    : SEN0161
*/
#include <DHT.h>

#define SensorPin A0            // pH meter Analog output to Arduino Analog Input
#define DHTPIN 3                // Digital pin connected to the DHT sensor
#define LDRPIN 4
#define DHTTYPE DHT22           // DHT 22 (AM2302)
#define Offset 0.00             // deviation compensate
#define LED 13                  // Built-in LED on Arduino Mega 2560
#define samplingInterval 20
#define printInterval 1000
#define ArrayLenth  40          // times of collection

String spacer = ",";

DHT dht(DHTPIN, DHTTYPE);
int pHArray[ArrayLenth];   // Store the average value of the sensor feedback
int pHArrayIndex = 0;

void setup(void) {
  pinMode(LED, OUTPUT);
  pinMode(LDRPIN, INPUT_PULLUP);
  Serial.begin(115200);
  //Serial.println("pH meter and DHT22 sensor experiment!");    // Test the serial monitor
  dht.begin();
}

void loop(void) {
  static unsigned long printTime = millis();
  static float pHValue, voltage;
  float temperature, humidity;
  bool LDR;

  readSensor(pHValue, voltage);
  readDHTSensor(temperature, humidity);
  readLDR(LDR);

  if (millis() - printTime > printInterval) { // Every 800 milliseconds, print sensor values
    // Serial.print("Voltage:");
    // Serial.print(voltage, 2);
    // Serial.print("    pH value: ");
    // Serial.println(pHValue, 2);

    // Serial.print("Temperature: ");
    // Serial.print(temperature, 2);
    // Serial.print(" °C    Humidity: ");
    // Serial.println(humidity, 2);
    Serial.println("*"+String(voltage)+spacer+String(pHValue)+spacer+String(temperature)+spacer+String(humidity)+spacer+String(LDR)+"#");

    digitalWrite(LED, !digitalRead(LED));
    printTime = millis();
  }
}

void readSensor(float &pHValue, float &voltage) {
  static unsigned long samplingTime = millis();
  if (millis() - samplingTime > samplingInterval) {
    pHArray[pHArrayIndex++] = analogRead(SensorPin);
    if (pHArrayIndex == ArrayLenth) pHArrayIndex = 0;
    voltage = avergearray(pHArray, ArrayLenth) * 5.0 / 1024; // Adjusted for Arduino Mega 5V ADC
    pHValue = 3.5 * voltage + Offset;
    samplingTime = millis();
  }
}

void readDHTSensor(float &temperature, float &humidity) {
  humidity = dht.readHumidity();
  temperature = dht.readTemperature();
  
  if (isnan(humidity) || isnan(temperature)) {
    //Serial.println("Failed to read from DHT sensor!");
    temperature = humidity = 0;
  }
}

void readLDR(bool &LDR) {
  LDR = digitalRead(LDRPIN);
}

double avergearray(int* arr, int number) {
  int i;
  int max, min;
  double avg;
  long amount = 0;
  if (number <= 0) {
    Serial.println("Error number for the array to averaging!/n");
    return 0;
  }
  if (number < 5) {   // less than 5, calculated directly statistics
    for (i = 0; i < number; i++) {
      amount += arr[i];
    }
    avg = amount / number;
    return avg;
  } else {
    if (arr[0] < arr[1]) {
      min = arr[0]; max = arr[1];
    } else {
      min = arr[1]; max = arr[0];
    }
    for (i = 2; i < number; i++) {
      if (arr[i] < min) {
        amount += min;        // arr < min
        min = arr[i];
      } else {
        if (arr[i] > max) {
          amount += max;    // arr > max
          max = arr[i];
        } else {
          amount += arr[i]; // min <= arr <= max
        }
      }
    }
    avg = (double)amount / (number - 2);
  }
  return avg;
}
