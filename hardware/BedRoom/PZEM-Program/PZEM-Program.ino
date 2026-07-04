#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <PZEM004Tv30.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- KONFIGURASI WIFI & API ---
const char* ssid = "TierKun_IoT";
const char* password = "Tier010707";
const char* serverUrl = "http://192.168.100.149:2055/api/device/pzem/data"; // Ganti dengan URL API Anda
const char* deviceId = "fa7daf1f-b10f-4480-80f3-80e306484365"; // UUID Device Anda

// --- KONFIGURASI PIN & SENSOR ---
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);
LiquidCrystal_I2C lcd(0x3F, 20, 4);

// --- DEFINISI CUSTOM CHARACTER (Limit 8) ---
byte iconVolt[8]   = {B00010, B00110, B01100, B11111, B00110, B01100, B01000, B00000};
byte iconAmp[8]    = {B01010, B01010, B11111, B11111, B01110, B00100, B00100, B00000};
byte iconWatt[8]   = {B01110, B10001, B10001, B10101, B01110, B01110, B00100, B00000};

// Sub-pixel Progress Bar (Irisan vertikal 1-4)
byte bar1[8] = {B10000, B10000, B10000, B10000, B10000, B10000, B10000, B10000};
byte bar2[8] = {B11000, B11000, B11000, B11000, B11000, B11000, B11000, B11000};
byte bar3[8] = {B11100, B11100, B11100, B11100, B11100, B11100, B11100, B11100};
byte bar4[8] = {B11110, B11110, B11110, B11110, B11110, B11110, B11110, B11110};

unsigned long lastSendTime = 0;
const unsigned long sendInterval = 2000; // Kirim data tiap 5 detik

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  
  // Daftarkan Karakter (Max 8 slot: 0-7)
  lcd.createChar(0, iconVolt);
  lcd.createChar(1, iconAmp);
  lcd.createChar(2, iconWatt);
  lcd.createChar(3, bar1);
  lcd.createChar(4, bar2);
  lcd.createChar(5, bar3);
  lcd.createChar(6, bar4);
  // Slot 7 kosong atau bisa untuk ikon lain, Blok penuh pakai 255 bawaan LCD

  lcd.setCursor(0, 0); lcd.print("Connecting WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  lcd.clear();
  lcd.setCursor(0, 1); lcd.print("   SYSTEM READY   ");
  delay(1500);
  lcd.clear();
}

void printAt(int col, int row, String text, int width) {
  lcd.setCursor(col, row);
  lcd.print(text);
  for(int i = text.length(); i < width; i++) {
    lcd.print(" ");
  }
}

// Fungsi Progress Bar Detail (Per 2% untuk 10 bar/50 step)
void drawDetailedBar(int row, int colStart, int totalWidth, float percentage) {
  lcd.setCursor(colStart, row);
  lcd.print("[");
  
  int totalPixels = totalWidth * 5; 
  int pixelsToDraw = (percentage / 100.0) * totalPixels;
  
  for (int i = 0; i < totalWidth; i++) {
    int currentBlockPixels = pixelsToDraw - (i * 5);
    
    if (currentBlockPixels >= 5) {
      lcd.write(255); // Blok Penuh
    } else if (currentBlockPixels == 4) {
      lcd.write(6);   // 4 baris pixel
    } else if (currentBlockPixels == 3) {
      lcd.write(5);   // 3 baris pixel
    } else if (currentBlockPixels == 2) {
      lcd.write(4);   // 2 baris pixel
    } else if (currentBlockPixels == 1) {
      lcd.write(3);   // 1 baris pixel
    } else {
      lcd.print("-"); // Area kosong
    }
  }
  lcd.print("]");
}

void sendDataToServer(float v, float a, float p, float e, float f, float pf) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["deviceId"] = deviceId;
    doc["voltage"]  = v;
    doc["current"]  = a;
    doc["power"]    = p;
    doc["energy"]   = e;
    doc["frequency"] = f;
    doc["pf"]       = pf;

    String jsonStr;
    serializeJson(doc, jsonStr);

    int httpResponseCode = http.POST(jsonStr);

    if (httpResponseCode > 0) {
      String response = http.getString();
      StaticJsonDocument<128> resDoc;
      deserializeJson(resDoc, response);
      if (String(resDoc["command"]) == "RESET_ENERGY") {
        pzem.resetEnergy();
        Serial.println("Energy Reset via API!");
      }
    }
    http.end();
  }
}

void loop() {
  float voltage   = pzem.voltage();
  float current   = pzem.current();
  float power     = pzem.power();
  float energy    = pzem.energy();
  float frequency = pzem.frequency();
  float pf        = pzem.pf();

  if (isnan(voltage)) {
    lcd.setCursor(0, 0); lcd.print("--- SENSOR ERROR ---");
  } else {
    // BARIS 1: Tegangan & Arus
    lcd.setCursor(0, 0); lcd.write(0); // Ikon Volt
    printAt(1, 0, String(voltage, 1) + "V", 9);
    lcd.setCursor(10, 0); lcd.print("|");
    lcd.setCursor(11, 0); lcd.write(1); // Ikon Amp
    printAt(12, 0, String(current, 2) + "A", 8);

    // BARIS 2: Daya & Frekuensi
    lcd.setCursor(0, 1); lcd.write(2); // Ikon Watt
    printAt(1, 1, String((int)power) + "W", 9);
    lcd.setCursor(10, 1); lcd.print("|");
    lcd.setCursor(11, 1); lcd.print("F:"); 
    printAt(13, 1, String(frequency, 1) + "Hz", 7);

    // BARIS 3: Energi & PF
    lcd.setCursor(0, 2); lcd.print("E:");
    printAt(2, 2, String(energy, 2) + "kWh", 8);
    lcd.setCursor(10, 2); lcd.print("|");
    lcd.setCursor(11, 2); lcd.print("PF:");
    printAt(14, 2, String(pf, 2), 6);

    // BARIS 4: Detailed Progress Bar
    float maxPower = 450.0; // Limit daya rumah/alat
    float percent = (power / maxPower) * 100.0;
    percent = constrain(percent, 0, 100);

    lcd.setCursor(0, 3);
    lcd.print("P"); 
    drawDetailedBar(3, 1, 13, percent); // Menggunakan 13 kolom untuk bar

    // Cetak Persentase Rata Kanan
    char pctBuf[6];
    snprintf(pctBuf, sizeof(pctBuf), "%3d%%", (int)percent);
    lcd.setCursor(16, 3);
    lcd.print(pctBuf);

    // Kirim API secara non-blocking
    if (millis() - lastSendTime > sendInterval) {
      sendDataToServer(voltage, current, power, energy, frequency, pf);
      lastSendTime = millis();
    }
  }
  delay(500); 
}