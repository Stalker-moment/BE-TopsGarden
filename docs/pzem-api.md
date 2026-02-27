# PZEM Sensor API Documentation

Dokumentasi ini mencakup endpoint HTTP dan WebSocket untuk manajemen sensor PZEM-004T/016/017 (Voltage, Current, Power, Energy, Frequency, PF).

---

## 1. Base URL

`{API_URL}/api/device/pzem`

---

## 2. API Endpoints

### A. Manajemen Device (CRUD)

#### 1. List Semua Sensor

Mengambil daftar semua sensor yang terdaftar.

- **URL**: `GET /`
- **Response**:
  ```json
  [
    {
      "id": "uuid-string",
      "name": "Panel Utama",
      "location": "Gudang",
      "isActive": true,
      "shouldReset": false,
      "lastResetAt": null
    }
  ]
  ```

#### 2. Register Sensor Baru

- **URL**: `POST /`
- **Body**:
  ```json
  {
    "name": "Pompa Air",
    "location": "Taman Belakang"
  }
  ```

#### 3. Update Sensor

- **URL**: `PUT /:id`
- **Body** (optional fields):
  ```json
  {
    "name": "Pompa Air Baru",
    "location": "Taman Depan",
    "isActive": false
  }
  ```

#### 4. Delete Sensor

- **URL**: `DELETE /:id`

---

### B. Dashboard Data

#### 1. Data Realtime & Kartu Statistik

Mengambil data terakhir untuk ditampilkan di kartu dashboard (Voltage, Current, Power, Energy).

- **URL**: `GET /:id/latest`
- **Response**:
  ```json
  {
    "latest": {
      "id": "...",
      "voltage": 220.5,
      "current": 1.2,
      "power": 264.0,
      "energy": 50.1, // kWh kumulatif (sejak reset terakhir)
      "frequency": 50.0,
      "pf": 0.98,
      "createdAt": "2023-10-27T10:00:00.000Z"
    },
    "status": "ONLINE"
  }
  ```

#### 2. Grafik "Live Load Trend"

Mengambil 50 data terakhir untuk grafik realtime.

- **URL**: `GET /:id/chart`
- **Response**: Array of Objects (PzemLog) terurut dari lama ke baru.

#### 3. Tabel Log Historis

Mengambil data mentah untuk tabel "Recent Logs".

- **URL**: `GET /:id/logs?limit=20`
- **Query Params**: `limit` (default: 20)

#### 4. Trigger Reset Energi (Bulanan)

Mengirim perintah agar alat mereset nilai kWh menjadi 0. Biasanya digunakan saat pergantian bulan tagihan listrik.

- **URL**: `POST /:id/reset-command`
- **Response**:
  ```json
  {
    "message": "Reset command queued. Device will reset on next connection."
  }
  ```
- **Flow**:
  1. Frontend panggil endpoint ini.
  2. status `shouldReset` di database menjadi `true`.
  3. Saat ESP32 mengirim data berikutnya, server membalas dengan perintah reset.
  4. ESP32 mereset modul PZEM.
  5. Jika data energi berikutnya mendekati 0, server otomatis mematikan flag `shouldReset`.

---

### C. Ingestion (Khusus ESP32 / IoT Device)

- **URL**: `POST /data`
- **Body**:
  ```json
  {
    "deviceId": "uuid-device-id",
    "voltage": 220.5,
    "current": 1.4,
    "power": 308.0,
    "energy": 120.5,
    "frequency": 50.0,
    "pf": 0.95
  }
  ```
- **Response (Penting untuk Logic Reset Device)**:
  ```json
  {
    "status": "success",
    "command": "OK"
    // Jika command === "RESET_ENERGY", ESP32 harus memanggil fungsi resetEnergy() library PZEM.
    // Jika command === "OK", tidak ada aksi.
  }
  ```

---

## 3. WebSocket API

Digunakan untuk monitoring realtime tanpa polling terus menerus dari frontend.

- **URL**: `ws://localhost:1777/pzem`
- **Behavior**:
  - Server otomatis melakukan polling internal ke database/memori setiap 1 detik.
  - Mengirimkan array data terbaru dari **SEMUA** sensor aktif.
- **Data Format**:
  ```json
  [
    {
      "id": "uuid-device-1",
      "name": "Panel Utama",
      "location": "Gudang",
      "lastUpdate": "2023-10-27T10:00:05.000Z",
      "data": {
        "voltage": 221.0,
        "current": 5.0,
        "power": 1100.0,
        ...
      },
      "logs": [
        { "id": "...", "voltage": 221.0, "createdAt": "..." },
        ...
      ],
      "chart": [
        { "voltage": 220.5, "createdAt": "..." },
        { "voltage": 221.0, "createdAt": "..." }
      ]
    },
    {
        "id": "uuid-device-2",
        ...
    }
  ]
  ```

---

## 4. Catatan Frontend

1. **Reset Bulanan**: Sediakan tombol "Reset KWh" di menu setting atau dashboard. Panggil endpoint `POST /:id/reset-command` saat diklik. Tampilkan loading/status "Pending Reset" sampai angka energi di dashboard kembali ke 0.
2. **Grafik**: Gunakan endpoint `GET /:id/chart` untuk inisialisasi awal grafik, lalu update data terbaru via WebSocket atau polling `GET /:id/latest`.
