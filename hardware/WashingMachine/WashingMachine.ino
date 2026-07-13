#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <PZEM004Tv30.h>
#include <Keypad.h>
#include <Preferences.h>

// --- KONFIGURASI WIFI ---
const char* ssid = "TierKun_IoT";
const char* password = "Tier010707";

// --- KONFIGURASI API BACKEND ---
const char* pzemServerUrl = "http://192.168.100.149:2055/api/device/pzem/data";
const char* pzemDeviceId = "fa7daf1f-b10f-4480-80f3-80e306484365"; // Ganti dengan ID mesin cuci Anda

// --- PIN MAPPING ---
#define RELAY_PIN 4
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

// --- KEYPAD 3x4 PIN MAPPING (Sama seperti Bedroom) ---
const byte ROWS = 4;
const byte COLS = 3;
char keys[ROWS][COLS] = {
  { '1', '2', '3' },
  { '4', '5', '6' },
  { '7', '8', '9' },
  { '*', '0', '#' }
};
byte rowPins[ROWS] = { 13, 15, 14, 27 };
byte colPins[COLS] = { 26, 25, 33 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// --- SENSOR PZEM & LCD ---
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);
LiquidCrystal_I2C lcd(0x27, 20, 4); // Alamat I2C umum 0x27 atau 0x3F

// --- EEPROM / STORAGE PERSISTENCE ---
Preferences preferences;

// --- STATE MANAGEMENT ---
enum UIState {
  STATE_DASHBOARD,
  STATE_SETTINGS_MENU,
  STATE_EDIT_THRESHOLD,
  STATE_EDIT_DELAY,
  STATE_EDIT_AUTO_RECONNECT,
  STATE_EDIT_RECONNECT_DELAY
};
UIState currentUIState = STATE_DASHBOARD;

// --- PARAMETER MONITORING & PROTEKSI ---
bool relayState = true;                 // True = ON (Normal), False = OFF (Cutoff / Trip)
float overcurrentThreshold = 5.0;      // Threshold default dalam Ampere
int overcurrentDelay = 0;              // Detik. 0 = instan / spike, >0 = konsisten selama X detik
bool autoReconnect = false;            // Auto reconnect setelah trip
int reconnectDelay = 30;               // Waktu tunggu reconnect (detik)

unsigned long lastPzemSendTime = 0;
const unsigned long pzemSendInterval = 2000; // Kirim data tiap 2 detik
unsigned long lastDisplayUpdate = 0;

// Logika trip lokal instan & tunda
bool isLocalTripped = false;
unsigned long tripTime = 0;
unsigned long overcurrentStartTime = 0;

// Sinkronisasi Bidirectional
bool settingsChangedLocally = false;
bool relayStateChangedLocally = false;
String inputBuffer = ""; // Untuk menampung input keypad

void setup() {
  Serial.begin(115200);
  
  // Konfigurasi pin relay
  pinMode(RELAY_PIN, OUTPUT);
  
  // Memuat data dari Flash Memory (Preferences)
  preferences.begin("pzem_settings", false);
  overcurrentThreshold = preferences.getFloat("threshold", 5.0);
  relayState = preferences.getBool("relay_state", true);
  overcurrentDelay = preferences.getInt("overcurrent_delay", 0);
  autoReconnect = preferences.getBool("auto_reconnect", false);
  reconnectDelay = preferences.getInt("reconnect_delay", 30);
  preferences.end();
  
  // Sinkronisasi fisik pin di awal
  digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
  
  // Inisialisasi LCD
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WASHING & BOOSTER");
  lcd.setCursor(0, 1);
  lcd.print("PUMP MONITOR");
  lcd.setCursor(0, 3);
  lcd.print("Connecting WiFi...");

  // Hubungkan ke Wi-Fi
  connectWiFi();
}

void loop() {
  // Pastikan koneksi Wi-Fi tetap terhubung
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  unsigned long currentMillis = millis();

  // 1. Baca data kelistrikan dari PZEM
  float voltage   = pzem.voltage();
  float current   = pzem.current();
  float power     = pzem.power();
  float energy    = pzem.energy();
  float frequency = pzem.frequency();
  float pf        = pzem.pf();

  // Simpan nilai energy terakhir yang valid agar akumulasi kWh tidak hilang saat mati listrik
  static float lastValidEnergy = 0.0;
  if (!isnan(energy) && energy >= 0) {
    lastValidEnergy = energy;
  }

  // Jika sensor mati / error / listrik padam (isnan(voltage)), set ke 0.0V & 0W
  if (isnan(voltage)) {
    voltage   = 0.0;
    current   = 0.0;
    power     = 0.0;
    frequency = 0.0;
    pf        = 0.0;
    energy    = lastValidEnergy;
  } else {
    if (isnan(current))   current   = 0.0;
    if (isnan(power))     power     = 0.0;
    if (isnan(energy))    energy    = lastValidEnergy;
    if (isnan(frequency)) frequency = 0.0;
    if (isnan(pf))        pf        = 0.0;
  }

  // 2. Proteksi Overcurrent Lokal (Tunda & Spike)
  if (relayState && current > overcurrentThreshold) {
    if (overcurrentDelay == 0) {
      // Langsung trip jika diatur 0 (Instan / Spike)
      executeTrip(current, "INSTANT");
    } else {
      // Memulai hitungan waktu tunda jika belum mulai
      if (overcurrentStartTime == 0) {
        overcurrentStartTime = millis();
      } else if (millis() - overcurrentStartTime >= (overcurrentDelay * 1000)) {
        // Jika arus melebihi batas secara konsisten selama overcurrentDelay detik
        executeTrip(current, "DELAYED");
        overcurrentStartTime = 0;
      }
    }
  } else {
    // Reset timer jika arus turun kembali di bawah batas
    overcurrentStartTime = 0;
  }

  // 3. Logika Auto-Reconnect
  if (isLocalTripped && !relayState && autoReconnect) {
    unsigned long elapsedSeconds = (millis() - tripTime) / 1000;
    if (elapsedSeconds >= reconnectDelay) {
      // Lakukan auto reconnect pompa booster
      relayState = true;
      isLocalTripped = false;
      digitalWrite(RELAY_PIN, HIGH);
      
      preferences.begin("pzem_settings", false);
      preferences.putBool("relay_state", true);
      preferences.end();
      
      relayStateChangedLocally = true;
      Serial.println("[INFO] Auto-reconnecting relay after cooldown.");
      lcd.clear();
      lcd.setCursor(0, 1);
      lcd.print(" AUTO RECONNECTING  ");
      delay(1000);
      lcd.clear();
    }
  }

  // 4. Sinkronisasi Fisik Output Relay
  digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);

  // 5. Membaca Input dari Keypad 3x4
  char key = keypad.getKey();
  if (key) {
    handleKeypadInput(key);
  }

  // 6. Update Informasi di Layar LCD (setiap 500 ms)
  if (currentMillis - lastDisplayUpdate > 500) {
    updateLCDDisplay(voltage, current, power, energy);
    lastDisplayUpdate = currentMillis;
  }

  // 7. Kirim data telemetri ke server API (setiap 2 detik)
  if (currentMillis - lastPzemSendTime > pzemSendInterval) {
    sendDataToServer(voltage, current, power, energy, frequency, pf);
    lastPzemSendTime = currentMillis;
  }
}

void executeTrip(float current, const char* tripType) {
  relayState = false;
  isLocalTripped = true;
  tripTime = millis();
  digitalWrite(RELAY_PIN, LOW); // Cutoff sirkuit seketika!
  
  // Simpan status cutoff ke Flash memory
  preferences.begin("pzem_settings", false);
  preferences.putBool("relay_state", false);
  preferences.end();
  
  relayStateChangedLocally = true;
  Serial.printf("[WARNING] %s OVERCURRENT TRIP! Current: %.2f A > Limit: %.2f A\n", tripType, current, overcurrentThreshold);
  lcd.clear();
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 15) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    lcd.setCursor(0, 3);
    lcd.print("WiFi: Connected     ");
  } else {
    Serial.println("\nWiFi Connection Failed! Running in Offline Mode.");
    lcd.setCursor(0, 3);
    lcd.print("WiFi: Offline Mode  ");
  }
}

void handleKeypadInput(char key) {
  if (currentUIState == STATE_DASHBOARD) {
    if (key == '*') {
      // Masuk ke Menu Pengaturan
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    } else if (key == '#') {
      // Toggle Relay manual dari keypad
      relayState = !relayState;
      if (relayState) {
        isLocalTripped = false; // Reset trip state jika dinyalakan manual
      }
      
      preferences.begin("pzem_settings", false);
      preferences.putBool("relay_state", relayState);
      preferences.end();

      relayStateChangedLocally = true;
      Serial.printf("[KEYPAD] Relay toggled manual to: %s\n", relayState ? "ON" : "OFF");
      lcd.clear();
    }
  } 
  else if (currentUIState == STATE_SETTINGS_MENU) {
    if (key == '1') {
      currentUIState = STATE_EDIT_THRESHOLD;
      inputBuffer = "";
      lcd.clear();
    } else if (key == '2') {
      currentUIState = STATE_EDIT_DELAY;
      inputBuffer = "";
      lcd.clear();
    } else if (key == '3') {
      currentUIState = STATE_EDIT_AUTO_RECONNECT;
      inputBuffer = "";
      lcd.clear();
    } else if (key == '4') {
      currentUIState = STATE_EDIT_RECONNECT_DELAY;
      inputBuffer = "";
      lcd.clear();
    } else if (key == '*') {
      // Kembali ke Dashboard
      currentUIState = STATE_DASHBOARD;
      lcd.clear();
    }
  }
  else if (currentUIState == STATE_EDIT_THRESHOLD) {
    if (key >= '0' && key <= '9') {
      if (inputBuffer.length() < 4) inputBuffer += key;
    } else if (key == '*') {
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    } else if (key == '#') {
      if (inputBuffer.length() > 0) {
        float val = atoi(inputBuffer.c_str()) / 100.0;
        if (val >= 0.2 && val <= 25.0) {
          overcurrentThreshold = val;
          preferences.begin("pzem_settings", false);
          preferences.putFloat("threshold", overcurrentThreshold);
          preferences.end();
          settingsChangedLocally = true;
          showSaveSuccess();
        } else {
          showSaveError("Range: 0.2-25.0A");
        }
      }
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    }
  }
  else if (currentUIState == STATE_EDIT_DELAY) {
    if (key >= '0' && key <= '9') {
      if (inputBuffer.length() < 2) inputBuffer += key;
    } else if (key == '*') {
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    } else if (key == '#') {
      if (inputBuffer.length() > 0) {
        int val = atoi(inputBuffer.c_str());
        if (val >= 0 && val <= 60) {
          overcurrentDelay = val;
          preferences.begin("pzem_settings", false);
          preferences.putInt("overcurrent_delay", overcurrentDelay);
          preferences.end();
          settingsChangedLocally = true;
          showSaveSuccess();
        } else {
          showSaveError("Range: 0-60 Secs");
        }
      }
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    }
  }
  else if (currentUIState == STATE_EDIT_AUTO_RECONNECT) {
    if (key == '0' || key == '1') {
      inputBuffer = String(key);
    } else if (key == '*') {
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    } else if (key == '#') {
      if (inputBuffer.length() > 0) {
        autoReconnect = (inputBuffer == "1");
        preferences.begin("pzem_settings", false);
        preferences.putBool("auto_reconnect", autoReconnect);
        preferences.end();
        settingsChangedLocally = true;
        showSaveSuccess();
      }
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    }
  }
  else if (currentUIState == STATE_EDIT_RECONNECT_DELAY) {
    if (key >= '0' && key <= '9') {
      if (inputBuffer.length() < 3) inputBuffer += key;
    } else if (key == '*') {
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    } else if (key == '#') {
      if (inputBuffer.length() > 0) {
        int val = atoi(inputBuffer.c_str());
        if (val >= 5 && val <= 300) {
          reconnectDelay = val;
          preferences.begin("pzem_settings", false);
          preferences.putInt("reconnect_delay", reconnectDelay);
          preferences.end();
          settingsChangedLocally = true;
          showSaveSuccess();
        } else {
          showSaveError("Range: 5-300 Secs");
        }
      }
      currentUIState = STATE_SETTINGS_MENU;
      lcd.clear();
    }
  }
}

void showSaveSuccess() {
  lcd.clear();
  lcd.setCursor(0, 1);
  lcd.print("   SETTINGS SAVED!  ");
  delay(1200);
}

void showSaveError(const char* errMsg) {
  lcd.clear();
  lcd.setCursor(0, 1);
  lcd.print("   INVALID INPUT!   ");
  lcd.setCursor(0, 2);
  lcd.print(errMsg);
  delay(1500);
}

void updateLCDDisplay(float v, float a, float p, float e) {
  if (currentUIState == STATE_DASHBOARD) {
    lcd.setCursor(0, 0);
    lcd.print("PUMP MON // ");
    if (isLocalTripped) {
      // Tampilkan hitung mundur reconnect di baris pertama
      if (autoReconnect) {
        unsigned long elapsed = (millis() - tripTime) / 1000;
        int remaining = reconnectDelay - elapsed;
        lcd.printf("REC %2ds ", remaining > 0 ? remaining : 0);
      } else {
        lcd.print("TRIPPED!");
      }
    } else if (!relayState) {
      lcd.print("CUTOFF  ");
    } else {
      lcd.print("ACTIVE  ");
    }

    // Baris 1: Volt & Ampere
    lcd.setCursor(0, 1);
    lcd.print("V: ");
    lcd.print(v, 1);
    lcd.print("V   ");
    lcd.setCursor(10, 1);
    lcd.print("A: ");
    lcd.print(a, 3);
    lcd.print("A   ");

    // Baris 2: Watt & kWh
    lcd.setCursor(0, 2);
    lcd.print("W: ");
    lcd.print(p, 1);
    lcd.print("W   ");
    lcd.setCursor(10, 2);
    lcd.print("E: ");
    lcd.print(e, 2);
    lcd.print("kWh ");

    // Baris 3: Instruksi & Menu
    lcd.setCursor(0, 3);
    lcd.print("*:Settings  #:");
    lcd.print(relayState ? "Off" : "On ");
  }
  else if (currentUIState == STATE_SETTINGS_MENU) {
    lcd.setCursor(0, 0);
    lcd.printf("1.Limit: %.2fA", overcurrentThreshold);
    lcd.setCursor(0, 1);
    lcd.printf("2.Delay: %ds", overcurrentDelay);
    lcd.setCursor(0, 2);
    lcd.printf("3.AutoRec: %s", autoReconnect ? "ON" : "OFF");
    lcd.setCursor(0, 3);
    lcd.printf("4.RecDelay: %ds", reconnectDelay);
  }
  else if (currentUIState == STATE_EDIT_THRESHOLD) {
    lcd.setCursor(0, 0);
    lcd.print("= EDIT LIMIT (100th)");
    lcd.setCursor(0, 1);
    lcd.printf("Current: %.2f A", overcurrentThreshold);
    lcd.setCursor(0, 2);
    lcd.print("New: ");
    lcd.print(inputBuffer);
    if (inputBuffer.length() > 0) {
      lcd.printf(" -> %.2fA  ", atoi(inputBuffer.c_str()) / 100.0);
    } else {
      lcd.print(" [____] A ");
    }
    lcd.setCursor(0, 3);
    lcd.print("*:Cancel    #:Save  ");
  }
  else if (currentUIState == STATE_EDIT_DELAY) {
    lcd.setCursor(0, 0);
    lcd.print("= EDIT TRIP DELAY == ");
    lcd.setCursor(0, 1);
    lcd.printf("Current: %d s (0=inst)", overcurrentDelay);
    lcd.setCursor(0, 2);
    lcd.print("New (secs): ");
    lcd.print(inputBuffer);
    lcd.setCursor(0, 3);
    lcd.print("*:Cancel    #:Save  ");
  }
  else if (currentUIState == STATE_EDIT_AUTO_RECONNECT) {
    lcd.setCursor(0, 0);
    lcd.print("= AUTO RECONNECT === ");
    lcd.setCursor(0, 1);
    lcd.printf("Current: %s", autoReconnect ? "ENABLED" : "DISABLED");
    lcd.setCursor(0, 2);
    lcd.print("New (0=Off,1=On): ");
    lcd.print(inputBuffer);
    lcd.setCursor(0, 3);
    lcd.print("*:Cancel    #:Save  ");
  }
  else if (currentUIState == STATE_EDIT_RECONNECT_DELAY) {
    lcd.setCursor(0, 0);
    lcd.print("= RECONNECT COOLDOWN ");
    lcd.setCursor(0, 1);
    lcd.printf("Current: %d s", reconnectDelay);
    lcd.setCursor(0, 2);
    lcd.print("New (secs): ");
    lcd.print(inputBuffer);
    lcd.setCursor(0, 3);
    lcd.print("*:Cancel    #:Save  ");
  }
}

void sendDataToServer(float v, float a, float p, float e, float f, float pf) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(pzemServerUrl);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<512> doc;
  doc["deviceId"]  = pzemDeviceId;
  doc["voltage"]   = v;
  doc["current"]   = a;
  doc["power"]     = p;
  doc["energy"]    = e;
  doc["frequency"] = f;
  doc["pf"]        = pf;
  
  // Laporkan state dan threshold ke server
  doc["relayState"] = relayState;
  doc["overcurrentThreshold"] = overcurrentThreshold;
  doc["overcurrentDelay"] = overcurrentDelay;
  doc["autoReconnect"] = autoReconnect;
  doc["reconnectDelay"] = reconnectDelay;

  String jsonStr;
  serializeJson(doc, jsonStr);

  int httpResponseCode = http.POST(jsonStr);

  if (httpResponseCode >= 200 && httpResponseCode < 300) {
    String response = http.getString();
    StaticJsonDocument<512> resDoc;
    deserializeJson(resDoc, response);
    
    // 1. Baca komando reset energy
    if (String(resDoc["command"]) == "RESET_ENERGY") {
      pzem.resetEnergy();
      Serial.println("[API] Energy Reset command executed.");
    }
    
    // 2. Baca perintah status relay dari server
    if (resDoc.containsKey("relayState")) {
      bool serverRelayState = resDoc["relayState"];
      
      if (relayStateChangedLocally) {
        if (serverRelayState == relayState) {
          relayStateChangedLocally = false;
        }
      } else {
        if (relayState != serverRelayState) {
          relayState = serverRelayState;
          if (relayState == true) {
            isLocalTripped = false;
          }
          
          preferences.begin("pzem_settings", false);
          preferences.putBool("relay_state", relayState);
          preferences.end();
          
          Serial.printf("[API] Relay state synced from Web: %s\n", relayState ? "ON" : "OFF");
        }
      }
    }
    
    // 3. Baca parameter setting lainnya jika tidak sedang dirubah lokal
    if (settingsChangedLocally) {
      // Validasi apakah server sudah sinkron dengan data lokal kita
      float serverThreshold = resDoc["overcurrentThreshold"] | 5.0;
      int serverDelay = resDoc["overcurrentDelay"] | 0;
      bool serverAutoRec = resDoc["autoReconnect"] | false;
      int serverRecDelay = resDoc["reconnectDelay"] | 30;

      if (abs(serverThreshold - overcurrentThreshold) < 0.005 &&
          serverDelay == overcurrentDelay &&
          serverAutoRec == autoReconnect &&
          serverRecDelay == reconnectDelay) {
        settingsChangedLocally = false;
        Serial.println("[API] Bidirectional settings synced successfully.");
      }
    } 
    else {
      // Sinkronisasi dari Web ke Hardware
      bool needsWrite = false;
      preferences.begin("pzem_settings", false);

      if (resDoc.containsKey("overcurrentThreshold")) {
        float serverThreshold = resDoc["overcurrentThreshold"];
        if (abs(overcurrentThreshold - serverThreshold) >= 0.005) {
          overcurrentThreshold = serverThreshold;
          preferences.putFloat("threshold", overcurrentThreshold);
          needsWrite = true;
          Serial.printf("[API] Overcurrent threshold synced: %.2f A\n", overcurrentThreshold);
        }
      }
      
      if (resDoc.containsKey("overcurrentDelay")) {
        int serverDelay = resDoc["overcurrentDelay"];
        if (overcurrentDelay != serverDelay) {
          overcurrentDelay = serverDelay;
          preferences.putInt("overcurrent_delay", overcurrentDelay);
          needsWrite = true;
          Serial.printf("[API] Overcurrent delay synced: %d s\n", overcurrentDelay);
        }
      }
      
      if (resDoc.containsKey("autoReconnect")) {
        bool serverAutoRec = resDoc["autoReconnect"];
        if (autoReconnect != serverAutoRec) {
          autoReconnect = serverAutoRec;
          preferences.putBool("auto_reconnect", autoReconnect);
          needsWrite = true;
          Serial.printf("[API] Auto-reconnect synced: %s\n", autoReconnect ? "ON" : "OFF");
        }
      }
      
      if (resDoc.containsKey("reconnectDelay")) {
        int serverRecDelay = resDoc["reconnectDelay"];
        if (reconnectDelay != serverRecDelay) {
          reconnectDelay = serverRecDelay;
          preferences.putInt("reconnect_delay", reconnectDelay);
          needsWrite = true;
          Serial.printf("[API] Reconnect delay synced: %d s\n", reconnectDelay);
        }
      }

      preferences.end();
    }
  } else {
    Serial.printf("[HTTP ERROR] Failed to sync PZEM data. Code: %d\n", httpResponseCode);
  }
  http.end();
}
