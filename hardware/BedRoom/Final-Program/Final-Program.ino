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
const char* ssid = "TierKun_IoT";
const char* password = "Tier010707";

// --- KONFIGURASI API KEYPAD ---
const String listUrl = "http://192.168.100.149:2055/api/device/outputs";
const String updateUrl = "http://192.168.100.149:2055/api/device/output/";

// --- KONFIGURASI API PZEM ---
const char* pzemServerUrl = "http://192.168.100.149:2055/api/device/pzem/data";
const char* pzemDeviceId = "fa7daf1f-b10f-4480-80f3-80e306484365";

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
int currentBrightness = 200;  
int targetBrightness = 200;
unsigned long lastFadeTime = 0;
const int fadeInterval = 5;  

// --- KEYPAD 3x4 ---
/*
D13 - Merah
D15 - Ungu
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
byte rowPins[ROWS] = { 13, 15, 14, 27 };
byte colPins[COLS] = { 26, 25, 33 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

LiquidCrystal_I2C lcd(0x3F, 20, 4);

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
#define PARENT_ITEM_COUNT 4

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

// PZEM Timing variables
unsigned long lastPzemSendTime = 0;
const unsigned long pzemSendInterval = 2000;
unsigned long lastPzemUpdate = 0;

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
  lcd.createChar(2, arrowUp);
  lcd.createChar(3, arrowDown);
}

void setControlIcons() {
  lcd.createChar(2, lampOff);
  lcd.createChar(3, lampOn);
}

void setParentIcons() {
  lcd.createChar(2, iconPanahKiri);
  lcd.createChar(3, iconPanahKanan);
}

void setSystemIcons() {
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
  lcd.createChar(0, wifiIcon);
  lcd.createChar(1, battIcon);
  lcd.createChar(4, flipperF1);
  lcd.createChar(5, flipperF2);
  lcd.createChar(6, selector);
  lcd.createChar(7, solidBlock);
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
    delay(10);
  }
  for (int col = 0; col < 20; col++) {
    for (int row = 0; row < 4; row++) {
      lcd.setCursor(col, row);
      lcd.print(" ");
    }
    delay(10);
  }
}

void setup() {
  Serial.begin(115200);

  ledcAttach(LCD_BRIGHT, freq, resolution);
  setLcdBrightness(200);

  pinMode(LDR_PIN, INPUT);
  pinMode(RELAY_1, OUTPUT);
  pinMode(RELAY_2, OUTPUT);

  lcd.init();
  lcd.backlight();
  setupIcons();

  lcd.setCursor(4, 1);
  lcd.print("GARDEN_OS v4");
  lcd.setCursor(2, 2);
  for (int i = 0; i < 16; i++) {
    lcd.write(7);
    delay(30);
  }
  delay(300);

  playTransition();

  lcd.setCursor(0, 0);
  lcd.print("WiFi Handshake...");
  lcd.setCursor(0, 1);
  lcd.print(ssid);

  WiFi.begin(ssid, password);
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    lcd.setCursor(0, 2);
    for (int i = 0; i < dots; i++) lcd.print(".");
    lcd.print("   ");  
    dots = (dots + 1) % 10;
  }
  
  // Init NTP
  lcd.setCursor(0, 3);
  lcd.print("Syncing Time NTP");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  preferences.begin("gardenos", false);
  ssEnabled = preferences.getBool("ss_en", true);
  ssType = preferences.getInt("ss_type", 0);

  playTransition();
  fetchLampu();
  
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
  lcd.print("<0  SYSTEM CORE    ");
  
  for (int i = 0; i < 3; i++) {
    int idx = sysMenuTopIndex + i;
    lcd.setCursor(0, i + 1);
    
    for (int j = 0; j < 19; j++) lcd.print(" ");
    lcd.setCursor(0, i + 1);

    if (idx == 0) {
      char uptimeStr[20];
      sprintf(uptimeStr, "UP: %02ldd:%02dh:%02dm", days, hours, minutes);
      lcd.print(uptimeStr);
    } 
    else if (idx == 1) {
      lcd.print("IP: ");
      lcd.print(WiFi.localIP().toString().substring(0, 14));
    }
    else if (idx == 2) {
      lcd.print("WIFI: ");
      lcd.write(0);
      lcd.print(" ");
      lcd.print(rssi);
      lcd.print(" CH:");
      lcd.print(WiFi.channel());
    }
    else if (idx == 3) {
      lcd.print("CPU : ");
      lcd.print(ESP.getCpuFreqMHz());
      lcd.print(" MHz");
    }
    else if (idx == 4) {
      lcd.print("RAM :");
      drawProgressBar(5, i + 1, 7, ramPercentage); 
      lcd.setCursor(12, i + 1);
      lcd.print(" ");
      lcd.print(100 - ramPercentage);
      lcd.print("%F");
    }
    else if (idx == 5) {
      lcd.print("MEM : ");
      lcd.print(freeHeap / 1024);
      lcd.print("/");
      lcd.print(totalHeap / 1024);
      lcd.print("KB");
    }
    else if (idx == 6) {
      lcd.print("TMP : ");
      lcd.print(tempC);
      lcd.print((char)223); 
      lcd.print("C");
    }
  }

  lcd.setCursor(19, 1);
  if (sysMenuTopIndex > 0) lcd.print("^"); else lcd.print(" ");
  lcd.setCursor(19, 3);
  if (sysMenuTopIndex < SYS_ITEM_COUNT - 3) lcd.print("v"); else lcd.print(" ");
}

void drawPzemMenu() {
  if (currentState != STATE_MENU_POWER) return;

  float voltage   = pzem.voltage();
  float current   = pzem.current();
  float power     = pzem.power();
  float energy    = pzem.energy();
  float frequency = pzem.frequency();
  float pf        = pzem.pf();

  static float lastValidEnergy = 0.0;
  if (!isnan(energy) && energy >= 0) lastValidEnergy = energy;

  if (isnan(voltage)) {
    lcd.setCursor(0, 0); lcd.print("- SENSOR OFF / 0V  -");
    lcd.setCursor(0, 1); lcd.print("V: 0.0V  | P: 0W    ");
    lcd.setCursor(0, 2); lcd.print("E:"); printAt(2, 2, String(lastValidEnergy, 2) + "kWh", 8);
    lcd.setCursor(10, 2); lcd.print("| OFF");
    lcd.setCursor(0, 3); lcd.print("<0 BACK             ");
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
    lcd.print("<0 ");
    drawDetailedBarPzem(3, 3, 11, percent); // Menggunakan 11 kolom untuk bar

    char pctBuf[6];
    snprintf(pctBuf, sizeof(pctBuf), "%3d%%", (int)percent);
    lcd.setCursor(15, 3);
    lcd.print(pctBuf);
  }
}

void drawParentMenu() {
  setupIcons(); // Kembali load Flipper dan Main Parent Icons
  lcd.clear();
  
  // Header
  lcd.setCursor(0, 0);
  lcd.write(0); // WiFi
  lcd.print(" GARDEN OS     ");
  lcd.write(4); // Mascot
  lcd.print(" ");
  lcd.setCursor(19, 0);
  lcd.write(1); // Battery
  
  // Clock Area Center
  lcd.setCursor(7, 1);
  lcd.print(getLocalTimeStr());
  
  // Main Items Selector
  lcd.setCursor(0, 2);
  
  // Kiri
  if (parentMenuCursor > 0) lcd.write(2);
  else lcd.print(" ");
  
  // Item Name Cenered
  String itemName = "";
  if (parentMenuCursor == 0) itemName = "DEVICES";
  else if (parentMenuCursor == 1) itemName = "SYSTEM";
  else if (parentMenuCursor == 2) itemName = "SETTINGS";
  else itemName = "POWER";
  
  int padding = (18 - itemName.length()) / 2;
  for(int i=0; i<padding; i++) lcd.print(" ");
  lcd.print(itemName);
  for(int i=0; i<(18 - padding - itemName.length()); i++) lcd.print(" ");
  
  // Kanan
  if (parentMenuCursor < PARENT_ITEM_COUNT - 1) lcd.write(3);
  else lcd.print(" ");
  
  lcd.setCursor(2, 3);
  lcd.print("4");
  lcd.write(2); 
  
  lcd.setCursor(7, 3);
  lcd.print("5 SEL");
  
  lcd.setCursor(15, 3);
  lcd.print("6");
  lcd.write(3); 
}

void drawSettingsMenu() {
  setMenuIcons();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("<0  SETTINGS       ");
  lcd.setCursor(19, 0);
  lcd.write(1); // Ikon battery dummy/sisa
  
  lcd.setCursor(0, 1);
  if (settingsCursor == 0) lcd.write(6); else lcd.print(" ");
  lcd.print(" SCR SAVER: ");
  lcd.print(ssEnabled ? "ON " : "OFF");
  
  lcd.setCursor(0, 2);
  if (settingsCursor == 1) lcd.write(6); else lcd.print(" ");
  lcd.print(" SS TYPE  : ");
  lcd.print(ssType == 0 ? "TIME" : "EYE ");
}

const char* scrEyeFaces[] = {"  (O)   (O)  ", "  (-)   (-)  ", "  (>)   (<)  ", "  (^)   (^)  ", "  (o)   (o)  ", "  (@)   (@)  ", "  (~)   (~)  ", "  (X)   (X)  "};

void drawScreenSaver() {
  lcd.clear();
  if (ssType == 0) { // TIME
     targetBrightness = 10; // Redup minimal
     setLcdBrightness(targetBrightness);
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
  } else {           // EYE
     targetBrightness = 200; // Normal brightness
     setLcdBrightness(targetBrightness);
     int faceIdx = random(0, 8);
     int offsetX = random(0, 6);
     int offsetY = random(0, 4);
     lcd.setCursor(offsetX, offsetY);
     lcd.print(scrEyeFaces[faceIdx]);
  }
}

void drawMenu() {
  setMenuIcons();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("<0  DEVICES (");
  lcd.print(totalLampu);
  lcd.print(")  ");
  lcd.setCursor(19, 0);
  lcd.write(1);

  for (int i = 0; i < 3; i++) {
    int itemIdx = menuTopIndex + i; 
    lcd.setCursor(0, i + 1);

    if (itemIdx < totalLampu) {
      if (itemIdx == menuCursor) lcd.write(6); 
      else lcd.print(" ");

      lcd.print(" ");
      String nama = daftarLampu[itemIdx].deskripsi;
      if (nama.length() > 16) nama = nama.substring(0, 16);
      lcd.print(nama);
    }
  }

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

  lcd.setCursor(0, 0);
  lcd.print("<0    ST:");
  if (daftarLampu[controlIndex].state) lcd.write(3);  
  else lcd.write(2);                                  

  lcd.setCursor(12, 0);
  setupIcons(); // Ensure maskot is loaded temporarily
  lcd.write(4);  
  setControlIcons(); // Revert back custom icons
  lcd.setCursor(19, 0);
  lcd.write(1);  

  lcd.setCursor(0, 2);
  String md = daftarLampu[controlIndex].mode;
  if (md == "MANUAL") {
    lcd.print("MD: MANUAL        ");
  } else if (md == "AUTO_SUN") {
    lcd.print("MD: AUTO (LDR)    ");
  } else if (md == "AUTO_DATETIME") {
    lcd.print("TM:");
    if (daftarLampu[controlIndex].turnOnTime.length() >= 5) {
      lcd.print(daftarLampu[controlIndex].turnOnTime.substring(0, 5));
      lcd.print("-");
      lcd.print(daftarLampu[controlIndex].turnOffTime.substring(0, 5));
    } else {
      lcd.print("NOT SET    ");
    }
  }

  lcd.setCursor(0, 3);
  lcd.print(" *");
  lcd.write(2);  
  lcd.print("  #");
  lcd.write(3);  
  lcd.print("  5MD  1TM");

  scrollPos = 0;
  drawControlScroller();
}

void drawControlScroller() {
  if (currentState != STATE_CONTROL) return;

  lcd.setCursor(0, 1);
  lcd.print(" ");

  String nama = daftarLampu[controlIndex].deskripsi;

  if (nama.length() <= 18) {
    int spaces = (18 - nama.length()) / 2;
    for (int i = 0; i < spaces; i++) lcd.print(" ");
    lcd.print(nama);
    for (int i = 0; i < (18 - spaces - nama.length()); i++) lcd.print(" ");
  } else {
    String paddedName = nama + "    ";
    int len = paddedName.length();
    String view = "";
    for (int i = 0; i < 18; i++) {
      view += paddedName[(scrollPos + i) % len];
    }
    lcd.print(view);
  }
  lcd.print(" ");
}

void drawTimeInputScreen(String title) {
  lcd.clear();
  lcd.setCursor((20 - title.length()) / 2, 0);
  lcd.print(title);

  lcd.setCursor(0, 3);
  lcd.print(" *  BACK / DELETE");

  lcd.setCursor(7, 2);
  for (int i = 0; i < 4; i++) {
    if (i == 2) lcd.print(":");
    if (i < timeInputBuffer.length()) lcd.print(timeInputBuffer[i]);
    else lcd.print("-");
  }
}

// ================= HARDWARE & API LOGIC =================

void controlLampuAPI(int idx, String mode, bool state, String turnOnT, String turnOffT) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(updateUrl + daftarLampu[idx].id);
  http.addHeader("Content-Type", "application/json");

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


// ================= MAIN LOOP =================

void loop() {
  unsigned long currentMillis = millis();

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
       lcd.setCursor(7, 1);
       lcd.print(getLocalTimeStr()); 
       lastClockUpdate = currentMillis;
    }

    if (currentMillis - lastAnimTime > 800) {
      animFrame = (animFrame + 1) % 4;
      lcd.setCursor(15, 0);
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

  // Realtime PZEM Display Updater di Power Menu
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

  // PZEM Background API Sender
  if (currentMillis - lastPzemSendTime > pzemSendInterval) {
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

    // Jika sensor mati / error / listrik padam (isnan(voltage)), set ke 0.0V & 0W tapi TETAP kirim data ke server
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

    // Selalu kirim data ke server (bahkan saat 0V / mati listrik) agar backend dapat mencatat log matlis
    Serial.printf("[DEBUG PZEM] V: %.1f V | A: %.3f A | W: %.1f W | E: %.3f kWh | F: %.1f Hz | PF: %.2f\n",
                  voltage, current, power, energy, frequency, pf);
    sendPzemDataToServer(voltage, current, power, energy, frequency, pf);
    lastPzemSendTime = currentMillis;
  }


  char key = keypad.getKey();
  if (key) {
    lastKeyPressTime = currentMillis; // RESET TIMER
    
    if (isScreenSaverActive) {
      isScreenSaverActive = false;
      targetBrightness = 200;
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
           settingsCursor = 0;
           currentState = STATE_MENU_SETTINGS;
           drawSettingsMenu();
         } else if (parentMenuCursor == 3) {
           playTransition();
           setPzemIcons();
           currentState = STATE_MENU_POWER;
           lcd.clear();
           drawPzemMenu();
         }
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
            delay(300);  
            drawTimeInputScreen("SET OFF TIME");
          } else {
            String tempTurnOffTime = timeInputBuffer.substring(0, 2) + ":" + timeInputBuffer.substring(2, 4);
            delay(300);  

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
}
