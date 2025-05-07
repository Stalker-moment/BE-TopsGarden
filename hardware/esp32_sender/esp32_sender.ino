#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Arduino.h>

const char* ssid = "TopsGarden";
const char* password = "Tops010707";
String base_url = "https://gardenapi.tierkun.my.id";  // Pastikan menggunakan http atau https yang benar

//Deklarasi untuk parsing data
String dataIn;
String dt[25];
int i;
boolean parsing = false;

//Definisi data string
String Voltage = "";
String Ph = "";
String Temp = "";
String Humi = "";
String LDR = "";
String APIHealth;

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  Serial.println("Connected to WiFi");
}

void loop() {
  connectionHandler();
  if (Serial.available() > 0) {
    char inChar = (char)Serial.read();
    dataIn += inChar;
    if (inChar == '\n') {
      parsing = true;
    }
  }

  if (parsing) {
    parsingData();
    parsing = false;
    dataIn = "";
  }
}

void connectionHandler() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi Disconnected. Reconnecting...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
      delay(1000);
      Serial.println("Reconnecting to WiFi...");
    }
    Serial.println("Reconnected to WiFi");
  }
}

void parsingData() {
  int j = 0;

  //kirim data yang telah diterima sebelumnya
  Serial.print("data masuk : ");
  Serial.print(dataIn);

  //inisialisasi variabel, (reset isi variabel)
  dt[j] = "";
  //proses parsing data
  for (i = 1; i < dataIn.length(); i++) {
    //pengecekan tiap karakter dengan karakter (#) dan (,)
    if ((dataIn[i] == '#') || (dataIn[i] == ',')) {
      j++;
      dt[j] = "";
    } else {
      dt[j] = dt[j] + dataIn[i];
    }
  }

  //Wrapping data untuk di definisikan
  Voltage = dt[0];
  Ph = dt[1];
  Temp = dt[2];
  Humi = dt[3];
  LDR = dt[4];

  sendDataSensor();
}

void sendDataSensor() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    
    // Perbaiki URL API
    String url = base_url + "/api/device/sensor/" + Voltage + "/" + Ph + "/" + Temp + "/" + Humi + "/" + LDR;

    Serial.print("Sending HTTP GET request to: ");
    Serial.println(url);

    http.begin(url);
    
    // Ikuti redirect jika terjadi pengalihan (301, 302)
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

    int httpCode = http.GET();
    if (httpCode > 0) {
      if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        Serial.println("Response payload:");
        Serial.println(payload);

        DynamicJsonDocument doc(1024);
        deserializeJson(doc, payload);

        APIHealth = "Yes";
      } else {
        Serial.print("HTTP request failed with error code: ");
        Serial.println(httpCode);
        APIHealth = "No";
      }
    } else {
      Serial.print("HTTP request failed with error code: ");
      Serial.println(httpCode);
      APIHealth = "No";
    }

    http.end();
  }
}
