#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>

// WiFi Credentials
const char* ssid = "TopsGarden";
const char* password = "Tops010707";
const char* apiUrl = "https://gardenapi.tierkun.my.id/api/device/output-device";

// Gunakan WiFiClientSecure untuk HTTPS
WiFiClientSecure client;
HTTPClient http;

const int relayPins[] = {16, 5, 4, 0, 2, 14, 12, 13}; // D0 - D7
const int relayCount = sizeof(relayPins) / sizeof(relayPins[0]);

void setup() {
    Serial.begin(115200);
    WiFi.begin(ssid, password);
    
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        Serial.print(".");
        delay(1000);
    }
    Serial.println("\nWiFi Connected!");

    // Nonaktifkan verifikasi SSL (karena ESP8266 sulit memverifikasi sertifikat)
    client.setInsecure();

    // Atur pin relay sebagai OUTPUT
    for (int i = 0; i < relayCount; i++) {
        pinMode(relayPins[i], OUTPUT);
        digitalWrite(relayPins[i], HIGH);
    }
}

void loop() {
    if (WiFi.status() == WL_CONNECTED) {
        http.begin(client, apiUrl);
        http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS); // Ikuti redirect otomatis
        
        int httpResponseCode = http.GET();
        if (httpResponseCode == 200) {
            String response = http.getString();
            Serial.println("Response: " + response);

            StaticJsonDocument<1024> doc;
            DeserializationError error = deserializeJson(doc, response);
            if (!error) {
                int index = 0;
                for (JsonObject obj : doc.as<JsonArray>()) {
                    if (index < relayCount) {
                        bool state = obj["state"];
                        digitalWrite(relayPins[index], state ? LOW : HIGH);
                        Serial.printf("Relay %d (%s) -> %s\n", index, obj["name"].as<const char*>(), state ? "ON" : "OFF");
                        index++;
                    }
                }
            } else {
                Serial.println("JSON Parsing Error!");
            }
        } else {
            Serial.printf("HTTP Request Failed, Code: %d\n", httpResponseCode);
        }

        http.end();
    } else {
        Serial.println("WiFi Disconnected, Reconnecting...");
        WiFi.begin(ssid, password);
    }

    delay(2000);
}
