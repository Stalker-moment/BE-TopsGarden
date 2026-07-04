#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>

// --- KONFIGURASI WIFI (Sesuai Request) ---
const char* ssid = "TierKun_IoT";
const char* password = "Tier010707";

// --- KONFIGURASI API ---
const String listUrl = "http://192.168.100.149:2055/api/device/outputs";
const String updateUrl = "http://192.168.100.149:2055/api/device/output/";

// --- PIN MAPPING (Sesuai Markdown Wiring) ---
#define LDR_PIN 34
#define RELAY_1 2
#define RELAY_2 15

// --- KEYPAD 3x4 ---
const byte ROWS = 4;
const byte COLS = 3;
char keys[ROWS][COLS] = {
  {'1','2','3'},
  {'4','5','6'},
  {'7','8','9'},
  {'*','0','#'}
};
byte rowPins[ROWS] = {13, 12, 14, 27}; 
byte colPins[COLS] = {26, 25, 33}; 
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

LiquidCrystal_I2C lcd(0x3F, 20, 4);

struct Lampu {
  String id; // Ubah dari int ke String
  String deskripsi;
};

Lampu daftarLampu[10]; 
int totalLampu = 0;
int currentIndex = 0;
unsigned long lastLDRCheck = 0;
bool autoMode = false; // Tekan '5' untuk Toggle Auto LDR

// Definisikan karakter custom (Max 8 karakter)
byte lampOn[8] = {B01110, B11111, B11111, B11111, B01110, B01110, B00100, B00000};
byte lampOff[8] = {B01110, B10001, B10001, B10001, B01110, B01110, B00100, B00000};
byte wifiIcon[8] = {B00000, B00111, B01000, B10011, B00100, B01010, B00000, B00100};
byte arrowUp[8] = {B00100, B01110, B11111, B00100, B00100, B00100, B00100, B00000};
byte arrowDown[8] = {B00100, B00100, B00100, B00100, B00100, B11111, B01110, B00100};
byte plugIcon[8] = {B01010, B01010, B11111, B10001, B10001, B01110, B00100, B00100};

void setupIcons() {
  lcd.createChar(0, lampOn);
  lcd.createChar(1, lampOff);
  lcd.createChar(2, wifiIcon);
  lcd.createChar(3, arrowUp);
  lcd.createChar(4, arrowDown);
  lcd.createChar(5, plugIcon);
}

void setup() {
  Serial.begin(115200);
  pinMode(LDR_PIN, INPUT);
  pinMode(RELAY_1, OUTPUT);
  pinMode(RELAY_2, OUTPUT);
  
  lcd.init();
  lcd.backlight();
  setupIcons(); // Panggil fungsi setup icon ke dalam setup utama
  
  WiFi.begin(ssid, password);
  lcd.setCursor(0,0);
  lcd.print("Connecting WiFi...");
  lcd.setCursor(0,1);
  lcd.print(ssid);
  
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print(".");
  }
  
  fetchLampu(); 
  updateDisplay();
}

void fetchLampu() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(listUrl);
    
    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      DynamicJsonDocument doc(8192); 
      deserializeJson(doc, payload);

      JsonArray arr = doc["data"]["items"];
      
      totalLampu = 0;
      for (JsonObject obj : arr) {
        if (totalLampu < 10) {
          daftarLampu[totalLampu].id = obj["id"].as<String>();
          daftarLampu[totalLampu].deskripsi = obj["name"].as<String>().substring(0, 18);
          
          Serial.print("[DATA] Found: ");
          Serial.println(daftarLampu[totalLampu].deskripsi);
          totalLampu++;
        }
      }
    }
    http.end();
  }
  updateDisplay();
}

void showLoading(String pesan) {
  lcd.setCursor(0, 2);
  lcd.print("                    "); // Bersihkan baris
  lcd.setCursor(0, 2);
  lcd.print(pesan);
  for (int i = 0; i < 3; i++) {
    lcd.print(".");
    delay(200);
  }
}

void updateDisplay() {
  lcd.clear();
  
  // --- BARIS 1: HEADER (Nama App & Paging Info) ---
  lcd.setCursor(0, 0);
  lcd.write(2); // Ikon WiFi
  String headerText = " TOP's GARDEN ";
  lcd.print(headerText);
  
  String paging = "[";
  paging += (totalLampu > 0) ? String(currentIndex + 1) : "0";
  paging += "/";
  paging += String(totalLampu);
  paging += "]";
  
  int padding = 20 - (1 + headerText.length() + paging.length()); 
  if (padding > 0) {
    for(int i = 0; i < padding; i++) {
      lcd.print(" ");
    }
  }
  lcd.print(paging);

  // --- BARIS 2: NAMA PERANGKAT (Tengah) ---
  lcd.setCursor(0, 1);
  if (totalLampu > 0) {
    lcd.write(5); // Ikon colokan
    lcd.print(" ");
    
    String nama = daftarLampu[currentIndex].deskripsi;
    if (nama.length() > 18) nama = nama.substring(0, 18);
    
    int spaces = (18 - nama.length()) / 2;
    for (int i=0; i<spaces; i++) lcd.print(" ");
    lcd.print(nama);
  } else {
    lcd.print("> Wait API data...");
  }

  // --- BARIS 3: MODE STATUS ---
  lcd.setCursor(0, 2);
  lcd.print("Mode : ");
  if (autoMode) {
    lcd.print("AUTO (Sensor) ");
  } else {
    lcd.print("MANUAL (Pad)  ");
  }

  // --- BARIS 4: ACTION NAVIGATION ---
  lcd.setCursor(0, 3);
  lcd.write(3); // Arrow Up
  lcd.print("2 ");
  lcd.write(4); // Arrow Down
  lcd.print("8 | ON:# | OFF:*");
}

void controlLampu(String id, bool state) {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  String url = updateUrl + id;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  // Menggunakan StaticJsonDocument yang pas ukurannya
  StaticJsonDocument<256> body;
  
  // 1. State dikirim sebagai boolean (true/false)
  body["state"] = state; 
  
  // 2. Mode WAJIB HURUF KAPITAL sesuai gambar referensi
  body["mode"] = autoMode ? "AUTO" : "MANUAL";
  
  // 3. Kirimkan null (JsonVariant) untuk waktu agar tidak error 500
  body["turnOnTime"] = JsonVariant(); 
  body["turnOffTime"] = JsonVariant();

  String jsonRequest;
  serializeJson(body, jsonRequest);
  
  // Debug untuk memastikan format sudah sama persis dengan gambar referensi
  Serial.print("[PUT] Payload: "); 
  Serial.println(jsonRequest);

  int httpCode = http.PUT(jsonRequest);
  
  Serial.print("[PUT] Response Code: ");
  Serial.println(httpCode);

  if (httpCode != 200) {
    String response = http.getString();
    Serial.println("[ERROR RESPONSE]: " + response);
  }
  
  http.end();
}

void checkLDR() {
  if (!autoMode) return;
  
  int ldrValue = analogRead(LDR_PIN);
  static bool lastState = false;
  bool currentState = (ldrValue > 2000); // Gelap = True (ON)

  if (currentState != lastState) {
    controlLampu(daftarLampu[currentIndex].id, currentState);
    lastState = currentState;
    updateDisplay();
  }
}

void loop() {
  char key = keypad.getKey();
  
  if (key) {
    if (key == '2' && currentIndex > 0) { currentIndex--; updateDisplay(); } 
    else if (key == '8' && currentIndex < totalLampu - 1) { currentIndex++; updateDisplay(); }
    else if (key == '5') { autoMode = !autoMode; updateDisplay(); } // Toggle Auto/Manual
    else if (key == '#') { controlLampu(daftarLampu[currentIndex].id, true); updateDisplay(); }
    else if (key == '*') { controlLampu(daftarLampu[currentIndex].id, false); updateDisplay(); }
    else if (key == '0') { fetchLampu(); currentIndex = 0; updateDisplay(); }
  }

  // Cek LDR setiap 5 detik jika mode Auto aktif
  if (millis() - lastLDRCheck > 5000) {
    checkLDR();
    lastLDRCheck = millis();
  }
}