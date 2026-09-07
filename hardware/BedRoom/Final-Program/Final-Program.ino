#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <PZEM004Tv30.h>
#include <time.h>
#include <Preferences.h>

Preferences preferences;

// --- KONFIGURASI WIFI ---
const char* ssid = "Sheraton";
const char* password = "12345678";

// --- KONFIGURASI API KEYPAD ---
const String listUrl = "https://gardenapi.tierkun.my.id/api/device/outputs";
const String updateUrl = "https://gardenapi.tierkun.my.id/api/device/output/";

// --- KONFIGURASI API PZEM ---
const char* pzemServerUrl = "https://gardenapi.tierkun.my.id/api/device/pzem/data";
const char* pzemDeviceId = "35e824b5-8bd4-4bc1-b023-a133f7388259";

// --- KONFIGURASI API CUACA OPEN-METEO (OPENSOURCE) ---
// Surakarta (Solo), Jawa Tengah, Indonesia: Lat -7.5666, Lon 110.8166
const char* weatherApiUrl = "http://api.open-meteo.com/v1/forecast?latitude=-7.5666&longitude=110.8166&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m";

// Live Weather Variables (Updated Asynchronously via Core 0)
volatile float weatherTemp = 0.0;
volatile int weatherHumidity = 0;
volatile int weatherCode = 0;
volatile float weatherWind = 0.0;
volatile bool weatherValid = false;
String weatherDesc = "Memuat...";

// --- KONFIGURASI NTP ---
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 25200; // WIB = UTC+7 * 3600
const int   daylightOffset_sec = 0;

// --- PIN MAPPING ---
#define LDR_PIN 34
#define RELAY_1 4
#define RELAY_2 32
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

// Internal Sensors C++ Declaration (ESP32 specific)
#ifdef __cplusplus
extern "C" {
#endif
uint8_t temprature_sens_read();
#ifdef __cplusplus
}
#endif

// --- KONFIGURASI PZEM ---
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

// --- KONFIGURASI PWM LCD ---
const int LCD_BRIGHT = 2;
const int freq = 5000;
const int resolution = 8;

// --- SMOOTH BRIGHTNESS VARIABLES ---
int currentBrightness = 255;  
int targetBrightness = 255;
unsigned long lastFadeTime = 0;
const int fadeInterval = 5;  

// --- KEYPAD 3x4 ---
/*
D13 - Merah
D12 - Ungu
D14 - Biru
D27 - Kuning

D26 - Hijau
D25 - Coklat
D33 - Orange
*/    
const byte ROWS = 4;
const byte COLS = 3;
char keys[ROWS][COLS] = {
  { '1', '2', '3' },
  { '4', '5', '6' },
  { '7', '8', '9' },
  { '*', '0', '#' }
};
byte rowPins[ROWS] = { 13, 12, 14, 27 };
byte colPins[COLS] = { 26, 25, 33 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

LiquidCrystal_I2C lcd(0x27, 20, 4);

struct Lampu {
  String id;
  String deskripsi;
  bool state;
  String mode;
  String turnOnTime;
  String turnOffTime;
};

Lampu daftarLampu[10];
int totalLampu = 0;

// --- STATE MANAGEMENT ---
enum AppState {
  STATE_BOOT,
  STATE_PARENT_MENU,
  STATE_MENU_LIST_LAMPU,
  STATE_MENU_SYSTEM,
  STATE_MENU_WEATHER,
  STATE_MENU_SETTINGS,
  STATE_MENU_POWER,
  STATE_SCREEN_SAVER,
  STATE_CONTROL,
  STATE_INPUT_TIME_ON,
  STATE_INPUT_TIME_OFF
};
AppState currentState = STATE_BOOT;

// PARENT MENU variables
int parentMenuCursor = 0; 
#define PARENT_ITEM_COUNT 5

// SETTINGS VARIABLES
int settingsCursor = 0;
bool ssEnabled = false;
int ssType = 0; // 0: TIME, 1: EYE
unsigned long lastKeyPressTime = 0;
const unsigned long SCREEN_SAVER_TIMEOUT = 30000;
bool isScreenSaverActive = false;

// SYSTEM MENU variables
int sysMenuTopIndex = 0;
#define SYS_ITEM_COUNT 7

// MENU STATE variables
int menuCursor = 0;    
int menuTopIndex = 0;  

// CONTROL STATE variables
int controlIndex = 0;
unsigned long lastLDRCheck = 0;
int scrollPos = 0;
unsigned long lastScrollTime = 0;

// TIMING STATE variables
String timeInputBuffer = "";
String tempTurnOnTime = "";

// PZEM Timing & Live Async Variables
unsigned long lastPzemUpdate = 0;
volatile float liveVoltage = 0.0;
volatile float liveCurrent = 0.0;
volatile float livePower = 0.0;
volatile float liveEnergy = 0.0;
volatile float liveFrequency = 0.0;
volatile float livePf = 0.0;
volatile bool livePzemValid = false;
TaskHandle_t pzemTaskHandle = NULL;

// ANIMATION
int animFrame = 0;
unsigned long lastAnimTime = 0;
unsigned long lastClockUpdate = 0;
unsigned long lastSystemUpdate = 0;

// --- CUSTOM ICONS ---
byte wifiIcon[8] = { B00000, B01110, B10001, B00100, B01010, B00000, B00100, B00000 };
byte battIcon[8] = { B01110, B11111, B11111, B11111, B11111, B11111, B11111, B11111 };
byte flipperF1[8] = { B00000, B01110, B10001, B10101, B10001, B01110, B00000, B00000 };
byte flipperF2[8] = { B00000, B01110, B10001, B11111, B10001, B01110, B00000, B00000 };
byte selector[8] = { B01000, B01100, B01110, B01111, B01110, B01100, B01000, B00000 };
byte solidBlock[8] = { B11111, B11111, B11111, B11111, B11111, B11111, B11111, B11111 };

// RAM-SWAP ICONS
byte arrowUp[8] = { B00100, B01110, B11111, B00000, B00000, B00000, B00000, B00000 };
byte arrowDown[8] = { B00000, B00000, B00000, B00000, B00000, B11111, B01110, B00100 };
byte lampOn[8] = { B01110, B11111, B11111, B11111, B01110, B01110, B00100, B00000 };
byte lampOff[8] = { B01110, B10001, B10001, B10001, B01110, B01110, B00100, B00000 };

byte iconPanahKiri[8]  = {B00010, B00110, B01110, B11110, B01110, B00110, B00010, B00000};
byte iconPanahKanan[8] = {B01000, B01100, B01110, B01111, B01110, B01100, B01000, B00000};

// PROGRESS BAR ICONS (Load saat System Menu)
byte pBar[8]  = {B00000, B00000, B00000, B00000, B00000, B00000, B00000, B11111}; // Kosong
byte pBar1[8] = {B10000, B10000, B10000, B10000, B10000, B10000, B10000, B11111}; // 1 Block
byte pBar2[8] = {B11000, B11000, B11000, B11000, B11000, B11000, B11000, B11111}; // 2 Block
byte pBar3[8] = {B11100, B11100, B11100, B11100, B11100, B11100, B11100, B11111}; // 3 Block
byte pBar4[8] = {B11110, B11110, B11110, B11110, B11110, B11110, B11110, B11111}; // 4 Block

// PZEM ICONS
byte iconVolt[8]   = {B00010, B00110, B01100, B11111, B00110, B01100, B01000, B00000};
byte iconAmp[8]    = {B01010, B01010, B11111, B11111, B01110, B00100, B00100, B00000};
byte iconWatt[8]   = {B01110, B10001, B10001, B10101, B01110, B01110, B00100, B00000};
byte barPz1[8] = {B10000, B10000, B10000, B10000, B10000, B10000, B10000, B10000};
byte barPz2[8] = {B11000, B11000, B11000, B11000, B11000, B11000, B11000, B11000};
byte barPz3[8] = {B11100, B11100, B11100, B11100, B11100, B11100, B11100, B11100};
byte barPz4[8] = {B11110, B11110, B11110, B11110, B11110, B11110, B11110, B11110};

void setMenuIcons() {
  lcd.createChar(0, wifiIcon);
  lcd.createChar(2, arrowUp);
  lcd.createChar(3, arrowDown);
  lcd.createChar(6, selector);
}

void setControlIcons() {
  lcd.createChar(0, wifiIcon);
  lcd.createChar(2, lampOff);
  lcd.createChar(3, lampOn);
  lcd.createChar(4, flipperF1);
  lcd.createChar(5, flipperF2);
}

void setParentIcons() {
  lcd.createChar(0, wifiIcon);
  lcd.createChar(1, battIcon);
  lcd.createChar(2, iconPanahKiri);
  lcd.createChar(3, iconPanahKanan);
  lcd.createChar(4, flipperF1);
  lcd.createChar(5, flipperF2);
  lcd.createChar(6, selector);
  lcd.createChar(7, solidBlock);
}

void setSystemIcons() {
  lcd.createChar(0, wifiIcon);
  lcd.createChar(2, pBar1);
  lcd.createChar(3, pBar2);
  lcd.createChar(4, pBar3);
  lcd.createChar(5, pBar4);
  lcd.createChar(6, pBar); 
}

void setPzemIcons() {
  lcd.createChar(0, iconVolt);
  lcd.createChar(1, iconAmp);
  lcd.createChar(2, iconWatt);
  lcd.createChar(3, barPz1);
  lcd.createChar(4, barPz2);
  lcd.createChar(5, barPz3);
  lcd.createChar(6, barPz4);
}

void setupIcons() {
  setParentIcons();
}

void setLcdBrightness(int level) {
  ledcWrite(LCD_BRIGHT, level);
}

void playTransition() {
  for (int col = 0; col < 20; col++) {
    for (int row = 0; row < 4; row++) {
      lcd.setCursor(col, row);
      lcd.write(7);
    }
    delay(2);
  }
  for (int col = 0; col < 20; col++) {
    for (int row = 0; row < 4; row++) {
      lcd.setCursor(col, row);
      lcd.print(" ");
    }
    delay(2);
  }
}

// Forward declaration background task Core 0
void pzemBackgroundTask(void *pvParameters);

void setup() {
  Serial.begin(115200);

  ledcAttach(LCD_BRIGHT, freq, resolution);
  setLcdBrightness(255);

  pinMode(LDR_PIN, INPUT);
  pinMode(RELAY_1, OUTPUT);
  pinMode(RELAY_2, OUTPUT);

  // Keypad Fast Debounce & 1-Click Instant Response
  keypad.setDebounceTime(10);
  keypad.setHoldTime(500);

  lcd.init();
  lcd.backlight();
  setupIcons();

  lcd.setCursor(1, 0);
  lcd.print(".----------------.");
  lcd.setCursor(2, 1);
  lcd.print("[ GARDEN_OS v4 ]");
  lcd.setCursor(1, 2);
  lcd.print("'----------------'");
  lcd.setCursor(3, 3);
  lcd.print("BOOTING SYSTEM...");
  delay(400);

  playTransition();

  lcd.setCursor(0, 0);
  lcd.print("[ WIFI CONNECT ]");
  lcd.setCursor(0, 1);
  lcd.print("SSID: ");
  lcd.print(String(ssid).substring(0, 14));

  WiFi.begin(ssid, password);
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    lcd.setCursor(0, 2);
    lcd.print("Status: Linking");
    for (int i = 0; i < (dots % 5); i++) lcd.print(".");
    lcd.print("     ");  
    dots++;
  }
  
  lcd.setCursor(0, 2);
  lcd.print("Status: CONNECTED! ");
  lcd.setCursor(0, 3);
  lcd.print("IP: ");
  lcd.print(WiFi.localIP().toString());
  delay(500);

  // Init NTP
  lcd.setCursor(0, 3);
  lcd.print("Sync Time (NTP)...  ");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  delay(300);

  preferences.begin("gardenos", false);
  ssEnabled = preferences.getBool("ss_en", true);
  ssType = preferences.getInt("ss_type", 0);

  playTransition();
  fetchLampu();

  // Jalankan pembacaan PZEM & Telemetry di background Core 0 (Bebaskan Core 1 untuk UI Keypad 100% responsif)
  xTaskCreatePinnedToCore(
    pzemBackgroundTask,
    "PzemBgTask",
    8192,
    NULL,
    1,
    &pzemTaskHandle,
    0
  );
  
  currentState = STATE_PARENT_MENU;
  drawParentMenu();
}

String getLocalTimeStr() {
  struct tm timeinfo;
  if(!getLocalTime(&timeinfo)){
    return "--:--";
  }
  char timeStringBuff[15];
  if ((millis() / 500) % 2 == 0) {
    strftime(timeStringBuff, sizeof(timeStringBuff), "%H:%M", &timeinfo);
  } else {
    strftime(timeStringBuff, sizeof(timeStringBuff), "%H %M", &timeinfo);
  }
  return String(timeStringBuff);
}

void fetchLampu() {
  lcd.clear();
  lcd.setCursor(2, 1);
  setupIcons(); // Pastikan maskot aktif
  lcd.write(4);  
  lcd.print(" SYNCING API...");

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
          daftarLampu[totalLampu].deskripsi = obj["name"].as<String>();
          daftarLampu[totalLampu].state = obj["state"].as<bool>();
          daftarLampu[totalLampu].mode = obj["mode"].as<String>();

          if (!obj["turnOnTime"].isNull()) daftarLampu[totalLampu].turnOnTime = obj["turnOnTime"].as<String>();
          else daftarLampu[totalLampu].turnOnTime = "";

          if (!obj["turnOffTime"].isNull()) daftarLampu[totalLampu].turnOffTime = obj["turnOffTime"].as<String>();
          else daftarLampu[totalLampu].turnOffTime = "";
          totalLampu++;
        }
      }
    }
    http.end();
  }
  delay(500);
}

// ================= UI RENDERING =================

void drawProgressBar(int col, int row, int width, int percentage) {
  lcd.setCursor(col, row);
  int totalSegments = width * 5; 
  int filledSegments = (percentage * totalSegments) / 100;
  
  for (int i = 0; i < width; i++) {
    int segmentValue = filledSegments - (i * 5);
    if (segmentValue >= 5) lcd.write(7); // Full block
    else if (segmentValue == 4) lcd.write(5); 
    else if (segmentValue == 3) lcd.write(4); 
    else if (segmentValue == 2) lcd.write(3); 
    else if (segmentValue == 1) lcd.write(2); 
    else lcd.write(6); // Kosong garis bawah
  }
}

String getSignalIcon(long rssi) {
  if (rssi > -60) return "EXCL"; 
  if (rssi > -70) return "GOOD";
  if (rssi > -80) return "FAIR";
  return "WEAK";
}

void printAt(int col, int row, String text, int width) {
  lcd.setCursor(col, row);
  lcd.print(text);
  for(int i = text.length(); i < width; i++) {
    lcd.print(" ");
  }
}

void drawDetailedBarPzem(int row, int colStart, int totalWidth, float percentage) {
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

void drawSystemMenu() {
  if (currentState != STATE_MENU_SYSTEM) return;

  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t totalHeap = ESP.getHeapSize();
  int ramPercentage = ((totalHeap - freeHeap) * 100) / totalHeap;
  long rssi = WiFi.RSSI();
  
  int tempC = (temprature_sens_read() - 32) / 1.8; 
  
  unsigned long ms = millis();
  int minutes = (ms / (1000 * 60)) % 60;
  int hours   = (ms / (1000 * 60 * 60)) % 24;
  int days    = (ms / (1000 * 60 * 60 * 24));

  lcd.setCursor(0, 0);
  lcd.print("<0 SYSTEM CORE     ");
  lcd.setCursor(19, 0);
  if (WiFi.status() == WL_CONNECTED) lcd.write(0);
  else lcd.print("!");
  
  for (int i = 0; i < 3; i++) {
    int idx = sysMenuTopIndex + i;
    lcd.setCursor(0, i + 1);
    
    for (int j = 0; j < 19; j++) lcd.print(" ");
    lcd.setCursor(0, i + 1);

    if (idx == 0) {
      char uptimeStr[20];
      sprintf(uptimeStr, "UP  : %02ldd:%02dh:%02dm", days, hours, minutes);
      lcd.print(uptimeStr);
    } 
    else if (idx == 1) {
      lcd.print("IP  : ");
      lcd.print(WiFi.localIP().toString().substring(0, 13));
    }
    else if (idx == 2) {
      lcd.print("WIFI: ");
      lcd.print(rssi);
      lcd.print("dBm (CH");
      lcd.print(WiFi.channel());
      lcd.print(")");
    }
    else if (idx == 3) {
      lcd.print("CPU : ");
      lcd.print(ESP.getCpuFreqMHz());
      lcd.print(" MHz Dual");
    }
    else if (idx == 4) {
      lcd.print("RAM :");
      drawProgressBar(5, i + 1, 7, ramPercentage); 
      lcd.setCursor(13, i + 1);
      lcd.print(ramPercentage);
      lcd.print("%U");
    }
    else if (idx == 5) {
      lcd.print("HEAP: ");
      lcd.print(freeHeap / 1024);
      lcd.print("/");
      lcd.print(totalHeap / 1024);
      lcd.print(" KB");
    }
    else if (idx == 6) {
      lcd.print("TEMP: ");
      lcd.print(tempC);
      lcd.print((char)223); 
      lcd.print("C Core");
    }
  }

  lcd.setCursor(19, 1);
  if (sysMenuTopIndex > 0) lcd.print("^"); else lcd.print(" ");
  lcd.setCursor(19, 3);
  if (sysMenuTopIndex < SYS_ITEM_COUNT - 3) lcd.print("v"); else lcd.print(" ");
}

void drawPzemMenu() {
  if (currentState != STATE_MENU_POWER) return;

  float voltage   = liveVoltage;
  float current   = liveCurrent;
  float power     = livePower;
  float energy    = liveEnergy;
  float frequency = liveFrequency;
  float pf        = livePf;
  bool isValid    = livePzemValid;

  if (!isValid || voltage < 10.0) {
    lcd.setCursor(0, 0); lcd.print("<0 POWER MONITOR   !");
    lcd.setCursor(0, 1); lcd.print("STATUS: STANDBY 0.0V");
    lcd.setCursor(0, 2); lcd.print("ENERGY: ");
    printAt(8, 2, String(energy, 2) + " kWh", 12);
    lcd.setCursor(0, 3); lcd.print("[0]BACK    PZEM:OFFL");
  } else {
    // BARIS 0: Tegangan & Arus
    lcd.setCursor(0, 0); lcd.write(0); // Ikon Volt
    printAt(1, 0, String(voltage, 1) + "V", 8);
    lcd.setCursor(9, 0); lcd.print("|");
    lcd.setCursor(11, 0); lcd.write(1); // Ikon Amp
    printAt(12, 0, String(current, 2) + "A", 8);

    // BARIS 1: Daya & Frekuensi
    lcd.setCursor(0, 1); lcd.write(2); // Ikon Watt
    printAt(1, 1, String((int)power) + "W", 8);
    lcd.setCursor(9, 1); lcd.print("|");
    lcd.setCursor(11, 1); lcd.print("F:"); 
    printAt(13, 1, String(frequency, 1) + "Hz", 7);

    // BARIS 2: Energi & PF
    lcd.setCursor(0, 2); lcd.print("E:");
    printAt(2, 2, String(energy, 2) + "k", 7);
    lcd.setCursor(9, 2); lcd.print("|");
    lcd.setCursor(11, 2); lcd.print("PF:");
    printAt(14, 2, String(pf, 2), 6);

    // BARIS 3: Detailed Progress Bar
    float maxPower = 450.0; // Limit daya rumah/alat
    float percent = (power / maxPower) * 100.0;
    percent = constrain(percent, 0, 100);

    lcd.setCursor(0, 3);
    lcd.print("<0 ");
    drawDetailedBarPzem(3, 3, 11, percent);

    char pctBuf[6];
    snprintf(pctBuf, sizeof(pctBuf), "%3d%%", (int)percent);
    lcd.setCursor(15, 3);
    lcd.print(pctBuf);
  }
}

void updateParentStatusBar() {
  if (currentState != STATE_PARENT_MENU) return;
  // Baris 0: WiFi (col 0), Time (col 2-6), Mascot (col 8), Suhu (col 10-13), Live Watt (col 15-19)
  lcd.setCursor(0, 0);
  if (WiFi.status() == WL_CONNECTED) lcd.write(0);
  else lcd.print("!");

  lcd.setCursor(2, 0);
  lcd.print(getLocalTimeStr());

  lcd.setCursor(8, 0);
  if (animFrame == 1) lcd.write(5);
  else lcd.write(4);

  // Live Suhu Kota Surakarta (Solo) di sebelah Watt Usage
  lcd.setCursor(10, 0);
  if (weatherValid) {
    char tempBuf[4];
    snprintf(tempBuf, sizeof(tempBuf), "%2d", (int)round(weatherTemp));
    lcd.print(tempBuf);
    lcd.print((char)223); // Simbol derajat °
    lcd.print("C");
  } else {
    lcd.print("--");
    lcd.print((char)223);
    lcd.print("C");
  }

  // Live Watt di pojok kanan
  lcd.setCursor(15, 0);
  char wattBuf[6];
  snprintf(wattBuf, sizeof(wattBuf), "%4dW", (int)livePower);
  lcd.print(wattBuf);
}

String getWeatherDescription(int code) {
  switch (code) {
    case 0: return "Cerah";
    case 1: return "Cerah Berawan";
    case 2: return "Berawan Sbgn";
    case 3: return "Mendung";
    case 45: 
    case 48: return "Berkabut";
    case 51:
    case 53:
    case 55: return "Gerimis";
    case 61: return "Hujan Ringan";
    case 63: return "Hujan Sedang";
    case 65: return "Hujan Lebat";
    case 80:
    case 81:
    case 82: return "Hujan Lokal";
    case 95:
    case 96:
    case 99: return "Badai Petir";
    default: return "Cerah";
  }
}

void fetchWeatherAPI() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(weatherApiUrl);
  http.setTimeout(3000);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error && doc.containsKey("current")) {
      weatherTemp     = doc["current"]["temperature_2m"].as<float>();
      weatherHumidity = doc["current"]["relative_humidity_2m"].as<int>();
      weatherCode     = doc["current"]["weather_code"].as<int>();
      weatherWind     = doc["current"]["wind_speed_10m"].as<float>();
      weatherValid    = true;
      weatherDesc     = getWeatherDescription(weatherCode);
      Serial.printf("[WEATHER] Solo: %.1f C, RH: %d%%, Code: %d (%s), Wind: %.1f km/h\n",
                    weatherTemp, weatherHumidity, weatherCode, weatherDesc.c_str(), weatherWind);
    }
  } else {
    Serial.printf("[WEATHER] HTTP Error: %d\n", httpCode);
  }
  http.end();
}

void drawWeatherMenu() {
  if (currentState != STATE_MENU_WEATHER) return;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("<0 SURAKARTA (SOLO)");
  lcd.setCursor(19, 0);
  if (WiFi.status() == WL_CONNECTED) lcd.write(0);
  else lcd.print("!");

  if (!weatherValid) {
    lcd.setCursor(0, 1);
    lcd.print("KOTA : SURAKARTA, ID");
    lcd.setCursor(0, 2);
    lcd.print("STATUS: MEMUAT DATA ");
    lcd.setCursor(0, 3);
    lcd.print("[0]BACK     [5]FETCH");
  } else {
    // Baris 1: Suhu & Kelembapan
    lcd.setCursor(0, 1);
    lcd.print("SUHU : ");
    lcd.print(weatherTemp, 1);
    lcd.print((char)223);
    lcd.print("C | ");
    lcd.print(weatherHumidity);
    lcd.print("%RH");

    // Baris 2: Kecepatan Angin
    lcd.setCursor(0, 2);
    lcd.print("ANGIN: ");
    lcd.print(weatherWind, 1);
    lcd.print(" km/h");

    // Baris 3: Status Cuaca
    lcd.setCursor(0, 3);
    String desc = weatherDesc;
    if (desc.length() > 12) desc = desc.substring(0, 12);
    lcd.print("CUACA: ");
    lcd.print(desc);
  }
}

void drawParentMenu() {
  setParentIcons();
  lcd.clear();
  
  updateParentStatusBar();
  
  // Carousel Card Box
  lcd.setCursor(2, 1);
  lcd.print(".----------------.");
  
  lcd.setCursor(0, 2);
  if (parentMenuCursor > 0) lcd.write(2);
  else lcd.print(" ");
  
  lcd.setCursor(2, 2);
  lcd.print("| ");
  
  String itemName = "";
  if (parentMenuCursor == 0) itemName = " 1. DEVICES ";
  else if (parentMenuCursor == 1) itemName = " 2. SYSTEM  ";
  else if (parentMenuCursor == 2) itemName = " 3. WEATHER ";
  else if (parentMenuCursor == 3) itemName = " 4. SETTINGS";
  else itemName = " 5. POWER   ";
  
  lcd.print(itemName);
  lcd.print(" |");
  
  lcd.setCursor(19, 2);
  if (parentMenuCursor < PARENT_ITEM_COUNT - 1) lcd.write(3);
  else lcd.print(" ");
  
  // Keypad Helper
  lcd.setCursor(1, 3);
  lcd.print("[4]<   [5]OK   [6]>");
}

void drawSettingsMenu() {
  setMenuIcons();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("<0 SETTINGS        ");
  lcd.setCursor(19, 0);
  if (WiFi.status() == WL_CONNECTED) lcd.write(0);
  else lcd.print("!");
  
  lcd.setCursor(0, 1);
  if (settingsCursor == 0) lcd.write(6); else lcd.print(" ");
  lcd.print(" SCR SAVER : ");
  lcd.print(ssEnabled ? "[ON ]" : "[OFF]");
  
  lcd.setCursor(0, 2);
  if (settingsCursor == 1) lcd.write(6); else lcd.print(" ");
  lcd.print(" SS STYLE  : ");
  lcd.print(ssType == 0 ? "[TIME]" : "[EYE ]");

  lcd.setCursor(0, 3);
  lcd.print("[0]BACK     [5]TOGGLE");
}

const char* scrEyeFaces[] = {"  (O)   (O)  ", "  (-)   (-)  ", "  (>)   (<)  ", "  (^)   (^)  ", "  (o)   (o)  ", "  (@)   (@)  ", "  (~)   (~)  ", "  (X)   (X)  "};

void drawScreenSaver() {
  lcd.clear();
  if (ssType == 0) { // TIME
     targetBrightness = 15; // Redup minimal
     setLcdBrightness(targetBrightness);
     
     // Status bar
     lcd.setCursor(0, 0);
     if (weatherValid) {
       lcd.print("SOLO ");
       lcd.print(weatherTemp, 1);
       lcd.print((char)223);
       lcd.print("C");
     } else {
       lcd.print("SHERATON");
     }
     lcd.setCursor(14, 0);
     char wattBuf[7];
     snprintf(wattBuf, sizeof(wattBuf), "%4dW", (int)livePower);
     lcd.print(wattBuf);

     // Jam besar centered
     lcd.setCursor((20 - 5) / 2, 1);
     struct tm timeinfo;
     if(!getLocalTime(&timeinfo)){
        lcd.print("--:--");
     } else {
        char timeStringBuff[15];
        if ((millis() / 500) % 2 == 0) strftime(timeStringBuff, sizeof(timeStringBuff), "%H:%M", &timeinfo);
        else strftime(timeStringBuff, sizeof(timeStringBuff), "%H %M", &timeinfo);
        lcd.print(timeStringBuff);
     }

     lcd.setCursor(2, 2);
     lcd.print("[ GARDEN_OS v4 ]");

     lcd.setCursor(2, 3);
     lcd.print("Press Any Key...");
  } else {           // EYE
     targetBrightness = 255; // Normal full brightness
     setLcdBrightness(targetBrightness);
     int faceIdx = random(0, 8);
     int offsetX = random(1, 5);
     int offsetY = random(0, 3);
     lcd.setCursor(offsetX, offsetY);
     lcd.print(scrEyeFaces[faceIdx]);
     lcd.setCursor(1, 3);
     lcd.print("< Press Any Key >");
  }
}

void drawMenu() {
  setMenuIcons();
  lcd.clear();

  // Header
  lcd.setCursor(0, 0);
  lcd.print("<0 DEVICES (");
  lcd.print(totalLampu);
  lcd.print(")");
  lcd.setCursor(19, 0);
  if (WiFi.status() == WL_CONNECTED) lcd.write(0);
  else lcd.print("!");

  // List Items
  for (int i = 0; i < 3; i++) {
    int itemIdx = menuTopIndex + i; 
    lcd.setCursor(0, i + 1);

    if (itemIdx < totalLampu) {
      if (itemIdx == menuCursor) lcd.write(6); // Selector arrow
      else lcd.print(" ");

      lcd.print(itemIdx + 1);
      lcd.print(".");

      String nama = daftarLampu[itemIdx].deskripsi;
      if (nama.length() > 9) nama = nama.substring(0, 9);
      lcd.print(nama);

      // Padding nama
      for (int s = nama.length(); s < 9; s++) lcd.print(" ");

      // State Badge
      if (daftarLampu[itemIdx].state) {
        lcd.print("[ON ]");
      } else {
        lcd.print("[OFF]");
      }
    } else {
      lcd.print("                   ");
    }
  }

  // Scroll Indicators
  lcd.setCursor(19, 1);
  if (menuTopIndex > 0) lcd.write(2);
  else lcd.print(" ");
  
  lcd.setCursor(19, 3);
  if (menuTopIndex + 3 < totalLampu) lcd.write(3);
  else lcd.print(" ");
}

void drawControlInit() {
  setControlIcons();
  lcd.clear();

  // Header Bar
  lcd.setCursor(0, 0);
  lcd.print("<0 CONTROL");
  lcd.setCursor(13, 0);
  if (daftarLampu[controlIndex].state) lcd.write(3); // Ikon lampu nyala
  else lcd.write(2);                                // Ikon lampu mati
  lcd.setCursor(16, 0);
  lcd.write(4); // Mascot
  lcd.setCursor(19, 0);
  if (WiFi.status() == WL_CONNECTED) lcd.write(0);
  else lcd.print("!");

  // Line 1: Scroller (Device Name)
  scrollPos = 0;
  drawControlScroller();

  // Line 2: Status & Mode Badges
  lcd.setCursor(0, 2);
  if (daftarLampu[controlIndex].state) lcd.print("PWR:[ ON ]");
  else lcd.print("PWR:[OFF ]");

  lcd.print(" | ");
  String md = daftarLampu[controlIndex].mode;
  if (md == "MANUAL") {
    lcd.print("MD:MAN");
  } else if (md == "AUTO_SUN") {
    lcd.print("MD:SUN");
  } else if (md == "AUTO_DATETIME") {
    if (daftarLampu[controlIndex].turnOnTime.length() >= 5) {
      lcd.print(daftarLampu[controlIndex].turnOnTime.substring(0, 2));
      lcd.print("-");
      lcd.print(daftarLampu[controlIndex].turnOffTime.substring(0, 2));
    } else {
      lcd.print("MD:TIM");
    }
  }

  // Line 3: Actions Helper
  lcd.setCursor(0, 3);
  lcd.print("[*OFF][#ON] [5]MD [1]");
}

void drawControlScroller() {
  if (currentState != STATE_CONTROL) return;

  lcd.setCursor(0, 1);
  String nama = daftarLampu[controlIndex].deskripsi;

  if (nama.length() <= 20) {
    int spaces = (20 - nama.length()) / 2;
    for (int i = 0; i < spaces; i++) lcd.print(" ");
    lcd.print(nama);
    for (int i = 0; i < (20 - spaces - nama.length()); i++) lcd.print(" ");
  } else {
    String paddedName = nama + "    ";
    int len = paddedName.length();
    String view = "";
    for (int i = 0; i < 20; i++) {
      view += paddedName[(scrollPos + i) % len];
    }
    lcd.print(view);
  }
}

void drawTimeInputScreen(String title) {
  lcd.clear();
  lcd.setCursor((20 - title.length()) / 2, 0);
  lcd.print(title);

  lcd.setCursor(6, 2);
  lcd.print("[ ");
  for (int i = 0; i < 4; i++) {
    if (i == 2) lcd.print(":");
    if (i < timeInputBuffer.length()) lcd.print(timeInputBuffer[i]);
    else lcd.print("-");
  }
  lcd.print(" ]");

  lcd.setCursor(0, 3);
  lcd.print("[*]DEL/BACK  [#]SAVE");
}

// ================= HARDWARE & API LOGIC =================

void controlLampuAPI(int idx, String mode, bool state, String turnOnT, String turnOffT) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(updateUrl + daftarLampu[idx].id);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(1500);

  StaticJsonDocument<256> body;
  body["state"] = state;
  body["mode"] = mode;

  if (mode == "AUTO_DATETIME") {
    body["turnOnTime"] = turnOnT;
    body["turnOffTime"] = turnOffT;
  } else {
    body["turnOnTime"] = nullptr;
    body["turnOffTime"] = nullptr;
  }

  String jsonRequest;
  serializeJson(body, jsonRequest);

  int httpCode = http.PUT(jsonRequest);
  if (httpCode == 200) {
    if (currentState == STATE_CONTROL && idx == controlIndex) {
      setupIcons(); // Load maskot sebentar
      lcd.setCursor(12, 0);
      lcd.write(5);  
      delay(300);
      lcd.setCursor(12, 0);
      lcd.write(4);  
      setControlIcons(); // Revert back
    }

    String response = http.getString();
    DynamicJsonDocument resDoc(512);
    deserializeJson(resDoc, response);
    if (resDoc["output"]) {
      daftarLampu[idx].state = resDoc["output"]["state"].as<bool>();
      daftarLampu[idx].mode = resDoc["output"]["mode"].as<String>();
      if (!resDoc["output"]["turnOnTime"].isNull()) daftarLampu[idx].turnOnTime = resDoc["output"]["turnOnTime"].as<String>();
      if (!resDoc["output"]["turnOffTime"].isNull()) daftarLampu[idx].turnOffTime = resDoc["output"]["turnOffTime"].as<String>();
    }
  }
  http.end();

  if (currentState == STATE_CONTROL && idx == controlIndex) {
    drawControlInit();
  }
}

void checkLDR() {
  bool isDark = digitalRead(LDR_PIN);

  if (isDark) targetBrightness = 40;
  else targetBrightness = 255;

  static bool lastLdrState = false;
  if (isDark != lastLdrState) {
    for (int i = 0; i < totalLampu; i++) {
      if (daftarLampu[i].mode == "AUTO_SUN") {
        controlLampuAPI(i, "AUTO_SUN", isDark, "", "");
      }
    }
    lastLdrState = isDark;
  }
}

void updateSmoothBrightness() {
    if (millis() - lastFadeTime > fadeInterval) {
      if (currentBrightness < targetBrightness) {
        currentBrightness++;
        setLcdBrightness(currentBrightness);
      } else if (currentBrightness > targetBrightness) {
        currentBrightness--;
        setLcdBrightness(currentBrightness);
      }
      lastFadeTime = millis();
    }
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

bool sendSinglePzemRecord(float v, float a, float p, float e, float f, float pf) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(pzemServerUrl);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2000); // 2 detik timeout

  StaticJsonDocument<256> doc;
  doc["deviceId"] = pzemDeviceId;
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

void processOfflinePzemQueue() {
  if (offlineBufferCount == 0 || WiFi.status() != WL_CONNECTED) return;

  Serial.printf("[OFFLINE QUEUE] Mengirim %d data offline yang tersimpan ke server...\n", offlineBufferCount);

  int sentCount = 0;
  while (offlineBufferCount > 0 && WiFi.status() == WL_CONNECTED) {
    PzemDataRecord rec = offlineBuffer[offlineBufferHead];
    bool ok = sendSinglePzemRecord(rec.v, rec.a, rec.p, rec.e, rec.f, rec.pf);

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

void sendPzemDataToServer(float v, float a, float p, float e, float f, float pf) {
  // 1. Jika terhubung & ada antrean data offline, flush data offline terlebih dahulu
  if (WiFi.status() == WL_CONNECTED && offlineBufferCount > 0) {
    processOfflinePzemQueue();
  }

  // 2. Kirim data terkini
  bool success = sendSinglePzemRecord(v, a, p, e, f, pf);

  // 3. Jika gagal kirim (koneksi terputus/server down), simpan di antrean offline
  if (!success) {
    enqueueOfflineData(v, a, p, e, f, pf);
  }
}

// Background FreeRTOS Task pinned to Core 0 for PZEM reading & HTTP sending & Weather
void pzemBackgroundTask(void *pvParameters) {
  static unsigned long lastWeatherFetchTime = 0;
  
  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      // 1. Baca & Kirim PZEM
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

      if (isnan(voltage)) {
        liveVoltage   = 0.0;
        liveCurrent   = 0.0;
        livePower     = 0.0;
        liveFrequency = 0.0;
        livePf        = 0.0;
        liveEnergy    = lastValidEnergy;
        livePzemValid = false;
      } else {
        liveVoltage   = voltage;
        liveCurrent   = isnan(current) ? 0.0 : current;
        livePower     = isnan(power) ? 0.0 : power;
        liveEnergy    = isnan(energy) ? lastValidEnergy : energy;
        liveFrequency = isnan(frequency) ? 0.0 : frequency;
        livePf        = isnan(pf) ? 0.0 : pf;
        livePzemValid = true;
      }

      Serial.printf("[DEBUG PZEM] V: %.1f V | A: %.3f A | W: %.1f W | E: %.3f kWh | F: %.1f Hz | PF: %.2f\n",
                    liveVoltage, liveCurrent, livePower, liveEnergy, liveFrequency, livePf);
      sendPzemDataToServer(liveVoltage, liveCurrent, livePower, liveEnergy, liveFrequency, livePf);

      // 2. Fetch Cuaca Open-Meteo di background (pertama kali saat boot & auto-refresh setiap 10 menit)
      if (millis() - lastWeatherFetchTime > (weatherValid ? 600000 : 30000) || lastWeatherFetchTime == 0) {
        fetchWeatherAPI();
        lastWeatherFetchTime = millis();
      }
    }
    vTaskDelay(2000 / portTICK_PERIOD_MS);
  }
}


// ================= MAIN LOOP =================

void loop() {
  unsigned long currentMillis = millis();

  // 1. KEYPAD INSTANT SCAN FIRST (Prioritas Utama di Core 1)
  char key = keypad.getKey();
  if (key) {
    lastKeyPressTime = currentMillis; // RESET TIMER
    
    if (isScreenSaverActive) {
      isScreenSaverActive = false;
      targetBrightness = 255;
      setLcdBrightness(targetBrightness);
      playTransition();
      currentState = STATE_PARENT_MENU;
      drawParentMenu();
      return; 
    }
    
    // --- LAYAR PARENT MENU ---
    if (currentState == STATE_PARENT_MENU) {
      if (key == '4') { 
        if (parentMenuCursor > 0) {
          parentMenuCursor--;
          drawParentMenu();
        }
      } else if (key == '6') { 
         if (parentMenuCursor < PARENT_ITEM_COUNT - 1) {
          parentMenuCursor++;
          drawParentMenu();
        }
      } else if (key == '5') {
         if (parentMenuCursor == 0) {
           playTransition();
           currentState = STATE_MENU_LIST_LAMPU;
           drawMenu();
         } else if (parentMenuCursor == 1) {
           playTransition();
           setSystemIcons(); // Swap ram icon
           sysMenuTopIndex = 0; // RESET offset scroll
           currentState = STATE_MENU_SYSTEM;
           lcd.clear();
           drawSystemMenu();
         } else if (parentMenuCursor == 2) {
           playTransition();
           currentState = STATE_MENU_WEATHER;
           lcd.clear();
           drawWeatherMenu();
         } else if (parentMenuCursor == 3) {
           playTransition();
           settingsCursor = 0;
           currentState = STATE_MENU_SETTINGS;
           drawSettingsMenu();
         } else if (parentMenuCursor == 4) {
           playTransition();
           setPzemIcons();
           currentState = STATE_MENU_POWER;
           lcd.clear();
           drawPzemMenu();
         }
      }
    }
    
    // --- LAYAR MENU WEATHER ---
    else if (currentState == STATE_MENU_WEATHER) {
      if (key == '0') {
        playTransition();
        currentState = STATE_PARENT_MENU;
        drawParentMenu();
      } else if (key == '5') {
        lcd.setCursor(0, 3);
        lcd.print("SYNCING WEATHER...  ");
        fetchWeatherAPI();
        drawWeatherMenu();
      }
    }
    
    // --- LAYAR MENU SETTINGS ---
    else if (currentState == STATE_MENU_SETTINGS) {
      if (key == '2') {
        if (settingsCursor > 0) { settingsCursor--; drawSettingsMenu(); }
      } else if (key == '8') {
        if (settingsCursor < 1) { settingsCursor++; drawSettingsMenu(); }
      } else if (key == '5') {
        if (settingsCursor == 0) {
          ssEnabled = !ssEnabled;
          preferences.putBool("ss_en", ssEnabled);
        } else if (settingsCursor == 1) {
          ssType = (ssType == 0) ? 1 : 0;
          preferences.putInt("ss_type", ssType);
        }
        drawSettingsMenu();
      } else if (key == '0') {
        playTransition();
        currentState = STATE_PARENT_MENU;
        drawParentMenu();
      }
    }

    // --- LAYAR MENU SYSTEM ---
    else if (currentState == STATE_MENU_SYSTEM) {
      if (key == '2') {
        if (sysMenuTopIndex > 0) {
          sysMenuTopIndex--;
          drawSystemMenu();
        }
      } else if (key == '8') {
        if (sysMenuTopIndex < SYS_ITEM_COUNT - 3) {
          sysMenuTopIndex++;
          drawSystemMenu();
        }
      } else if (key == '0') {
        playTransition();
        currentState = STATE_PARENT_MENU;
        drawParentMenu();
      }
    }

    // --- LAYAR MENU POWER ---
    else if (currentState == STATE_MENU_POWER) {
      if (key == '0') {
        playTransition();
        currentState = STATE_PARENT_MENU;
        drawParentMenu();
      }
    }
    
    // --- LAYAR MENU LAMPU---
    else if (currentState == STATE_MENU_LIST_LAMPU) {
      if (key == '2') {
        if (menuCursor > 0) {
          menuCursor--;
          if (menuCursor < menuTopIndex) menuTopIndex--;
          drawMenu();
        }
      } else if (key == '8') {
        if (menuCursor < totalLampu - 1) {
          menuCursor++;
          if (menuCursor >= menuTopIndex + 3) menuTopIndex++;
          drawMenu();
        }
      } else if (key == '5') {
        controlIndex = menuCursor;
        playTransition();
        currentState = STATE_CONTROL;
        drawControlInit();
      } else if (key == '0') {
        playTransition();
        currentState = STATE_PARENT_MENU;
        drawParentMenu();
      }
    }

    // --- LAYAR CONTROL ---
    else if (currentState == STATE_CONTROL) {
      if (key == '0') {
        playTransition();
        currentState = STATE_MENU_LIST_LAMPU;
        drawMenu();
      }
      else if (key == '5') {
        String currentMode = daftarLampu[controlIndex].mode;
        if (currentMode == "MANUAL") currentMode = "AUTO_SUN";
        else if (currentMode == "AUTO_SUN") currentMode = "AUTO_DATETIME";
        else currentMode = "MANUAL";

        controlLampuAPI(controlIndex, currentMode, daftarLampu[controlIndex].state,
                        daftarLampu[controlIndex].turnOnTime,
                        daftarLampu[controlIndex].turnOffTime);
      }
      else if (key == '#') {
        controlLampuAPI(controlIndex, "MANUAL", true, "", "");
      }
      else if (key == '*') {
        controlLampuAPI(controlIndex, "MANUAL", false, "", "");
      }
      else if (key == '1') {
        timeInputBuffer = "";
        currentState = STATE_INPUT_TIME_ON;
        drawTimeInputScreen("SET ON TIME");
      }
    }

    // --- LAYAR INPUT WAKTU ---
    else if (currentState == STATE_INPUT_TIME_ON || currentState == STATE_INPUT_TIME_OFF) {
      if (key == '*') {
        if (timeInputBuffer.length() > 0) {
          timeInputBuffer.remove(timeInputBuffer.length() - 1);
          drawTimeInputScreen(currentState == STATE_INPUT_TIME_ON ? "SET ON TIME" : "SET OFF TIME");
        } else {
          if (currentState == STATE_INPUT_TIME_OFF) {
            currentState = STATE_INPUT_TIME_ON;
            timeInputBuffer = tempTurnOnTime.substring(0, 2) + tempTurnOnTime.substring(3, 5);
            drawTimeInputScreen("SET ON TIME");
          } else {
            playTransition();
            currentState = STATE_CONTROL;
            drawControlInit();
          }
        }
      }
      else if (key >= '0' && key <= '9') {
        timeInputBuffer += key;
        drawTimeInputScreen(currentState == STATE_INPUT_TIME_ON ? "SET ON TIME" : "SET OFF TIME");

        if (timeInputBuffer.length() == 4) {
          if (currentState == STATE_INPUT_TIME_ON) {
            tempTurnOnTime = timeInputBuffer.substring(0, 2) + ":" + timeInputBuffer.substring(2, 4);
            timeInputBuffer = "";
            currentState = STATE_INPUT_TIME_OFF;
            delay(150);  
            drawTimeInputScreen("SET OFF TIME");
          } else {
            String tempTurnOffTime = timeInputBuffer.substring(0, 2) + ":" + timeInputBuffer.substring(2, 4);
            delay(150);  

            controlLampuAPI(controlIndex, "AUTO_DATETIME", daftarLampu[controlIndex].state, tempTurnOnTime, tempTurnOffTime);

            timeInputBuffer = "";
            playTransition();
            currentState = STATE_CONTROL;
            drawControlInit();
          }
        }
      }
    } 
  }

  // SCREEN SAVER TIMEOUT TRIGGER
  if (!isScreenSaverActive && ssEnabled && currentState != STATE_BOOT && currentState != STATE_SCREEN_SAVER) {
    if (currentMillis - lastKeyPressTime > SCREEN_SAVER_TIMEOUT) {
      isScreenSaverActive = true;
      currentState = STATE_SCREEN_SAVER;
      drawScreenSaver();
    }
  }

  updateSmoothBrightness();
  
  // Realtime Clock & Mascot Updater di Parent Menu
  if (currentState == STATE_PARENT_MENU) {
    if(currentMillis - lastClockUpdate > 500) { 
       updateParentStatusBar();
       lastClockUpdate = currentMillis;
    }

    if (currentMillis - lastAnimTime > 800) {
      animFrame = (animFrame + 1) % 4;
      lcd.setCursor(8, 0);
      if (animFrame == 1) lcd.write(5); 
      else lcd.write(4);
      lastAnimTime = currentMillis;
    }
  }
  
  // Realtime System Resource Updater di System Menu
  if (currentState == STATE_MENU_SYSTEM) {
    if(currentMillis - lastSystemUpdate > 1000) { 
       drawSystemMenu(); 
       lastSystemUpdate = currentMillis;
    }
  }

  // Realtime PZEM Display Updater di Power Menu (Membaca live cached data tanpa blocking Modbus)
  if (currentState == STATE_MENU_POWER) {
    if(currentMillis - lastPzemUpdate > 500) {
       drawPzemMenu();
       lastPzemUpdate = currentMillis;
    }
  }

  if (currentState == STATE_SCREEN_SAVER) {
    if (currentMillis - lastAnimTime > (ssType == 0 ? 1000 : 2500)) { 
       drawScreenSaver();
       lastAnimTime = currentMillis;
    }
  }

  if (currentState == STATE_CONTROL) {
    if (currentMillis - lastAnimTime > 800) {
      animFrame = (animFrame + 1) % 4;
      setupIcons();
      lcd.setCursor(12, 0);
      if (animFrame == 1) lcd.write(5);
      else lcd.write(4);
      setControlIcons();
      lastAnimTime = currentMillis;
    }

    if (currentMillis - lastScrollTime > 300) {
      if (totalLampu > 0 && daftarLampu[controlIndex].deskripsi.length() > 18) {
        String nama = daftarLampu[controlIndex].deskripsi + "    ";
        scrollPos = (scrollPos + 1) % nama.length();
        drawControlScroller();
      }
      lastScrollTime = currentMillis;
    }
  }

  if (currentMillis - lastLDRCheck > 2000) {
    checkLDR();
    lastLDRCheck = currentMillis;
  }
}
