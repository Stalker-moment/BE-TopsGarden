#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Keypad.h>

// --- KONFIGURASI LCD ---
// Sesuaikan alamat I2C (biasanya 0x27 atau 0x3F)
LiquidCrystal_I2C lcd(0x3F, 20, 4); 

// --- KONFIGURASI KEYPAD 3x4 ---
const byte ROWS = 4; // Empat baris
const byte COLS = 3; // Tiga kolom

char keys[ROWS][COLS] = {
  {'1','2','3'},
  {'4','5','6'},
  {'7','8','9'},
  {'*','0','#'}
};

// Mapping Pin sesuai Markdown Wiring sebelumnya
byte rowPins[ROWS] = {13, 12, 14, 27}; 
byte colPins[COLS] = {26, 25, 33}; 

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

void setup() {
  Serial.begin(115200);
  
  // Inisialisasi LCD
  lcd.init();
  lcd.backlight();
  
  // Pesan Awal
  lcd.setCursor(0, 0);
  lcd.print("Testing Hardware:");
  lcd.setCursor(0, 1);
  lcd.print("Keypad 3x4 Ready");
  lcd.setCursor(0, 3);
  lcd.print("Tekan sembarang...");
  
  Serial.println("System Ready. Silakan tekan tombol pada Keypad.");
}

void loop() {
  char key = keypad.getKey();

  if (key) {
    // Tampilkan di Serial Monitor
    Serial.print("Tombol ditekan: ");
    Serial.println(key);

    // Tampilkan di LCD
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Testing Keypad");
    
    lcd.setCursor(0, 2);
    lcd.print("Tombol: ");
    lcd.setCursor(9, 2);
    lcd.print("[ ");
    lcd.print(key);
    lcd.print(" ]");

    lcd.setCursor(0, 3);
    lcd.print("Status: BERHASIL!");
    
    // Delay sebentar agar terlihat, lalu tampilkan instruksi lagi
    delay(1000);
    lcd.setCursor(0, 3);
    lcd.print("Tekan lagi...       ");
  }
}