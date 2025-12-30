# Data Sensor WebSocket Guide

Panduan ini menjelaskan cara menggunakan kanal WebSocket `/dataSensor` untuk menerima data sensor secara realtime maupun historis.

## Ikhtisar
- **Endpoint dasar**: `ws://<host>:<port>/dataSensor?token=<JWT>`
- **Autentikasi**: parameter query `token` berisi JWT valid (`JWT_SECRET`). Token kedaluwarsa atau tidak ada akan ditolak.
- **Enkripsi payload**: seluruh payload yang dikirim server atau dikirim balik ke klien melalui `ws.send()` sudah dibungkus helper `encryptData` (`helper/encyptJson.js`). Klien wajib mendekripsi menggunakan `WS_SECRET_KEY` yang sama.
- **Polling internal**: server melakukan push setiap `SENSOR_PUSH_INTERVAL_MS` (default 2000 ms) hanya saat ada perubahan dataset.

## Variabel Lingkungan Terkait
| Nama | Deskripsi | Default |
| --- | --- | --- |
| `SENSOR_PUSH_INTERVAL_MS` | Interval loop broadcast realtime (ms) | `2000` |
| `SENSOR_RECENT_LIMIT` | Jumlah data terakhir untuk snapshot realtime | `10` |
| `SENSOR_HISTORY_DEFAULT_LIMIT` | Limit default saat permintaan history tanpa limit eksplisit | `288` |
| `SENSOR_HISTORY_MAX_LIMIT` | Limit maksimum yang diizinkan untuk permintaan history | `2000` |
| `SENSOR_HISTORY_MAX_RANGE_DAYS` | Rentang hari maksimum untuk query history | `30` |
| `WS_SECRET_KEY` | Kunci AES-256-CBC untuk enkripsi payload | — |
| `JWT_SECRET` | Kunci signing token | — |

## Alur Realtime
1. Klien membuka koneksi ke endpoint dengan token valid.
2. Server menambahkan klien ke set subscriber dan langsung mengirim snapshot terbaru (hasil `sendSensor()` tanpa filter).
3. Saat ada pembaruan data sensor (atau ketika cache kosong), server menyiapkan payload:
   ```jsonc
   {
     "latest": {
       "voltage": 11.9,
       "ph": 6.7,
       "temperature": 27.4,
       "humidity": 63.1,
       "ldr": true,
       "updatedAt": "14:22:31"
     },
     "history": {
       "temperature": {
         "value": [27.2, 27.3, 27.4],
         "timestamp": ["14:20:30", "14:21:30", "14:22:30"]
       },
       "...": {}
     }
   }
   ```
4. Payload di-enkripsi dan dikirim ke semua subscriber.

> **Catatan**: `latest.updatedAt` menggunakan format jam lokal (`HH:mm:ss`).

## Permintaan Data Historis
Selain stream realtime, klien dapat meminta data historis melalui pesan WebSocket setelah koneksi terbentuk.

### Format Permintaan
```json
{
  "type": "historyRequest",
  "requestId": "chart-2025-04-05",
  "startDate": "2025-04-05T00:00:00Z",
  "endDate": "2025-04-05T23:59:59Z",
  "limit": 500
}
```

Alternatif: kirim satu field `date` untuk otomatis mengambil rentang satu hari penuh.
```json
{
  "type": "historyRequest",
  "requestId": "chart-2025-04-05",
  "date": "2025-04-05"
}
```

### Aturan Validasi
- `startDate` dan `endDate` wajib ada kecuali menggunakan `date`.
- `startDate` ≤ `endDate`.
- Rentang tidak boleh melebihi `SENSOR_HISTORY_MAX_RANGE_DAYS`.
- `limit` opsional; jika tidak diisi server memakai default (`SENSOR_HISTORY_DEFAULT_LIMIT`). Nilai limit tidak boleh melampaui `SENSOR_HISTORY_MAX_LIMIT`.
- Semua tanggal harus valid ISO 8601.

### Respons Berhasil
```json
{
  "type": "historyResponse",
  "requestId": "chart-2025-04-05",
  "range": {
    "start": "2025-04-05T00:00:00.000Z",
    "end": "2025-04-05T23:59:59.999Z"
  },
  "limit": 500,
  "total": 480,
  "latest": {
    "voltage": 12.0,
    "ph": 6.5,
    "temperature": 28.1,
    "humidity": 62.3,
    "ldr": false,
    "updatedAt": "2025-04-05T23:59:20.000Z"
  },
  "history": {
    "temperature": {
      "value": [26.9, 27.4, 28.1, "..."],
      "timestamp": [
        "2025-04-05T12:00:00.000Z",
        "2025-04-05T12:05:00.000Z",
        "2025-04-05T12:10:00.000Z",
        "..."
      ]
    },
    "humidity": { "...": "..." },
    "voltage": { "...": "..." },
    "ph": { "...": "..." },
    "ldr": { "...": "..." }
  }
}
```
- `total` menunjukkan jumlah baris yang dikembalikan untuk rentang tersebut.
- `history.*.timestamp` selalu dalam ISO string saat permintaan history aktif (agar mudah dipetakan ke chart time-series).

### Respons Error
Jika validasi gagal atau range terlalu besar, server mengirim:
```json
{
  "type": "historyError",
  "requestId": "chart-2025-04-05",
  "message": "Rentang maksimal 30 hari"
}
```

## Contoh Klien (Browser)
```javascript
import { decryptPayload } from "./crypto.js"; // gunakan WS_SECRET_KEY yang sama

const ws = new WebSocket("ws://localhost:1777/dataSensor?token=<JWT>");

ws.onopen = () => {
  console.log("connected");

  ws.send(JSON.stringify({
    type: "historyRequest",
    requestId: "chart-2025-04-05",
    date: "2025-04-05"
  }));
};

ws.onmessage = (event) => {
  const envelope = JSON.parse(event.data);
  const payload = decryptPayload(envelope); // hasil decrypt JSON asli

  if (payload.type === "historyResponse") {
    renderHistory(payload.history);
  } else if (payload.type === "historyError") {
    console.error("History error", payload.message);
  } else {
    renderRealtime(payload.latest, payload.history);
  }
};

ws.onclose = () => console.log("disconnected");
```

## Troubleshooting
- **`Token is required`**: tambahkan query `?token=<JWT>` saat membuka WebSocket.
- **`Invalid or expired token`**: pastikan JWT belum kedaluwarsa dan memakai `JWT_SECRET` terbaru.
- **`Rentang maksimal X hari`**: perkecil rentang `startDate/endDate` atau gunakan pagination `limit`.
- **Payload tidak bisa didekripsi**: cek `WS_SECRET_KEY` antara server dan klien serta IV/Content yang diterima.

---
Referensi kode utama:
- [sockets/dataSensor.js](../sockets/dataSensor.js)
- [functions/sendSensor.js](../functions/sendSensor.js)
- [helper/encyptJson.js](../helper/encyptJson.js)
