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
const char* deviceId = ""; // UUID Device Anda

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

// --- OFFLINE QUEUE SYSTEM FOR PZEM TELEMETRY ---
struct PzemDataRecord {
  float v;
  float a;
  float p;
  float e;
  float f;
  float pf;
};

#define MAX_OFFLINE_BUFFER 60 // Kapasitas antrean simpan offline (hingga 60 record)
PzemDataRecord offlineBuffer[MAX_OFFLINE_BUFFER];
int offlineBufferHead = 0;
int offlineBufferTail = 0;
int offlineBufferCount = 0;

void enqueueOfflineData(float v, float a, float p, float e, float f, float pf) {
  if (offlineBufferCount < MAX_OFFLINE_BUFFER) {
    offlineBuffer[offlineBufferTail] = {v, a, p, e, f, pf};
    offlineBufferTail = (offlineBufferTail + 1) % MAX_OFFLINE_BUFFER;
    offlineBufferCount++;
    Serial.printf("[OFFLINE QUEUE] Server tidak terjangkau. Data disimpan di buffer ESP32 (%d/%d)\n", offlineBufferCount, MAX_OFFLINE_BUFFER);
  } else {
    // Buffer penuh -> menimpa data paling lama
    offlineBuffer[offlineBufferTail] = {v, a, p, e, f, pf};
    offlineBufferHead = (offlineBufferHead + 1) % MAX_OFFLINE_BUFFER;
    offlineBufferTail = (offlineBufferTail + 1) % MAX_OFFLINE_BUFFER;
    Serial.println("[OFFLINE QUEUE] Buffer penuh! Menimpa data terlama.");
  }
}

bool sendSingleRecord(float v, float a, float p, float e, float f, float pf) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2000); // 2 detik timeout

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
  bool success = false;

  if (httpResponseCode >= 200 && httpResponseCode < 300) {
    success = true;
    String response = http.getString();
    StaticJsonDocument<128> resDoc;
    deserializeJson(resDoc, response);
    if (String(resDoc["command"]) == "RESET_ENERGY") {
      pzem.resetEnergy();
      Serial.println("Energy Reset via API!");
    }
  } else {
    Serial.printf("[HTTP ERROR] Failed to send PZEM data. Code: %d\n", httpResponseCode);
  }
  http.end();
  return success;
}

void processOfflineQueue() {
  if (offlineBufferCount == 0 || WiFi.status() != WL_CONNECTED) return;

  Serial.printf("[OFFLINE QUEUE] Mengirim %d data offline yang tersimpan ke server...\n", offlineBufferCount);

  int sentCount = 0;
  while (offlineBufferCount > 0 && WiFi.status() == WL_CONNECTED) {
    PzemDataRecord rec = offlineBuffer[offlineBufferHead];
    bool ok = sendSingleRecord(rec.v, rec.a, rec.p, rec.e, rec.f, rec.pf);

    if (ok) {
      offlineBufferHead = (offlineBufferHead + 1) % MAX_OFFLINE_BUFFER;
      offlineBufferCount--;
      sentCount++;
      delay(50); // Jeda singkat antar request
    } else {
      Serial.println("[OFFLINE QUEUE] Gagal mengirim data antrean. Koneksi terputus kembali.");
      break;
    }
  }

  if (sentCount > 0) {
    Serial.printf("[OFFLINE QUEUE] Sukses mengirim %d data offline ke server. (Sisa antrean: %d)\n", sentCount, offlineBufferCount);
  }
}

void sendDataToServer(float v, float a, float p, float e, float f, float pf) {
  // 1. Jika terhubung & ada antrean data offline, flush data offline terlebih dahulu
  if (WiFi.status() == WL_CONNECTED && offlineBufferCount > 0) {
    processOfflineQueue();
  }

  // 2. Kirim data terkini
  bool success = sendSingleRecord(v, a, p, e, f, pf);

  // 3. Jika gagal kirim (koneksi terputus/server down), simpan di antrean offline
  if (!success) {
    enqueueOfflineData(v, a, p, e, f, pf);
  }
}


void loop() {
  float voltage   = pzem.voltage();
  float current   = pzem.current();
  float power     = pzem.power();
  float energy    = pzem.energy();
  float frequency = pzem.frequency();
  float pf        = pzem.pf();

  static float lastValidEnergy = 0.0;
  if (!isnan(energy) && energy >= 0) {
    lastValidEnergy = energy;
  }

  bool isError = isnan(voltage);

  if (isError) {
    voltage   = 0.0;
    current   = 0.0;
    power     = 0.0;
    frequency = 0.0;
    pf        = 0.0;
    energy    = lastValidEnergy;

    lcd.setCursor(0, 0); lcd.print("- SENSOR OFF / 0V  -");
    lcd.setCursor(0, 1); lcd.print("V: 0.0V  | P: 0W    ");
    lcd.setCursor(0, 2); lcd.print("E:"); printAt(2, 2, String(energy, 2) + "kWh", 8);
    lcd.setCursor(10, 2); lcd.print("| OFF");
    lcd.setCursor(0, 3); lcd.print("P[              ] 0%");
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
  }

  // Kirim API secara non-blocking SELALU (bahkan saat 0V / sensor error / mati listrik)
  if (millis() - lastSendTime > sendInterval) {
    Serial.printf("[DEBUG PZEM] V: %.1f V | A: %.3f A | W: %.1f W | E: %.3f kWh | F: %.1f Hz | PF: %.2f\n",
                  voltage, current, power, energy, frequency, pf);
    sendDataToServer(voltage, current, power, energy, frequency, pf);
    lastSendTime = millis();
  }

  delay(500); 
}